const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const CONFIG_PATH = process.env.SERVERS_CONFIG_PATH
  || path.join(__dirname, '..', '..', 'config', 'servers.yaml');

const ID_PATTERN = /^[a-z0-9-]+$/;

function loadServers() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(
      `File konfigurasi server tidak ditemukan: ${CONFIG_PATH}\n` +
      'Salin config/servers.example.yaml menjadi config/servers.yaml lalu isi datanya.'
    );
  }

  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  const parsed = yaml.load(raw);

  if (!parsed || !Array.isArray(parsed.servers)) {
    throw new Error(`Format ${CONFIG_PATH} tidak valid: butuh key "servers" berisi list.`);
  }

  const servers = parsed.servers;
  const byId = new Map();

  for (const s of servers) {
    if (!s.id || !ID_PATTERN.test(s.id)) {
      throw new Error(`Server dengan id tidak valid: ${JSON.stringify(s.id)} (hanya huruf kecil, angka, strip)`);
    }
    if (byId.has(s.id)) {
      throw new Error(`Id server duplikat: ${s.id}`);
    }
    for (const field of ['name', 'host', 'user', 'ssh_key']) {
      if (!s[field]) {
        throw new Error(`Server "${s.id}" tidak punya field wajib: ${field}`);
      }
    }
    byId.set(s.id, {
      id: s.id,
      name: s.name,
      group: s.group || 'lainnya',
      host: s.host,
      port: s.port || 22,
      user: s.user,
      sshKey: s.ssh_key,
      via: s.via || null,
      hasDocker: !!s.has_docker,
    });
  }

  for (const s of byId.values()) {
    if (s.via && !byId.has(s.via)) {
      throw new Error(`Server "${s.id}" punya via="${s.via}" yang tidak ditemukan di daftar server.`);
    }
  }

  for (const s of byId.values()) {
    const seen = new Set();
    let cur = s;
    while (cur.via) {
      if (seen.has(cur.id)) {
        throw new Error(`Siklus jump host terdeteksi melibatkan server "${s.id}".`);
      }
      seen.add(cur.id);
      cur = byId.get(cur.via);
    }
  }

  return Array.from(byId.values());
}

function getServerById(id) {
  return loadServers().find((s) => s.id === id) || null;
}

module.exports = { loadServers, getServerById, CONFIG_PATH };
