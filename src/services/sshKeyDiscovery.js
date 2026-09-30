const fs = require('fs');
const os = require('os');
const path = require('path');

const SSH_DIR = process.env.SSH_DIR || path.join(os.homedir(), '.ssh');

const SKIP_NAMES = new Set(['config', 'known_hosts', 'known_hosts.old', 'authorized_keys']);

function looksLikePrivateKeyFile(filePath) {
  if (filePath.endsWith('.pub')) return false;
  try {
    const head = fs.readFileSync(filePath, { encoding: 'utf8', flag: 'r' }).slice(0, 100);
    return /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(head);
  } catch {
    return false;
  }
}

/**
 * Daftar semua file yang terlihat seperti private key di ~/.ssh/,
 * diurutkan supaya key yang lebih umum dicoba lebih dulu (heuristik saja,
 * urutan pasti ditentukan trial-and-error saat connect).
 */
function listCandidateKeys() {
  if (!fs.existsSync(SSH_DIR)) return [];

  const entries = fs.readdirSync(SSH_DIR, { withFileTypes: true });
  const candidates = entries
    .filter((e) => e.isFile() && !SKIP_NAMES.has(e.name))
    .map((e) => path.join(SSH_DIR, e.name))
    .filter(looksLikePrivateKeyFile);

  const priority = ['id_ed25519', 'id_rsa', 'id_ecdsa'];
  candidates.sort((a, b) => {
    const ai = priority.indexOf(path.basename(a));
    const bi = priority.indexOf(path.basename(b));
    const aRank = ai === -1 ? priority.length : ai;
    const bRank = bi === -1 ? priority.length : bi;
    return aRank - bRank;
  });

  return candidates;
}

/**
 * Parser minimal untuk ~/.ssh/config: cari blok `Host <alias>` yang
 * namanya sama persis dengan hostname target, kembalikan IdentityFile
 * kalau didefinisikan di blok itu. Tidak mendukung wildcard/pattern.
 */
function findIdentityFileForHost(targetHost) {
  const configPath = path.join(SSH_DIR, 'config');
  if (!fs.existsSync(configPath)) return null;

  const lines = fs.readFileSync(configPath, 'utf8').split(/\r?\n/);
  let inMatchingBlock = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const hostMatch = line.match(/^Host\s+(.+)$/i);
    if (hostMatch) {
      const aliases = hostMatch[1].split(/\s+/);
      inMatchingBlock = aliases.includes(targetHost);
      continue;
    }

    if (inMatchingBlock) {
      const identityMatch = line.match(/^IdentityFile\s+(.+)$/i);
      if (identityMatch) {
        let identityPath = identityMatch[1].trim().replace(/^"|"$/g, '');
        if (identityPath.startsWith('~')) {
          identityPath = path.join(os.homedir(), identityPath.slice(1));
        }
        return identityPath;
      }
    }
  }

  return null;
}

/**
 * Urutan key yang akan dicoba untuk sebuah host: IdentityFile spesifik
 * dari ~/.ssh/config dulu (kalau ada dan filenya ada), lalu semua
 * kandidat lain di ~/.ssh/.
 */
function keysToTryForHost(targetHost) {
  const fromConfig = findIdentityFileForHost(targetHost);
  const all = listCandidateKeys();

  if (fromConfig && fs.existsSync(fromConfig) && looksLikePrivateKeyFile(fromConfig)) {
    return [fromConfig, ...all.filter((k) => k !== fromConfig)];
  }
  return all;
}

module.exports = { listCandidateKeys, findIdentityFileForHost, keysToTryForHost, SSH_DIR };
