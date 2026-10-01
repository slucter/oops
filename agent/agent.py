#!/usr/bin/env python3
"""
Agent Oops versi Python — setara fitur dengan agent.js.

Dipakai ketika server client punya Python 3 tapi tidak punya Node.js,
supaya tidak perlu memasang runtime baru di server orang.

**Tanpa dependensi eksternal sama sekali** — protokol WebSocket
diimplementasikan langsung di atas soket standar. Alasannya: `pip install`
sering tidak tersedia di server minimal, butuh akses ke PyPI yang kadang
diblokir, dan bisa merusak paket Python bawaan sistem. Modul yang dipakai
(`socket`, `ssl`, `struct`, `base64`, `hashlib`, `json`, `subprocess`)
semuanya bawaan Python 3.6+.

Konfigurasi lewat environment variable, sama seperti agent Node:
OOPS_SERVER_URL, OOPS_TOKEN, OOPS_INTERVAL_MS (opsional).
"""

import base64
import hashlib
import json
import os
import re
import shutil
import socket
import ssl
import struct
import subprocess
import sys
import threading
import time
import urllib.request
from urllib.parse import urlparse, urlencode

AGENT_VERSION = '1.6.0'

SERVER_URL = os.environ.get('OOPS_SERVER_URL')
TOKEN = os.environ.get('OOPS_TOKEN')
INTERVAL_MS = int(os.environ.get('OOPS_INTERVAL_MS') or 30000)
SERVICE_NAME = os.environ.get('OOPS_SERVICE_NAME') or 'oops-agent'
AGENT_DIR = os.path.dirname(os.path.abspath(__file__))

RECONNECT_BASE_S = 2
RECONNECT_MAX_S = 60

# Berapa kali token boleh ditolak (HTTP 401) sebelum agent menyimpulkan dirinya
# memang sudah dicabut lalu berhenti. Tidak langsung di penolakan pertama:
# database server bisa saja sedang di-restore dari backup, dan agent yang
# menghapus dirinya karena gangguan sesaat tidak bisa dibatalkan dari jarak
# jauh — harus datang ke server itu lagi secara manual.
MAX_TOKEN_REJECTIONS = int(os.environ.get('OOPS_MAX_TOKEN_REJECTIONS') or 10)

if not SERVER_URL or not TOKEN:
    print('[agent] OOPS_SERVER_URL dan OOPS_TOKEN wajib diset.', file=sys.stderr)
    sys.exit(1)


# ===================== WebSocket minimal (RFC 6455) =====================

class WebSocketError(Exception):
    pass


class TokenDitolak(WebSocketError):
    """
    Server menjawab HTTP 401 saat handshake: token tidak dikenal.

    Kelas sendiri, bukan pemeriksaan teks pesan error, supaya pemanggil bisa
    membedakan "client sudah dihapus dari dashboard" dari kegagalan koneksi
    biasa secara andal — pencocokan string akan diam-diam berhenti bekerja
    kalau pesannya berubah sedikit saja.
    """
    pass


class WebSocket:
    """
    Klien WebSocket seperlunya: handshake, kirim/terima frame teks, serta
    ping/pong.

    Yang sengaja TIDAK didukung karena tidak dipakai protokol Oops:
    ekstensi (permessage-deflate) dan frame biner. Fragmentasi ditangani,
    karena server berhak memecah pesan kapan saja dan mengabaikannya akan
    menyebabkan pesan rusak yang sulit dilacak.
    """

    OP_CONT, OP_TEXT, OP_BIN = 0x0, 0x1, 0x2
    OP_CLOSE, OP_PING, OP_PONG = 0x8, 0x9, 0xA

    def __init__(self, url, timeout=20):
        u = urlparse(url)
        secure = u.scheme in ('wss', 'https')
        port = u.port or (443 if secure else 80)
        path = u.path or '/'
        if u.query:
            path += '?' + u.query

        raw = socket.create_connection((u.hostname, port), timeout=timeout)
        if secure:
            ctx = ssl.create_default_context()
            raw = ctx.wrap_socket(raw, server_hostname=u.hostname)

        self.sock = raw
        self._buf = b''
        self._send_lock = threading.Lock()
        self._handshake(u.hostname, port, path, secure)
        # Setelah handshake, baca dengan timeout supaya loop utama tidak
        # terblokir selamanya kalau server diam — koneksi menggantung
        # tanpa batas adalah cara paling umum agent "hidup tapi bisu".
        #
        # Timeout ini berlaku untuk KIRIM maupun TERIMA. Itu pernah jadi
        # masalah nyata: saat `docker builder prune` membanjiri I/O server,
        # sendall() melebihi batas, melempar socket.timeout, dan agent
        # terputus lalu di-restart systemd berulang kali. Karena itu
        # send_text() menaikkan batasnya sementara saat mengirim — lihat
        # _send_frame().
        self._baca_timeout = timeout
        self.sock.settimeout(timeout)

    def _handshake(self, host, port, path, secure):
        key = base64.b64encode(os.urandom(16)).decode()
        default_port = 443 if secure else 80
        host_header = host if port == default_port else '%s:%d' % (host, port)
        req = (
            'GET %s HTTP/1.1\r\n'
            'Host: %s\r\n'
            'Upgrade: websocket\r\n'
            'Connection: Upgrade\r\n'
            'Sec-WebSocket-Key: %s\r\n'
            'Sec-WebSocket-Version: 13\r\n'
            'User-Agent: oops-agent-python/%s\r\n'
            '\r\n'
        ) % (path, host_header, key, AGENT_VERSION)
        self.sock.sendall(req.encode())

        # Baca header respons sampai baris kosong.
        data = b''
        while b'\r\n\r\n' not in data:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise WebSocketError('koneksi ditutup saat handshake')
            data += chunk
            if len(data) > 65536:
                raise WebSocketError('header handshake terlalu besar')

        head, _, rest = data.partition(b'\r\n\r\n')
        self._buf = rest  # sisa byte bisa jadi awal frame, jangan dibuang
        lines = head.decode('latin-1').split('\r\n')
        if '101' not in lines[0]:
            if ' 401' in lines[0]:
                raise TokenDitolak(lines[0].strip())
            raise WebSocketError('handshake ditolak: %s' % lines[0])

        # Verifikasi Sec-WebSocket-Accept. Tanpa ini, respons 101 dari
        # proxy yang tidak benar-benar berbicara WebSocket akan diterima
        # dan menghasilkan frame kacau yang sulit didiagnosis.
        expected = base64.b64encode(
            hashlib.sha1((key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest()
        ).decode()
        got = None
        for line in lines[1:]:
            name, _, value = line.partition(':')
            if name.strip().lower() == 'sec-websocket-accept':
                got = value.strip()
        if got != expected:
            raise WebSocketError('Sec-WebSocket-Accept tidak cocok')

    def _recv_exact(self, n):
        while len(self._buf) < n:
            chunk = self.sock.recv(max(4096, n - len(self._buf)))
            if not chunk:
                raise WebSocketError('koneksi ditutup')
            self._buf += chunk
        out, self._buf = self._buf[:n], self._buf[n:]
        return out

    def _recv_frame(self):
        b1, b2 = struct.unpack('!BB', self._recv_exact(2))
        fin = bool(b1 & 0x80)
        opcode = b1 & 0x0F
        masked = bool(b2 & 0x80)
        length = b2 & 0x7F

        if length == 126:
            length = struct.unpack('!H', self._recv_exact(2))[0]
        elif length == 127:
            length = struct.unpack('!Q', self._recv_exact(8))[0]

        # Batas akal sehat: server monitoring tidak pernah mengirim pesan
        # besar. Tanpa batas, server (atau siapa pun yang menyamar jadi
        # server) bisa membuat agent mengalokasikan memori tak terbatas.
        if length > 1 << 20:
            raise WebSocketError('frame terlalu besar: %d byte' % length)

        mask = self._recv_exact(4) if masked else None
        payload = self._recv_exact(length) if length else b''
        if mask:
            payload = bytes(payload[i] ^ mask[i % 4] for i in range(len(payload)))
        return fin, opcode, payload

    def recv(self):
        """Kembalikan pesan teks berikutnya, atau None kalau bukan teks."""
        fin, opcode, payload = self._recv_frame()

        if opcode == self.OP_PING:
            self._send_frame(self.OP_PONG, payload)
            return None
        if opcode == self.OP_PONG:
            return None
        if opcode == self.OP_CLOSE:
            raise WebSocketError('server menutup koneksi')

        # Rakit ulang pesan yang dipecah jadi beberapa frame.
        while not fin:
            fin, cont_op, more = self._recv_frame()
            if cont_op == self.OP_PING:
                self._send_frame(self.OP_PONG, more)
                fin = False
                continue
            if cont_op != self.OP_CONT:
                raise WebSocketError('frame lanjutan tidak valid')
            payload += more

        if opcode != self.OP_TEXT:
            return None
        return payload.decode('utf-8', 'replace')

    def _send_frame(self, opcode, payload=b''):
        # Klien WAJIB me-mask setiap frame yang dikirim (RFC 6455 §5.3).
        # Server akan memutus koneksi kalau tidak.
        mask = os.urandom(4)
        masked = bytes(payload[i] ^ mask[i % 4] for i in range(len(payload)))
        n = len(payload)
        if n < 126:
            header = struct.pack('!BB', 0x80 | opcode, 0x80 | n)
        elif n < (1 << 16):
            header = struct.pack('!BBH', 0x80 | opcode, 0x80 | 126, n)
        else:
            header = struct.pack('!BBQ', 0x80 | opcode, 0x80 | 127, n)
        # Batas tulis dilonggarkan jauh melebihi batas baca. Saat server
        # sibuk berat (docker prune, du seluruh disk), sendall bisa tertahan
        # puluhan detik — dan agent yang terputus karena itu justru membuat
        # pekerjaannya gagal di tengah. Dikembalikan ke batas baca setelah
        # selesai supaya loop utama tetap punya timeout yang ketat.
        with self._send_lock:
            try:
                self.sock.settimeout(120)
                self.sock.sendall(header + mask + masked)
            finally:
                try:
                    self.sock.settimeout(self._baca_timeout)
                except Exception:
                    pass

    def send_text(self, text):
        self._send_frame(self.OP_TEXT, text.encode('utf-8'))

    def close(self):
        try:
            self._send_frame(self.OP_CLOSE, struct.pack('!H', 1000))
        except Exception:
            pass
        try:
            self.sock.close()
        except Exception:
            pass


# ===================== Pengumpulan metrik =====================

DELIM = '---oops-delim---'
RESOURCE_COMMAND = '; '.join([
    'free -m', 'echo %s' % DELIM,
    'df -k /', 'echo %s' % DELIM,
    'cat /proc/loadavg', 'echo %s' % DELIM,
    'uptime -p', 'echo %s' % DELIM,
    'nproc',
])


def run(cmd, timeout=10):
    return subprocess.run(
        cmd, shell=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        timeout=timeout,
    ).stdout.decode('utf-8', 'replace')


def _int_or_none(v):
    try:
        return int(str(v).strip())
    except (TypeError, ValueError):
        return None


def _float_or_none(v):
    try:
        return float(str(v).strip())
    except (TypeError, ValueError):
        return None


def _kb_ke_gb(value):
    """Kilobyte -> GB dengan dua desimal. Dipakai untuk keluaran `df -k`."""
    try:
        return round(int(value) / 1048576, 2)
    except (TypeError, ValueError):
        return None


def _size_to_gb(value):
    """Ubah "32G" / "820M" / "1.5T" jadi angka GB. Sama seperti resourceParser.js."""
    if not value:
        return None
    m = re.match(r'^([\d.]+)([KMGT])?$', value, re.I)
    if not m:
        return None
    num = float(m.group(1))
    factor = {'K': 1 / 1048576, 'M': 1 / 1024, 'G': 1.0, 'T': 1024.0}[(m.group(2) or 'G').upper()]
    return round(num * factor, 2)


def parse_resource_output(stdout):
    """
    Parse output gabungan. Setiap bagian yang gagal di-parse jadi None,
    bukan melempar error — command yang tidak ada di satu OS (mis. `nproc`
    di BusyBox) tidak boleh menggagalkan seluruh snapshot.
    """
    parts = [p.strip() for p in stdout.split(DELIM)]
    parts += [''] * (5 - len(parts))
    free_out, df_out, load_out, _uptime_out, nproc_out = parts[:5]

    mem_total = mem_used = None
    for line in free_out.split('\n'):
        if line.strip().startswith('Mem:'):
            cols = line.split()
            mem_total, mem_used = _int_or_none(cols[1]), _int_or_none(cols[2])
            break

    disk_total = disk_used = None
    df_lines = [l for l in df_out.split('\n') if l.strip()]
    if df_lines:
        cols = df_lines[-1].split()
        if len(cols) >= 3:
            # `df -k` memberi angka dalam KILOBYTE, bukan "23G" yang sudah
            # dibulatkan. Presisi itu penting: dengan satuan bulat, 48->49
            # terbaca sebagai lompatan 1 GB penuh dan prediksi disk penuh
            # jadi berosilasi karena derau pembulatan — bukan pertumbuhan
            # nyata. Format "23G" tetap diterima supaya agent lama yang
            # masih mengirim `df -h` tidak rusak.
            disk_total = _kb_ke_gb(cols[1]) if cols[1].isdigit() else _size_to_gb(cols[1])
            disk_used = _kb_ke_gb(cols[2]) if cols[2].isdigit() else _size_to_gb(cols[2])

    load = load_out.split()
    return {
        'memTotalMb': mem_total,
        'memUsedMb': mem_used,
        'diskTotalGb': disk_total,
        'diskUsedGb': disk_used,
        'load1m': _float_or_none(load[0]) if len(load) > 0 else None,
        'load5m': _float_or_none(load[1]) if len(load) > 1 else None,
        'load15m': _float_or_none(load[2]) if len(load) > 2 else None,
        'cpuCount': _int_or_none(nproc_out),
    }


def uptime_seconds():
    try:
        with open('/proc/uptime') as f:
            return int(float(f.read().split()[0]))
    except Exception:
        return None


def private_ip():
    """
    IP internal lewat soket UDP ke alamat luar. Tidak ada paket yang
    benar-benar dikirim — ini hanya membuat kernel memilih interface mana
    yang akan dipakai, lalu alamatnya dibaca. Lebih andal daripada
    mem-parse output `ip`/`ifconfig` yang belum tentu ada di image minimal.
    """
    s = None
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(2)
        s.connect(('8.8.8.8', 80))
        return s.getsockname()[0]
    except Exception:
        return None
    finally:
        if s:
            try:
                s.close()
            except Exception:
                pass


_public_ip = {'value': None, 'at': 0}
PUBLIC_IP_TTL_S = 30 * 60
IP_RE = re.compile(r'^(?:\d{1,3}(?:\.\d{1,3}){3}|[0-9a-fA-F:]{2,45})$')


def refresh_public_ip():
    """Di-cache 30 menit — memanggil layanan luar tiap siklus metrik boros dan bisa kena rate limit."""
    if time.time() - _public_ip['at'] < PUBLIC_IP_TTL_S:
        return
    _public_ip['at'] = time.time()
    try:
        with urllib.request.urlopen('https://api.ipify.org?format=text', timeout=8) as r:
            ip = r.read(64).decode('utf-8', 'replace').strip()
            if IP_RE.match(ip):
                _public_ip['value'] = ip
    except Exception:
        pass  # offline / diblokir firewall: biarkan None, bukan kesalahan fatal


COMMANDS = {'docker_ps': 'docker ps -a', 'port_listen': 'ss -tulnp'}


# ===================== Optimasi =====================

def _disk_bytes():
    """Byte terpakai pada / — dipakai mengukur hasil optimasi, bukan klaim."""
    try:
        st = os.statvfs('/')
        return (st.f_blocks - st.f_bfree) * st.f_frsize
    except Exception:
        return None


def _mem_info():
    """Baca /proc/meminfo seperlunya, dalam kB."""
    hasil = {}
    try:
        with open('/proc/meminfo') as f:
            for baris in f:
                k, _, v = baris.partition(':')
                if k in ('MemTotal', 'MemAvailable', 'Cached', 'Buffers', 'SReclaimable', 'MemFree'):
                    hasil[k] = int(v.strip().split()[0])
    except Exception:
        pass
    return hasil


def _punya(cmd):
    return shutil.which(cmd) is not None


def _jalan(perintah, timeout=120):
    """
    Jalankan satu langkah optimasi. Tidak pernah melempar — satu langkah yang
    gagal (mis. perintahnya tidak ada) tidak boleh menggagalkan sisanya.
    """
    try:
        p = subprocess.run(perintah, shell=True, timeout=timeout,
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        return p.returncode == 0, (p.stdout + p.stderr).decode('utf-8', 'replace').strip()
    except Exception as e:
        return False, str(e)


def _langkah_aman():
    """
    Langkah yang tidak menyentuh data aplikasi, tidak merestart apa pun, dan
    tidak menghapus apa pun yang masih dipakai.

    Tiap langkah: (nama, perintah, butuh_sudo). Yang butuh sudo dilewati
    diam-diam kalau tidak ada sudo tanpa kata sandi — agent berjalan sebagai
    user biasa, dan meminta kata sandi dari proses non-interaktif hanya akan
    menggantung.
    """
    langkah = []

    # Journal systemd sering jadi pemakan disk terbesar yang tidak disadari.
    # Dipangkas ke 200M, bukan dihapus: riwayat terbaru tetap ada untuk
    # menyelidiki insiden.
    if _punya('journalctl'):
        langkah.append(('journal systemd dipangkas ke 200M',
                        'journalctl --vacuum-size=200M', True))

    # Cache paket: aman dibuang, terunduh ulang saat dibutuhkan.
    if _punya('apt-get'):
        langkah.append(('cache apt dibersihkan', 'apt-get clean', True))
    elif _punya('yum'):
        langkah.append(('cache yum dibersihkan', 'yum clean all', True))
    elif _punya('dnf'):
        langkah.append(('cache dnf dibersihkan', 'dnf clean all', True))
    elif _punya('apk'):
        langkah.append(('cache apk dibersihkan', 'rm -rf /var/cache/apk/*', True))

    # File sementara yang sudah lama. Batas 7 hari, bukan semua: proses yang
    # sedang berjalan bisa saja memakai file /tmp yang baru dibuat.
    langkah.append(('file /tmp lebih tua dari 7 hari dihapus',
                    "find /tmp -mindepth 1 -atime +7 -delete 2>/dev/null; true", False))

    # Log yang sudah dirotasi dan dikompresi — isinya riwayat lama.
    langkah.append(('log rotasi lama (>30 hari) dihapus',
                    "find /var/log -type f \\( -name '*.gz' -o -name '*.[0-9]' "
                    "-o -name '*.old' \\) -mtime +30 -delete 2>/dev/null; true", True))

    # Cache milik user yang menjalankan agent — tidak menyentuh milik user lain.
    langkah.append(('cache thumbnail/pip/npm milik user dibersihkan',
                    "rm -rf ~/.cache/thumbnails/* ~/.cache/pip/* ~/.npm/_cacache 2>/dev/null; true",
                    False))

    return langkah


def _langkah_docker():
    """
    Docker: hanya yang benar-benar tidak terpakai.

    `builder prune -f` membuang cache build, dan `image prune -f` (TANPA -a)
    hanya membuang image dangling — image tanpa tag yang tertinggal dari build
    ulang. `-a` akan ikut menghapus image bertag yang sedang tidak ada
    containernya, termasuk image yang sengaja disimpan untuk rollback.
    """
    if not _punya('docker'):
        return []
    # Urutan dari yang paling ringan ke paling berat. `builder prune` bisa
    # menghapus gigabyte cache dan membanjiri I/O sampai belasan menit;
    # menaruhnya terakhir berarti langkah-langkah ringan sudah selesai dan
    # terlaporkan lebih dulu, jadi kalau yang berat gagal pun hasilnya tidak
    # hilang semua.
    return [
        ('container mati dibuang', 'docker container prune -f', False),
        ('network tak terpakai dibuang', 'docker network prune -f', False),
        ('image docker dangling dibuang', 'docker image prune -f', False),
        ('cache build docker dibuang', 'docker builder prune -f', False),
    ]


def _sudo_tanpa_sandi():
    """
    Apakah sudo bisa dipakai tanpa kata sandi?

    Diperiksa lebih dulu dengan `-n` supaya langkah yang butuh sudo dilewati
    rapi, bukan menggantung menunggu kata sandi yang tidak akan pernah datang
    dari proses non-interaktif.
    """
    if os.getuid() == 0:
        return True
    if not _punya('sudo'):
        return False
    try:
        p = subprocess.run(['sudo', '-n', 'true'], timeout=8,
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        return p.returncode == 0
    except Exception:
        return False


def jalankan_optimasi(sertakan_docker=False, lapor=None):
    """
    Bersihkan yang aman dibersihkan, lalu laporkan dampaknya yang terukur.

    Disk diukur sebelum dan sesudah, jadi angka yang dilaporkan adalah hasil
    nyata — bukan penjumlahan perkiraan tiap langkah.

    `lapor(nomor, total, nama)` dipanggil sebelum tiap langkah kalau diberikan,
    supaya dashboard bisa menampilkan kemajuan. Optimasi bisa memakan beberapa
    menit (journal 3.5GB, docker cache 2GB), dan tanpa kabar apa pun selama itu
    pengguna tidak bisa membedakan "sedang bekerja" dari "macet".

    RAM SENGAJA TIDAK DISENTUH. Linux memakai RAM kosong sebagai cache disk
    dengan sengaja; `drop_caches` membuat angka "used" turun tapi justru
    memperlambat server karena semua data harus dibaca ulang dari disk. Yang
    dilaporkan adalah MemAvailable — berapa yang benar-benar bisa dipakai
    aplikasi baru, yang biasanya jauh lebih besar dari kesan angka "free".
    """
    disk_awal = _disk_bytes()
    mem = _mem_info()

    is_root = os.getuid() == 0
    bisa_sudo = _sudo_tanpa_sandi()

    langkah = _langkah_aman()
    if sertakan_docker:
        langkah += _langkah_docker()

    hasil = []
    dilewati = []

    # Hanya langkah yang benar-benar akan dijalankan yang dihitung, supaya
    # "3 dari 8" tidak berhenti di 6 karena sisanya dilewati.
    akan_jalan = [l for l in langkah if not (l[2] and not bisa_sudo)]
    total = len(akan_jalan)
    nomor = 0

    for nama, perintah, butuh_sudo in langkah:
        if butuh_sudo and not bisa_sudo:
            dilewati.append(nama)
            continue
        nomor += 1
        if lapor:
            try:
                lapor(nomor, total, nama)
            except Exception:
                pass  # kabar kemajuan tidak boleh menggagalkan optimasi
        if butuh_sudo and not is_root:
            perintah = 'sudo -n ' + perintah

        # Kabar berkala SELAMA langkah berjalan, bukan hanya sebelumnya.
        # Satu langkah bisa memakan menit (journal besar, docker prune), dan
        # tanpa ini layar diam sepanjang itu — tidak ada cara membedakan
        # "sedang bekerja" dari "macet".
        berhenti = threading.Event()

        def denyut(nm=nama, no=nomor):
            detik = 0
            while not berhenti.wait(5):
                detik += 5
                if lapor:
                    try:
                        lapor(no, total, '%s (%d detik)' % (nm, detik))
                    except Exception:
                        pass

        t_denyut = threading.Thread(target=denyut, daemon=True)
        t_denyut.start()
        try:
            # Docker prune pada cache besar bisa memakan belasan menit.
            # Timeout 120 detik seragam membuatnya dibunuh di tengah, dan
            # cache yang setengah terhapus tidak membebaskan apa pun.
            batas = 1200 if 'docker' in perintah else 300
            ok, keluaran = _jalan(perintah, timeout=batas)
        finally:
            berhenti.set()

        hasil.append({'nama': nama, 'ok': ok,
                      'pesan': keluaran[:300] if keluaran else None})

    disk_akhir = _disk_bytes()
    hemat = None
    if disk_awal is not None and disk_akhir is not None:
        hemat = max(0, disk_awal - disk_akhir)

    total_kb = mem.get('MemTotal', 0)
    tersedia_kb = mem.get('MemAvailable', 0)
    cache_kb = mem.get('Cached', 0) + mem.get('Buffers', 0) + mem.get('SReclaimable', 0)

    return {
        'hematBytes': hemat,
        'langkah': hasil,
        'dilewati': dilewati,
        'butuhSudo': not bisa_sudo,
        'dockerTersedia': _punya('docker'),
        'memTotalMb': round(total_kb / 1024) if total_kb else None,
        'memTersediaMb': round(tersedia_kb / 1024) if tersedia_kb else None,
        'memCacheMb': round(cache_kb / 1024) if cache_kb else None,
    }


# ===================== Update mandiri =====================

UPDATE_FILES = ['agent.py']


def handle_self_update(ws, req_id):
    """
    Perbarui agent ini sendiri. Pertimbangan sama persis dengan versi Node:
    unduh ke lokasi sementara dulu (kalau putus di tengah, yang tersisa
    bukan berkas terpotong yang membuat agent tidak pernah hidup lagi),
    simpan cadangan, dan balas SEBELUM restart (setelah restart, socket
    sudah mati dan balasan tidak akan pernah sampai).
    """
    def reply(ok, message):
        try:
            ws.send_text(json.dumps({
                'type': 'update_result', 'id': req_id,
                'ok': ok, 'message': message, 'version': AGENT_VERSION,
            }))
        except Exception:
            pass

    print('[agent] menerima perintah update, mengunduh berkas baru...')
    tmp = os.path.join(AGENT_DIR, '.update-tmp')
    try:
        shutil.rmtree(tmp, ignore_errors=True)
        os.makedirs(tmp, exist_ok=True)

        for name in UPDATE_FILES:
            url = SERVER_URL.rstrip('/') + '/agent-files/' + name
            dest = os.path.join(tmp, name)
            with urllib.request.urlopen(url, timeout=30) as r:
                data = r.read()
            if not data:
                raise RuntimeError('berkas %s kosong' % name)
            with open(dest, 'wb') as f:
                f.write(data)

        # Semua berkas lengkap di tmp. Baru sekarang menyentuh yang asli.
        for name in UPDATE_FILES:
            target = os.path.join(AGENT_DIR, name)
            if os.path.exists(target):
                shutil.copyfile(target, target + '.bak')
            shutil.move(os.path.join(tmp, name), target)
            os.chmod(target, 0o755)
        shutil.rmtree(tmp, ignore_errors=True)

        print('[agent] berkas diperbarui, restart service...')
        reply(True, 'Berkas agent diperbarui, service sedang restart.')
        time.sleep(0.5)  # beri waktu balasan terkirim sebelum proses mati

        env = dict(os.environ)
        env.setdefault('XDG_RUNTIME_DIR', '/run/user/%d' % os.getuid())
        try:
            subprocess.run(['systemctl', '--user', 'restart', SERVICE_NAME],
                           timeout=20, env=env, check=True,
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        except Exception as e:
            # systemctl tidak bisa dipanggil (mis. dijalankan manual).
            # Keluar dengan kode error — kalau ini memang service,
            # Restart=always yang menghidupkan kembali.
            print('[agent] systemctl restart gagal, keluar supaya di-restart: %s' % e, file=sys.stderr)
        os._exit(1)
    except Exception as e:
        print('[agent] update gagal: %s' % e, file=sys.stderr)
        shutil.rmtree(tmp, ignore_errors=True)
        # Kalau gagal di tahap unduh, berkas asli belum tersentuh sama
        # sekali — agent tetap jalan dengan versi lama.
        reply(False, 'Update gagal: %s' % e)


# ===================== Loop utama =====================

def self_uninstall(alasan):
    """
    Hapus agent ini dari server tempatnya berjalan.

    Urutannya penting. `disable` dijalankan sebelum proses ini mati, karena
    setelah itu tidak ada lagi yang bisa menjalankan perintah — kalau
    dibalik, unit-nya tetap enabled dan agent hidup lagi begitu server
    di-reboot, justru setelah "berhasil" di-uninstall.

    Direktori dihapus paling akhir lewat proses terpisah: kita sedang
    menghapus folder tempat berkas yang sedang dieksekusi berada, jadi
    penghapusnya tidak boleh ikut mati bersama proses ini.
    """
    print('[agent] uninstall: %s' % alasan)

    env = dict(os.environ)
    env.setdefault('XDG_RUNTIME_DIR', '/run/user/%d' % os.getuid())

    try:
        subprocess.run(['systemctl', '--user', 'disable', SERVICE_NAME],
                       timeout=15, env=env,
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    except Exception:
        pass  # systemd mungkin tidak dipakai; bukan alasan berhenti

    unit = os.path.join(os.environ.get('HOME', ''),
                        '.config/systemd/user/%s.service' % SERVICE_NAME)
    try:
        if os.environ.get('HOME') and os.path.exists(unit):
            os.unlink(unit)
    except Exception as e:
        print('[agent] gagal menghapus unit file: %s' % e, file=sys.stderr)

    # `stop` dipanggil di dalam skrip terpisah supaya systemd tidak menganggap
    # ini crash lalu me-restart kita di tengah penghapusan.
    # Pembersih HARUS lepas dari cgroup service ini.
    #
    # Ditemukan lewat pengujian di Linux, bukan dugaan: subprocess biasa —
    # bahkan dengan start_new_session — tetap berada di cgroup unit systemd,
    # dan systemd membunuh seluruh cgroup saat unit berhenti. Jadi pembersih
    # ikut mati sebelum sempat menghapus apa pun, lalu Restart=always
    # menghidupkan agent kembali. Hasilnya: agent mencoba mencabut diri
    # berulang-ulang tanpa pernah berhasil.
    #
    # `systemd-run` menjalankan perintah sebagai unit transient miliknya
    # sendiri, di luar cgroup kita, sehingga selamat saat unit ini dimatikan.
    #
    # Yang juga sudah dicoba dan TIDAK bekerja: `disable` saja (hanya
    # mencegah start saat boot), dan `set-property Restart=no` (systemd
    # menolak — Restart bukan properti yang bisa diubah saat runtime).
    perintah = '; '.join([
        'sleep 1',
        'systemctl --user stop %s 2>/dev/null || true' % SERVICE_NAME,
        'systemctl --user reset-failed %s 2>/dev/null || true' % SERVICE_NAME,
        'systemctl --user daemon-reload 2>/dev/null || true',
        "rm -rf '%s'" % AGENT_DIR.replace("'", "'\\''"),
    ])
    dijadwalkan = False
    try:
        r = subprocess.run(
            ['systemd-run', '--user', '--collect', '--quiet',
             '--unit', 'oops-cleanup-%d' % int(time.time()),
             '/bin/sh', '-c', perintah],
            timeout=15, env=env,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        dijadwalkan = (r.returncode == 0)
        if not dijadwalkan:
            print('[agent] systemd-run gagal: %s'
                  % r.stderr.decode('utf-8', 'replace').strip(), file=sys.stderr)
    except Exception as e:
        print('[agent] systemd-run tidak tersedia: %s' % e, file=sys.stderr)

    if not dijadwalkan:
        # Tanpa systemd-run (mis. agent dijalankan manual, bukan sebagai
        # service), tidak ada cgroup yang membunuh kita — proses terpisah
        # biasa sudah cukup.
        try:
            subprocess.Popen(['/bin/sh', '-c', perintah], env=env,
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                             start_new_session=True)
        except Exception as e:
            print('[agent] gagal menjadwalkan pembersihan: %s' % e, file=sys.stderr)

    print('[agent] service dicabut, direktori akan dihapus. Selamat tinggal.')
    # Exit 0: penghentian yang disengaja. Kode error akan membuat systemd
    # menganggapnya crash lalu me-restart kita.
    os._exit(0)


def handle_uninstall_command(ws, req_id):
    """Uninstall atas perintah dashboard — balas dulu, baru bersihkan."""
    try:
        ws.send_text(json.dumps({
            'type': 'uninstall_result', 'id': req_id, 'ok': True,
            'message': 'Agent dicabut dari server ini.',
        }))
    except Exception:
        pass
    time.sleep(0.5)  # beri waktu balasan terkirim sebelum socket ikut mati
    self_uninstall('diperintahkan dari dashboard')


# ===================== Pemetaan disk =====================

# Folder yang isinya tidak dibongkar. Bukan diabaikan — folder ini tetap
# muncul sebagai satu baris dengan total ukurannya, hanya isinya yang tidak
# ditelusuri. Membongkar node_modules menghasilkan ribuan folder kecil yang
# memenuhi peta tanpa memberi tahu apa pun yang berguna: yang perlu diketahui
# cukup "node_modules ini 400 MB", bukan rincian tiap paketnya.
SKIP_ISI = [
    'node_modules', '.git', '.cache/yarn', '.venv', 'vendor/bundle',
    # Layer image Docker: bisa ribuan folder dengan nama hash yang tidak
    # berarti apa-apa bagi manusia. Totalnya tetap terhitung di
    # /var/lib/docker, dan cara membersihkannya bukan menghapus folder ini
    # satu per satu — melainkan tombol Optimize dengan opsi Docker.
    'overlay2', 'aufs',
]

# Filesystem virtual: isinya bukan data di disk, jadi memetakannya
# menyesatkan (mis. /proc/kcore tampak sebesar seluruh RAM).
SKIP_MOUNT = ['/proc', '/sys', '/dev', '/run', '/snap']

# Berkas besar milik sistem yang TIDAK boleh dihapus. Menampilkannya di
# daftar "file besar" menyesatkan: orang melihat /swap.img 8 GB di urutan
# teratas lalu mengira itu sampah yang bisa dibuang, padahal menghapusnya
# mematikan swap dan bisa membuat server kehabisan memori.
SKIP_FILE = ['/swapfile', '/swap.img', '/swap', '/hiberfil.sys', '/pagefile.sys']


def _fmt_gb(kb):
    if not kb:
        return '?'
    return '%.1f GB' % (kb / 1024 / 1024)


# Folder yang dipetakan secara bawaan.
#
# Memetakan seluruh `/` menghabiskan sebagian besar waktu di /usr, /var/lib,
# dan /snap — besar, tapi itu berkas sistem yang tidak bisa dibersihkan
# pemilik server. Yang benar-benar bisa ditindaklanjuti ada di tiga tempat
# ini, dan membatasinya membuat pemindaian jauh lebih cepat di server yang
# sedang tertekan.
#
# /var/log ikut karena log yang tidak dirotasi adalah penyebab disk penuh
# yang paling sering, dan itu memang bisa dibersihkan.
PETA_TARGET = [
    '/var/www',        # berkas aplikasi web
    '/home',           # data pengguna, backup, log aplikasi
    '/tmp',            # berkas sementara yang sering lupa dibersihkan
    '/var/log',        # termasuk /var/log/journal — log tidak dirotasi adalah
                       # penyebab disk penuh yang paling sering
    '/var/lib/docker', # image, volume, dan cache build bisa puluhan GB
    '/opt',            # aplikasi yang dipasang manual
    '/srv',            # data layanan pada sebagian distro
]


def _peta_disk(min_persen=0.5, maks_file=25, min_file_mb=50, lapor=None,
               target=None):
    """
    Petakan folder yang membuat disk bengkak, sampai ke folder terdalam.

    Mengembalikan pohon folder yang sudah DIPANGKAS: hanya folder yang
    ukurannya >= `min_persen` dari total disk terpakai. Tanpa pemangkasan,
    `du` di server ini menghasilkan 12.775 baris (546 KB) — terlalu besar
    untuk dikirim lewat WebSocket dan terlalu banyak untuk dibaca manusia.
    Dengan ambang 0.5%, tersisa 48 folder yang benar-benar berarti.

    File besar individual dicari terpisah, karena penyebab disk penuh sering
    satu berkas (log tidak dirotasi, dump database, core dump) dan melihat
    foldernya saja tidak cukup untuk tahu apa yang harus dihapus.

    Dijalankan dengan nice/ionice supaya tidak mengganggu layanan yang sedang
    melayani permintaan di server itu.
    """
    hasil = {'root': '/', 'folder': [], 'file': [], 'totalKb': None,
             'ambangKb': None, 'terpotong': False, 'catatan': []}

    # Total dibaca dari statvfs, BUKAN dari `du` terpisah.
    #
    # Versi pertama menjalankan `du -xsk /` hanya untuk mendapat total, lalu
    # `du -xk /` lagi untuk pohonnya — dua kali melintasi seluruh disk untuk
    # angka yang statvfs berikan seketika. Di server dengan banyak berkas,
    # itu melipatgandakan waktu tunggu tanpa alasan.
    st = os.statvfs('/')
    total_kb = ((st.f_blocks - st.f_bfree) * st.f_frsize) // 1024
    hasil['totalKb'] = total_kb

    # Hanya folder target yang benar-benar ada. Tanpa penyaringan ini, `du`
    # mengeluh tentang path yang tidak ada dan `find` ikut gagal.
    daftar = target if target else PETA_TARGET
    ada = [t for t in daftar if os.path.isdir(t)]
    if not ada:
        hasil['catatan'].append(
            'Tidak ada folder target yang ditemukan (%s).' % ', '.join(daftar))
        return hasil
    hasil['root'] = ', '.join(ada)
    arg_target = ' '.join("'%s'" % t.replace("'", "'\\''") for t in ada)

    # Ambang ditetapkan SETELAH `du` selesai, dihitung dari ukuran target —
    # bukan dari total disk, dan bukan lewat lintasan tambahan.
    #
    # Kalau dihitung dari total disk 77 GB sementara /home hanya 3 GB,
    # ambang 0.5% = 385 MB akan menyaring habis seluruh isinya dan peta
    # tampak kosong — padahal justru di situ yang ingin dilihat. Ukuran
    # target sudah ada di hasil `du` (baris untuk tiap folder target), jadi
    # tidak perlu memindai ulang.
    ambang_kb = None

    # `nice` saja, TANPA `ionice -c3`.
    #
    # ionice kelas 3 (idle) berarti pemindaian hanya jalan saat tidak ada
    # proses lain yang meminta I/O sama sekali. Di server yang sibuk, itu
    # membuatnya nyaris tidak maju — persis yang dilaporkan pemilik projek.
    # `nice` sudah cukup untuk mengalah pada CPU tanpa membuat pemindaian
    # kelaparan I/O.
    prefix = 'nice -n 19 ' if _punya('nice') else ''

    is_root = os.getuid() == 0
    bisa_sudo = _sudo_tanpa_sandi()

    # Sebagian target (mis. /var/lib/docker) hanya terbaca root. Tanpa sudo,
    # `du` diam-diam melewatinya dan peta menunjukkan angka yang jauh lebih
    # kecil dari kenyataan — lebih buruk daripada tidak menampilkannya sama
    # sekali, karena terlihat seperti fakta.
    if not is_root and bisa_sudo:
        prefix = 'sudo -n ' + prefix
    elif not is_root:
        hasil['catatan'].append(
            'Tanpa sudo: folder yang hanya terbaca root (mis. /var/lib/docker) '
            'mungkin tampak lebih kecil dari sebenarnya.')

    exclude = ' '.join("--exclude='*/%s/*'" % s for s in SKIP_ISI)
    exclude += ' ' + ' '.join("--exclude='%s/*'" % s for s in SKIP_MOUNT)

    # `du` dan `find` melintasi disk yang sama, jadi dijalankan BERSAMAAN.
    # Berurutan berarti menunggu dua kali lintasan penuh; bersamaan, yang
    # kedua sebagian besar terlayani dari cache filesystem yang baru saja
    # dihangatkan oleh yang pertama.
    hasil_find = {'out': None}

    def cari_file_besar():
        if maks_file <= 0:
            return
        cari_exclude = ' '.join("-path '*/%s' -prune -o" % s for s in SKIP_ISI)
        cari_exclude += ' ' + ' '.join("-path '%s' -prune -o" % s for s in SKIP_MOUNT)
        # Berkas swap/hibernasi dikecualikan supaya tidak disangka sampah.
        cari_exclude += ' ' + ' '.join("-path '%s' -prune -o" % s for s in SKIP_FILE)
        perintah = (
            "%sfind %s -xdev %s -type f -size +%dM -printf '%%s\\t%%p\\n' 2>/dev/null "
            "| sort -rn | head -%d" % (prefix, arg_target, cari_exclude, min_file_mb, maks_file)
        )
        ok_f, out_f = _jalan(perintah, timeout=1800)
        if ok_f and out_f:
            hasil_find['out'] = out_f

    t_find = threading.Thread(target=cari_file_besar, daemon=True)
    t_find.start()

    # Kabar berkala selama `du` berjalan. Tanpa ini layar hanya menampilkan
    # satu pesan statis berjam-jam dan tidak ada cara membedakan "sedang
    # bekerja" dari "macet" — pemilik projek melaporkan persis kebingungan itu.
    berhenti_kabar = threading.Event()

    def kabar_berkala():
        detik = 0
        while not berhenti_kabar.wait(5):
            detik += 5
            if lapor:
                try:
                    lapor('memindai folder… (%d detik, %s terpakai)'
                          % (detik, _fmt_gb(total_kb)))
                except Exception:
                    pass

    t_kabar = threading.Thread(target=kabar_berkala, daemon=True)
    t_kabar.start()

    try:
        ok, out = _jalan('%sdu -xk %s %s 2>/dev/null' % (prefix, exclude, arg_target),
                         timeout=1800)
    finally:
        berhenti_kabar.set()
    if not ok and not out:
        hasil['catatan'].append('Pemindaian gagal atau tidak menghasilkan apa pun.')
        return hasil

    semua = []
    for baris in out.split('\n'):
        if not baris.strip():
            continue
        bagian = baris.split('\t', 1)
        if len(bagian) != 2:
            continue
        try:
            kb = int(bagian[0])
        except ValueError:
            continue
        semua.append({'path': bagian[1].strip(), 'kb': kb})

    # Ukuran target = baris `du` untuk folder target itu sendiri. Dari situ
    # ambangnya dihitung, tanpa lintasan tambahan.
    set_target = set(ada)
    target_kb = sum(f['kb'] for f in semua if f['path'] in set_target)
    ambang_kb = max(1024, int((target_kb or total_kb) * min_persen / 100))
    hasil['ambangKb'] = ambang_kb
    hasil['targetKb'] = target_kb or None

    folder = [
        {'path': f['path'], 'kb': f['kb'],
         'level': 0 if f['path'] == '/' else f['path'].count('/')}
        for f in semua if f['kb'] >= ambang_kb
    ]

    folder.sort(key=lambda f: f['path'])

    # Batas keras: kalau ambang relatif masih menyisakan terlalu banyak
    # (server dengan ribuan folder besar), ambil yang terbesar saja.
    if len(folder) > 400:
        folder.sort(key=lambda f: -f['kb'])
        folder = folder[:400]
        folder.sort(key=lambda f: f['path'])
        hasil['terpotong'] = True
    hasil['folder'] = folder

    # Tunggu pencarian file besar yang berjalan bersamaan tadi.
    if lapor and t_find.is_alive():
        try:
            lapor('mencari berkas besar…')
        except Exception:
            pass
    t_find.join(timeout=1800)
    if hasil_find['out']:
        for baris in hasil_find['out'].split('\n'):
            bagian = baris.split('\t', 1)
            if len(bagian) != 2:
                continue
            try:
                hasil['file'].append({'path': bagian[1].strip(),
                                      'kb': int(bagian[0]) // 1024})
            except ValueError:
                continue

    return hasil


_peta_berjalan = threading.Lock()
# Kapan pemetaan terakhir dimulai. Dipakai melepas lock yang tersangkut:
# kalau proses pemegangnya mati tanpa sempat release (mis. koneksi putus
# lalu thread-nya ikut hilang), lock bisa terkunci selamanya dan SEMUA
# percobaan berikutnya ditolak "Pemetaan lain masih berjalan" padahal tidak
# ada apa pun yang berjalan.
_peta_mulai_pada = [0.0]
PETA_LOCK_MAKS_DETIK = 1900  # sedikit di atas timeout du (1800)


def handle_peta(ws, req_id):
    """
    Jalankan pemetaan di thread, laporkan kemajuan.

    Sama seperti optimasi: dijalankan di thread supaya agent tetap mengirim
    metrik selama pemindaian. `du` seluruh disk bisa memakan menit di server
    dengan jutaan file, dan agent yang diam selama itu akan ditandai DOWN.
    """
    def kirim(payload):
        try:
            ws.send_text(json.dumps(payload))
        except Exception:
            pass

    def kerja():
        if not _peta_berjalan.acquire(blocking=False):
            # Lock dipegang. Tapi kalau sudah jauh melewati batas waktu
            # pemindaian, pemegangnya pasti sudah mati — rebut paksa.
            umur = time.time() - _peta_mulai_pada[0]
            if umur < PETA_LOCK_MAKS_DETIK:
                sisa = int(PETA_LOCK_MAKS_DETIK - umur)
                kirim({'type': 'peta_result', 'id': req_id, 'ok': False,
                       'pesan': 'Pemindaian lain masih berjalan di server ini '
                                '(sudah %d detik). Tunggu sampai selesai, atau '
                                'coba lagi dalam %d detik.' % (int(umur), sisa)})
                return
            print('[agent] lock pemetaan tersangkut %d detik, direbut paksa' % int(umur),
                  file=sys.stderr)
            # Tidak perlu release: lock yang pemegangnya hilang tetap
            # "terkunci", jadi kita lanjut saja tanpa memegangnya ulang.

        _peta_mulai_pada[0] = time.time()
        try:
            kirim({'type': 'peta_progress', 'id': req_id, 'tahap': 'memulai pemindaian…'})

            def lapor(tahap):
                kirim({'type': 'peta_progress', 'id': req_id, 'tahap': tahap})

            hasil = _peta_disk(lapor=lapor)
            kirim({'type': 'peta_progress', 'id': req_id, 'tahap': 'menyusun hasil…'})
            hasil.update({'type': 'peta_result', 'id': req_id, 'ok': True})
            kirim(hasil)
            print('[agent] pemetaan selesai: %d folder, %d file'
                  % (len(hasil['folder']), len(hasil['file'])))
        except Exception as e:
            print('[agent] pemetaan gagal: %s' % e, file=sys.stderr)
            kirim({'type': 'peta_result', 'id': req_id, 'ok': False, 'pesan': str(e)})
        finally:
            # Lock mungkin tidak benar-benar kita pegang (jalur "rebut
            # paksa" di atas), dan release() pada lock yang tidak dipegang
            # melempar RuntimeError — yang akan menutupi error aslinya.
            try:
                _peta_berjalan.release()
            except RuntimeError:
                pass
            _peta_mulai_pada[0] = 0.0

    threading.Thread(target=kerja, daemon=True).start()


_optimasi_berjalan = threading.Lock()
# Sama seperti lock pemetaan: dilepas paksa kalau tersangkut jauh melewati
# batas waktu, supaya satu optimasi yang terputus tidak memblokir semua
# percobaan berikutnya selamanya.
_optimasi_mulai_pada = [0.0]
OPT_LOCK_MAKS_DETIK = 1300  # sedikit di atas timeout langkah docker (1200)


def handle_optimize(ws, req_id, sertakan_docker):
    """
    Jalankan optimasi di thread terpisah, laporkan kemajuan lewat WebSocket.

    Dijalankan di thread karena optimasi bisa memakan beberapa menit
    (journal 3.5GB, docker cache 2GB). Kalau dikerjakan di loop pesan, agent
    berhenti mengirim metrik selama itu dan server akan menandainya DOWN —
    optimasi yang berhasil malah terlihat seperti server mati.

    Lock memastikan satu server tidak menjalankan dua optimasi sekaligus;
    dua `docker prune` bersamaan bisa saling mengganggu.
    """
    def kirim(payload):
        try:
            ws.send_text(json.dumps(payload))
        except Exception:
            pass  # koneksi putus di tengah; optimasi tetap diselesaikan

    def kerja():
        if not _optimasi_berjalan.acquire(blocking=False):
            umur = time.time() - _optimasi_mulai_pada[0]
            if umur < OPT_LOCK_MAKS_DETIK:
                kirim({'type': 'optimize_result', 'id': req_id, 'ok': False,
                       'pesan': 'Optimasi lain masih berjalan di server ini '
                                '(sudah %d detik). Tunggu sampai selesai.' % int(umur)})
                return
            print('[agent] lock optimasi tersangkut %d detik, direbut paksa' % int(umur),
                  file=sys.stderr)

        _optimasi_mulai_pada[0] = time.time()
        try:
            kirim({'type': 'optimize_progress', 'id': req_id,
                   'nomor': 0, 'total': 0, 'nama': 'memulai…'})

            def lapor(nomor, total, nama):
                kirim({'type': 'optimize_progress', 'id': req_id,
                       'nomor': nomor, 'total': total, 'nama': nama})

            hasil = jalankan_optimasi(sertakan_docker=sertakan_docker, lapor=lapor)
            hasil.update({'type': 'optimize_result', 'id': req_id, 'ok': True})
            kirim(hasil)
            print('[agent] optimasi selesai, hemat %s byte' % hasil.get('hematBytes'))
        except Exception as e:
            print('[agent] optimasi gagal: %s' % e, file=sys.stderr)
            kirim({'type': 'optimize_result', 'id': req_id, 'ok': False, 'pesan': str(e)})
        finally:
            try:
                _optimasi_berjalan.release()
            except RuntimeError:
                pass
            _optimasi_mulai_pada[0] = 0.0

    threading.Thread(target=kerja, daemon=True).start()


def build_ws_url():
    u = urlparse(SERVER_URL)
    scheme = 'wss' if u.scheme == 'https' else 'ws'
    netloc = u.netloc
    return '%s://%s/agent?%s' % (scheme, netloc, urlencode({'token': TOKEN}))


def send_metric(ws):
    refresh_public_ip()
    try:
        parsed = parse_resource_output(run(RESOURCE_COMMAND))
        hostname = run('hostname', timeout=5).strip() or socket.gethostname()
        payload = dict(parsed)
        payload.update({
            'type': 'metric',
            'uptimeSeconds': uptime_seconds(),
            'hostname': hostname,
            'privateIp': private_ip(),
            'publicIp': _public_ip['value'],
            'agentVersion': AGENT_VERSION,
        })
        ws.send_text(json.dumps(payload))
    except Exception as e:
        print('[agent] gagal kirim metric: %s' % e, file=sys.stderr)


def handle_command(ws, req_id, command):
    shell_command = COMMANDS.get(command)
    if not shell_command:
        return
    try:
        p = subprocess.run(shell_command, shell=True, timeout=15,
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        out = p.stdout.decode('utf-8', 'replace')
        err = p.stderr.decode('utf-8', 'replace')
        # Exit code bukan nol dengan stdout kosong berarti command memang
        # gagal (mis. docker tidak terpasang) — laporkan sebagai error,
        # bukan sebagai output kosong yang menyesatkan.
        if p.returncode != 0 and not out.strip():
            ws.send_text(json.dumps({'type': 'command_result', 'id': req_id,
                                     'command': command, 'output': None,
                                     'errorMessage': err.strip() or 'exit code %d' % p.returncode}))
            return
        ws.send_text(json.dumps({'type': 'command_result', 'id': req_id,
                                 'command': command, 'output': out, 'errorMessage': None}))
    except Exception as e:
        ws.send_text(json.dumps({'type': 'command_result', 'id': req_id,
                                 'command': command, 'output': None,
                                 'errorMessage': str(e)}))


def session():
    """Satu sesi koneksi. Melempar exception kalau putus, agar dipanggil ulang."""
    ws = WebSocket(build_ws_url())
    print('[agent] terkoneksi ke server monitoring (python v%s)' % AGENT_VERSION)

    stop = threading.Event()

    def metric_loop():
        send_metric(ws)
        gagal_beruntun = 0
        while not stop.wait(INTERVAL_MS / 1000.0):
            try:
                send_metric(ws)
                gagal_beruntun = 0
            except Exception as e:
                # JANGAN langsung berhenti. Saat server sibuk berat (docker
                # prune, du seluruh disk), perintah pengumpul metrik bisa
                # melewati timeout-nya — itu gangguan sesaat, bukan tanda
                # koneksi mati. Versi sebelumnya `break` di sini, sehingga
                # satu timeout membuat agent berhenti melapor selamanya dan
                # server menandainya DOWN padahal ia sehat.
                gagal_beruntun += 1
                if gagal_beruntun >= 5:
                    print('[agent] metrik gagal %d kali beruntun, hentikan sesi: %s'
                          % (gagal_beruntun, e), file=sys.stderr)
                    break

    t = threading.Thread(target=metric_loop, daemon=True)
    t.start()

    try:
        while True:
            try:
                raw = ws.recv()
            except socket.timeout:
                # Tidak ada pesan dalam periode timeout itu normal: server
                # hanya bicara saat ada perintah. Bukan alasan reconnect.
                continue
            if raw is None:
                continue
            try:
                msg = json.loads(raw)
            except ValueError:
                continue
            if msg.get('type') == 'command' and msg.get('id') and msg.get('command'):
                handle_command(ws, msg['id'], msg['command'])
            elif msg.get('type') == 'update_agent' and msg.get('id'):
                handle_self_update(ws, msg['id'])
            elif msg.get('type') == 'uninstall_agent' and msg.get('id'):
                handle_uninstall_command(ws, msg['id'])
            elif msg.get('type') == 'peta_disk' and msg.get('id'):
                handle_peta(ws, msg['id'])
            elif msg.get('type') == 'optimize' and msg.get('id'):
                handle_optimize(ws, msg['id'], bool(msg.get('docker')))
    finally:
        stop.set()
        ws.close()


def main():
    delay = RECONNECT_BASE_S
    ditolak = 0
    while True:
        try:
            session()
            delay = RECONNECT_BASE_S  # sesi sempat terbentuk: mulai lagi dari cepat
            ditolak = 0               # koneksi berhasil: penolakan lama tidak relevan
        except TokenDitolak:
            ditolak += 1
            print('[agent] token ditolak server (401), percobaan ke-%d' % ditolak,
                  file=sys.stderr)
            if ditolak >= MAX_TOKEN_REJECTIONS:
                self_uninstall('token sudah dicabut dari dashboard')
        except Exception as e:
            print('[agent] koneksi bermasalah (%s), reconnect dalam %ds' % (e, delay),
                  file=sys.stderr)
        time.sleep(delay)
        delay = min(delay * 2, RECONNECT_MAX_S)


if __name__ == '__main__':
    main()
