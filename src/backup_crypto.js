// Chiffrement des sauvegardes jointes aux e-mails (audit D3, option B).
// AES-256-GCM, clé dérivée par scrypt de BACKUP_ENCRYPTION_KEY (phrase secrète de 16 caractères minimum, conservée HORS base).
// Format du fichier .enc : "SMPENC1" (7 octets) | sel (16) | IV (12) | étiquette GCM (16) | données chiffrées.
const crypto = require('crypto');

const MAGIC = Buffer.from('SMPENC1');
const SALT_LEN = 16, IV_LEN = 12, TAG_LEN = 16;
const MIN_KEY_CHARS = 16;

function deriveKey(passphrase, salt) {
  return crypto.scryptSync(String(passphrase), salt, 32);
}

function assertKey(passphrase) {
  if (typeof passphrase !== 'string' || passphrase.length < MIN_KEY_CHARS) {
    throw new Error(`BACKUP_ENCRYPTION_KEY absente ou trop courte (${MIN_KEY_CHARS} caractères minimum)`);
  }
}

/** Indique si une clé de chiffrement exploitable est configurée. */
function isConfigured(passphrase = process.env.BACKUP_ENCRYPTION_KEY) {
  return typeof passphrase === 'string' && passphrase.length >= MIN_KEY_CHARS;
}

function encryptBuffer(buf, passphrase = process.env.BACKUP_ENCRYPTION_KEY) {
  assertKey(passphrase);
  const salt = crypto.randomBytes(SALT_LEN), iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(passphrase, salt), iv);
  const data = Buffer.concat([cipher.update(buf), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), data]);
}

function decryptBuffer(enc, passphrase = process.env.BACKUP_ENCRYPTION_KEY) {
  assertKey(passphrase);
  const head = MAGIC.length + SALT_LEN + IV_LEN + TAG_LEN;
  if (!Buffer.isBuffer(enc) || enc.length < head || !enc.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('Fichier chiffré invalide (en-tête SMPENC1 absent)');
  }
  let o = MAGIC.length;
  const salt = enc.subarray(o, o += SALT_LEN), iv = enc.subarray(o, o += IV_LEN), tag = enc.subarray(o, o += TAG_LEN);
  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(passphrase, salt), iv);
  decipher.setAuthTag(tag);
  try { return Buffer.concat([decipher.update(enc.subarray(o)), decipher.final()]); }
  catch { throw new Error('Déchiffrement impossible : clé incorrecte ou fichier altéré'); }
}

module.exports = { encryptBuffer, decryptBuffer, isConfigured, MIN_KEY_CHARS };
