const db = require('../db');

const insertServer = db.prepare(`
  INSERT INTO servers (name, group_name, host, port, user, via_server_id)
  VALUES (@name, @groupName, @host, @port, @user, @viaServerId)
`);

const updateServerStmt = db.prepare(`
  UPDATE servers
  SET name = @name, group_name = @groupName, host = @host, port = @port,
      user = @user, via_server_id = @viaServerId
  WHERE id = @id
`);

const deleteServerStmt = db.prepare('DELETE FROM servers WHERE id = ?');
const getByIdStmt = db.prepare('SELECT * FROM servers WHERE id = ?');
const getAllStmt = db.prepare('SELECT * FROM servers ORDER BY group_name, name');
const countChildrenStmt = db.prepare('SELECT COUNT(*) AS n FROM servers WHERE via_server_id = ?');

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    group: row.group_name,
    host: row.host,
    port: row.port,
    user: row.user,
    via: row.via_server_id,
    createdAt: row.created_at,
  };
}

function listServers() {
  return getAllStmt.all().map(mapRow);
}

function getServerById(id) {
  return mapRow(getByIdStmt.get(id));
}

/**
 * Cegah siklus: naik dari calon `via` sampai root, kalau ketemu id server
 * ini sendiri berarti akan membentuk siklus.
 */
function wouldCreateCycle(serverId, viaServerId) {
  let cur = viaServerId;
  const seen = new Set();
  while (cur != null) {
    if (cur === serverId) return true;
    if (seen.has(cur)) return true; // siklus lain yang sudah ada, jaga-jaga
    seen.add(cur);
    const row = getByIdStmt.get(cur);
    cur = row ? row.via_server_id : null;
  }
  return false;
}

function validateInput({ id, name, host, user, viaServerId }) {
  if (!name || !name.trim()) throw new Error('Nama server wajib diisi.');
  if (!host || !host.trim()) throw new Error('Host wajib diisi.');
  if (!user || !user.trim()) throw new Error('User SSH wajib diisi.');

  if (viaServerId != null) {
    const viaServer = getByIdStmt.get(viaServerId);
    if (!viaServer) throw new Error('Jump host yang dipilih tidak ditemukan.');
    if (id != null && wouldCreateCycle(id, viaServerId)) {
      throw new Error('Pilihan jump host ini akan membentuk siklus (server tidak boleh menjadi jump host untuk dirinya sendiri, langsung maupun tidak langsung).');
    }
  }
}

function createServer({ name, groupName, host, port, user, viaServerId }) {
  validateInput({ id: null, name, host, user, viaServerId });
  const info = insertServer.run({
    name: name.trim(),
    groupName: (groupName || 'lainnya').trim(),
    host: host.trim(),
    port: port || 22,
    user: user.trim(),
    viaServerId: viaServerId || null,
  });
  return getServerById(info.lastInsertRowid);
}

function updateServer(id, { name, groupName, host, port, user, viaServerId }) {
  const existing = getByIdStmt.get(id);
  if (!existing) throw new Error('Server tidak ditemukan.');
  validateInput({ id, name, host, user, viaServerId });

  updateServerStmt.run({
    id,
    name: name.trim(),
    groupName: (groupName || 'lainnya').trim(),
    host: host.trim(),
    port: port || 22,
    user: user.trim(),
    viaServerId: viaServerId || null,
  });
  return getServerById(id);
}

/** Berapa banyak server lain yang menjadikan server ini sebagai jump host. */
function countDependents(id) {
  return countChildrenStmt.get(id).n;
}

function deleteServer(id) {
  deleteServerStmt.run(id);
}

module.exports = {
  listServers,
  getServerById,
  createServer,
  updateServer,
  deleteServer,
  countDependents,
  wouldCreateCycle,
};
