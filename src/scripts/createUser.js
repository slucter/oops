require('dotenv').config();
const { createUser, hasAnyUser } = require('../services/userStore');

const [, , username, password] = process.argv;

if (!username || !password) {
  console.error('Pemakaian: node src/scripts/createUser.js <username> <password>');
  process.exit(1);
}

if (hasAnyUser()) {
  console.log('Catatan: sudah ada user terdaftar. Menambahkan user baru.');
}

createUser(username, password);
console.log(`User "${username}" dibuat.`);
