const bcrypt = require('bcrypt');
const db = require('../db');

const SALT_ROUNDS = 12;

const findByUsername = db.prepare('SELECT * FROM users WHERE username = ?');
const insertUser = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)');
const countUsers = db.prepare('SELECT COUNT(*) AS n FROM users');

function createUser(username, plainPassword) {
  const hash = bcrypt.hashSync(plainPassword, SALT_ROUNDS);
  insertUser.run(username, hash);
}

function verifyCredentials(username, plainPassword) {
  const user = findByUsername.get(username);
  if (!user) return null;
  const ok = bcrypt.compareSync(plainPassword, user.password_hash);
  return ok ? user : null;
}

function hasAnyUser() {
  return countUsers.get().n > 0;
}

module.exports = { createUser, verifyCredentials, hasAnyUser };
