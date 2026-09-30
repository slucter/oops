const https = require('https');
const settingsStore = require('./settingsStore');

const SEND_TIMEOUT_MS = 10000;

/**
 * Kirim pesan ke Telegram. Selalu mengembalikan hasil (tidak pernah
 * melempar) — kegagalan notifikasi tidak boleh menjatuhkan alur monitoring
 * yang memanggilnya.
 *
 * Balikan: { ok: true } atau { ok: false, error: '...' }
 */
function sendMessage(text, overrides = {}) {
  const token = overrides.token != null ? overrides.token : settingsStore.get('telegram_bot_token');
  const chatId = overrides.chatId != null ? overrides.chatId : settingsStore.get('telegram_chat_id');

  if (!token || !chatId) {
    return Promise.resolve({ ok: false, error: 'Bot token atau chat ID belum diisi.' });
  }

  const payload = JSON.stringify({
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  });

  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: 'api.telegram.org',
        path: `/bot${token}/sendMessage`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: SEND_TIMEOUT_MS,
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { if (body.length < 4096) body += c; });
        res.on('end', () => {
          if (res.statusCode === 200) return resolve({ ok: true });
          // Telegram mengembalikan alasan yang jelas di body — teruskan ke
          // pengguna supaya mereka tahu apa yang salah (token keliru, bot
          // belum ditambahkan ke grup, chat id salah, dsb).
          let reason = `HTTP ${res.statusCode}`;
          try {
            const parsed = JSON.parse(body);
            if (parsed.description) reason = parsed.description;
          } catch {
            // body bukan JSON — pakai status code saja
          }
          resolve({ ok: false, error: reason });
        });
      }
    );

    req.on('error', (err) => resolve({ ok: false, error: err.message }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'Timeout menghubungi api.telegram.org' });
    });

    req.write(payload);
    req.end();
  });
}

function isEnabled() {
  return settingsStore.getBool('telegram_enabled')
    && !!settingsStore.get('telegram_bot_token')
    && !!settingsStore.get('telegram_chat_id');
}

/** Escape karakter yang punya arti khusus di parse_mode HTML Telegram. */
function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

module.exports = { sendMessage, isEnabled, esc };
