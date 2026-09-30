CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'up', 'down')),
  hostname TEXT,
  private_ip TEXT,
  public_ip TEXT,
  last_seen_at TEXT,
  last_latency_ms INTEGER,
  agent_version TEXT,
  agent_updated_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_clients_token ON clients (token);
CREATE INDEX IF NOT EXISTS idx_clients_group ON clients (group_id);

CREATE TABLE IF NOT EXISTS client_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  mem_total_mb INTEGER,
  mem_used_mb INTEGER,
  disk_total_gb REAL,
  disk_used_gb REAL,
  load_1m REAL,
  load_5m REAL,
  load_15m REAL,
  uptime_seconds INTEGER,
  latency_ms INTEGER,
  cpu_count INTEGER
);
CREATE INDEX IF NOT EXISTS idx_client_metrics_client ON client_metrics (client_id, received_at DESC);

CREATE TABLE IF NOT EXISTS client_command_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  command TEXT NOT NULL CHECK (command IN ('docker_ps', 'port_listen')),
  requested_at TEXT NOT NULL DEFAULT (datetime('now')),
  output TEXT,
  error_message TEXT,
  UNIQUE (client_id, command)
);

CREATE TABLE IF NOT EXISTS status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_status_history_client ON status_history (client_id, changed_at DESC);

-- Pengaturan aplikasi (key-value). Dipakai untuk threshold alert dan
-- kredensial Telegram, supaya bisa diubah dari web tanpa redeploy.
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Alert aktif & riwayatnya. Satu baris per kejadian: dibuat saat kondisi
-- mulai bermasalah, di-resolve saat pulih. `resolved_at IS NULL` berarti
-- alert masih aktif — dipakai untuk badge di tabel dan peredam notifikasi
-- (tidak mengirim ulang selama baris aktifnya masih ada).
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'critical')),
  message TEXT NOT NULL,
  value_text TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  notified_at TEXT,
  resolve_notified_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_alerts_client ON alerts (client_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_active ON alerts (client_id, kind) WHERE resolved_at IS NULL;

-- Langganan Web Push per browser/perangkat. `endpoint` unik dari push
-- service (FCM/Mozilla/Apple) dan sekaligus jadi identitasnya — satu baris
-- per browser, bukan per user, karena satu user bisa punya banyak perangkat.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_success_at TEXT,
  fail_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions (user_id);
