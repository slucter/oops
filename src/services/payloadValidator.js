const MAX_HOSTNAME_LEN = 255;
const MAX_NUMBER = 1e9; // batas akal sehat, tolak angka yang jelas tidak masuk akal

function isFiniteNumberOrNull(value) {
  return value === null || value === undefined || (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) < MAX_NUMBER);
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
    'load1m', 'load5m', 'load15m', 'uptimeSeconds',
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
      hostname: payload.hostname ?? null,
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

module.exports = { validateMetricPayload, validateCommandResultPayload };
