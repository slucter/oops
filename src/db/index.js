const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'oops.sqlite');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

/**
 * Migrasi kolom tambahan. `CREATE TABLE IF NOT EXISTS` di schema.sql tidak
 * menyentuh tabel yang sudah terlanjur dibuat, jadi kolom baru pada database
 * yang sudah jalan (mis. produksi) harus ditambahkan eksplisit di sini.
 * Idempotent: dicek dulu lewat PRAGMA sebelum ALTER.
 */
function addColumnIfMissing(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (columns.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

addColumnIfMissing('clients', 'last_latency_ms', 'INTEGER');
addColumnIfMissing('client_metrics', 'latency_ms', 'INTEGER');
addColumnIfMissing('clients', 'private_ip', 'TEXT');
addColumnIfMissing('clients', 'public_ip', 'TEXT');
addColumnIfMissing('client_metrics', 'cpu_count', 'INTEGER');

module.exports = db;
