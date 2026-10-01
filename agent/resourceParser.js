const DELIM = '---oops-delim---';

const RESOURCE_COMMAND = [
  'free -m',
  `echo ${DELIM}`,
  'df -k /',
  `echo ${DELIM}`,
  'cat /proc/loadavg',
  `echo ${DELIM}`,
  'uptime -p',
  `echo ${DELIM}`,
  'nproc',
].join('; ');

/**
 * Parse gabungan output free/df/loadavg/uptime/nproc (dipisah DELIM,
 * lihat RESOURCE_COMMAND) jadi angka. Mengembalikan null per field kalau
 * bagian itu gagal di-parse (bukan melempar error) — command yang tidak
 * ada di satu OS (mis. `nproc` di BusyBox) tidak boleh menggagalkan
 * seluruh snapshot.
 */
function parseResourceOutput(stdout) {
  const parts = stdout.split(DELIM).map((p) => p.trim());
  const [freeOut, dfOut, loadavgOut, uptimeOut, nprocOut] = parts;

  return {
    ...parseFree(freeOut),
    ...parseDf(dfOut),
    ...parseLoadavg(loadavgOut),
    uptimeText: uptimeOut || null,
    cpuCount: parseIntOrNull(nprocOut),
  };
}

function parseFree(text) {
  if (!text) return { memTotalMb: null, memUsedMb: null };
  const line = text.split('\n').find((l) => l.trim().startsWith('Mem:'));
  if (!line) return { memTotalMb: null, memUsedMb: null };
  const cols = line.trim().split(/\s+/);
  return {
    memTotalMb: parseIntOrNull(cols[1]),
    memUsedMb: parseIntOrNull(cols[2]),
  };
}

function parseDf(text) {
  if (!text) return { diskTotalGb: null, diskUsedGb: null };
  const lines = text.split('\n').filter((l) => l.trim());
  const line = lines[lines.length - 1];
  if (!line) return { diskTotalGb: null, diskUsedGb: null };
  const cols = line.trim().split(/\s+/);
  return {
    // `df -k` memberi KILOBYTE, bukan "23G" yang sudah dibulatkan.
    // Presisi itu penting: dengan satuan bulat, 48->49 terbaca sebagai
    // lompatan 1 GB penuh dan prediksi disk penuh berosilasi karena derau
    // pembulatan. Format "23G" tetap diterima untuk agent lama.
    diskTotalGb: kbKeGb(cols[1]),
    diskUsedGb: kbKeGb(cols[2]),
  };
}

/** Kilobyte -> GB dua desimal; jatuh ke parseSizeToGb untuk format "23G". */
function kbKeGb(value) {
  if (/^\d+$/.test(String(value || ''))) {
    const kb = parseInt(value, 10);
    return Number.isFinite(kb) ? Math.round(kb / 1048576 * 100) / 100 : null;
  }
  return parseSizeToGb(value);
}

function parseSizeToGb(value) {
  if (!value) return null;
  const match = value.match(/^([\d.]+)([KMGT])?$/i);
  if (!match) return null;
  const num = parseFloat(match[1]);
  const unit = (match[2] || 'G').toUpperCase();
  const factor = { K: 1 / 1024 / 1024, M: 1 / 1024, G: 1, T: 1024 }[unit];
  return Math.round(num * factor * 100) / 100;
}

function parseLoadavg(text) {
  if (!text) return { load1m: null, load5m: null, load15m: null };
  const cols = text.trim().split(/\s+/);
  return {
    load1m: parseFloatOrNull(cols[0]),
    load5m: parseFloatOrNull(cols[1]),
    load15m: parseFloatOrNull(cols[2]),
  };
}

function parseIntOrNull(value) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

function parseFloatOrNull(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

module.exports = { RESOURCE_COMMAND, parseResourceOutput };
