CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS servers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  group_name TEXT NOT NULL DEFAULT 'lainnya',
  host TEXT NOT NULL,
  port INTEGER NOT NULL DEFAULT 22,
  user TEXT NOT NULL,
  via_server_id INTEGER REFERENCES servers(id) ON DELETE SET NULL,
  has_docker INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS check_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  checked_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL CHECK (status IN ('up', 'down', 'unreachable')),
  latency_ms INTEGER,
  error_message TEXT
);
CREATE INDEX IF NOT EXISTS idx_check_results_server ON check_results (server_id, checked_at DESC);

CREATE TABLE IF NOT EXISTS docker_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  checked_at TEXT NOT NULL DEFAULT (datetime('now')),
  raw_output TEXT,
  error_message TEXT
);
CREATE INDEX IF NOT EXISTS idx_docker_snapshots_server ON docker_snapshots (server_id, checked_at DESC);

CREATE TABLE IF NOT EXISTS port_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  checked_at TEXT NOT NULL DEFAULT (datetime('now')),
  raw_output TEXT,
  error_message TEXT
);
CREATE INDEX IF NOT EXISTS idx_port_snapshots_server ON port_snapshots (server_id, checked_at DESC);

CREATE TABLE IF NOT EXISTS status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_status_history_server ON status_history (server_id, changed_at DESC);
