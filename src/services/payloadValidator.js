const MAX_HOSTNAME_LEN = 255;
const MAX_NUMBER = 1e9; // batas akal sehat, tolak angka yang jelas tidak masuk akal
const MAX_IP_LEN = 45; // cukup untuk IPv6 terpanjang

// IPv4 / IPv6 sederhana. Sengaja longgar soal bentuk IPv6 (tidak memvalidasi
// setiap aturan penyingkatan) tapi ketat soal karakter yang boleh muncul —
// tujuannya mencegah string sembarangan masuk ke DB dan ke HTML, bukan
// menjadi validator alamat IP yang sempurna.
const IP_PATTERN = /^(?:\d{1,3}(?:\.\d{1,3}){3}|[0-9a-fA-F:]{2,45})$/;

// Versi agent: maksimal tiga komponen angka, tiap komponen maksimal 5 digit.
const VERSION_PATTERN = /^\d{1,5}(?:\.\d{1,5}){0,2}$/;

function isFiniteNumberOrNull(value) {
  return value === null || value === undefined || (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) < MAX_NUMBER);
}

function normalizeIp(value) {
  if (value == null) return null;
  if (typeof value !== 'string') return undefined; // undefined = invalid
  const v = value.trim();
  if (v === '') return null;
  if (v.length > MAX_IP_LEN || !IP_PATTERN.test(v)) return undefined;
  return v;
}

/**
 * Validasi payload metrik dari agent sebelum disimpan. Endpoint ini
 * publik ke internet dan menerima klaim sepihak dari kode yang jalan di
 * mesin pihak lain — validasi tipe/format ketat, TAPI tidak (dan tidak
 * bisa) memverifikasi kebenaran isi datanya.
 *
 * Balikan: { valid: true, data } atau { valid: false, reason }.
 */
function validateMetricPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return { valid: false, reason: 'payload bukan objek' };
  }

  const numericFields = [
    'memTotalMb', 'memUsedMb', 'diskTotalGb', 'diskUsedGb',
    'load1m', 'load5m', 'load15m', 'uptimeSeconds', 'cpuCount',
  ];
  for (const field of numericFields) {
    if (!isFiniteNumberOrNull(payload[field])) {
      return { valid: false, reason: `field "${field}" harus berupa angka atau null` };
    }
  }

  if (payload.hostname != null) {
    if (typeof payload.hostname !== 'string' || payload.hostname.length > MAX_HOSTNAME_LEN) {
      return { valid: false, reason: 'field "hostname" harus string pendek' };
    }
  }

  const privateIp = normalizeIp(payload.privateIp);
  if (privateIp === undefined) return { valid: false, reason: 'field "privateIp" bukan alamat IP yang valid' };
  const publicIp = normalizeIp(payload.publicIp);
  if (publicIp === undefined) return { valid: false, reason: 'field "publicIp" bukan alamat IP yang valid' };

  // Versi agent dibatasi ke bentuk angka bertitik. Nilai ini ditampilkan di
  // dashboard, jadi jangan biarkan string bebas dari mesin pihak lain masuk.
  // Agent lama tidak mengirim field ini sama sekali — itu sah, dan justru
  // penanda bahwa ia perlu di-update.
  let agentVersion = null;
  if (payload.agentVersion != null) {
    if (typeof payload.agentVersion !== 'string' || !VERSION_PATTERN.test(payload.agentVersion)) {
      return { valid: false, reason: 'field "agentVersion" harus berbentuk angka bertitik, mis. 1.2.0' };
    }
    agentVersion = payload.agentVersion;
  }

  return {
    valid: true,
    data: {
      memTotalMb: payload.memTotalMb ?? null,
      memUsedMb: payload.memUsedMb ?? null,
      diskTotalGb: payload.diskTotalGb ?? null,
      diskUsedGb: payload.diskUsedGb ?? null,
      load1m: payload.load1m ?? null,
      load5m: payload.load5m ?? null,
      load15m: payload.load15m ?? null,
      uptimeSeconds: payload.uptimeSeconds ?? null,
      cpuCount: payload.cpuCount ?? null,
      hostname: payload.hostname ?? null,
      privateIp,
      publicIp,
      agentVersion,
    },
  };
}

const ALLOWED_COMMANDS = new Set(['docker_ps', 'port_listen']);
const MAX_COMMAND_OUTPUT_LEN = 64 * 1024;

function validateCommandResultPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return { valid: false, reason: 'payload bukan objek' };
  }
  if (typeof payload.id !== 'string' || payload.id.length > 100) {
    return { valid: false, reason: 'field "id" harus string pendek' };
  }
  if (!ALLOWED_COMMANDS.has(payload.command)) {
    return { valid: false, reason: 'field "command" tidak dikenal' };
  }
  if (payload.output != null && (typeof payload.output !== 'string' || payload.output.length > MAX_COMMAND_OUTPUT_LEN)) {
    return { valid: false, reason: 'field "output" terlalu besar atau bukan string' };
  }
  if (payload.errorMessage != null && typeof payload.errorMessage !== 'string') {
    return { valid: false, reason: 'field "errorMessage" harus string' };
  }
  return {
    valid: true,
    data: {
      id: payload.id,
      command: payload.command,
      output: payload.output ?? null,
      errorMessage: payload.errorMessage ?? null,
    },
  };
}

const MAX_UPDATE_MESSAGE_LEN = 2000;

/** Validasi balasan agent atas perintah update. */
function validateUpdateResultPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return { valid: false, reason: 'payload bukan objek' };
  }
  if (typeof payload.id !== 'string' || payload.id.length > 100) {
    return { valid: false, reason: 'field "id" harus string pendek' };
  }
  if (typeof payload.ok !== 'boolean') {
    return { valid: false, reason: 'field "ok" harus boolean' };
  }
  if (payload.message != null && (typeof payload.message !== 'string' || payload.message.length > MAX_UPDATE_MESSAGE_LEN)) {
    return { valid: false, reason: 'field "message" terlalu panjang atau bukan string' };
  }
  if (payload.version != null && (typeof payload.version !== 'string' || !VERSION_PATTERN.test(payload.version))) {
    return { valid: false, reason: 'field "version" tidak valid' };
  }
  return {
    valid: true,
    data: {
      id: payload.id,
      ok: payload.ok,
      message: payload.message ?? null,
      version: payload.version ?? null,
    },
  };
}

module.exports = { validateMetricPayload, validateCommandResultPayload, validateUpdateResultPayload };
