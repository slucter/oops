const crypto = require('crypto');
const db = require('../db');

function generateToken() {
  return crypto.randomBytes(24).toString('hex');
}

const insertClient = db.prepare(`
  INSERT INTO clients (name, token, group_id) VALUES (@name, @token, @groupId)
`);

const updateClientStmt = db.prepare(`
  UPDATE clients SET name = @name, group_id = @groupId WHERE id = @id
`);

const updateTokenStmt = db.prepare('UPDATE clients SET token = ? WHERE id = ?');
const deleteClientStmt = db.prepare('DELETE FROM clients WHERE id = ?');
const getByIdStmt = db.prepare('SELECT * FROM clients WHERE id = ?');
const getByTokenStmt = db.prepare('SELECT * FROM clients WHERE token = ?');
const getAllStmt = db.prepare(`
  SELECT clients.*, groups.name AS group_name
  FROM clients
  LEFT JOIN groups ON groups.id = clients.group_id
  ORDER BY clients.name
`);

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    token: row.token,
    groupId: row.group_id,
    groupName: row.group_name || null,
    status: row.status,
    hostname: row.hostname,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
  };
}

function listClients() {
  return getAllStmt.all().map(mapRow);
}

function getClientById(id) {
  return mapRow(getByIdStmt.get(id));
}

function getClientByToken(token) {
  return mapRow(getByTokenStmt.get(token));
}

function createClient({ name, groupId }) {
  if (!name || !name.trim()) throw new Error('Nama client wajib diisi.');
  const token = generateToken();
  const info = insertClient.run({ name: name.trim(), token, groupId: groupId || null });
  return getClientById(info.lastInsertRowid);
}

function updateClient(id, { name, groupId }) {
  const existing = getByIdStmt.get(id);
  if (!existing) throw new Error('Client tidak ditemukan.');
  if (!name || !name.trim()) throw new Error('Nama client wajib diisi.');
  updateClientStmt.run({ id, name: name.trim(), groupId: groupId || null });
  return getClientById(id);
}

function regenerateToken(id) {
  const existing = getByIdStmt.get(id);
  if (!existing) throw new Error('Client tidak ditemukan.');
  const token = generateToken();
  updateTokenStmt.run(token, id);
  return getClientById(id);
}

function deleteClient(id) {
  deleteClientStmt.run(id);
}

module.exports = {
  listClients,
  getClientById,
  getClientByToken,
  createClient,
  updateClient,
  regenerateToken,
  deleteClient,
};
