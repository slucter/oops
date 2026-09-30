const db = require('../db');

const insertGroup = db.prepare('INSERT INTO groups (name) VALUES (?)');
const updateGroupStmt = db.prepare('UPDATE groups SET name = ? WHERE id = ?');
const deleteGroupStmt = db.prepare('DELETE FROM groups WHERE id = ?');
const getByIdStmt = db.prepare('SELECT * FROM groups WHERE id = ?');
const getAllStmt = db.prepare('SELECT * FROM groups ORDER BY name');
const countMembersStmt = db.prepare('SELECT COUNT(*) AS n FROM clients WHERE group_id = ?');

function mapRow(row) {
  if (!row) return null;
  return { id: row.id, name: row.name, createdAt: row.created_at };
}

function listGroups() {
  return getAllStmt.all().map(mapRow);
}

function getGroupById(id) {
  return mapRow(getByIdStmt.get(id));
}

function createGroup(name) {
  if (!name || !name.trim()) throw new Error('Nama grup wajib diisi.');
  try {
    const info = insertGroup.run(name.trim());
    return getGroupById(info.lastInsertRowid);
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      throw new Error(`Grup dengan nama "${name.trim()}" sudah ada.`);
    }
    throw err;
  }
}

function updateGroup(id, name) {
  const existing = getByIdStmt.get(id);
  if (!existing) throw new Error('Grup tidak ditemukan.');
  if (!name || !name.trim()) throw new Error('Nama grup wajib diisi.');
  try {
    updateGroupStmt.run(name.trim(), id);
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      throw new Error(`Grup dengan nama "${name.trim()}" sudah ada.`);
    }
    throw err;
  }
  return getGroupById(id);
}

function countMembers(id) {
  return countMembersStmt.get(id).n;
}

function deleteGroup(id) {
  deleteGroupStmt.run(id);
}

module.exports = { listGroups, getGroupById, createGroup, updateGroup, countMembers, deleteGroup };
