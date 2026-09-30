const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

const KEYS_DIR = process.env.KEYS_DIR || path.join(__dirname, '..', '..', 'data', 'keys');
fs.mkdirSync(KEYS_DIR, { recursive: true });

const MAX_KEY_SIZE_BYTES = 64 * 1024;

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, KEYS_DIR),
  filename: (req, file, cb) => cb(null, uuidv4()),
});

const keyUpload = multer({
  storage,
  limits: { fileSize: MAX_KEY_SIZE_BYTES },
});

/**
 * Validasi dasar bahwa file yang diupload terlihat seperti private key
 * (punya header PEM/OpenSSH). Bukan validasi kriptografis penuh, hanya
 * untuk mencegah upload file yang jelas-jelas salah.
 */
function looksLikePrivateKey(filePath) {
  const head = fs.readFileSync(filePath, { encoding: 'utf8', flag: 'r' }).slice(0, 100);
  return /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(head) || /-----BEGIN OPENSSH PRIVATE KEY-----/.test(head);
}

function assertValidKeyFile(filePath) {
  if (!looksLikePrivateKey(filePath)) {
    fs.unlinkSync(filePath);
    throw new Error('File yang diupload tidak terlihat seperti private key SSH (header PEM/OpenSSH tidak ditemukan).');
  }
  fs.chmodSync(filePath, 0o600);
}

function removeKeyFile(filePath) {
  if (filePath && fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

module.exports = { keyUpload, KEYS_DIR, assertValidKeyFile, removeKeyFile };
