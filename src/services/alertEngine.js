const db = require('../db');
const settingsStore = require('./settingsStore');
const telegram = require('./telegramNotifier');
const pushNotifier = require('./pushNotifier');

/**
 * Mesin alert. Prinsipnya: satu baris `alerts` per kejadian, dibuat saat
 * kondisi MULAI bermasalah dan di-resolve saat pulih. Notifikasi dikirim
 * sekali di masing-masing titik itu, bukan tiap kali metrik masuk — kalau
 * tidak, disk 91% dengan metrik tiap 30 detik akan membanjiri grup dengan
 * 120 pesan per jam untuk satu masalah yang sama.
 */

const findActive = db.prepare(`
  SELECT * FROM alerts WHERE client_id = ? AND kind = ? AND resolved_at IS NULL LIMIT 1
`);

const insertAlert = db.prepare(`
  INSERT INTO alerts (client_id, kind, severity, message, value_text)
  VALUES (@clientId, @kind, @severity, @message, @valueText)
`);

const resolveAlert = db.prepare(`
  UPDATE alerts SET resolved_at = datetime('now') WHERE id = ?
`);

const markNotified = db.prepare(`UPDATE alerts SET notified_at = datetime('now') WHERE id = ?`);
const markResolveNotified = db.prepare(`UPDATE alerts SET resolve_notified_at = datetime('now') WHERE id = ?`);

const listActiveByClient = db.prepare(`
  SELECT kind, severity, message, value_text, started_at
  FROM alerts WHERE client_id = ? AND resolved_at IS NULL
  ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, started_at
`);

const listAllActive = db.prepare(`
  SELECT a.*, c.name AS client_name
  FROM alerts a JOIN clients c ON c.id = a.client_id
  WHERE a.resolved_at IS NULL
  ORDER BY CASE a.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, a.started_at DESC
`);

const listRecentByClient = db.prepare(`
  SELECT kind, severity, message, value_text, started_at, resolved_at
  FROM alerts WHERE client_id = ?
  ORDER BY started_at DESC LIMIT 20
`);

const escalateAlert = db.prepare(`
  UPDATE alerts SET severity = @severity, message = @message, value_text = @valueText WHERE id = @id
`);

const SEVERITY_RANK = { info: 0, warning: 1, critical: 2 };

/**
 * Buka alert baru kalau belum ada yang aktif untuk (client, kind) ini,
 * lalu kirim notifikasi sekali. Kalau sudah ada yang aktif, tidak
 * mengirim ulang — inilah peredamnya.
 *
 * Pengecualian: kalau kondisinya MEMBURUK (mis. disk warning → critical),
 * alert yang ada dinaikkan tingkatnya dan notifikasi dikirim sekali lagi.
 * Tanpa ini, masalah yang makin parah akan diam-diam tertahan peredam.
 */
function raise(client, { kind, severity, message, valueText }) {
  const existing = findActive.get(client.id, kind);

  if (existing) {
    const isWorse = (SEVERITY_RANK[severity] || 0) > (SEVERITY_RANK[existing.severity] || 0);
    if (!isWorse) return existing;

    escalateAlert.run({ id: existing.id, severity, message, valueText: valueText || null });
    notify(client, { kind, severity, message, valueText, resolved: false, escalated: true })
      .then((sent) => { if (sent) markNotified.run(existing.id); })
      .catch(() => {});
    return { ...existing, severity, message };
  }

  const info = insertAlert.run({
    clientId: client.id, kind, severity, message, valueText: valueText || null,
  });
  const alertId = info.lastInsertRowid;

  notify(client, { kind, severity, message, valueText, resolved: false })
    .then((sent) => { if (sent) markNotified.run(alertId); })
    .catch(() => { /* notifikasi gagal tidak boleh menjatuhkan alur alert */ });

  return { id: alertId, kind, severity, message };
}

/** Tutup alert yang aktif untuk (client, kind) dan kirim pesan pemulihan. */
// Alert yang baru menyala tidak boleh langsung dinyatakan pulih.
//
// Pengaman terakhir terhadap alert yang berkedip: walau histeresis sudah
// dipasang per-jenis, nilai yang berosilasi lebar tetap bisa melompati
// kedua ambang. Satu insiden yang hidup cuma 30 detik lalu "pulih" bukan
// informasi — itu derau, dan grup Telegram yang penuh derau akan diabaikan
// orang justru saat ada yang benar-benar penting.
const MIN_DETIK_SEBELUM_PULIH = 300; // 5 menit

function clear(client, kind) {
  const existing = findActive.get(client.id, kind);
  if (!existing) return;

  const umurDetik = (Date.now() - Date.parse(existing.started_at + 'Z')) / 1000;
  if (Number.isFinite(umurDetik) && umurDetik < MIN_DETIK_SEBELUM_PULIH) {
    return; // biarkan menyala dulu; akan dibereskan di siklus berikutnya
  }

  resolveAlert.run(existing.id);

  if (settingsStore.getBool('alert_on_recover')) {
    notify(client, {
      kind,
      severity: 'info',
      message: recoveryMessageFor(kind, existing.message),
      valueText: null,
      resolved: true,
    })
      .then((sent) => { if (sent) markResolveNotified.run(existing.id); })
      .catch(() => {});
  }
}

function recoveryMessageFor(kind, originalMessage) {
  const map = {
    offline: 'Client kembali ONLINE',
    disk: 'Penggunaan disk kembali normal',
    disk_forecast: 'Laju pertumbuhan disk kembali normal',
    memory: 'Penggunaan RAM kembali normal',
    load: 'CPU load kembali normal',
    latency: 'Latency kembali normal',
  };
  return map[kind] || `Pulih: ${originalMessage}`;
}

/**
 * Kirim notifikasi ke semua kanal yang aktif (Telegram + Web Push).
 * Kegagalan satu kanal tidak menghalangi kanal lain, dan tidak pernah
 * melempar ke pemanggil.
 */
async function notify(client, { kind, severity, message, valueText, resolved, escalated }) {
  const icon = resolved ? '✅' : severity === 'critical' ? '🔴' : severity === 'warning' ? '🟠' : 'ℹ️';
  const head = resolved ? 'PULIH' : escalated ? `MEMBURUK → ${severity.toUpperCase()}` : severity.toUpperCase();

  const results = await Promise.all([
    notifyTelegram(client, { icon, head, message, valueText }),
    notifyPush(client, { kind, icon, head, severity, message, valueText, resolved }),
  ]);

  return results.some(Boolean);
}

async function notifyTelegram(client, { icon, head, message, valueText }) {
  if (!telegram.isEnabled()) return false;

  const lines = [
    `${icon} <b>${telegram.esc(head)}</b> — ${telegram.esc(client.name)}`,
    telegram.esc(message),
  ];
  if (valueText) lines.push(`<code>${telegram.esc(valueText)}</code>`);

  const detail = [];
  if (client.hostname) detail.push(`host: ${telegram.esc(client.hostname)}`);
  if (client.privateIp) detail.push(`ip: ${telegram.esc(client.privateIp)}`);
  if (detail.length) lines.push(`<i>${detail.join(' · ')}</i>`);

  const res = await telegram.sendMessage(lines.join('\n'));
  if (!res.ok) console.error(`[alert] gagal kirim Telegram: ${res.error}`);
  return res.ok;
}

async function notifyPush(client, { kind, icon, head, severity, message, valueText, resolved }) {
  if (!pushNotifier.isEnabled()) return false;

  try {
    const bodyParts = [message];
    if (valueText) bodyParts.push(valueText);

    const res = await pushNotifier.sendToAll({
      title: `${icon} ${head} — ${client.name}`,
      body: bodyParts.join('\n'),
      severity: resolved ? 'info' : severity,
      // Tag per (client, jenis): notifikasi menggantikan yang lama untuk
      // masalah yang sama, jadi tidak menumpuk di notification center.
      tag: `oops-${client.id}-${kind || 'alert'}`,
      url: `/client/${client.id}`,
      timestamp: Date.now(),
    });
    return res.sent > 0;
  } catch (err) {
    console.error('[alert] gagal kirim Web Push:', err.message);
    return false;
  }
}

/**
 * Evaluasi metrik yang baru masuk terhadap semua ambang batas.
 * Dipanggil setiap kali payload metrik diterima.
 */
function evaluateMetric(client, metric) {
  const diskPct = percent(metric.diskUsedGb, metric.diskTotalGb);
  const memPct = percent(metric.memUsedMb, metric.memTotalMb);

  checkThreshold(client, {
    kind: 'disk',
    value: diskPct,
    limit: settingsStore.getNumber('alert_disk_percent'),
    severityAt: 95,
    message: (v, l) => `Disk hampir penuh (${v}%, ambang ${l}%)`,
    valueText: metric.diskTotalGb != null
      ? `${metric.diskUsedGb} GB / ${metric.diskTotalGb} GB terpakai`
      : null,
  });

  checkThreshold(client, {
    kind: 'memory',
    value: memPct,
    limit: settingsStore.getNumber('alert_mem_percent'),
    severityAt: 97,
    message: (v, l) => `Penggunaan RAM tinggi (${v}%, ambang ${l}%)`,
    valueText: metric.memTotalMb != null
      ? `${(metric.memUsedMb / 1024).toFixed(1)} GB / ${(metric.memTotalMb / 1024).toFixed(1)} GB terpakai`
      : null,
  });

  // Load dibandingkan relatif terhadap jumlah CPU: load 8 itu normal di
  // mesin 32 core, tapi kritis di mesin 2 core.
  const cpuCount = metric.cpuCount && metric.cpuCount > 0 ? metric.cpuCount : 1;
  const loadPerCpu = metric.load1m != null ? metric.load1m / cpuCount : null;
  checkThreshold(client, {
    kind: 'load',
    value: loadPerCpu == null ? null : Math.round(loadPerCpu * 100) / 100,
    limit: settingsStore.getNumber('alert_load_per_cpu'),
    severityAt: settingsStore.getNumber('alert_load_per_cpu') * 2,
    message: (v, l) => `CPU load tinggi (${v} per core, ambang ${l})`,
    valueText: metric.load1m != null ? `load ${metric.load1m} pada ${cpuCount} core` : null,
  });

  checkThreshold(client, {
    kind: 'latency',
    value: metric.latencyMs,
    limit: settingsStore.getNumber('alert_latency_ms'),
    severityAt: settingsStore.getNumber('alert_latency_ms') * 3,
    message: (v, l) => `Latency tinggi (${v} ms, ambang ${l} ms)`,
    valueText: null,
  });

  evaluateDiskForecast(client, diskPct);
}

function checkThreshold(client, { kind, value, limit, severityAt, message, valueText }) {
  if (value == null || !Number.isFinite(limit)) return;

  if (value >= limit) {
    raise(client, {
      kind,
      severity: value >= severityAt ? 'critical' : 'warning',
      message: message(value, limit),
      valueText,
    });
  } else {
    clear(client, kind);
  }
}

const getDiskTrendSamples = db.prepare(`
  SELECT received_at, disk_used_gb, disk_total_gb
  FROM client_metrics
  WHERE client_id = ? AND disk_used_gb IS NOT NULL AND disk_total_gb IS NOT NULL
  ORDER BY received_at DESC
  LIMIT 120
`);

/**
 * Prediksi disk penuh: bandingkan pemakaian sekarang dengan sampel tertua
 * yang tersedia, lalu ekstrapolasi linear. Hanya memperingatkan kalau
 * pertumbuhannya benar-benar naik dan perkiraan penuhnya lebih cepat dari
 * ambang jam yang diatur.
 */
function evaluateDiskForecast(client, currentPct) {
  const horizonHours = settingsStore.getNumber('alert_disk_forecast_hours');
  if (!Number.isFinite(horizonHours) || horizonHours <= 0) return;

  // Kalau sudah kena alert disk biasa, prediksi jadi mubazir.
  if (currentPct != null && currentPct >= settingsStore.getNumber('alert_disk_percent')) {
    clear(client, 'disk_forecast');
    return;
  }

  const samples = getDiskTrendSamples.all(client.id);
  if (samples.length < 10) return; // data terlalu sedikit untuk menilai tren

  const newest = samples[0];
  const oldest = samples[samples.length - 1];
  const hours = (Date.parse(newest.received_at + 'Z') - Date.parse(oldest.received_at + 'Z')) / 3600000;

  // Rentang minimal 2 jam, bukan 30 menit.
  //
  // `disk_used_gb` disimpan sebagai bilangan BULAT, jadi 48->49 terbaca
  // sebagai lompatan 1 GB penuh padahal nyatanya mungkin 0.1 GB. Pada
  // rentang 30 menit, satu lompatan pembulatan saja sudah jadi "+2 GB/jam"
  // — cukup untuk memicu alert pada disk yang sebenarnya diam. Rentang
  // yang lebih panjang membuat derau pembulatan itu tidak lagi dominan.
  if (!Number.isFinite(hours) || hours < 2) return;

  const growthPerHour = (newest.disk_used_gb - oldest.disk_used_gb) / hours;

  // Pertumbuhan di bawah 0.25 GB/jam diabaikan: pada data bilangan bulat,
  // angka sekecil itu tidak bisa dibedakan dari derau pembulatan.
  const MIN_GROWTH_GB_PER_HOUR = 0.25;
  if (growthPerHour < MIN_GROWTH_GB_PER_HOUR) { clear(client, 'disk_forecast'); return; }

  const remainingGb = newest.disk_total_gb - newest.disk_used_gb;
  const hoursToFull = remainingGb / growthPerHour;

  // HISTERESIS: ambang naik dan ambang turun sengaja BERBEDA.
  //
  // Sebelumnya keduanya sama (horizonHours), sehingga prediksi yang
  // berosilasi di sekitar ambang — 9.9 jam, lalu 10.1 jam, lalu 9.9 lagi —
  // menghasilkan WARNING/PULIH bergantian tiap beberapa menit. Di grup
  // Telegram itu terlihat sebagai spam, dan alert yang jadi derau akan
  // diabaikan orang justru saat benar-benar penting.
  //
  // Sekarang: alert menyala di <= horizon, tapi baru dinyatakan pulih
  // setelah prediksinya membaik jauh (1.5x horizon).
  const ambangPulih = horizonHours * 1.5;
  const sedangAktif = !!findActive.get(client.id, 'disk_forecast');

  if (hoursToFull <= horizonHours) {
    raise(client, {
      kind: 'disk_forecast',
      severity: hoursToFull <= horizonHours / 4 ? 'critical' : 'warning',
      message: `Disk diperkirakan penuh dalam ~${formatHours(hoursToFull)}`,
      valueText: `+${growthPerHour.toFixed(2)} GB/jam · sisa ${remainingGb.toFixed(1)} GB`,
    });
  } else if (!sedangAktif || hoursToFull > ambangPulih) {
    // Di antara horizon dan ambang pulih, alert yang sudah menyala
    // DIBIARKAN menyala — itulah histeresisnya.
    clear(client, 'disk_forecast');
  }
}

function formatHours(h) {
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} menit`;
  if (h < 48) return `${Math.round(h)} jam`;
  return `${Math.round(h / 24)} hari`;
}

function percent(used, total) {
  if (used == null || !total) return null;
  return Math.round((used / total) * 100);
}

/** Dipanggil saat client terdeteksi OFFLINE oleh pemeriksa stale. */
function onClientOffline(client) {
  if (!settingsStore.getBool('alert_on_offline')) return;
  raise(client, {
    kind: 'offline',
    severity: 'critical',
    message: 'Client OFFLINE — tidak ada data masuk',
    valueText: client.lastSeenAt ? `terakhir terlihat ${client.lastSeenAt}` : null,
  });
}

/** Dipanggil saat metrik masuk lagi setelah sebelumnya offline/pending. */
function onClientOnline(client, wasStatus) {
  clear(client, 'offline');

  if (wasStatus === 'pending' && settingsStore.getBool('alert_on_new_client')) {
    raise(client, {
      kind: 'new_client',
      severity: 'info',
      message: 'Client baru berhasil terhubung',
      valueText: client.hostname || null,
    });
    // Alert perkenalan langsung ditutup — ini peristiwa sesaat, bukan
    // kondisi yang perlu terus ditandai di tabel.
    const active = findActive.get(client.id, 'new_client');
    if (active) resolveAlert.run(active.id);
  }
}

function getActiveForClient(clientId) {
  return listActiveByClient.all(clientId);
}

function getAllActive() {
  return listAllActive.all();
}

function getRecentForClient(clientId) {
  return listRecentByClient.all(clientId);
}

module.exports = {
  evaluateMetric,
  onClientOffline,
  onClientOnline,
  getActiveForClient,
  getAllActive,
  getRecentForClient,
};
