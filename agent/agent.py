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

AGENT_VERSION = '1.2.0'

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
        with self._send_lock:
            self.sock.sendall(header + mask + masked)

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
    'df -h /', 'echo %s' % DELIM,
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
            disk_total, disk_used = _size_to_gb(cols[1]), _size_to_gb(cols[2])

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
        while not stop.wait(INTERVAL_MS / 1000.0):
            try:
                send_metric(ws)
            except Exception:
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
