// Logique pure des clés d'accès (sans base de données) : testable seule (test/access-keys-unit.js).
const crypto = require('crypto');

const secretOf = () => process.env.ACCESS_KEY_SECRET || crypto.createHash('sha256').update(String(process.env.JWT_SECRET || '') + ':access-key').digest('hex');
const hmac = (label, value) => crypto.createHmac('sha256', secretOf()).update(label + ':' + value).digest('hex');

/** Clé numérique de 4 chiffres, zéros initiaux autorisés, générateur cryptographiquement sûr. */
function generateKey(randomInt = crypto.randomInt) { return String(randomInt(0, 10000)).padStart(4, '0'); }
const isValidKey = k => typeof k === 'string' && /^\d{4}$/.test(k);
const hashKey = key => hmac('key', key);
const hintOf = key => '••' + String(key).slice(-2);
const deviceHash = deviceId => hmac('device', deviceId);

// Chiffrement réversible de la clé (pour que le Super Admin puisse la retransmettre) : AES-256-GCM.
const encKey = () => crypto.createHash('sha256').update(secretOf() + ':enc').digest();
function encryptKey(key) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', encKey(), iv);
  const data = Buffer.concat([c.update(String(key), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), data].map(b => b.toString('base64')).join('.');
}
function decryptKey(blob) {
  const [iv, tag, data] = String(blob).split('.').map(x => Buffer.from(x, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', encKey(), iv); d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString('utf8');
}

// Cookies (sans dépendance)
function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
function cookie(name, value, { maxAgeSec, secure } = {}) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}${maxAgeSec != null ? '; Max-Age=' + Math.floor(maxAgeSec) : ''}`;
}

// « Laissez-passer » : prouve qu'une clé valide a été saisie sur CET appareil ; signé, borné dans le temps.
function signPass({ devHash, keyId, expiresAt }) {
  const payload = Buffer.from(JSON.stringify({ d: devHash, k: keyId, e: expiresAt })).toString('base64url');
  return payload + '.' + hmac('pass', payload);
}
function verifyPass(token, devHash, now = Date.now()) {
  if (typeof token !== 'string' || !token.includes('.')) return false;
  const [payload, sig] = token.split('.');
  const expected = hmac('pass', payload);
  const a = Buffer.from(sig || '', 'utf8'), b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try { const p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); return p.d === devHash && Number(p.e) > now; } catch (_) { return false; }
}

/** Limiteur d'essais à délai progressif : 3 échecs gratuits, puis 1 min, 2, 4… plafonné à 30 min ; oubli après 1 h sans échec. */
class Lockout {
  constructor({ free = 3, baseMs = 60000, maxMs = 30 * 60000, forgetMs = 3600000 } = {}) { Object.assign(this, { free, baseMs, maxMs, forgetMs }); this.m = new Map(); }
  check(id, now = Date.now()) {
    const r = this.m.get(id);
    if (!r) return 0;
    if (now - r.last > this.forgetMs) { this.m.delete(id); return 0; }
    return r.until > now ? Math.ceil((r.until - now) / 1000) : 0;
  }
  fail(id, now = Date.now()) {
    const r = this.m.get(id) && now - this.m.get(id).last <= this.forgetMs ? this.m.get(id) : { n: 0, until: 0, last: now };
    r.n += 1; r.last = now;
    if (r.n > this.free) r.until = now + Math.min(this.maxMs, this.baseMs * Math.pow(2, r.n - this.free - 1));
    this.m.set(id, r);
    if (this.m.size > 5000) for (const [k, v] of this.m) if (now - v.last > this.forgetMs) this.m.delete(k);
    return r.until > now ? Math.ceil((r.until - now) / 1000) : 0;
  }
  reset(id) { this.m.delete(id); }
}

/** Statut effectif d'une clé (calculé : l'expiration n'est pas stockée comme un statut). */
function effectiveStatus(row, now = Date.now()) {
  if (row.status === 'disponible' && row.expires_at && new Date(row.expires_at).getTime() <= now) return 'expiree';
  return row.status;
}

/** Code de secours Superadmin : 16 caractères (alphabet de 32 symboles sans I/O/0/1 = 80 bits), affiché par groupes de 4. */
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateRecoveryCode(randomInt = crypto.randomInt) {
  let s = ''; for (let i = 0; i < 16; i++) s += RECOVERY_ALPHABET[randomInt(0, RECOVERY_ALPHABET.length)];
  return s.match(/.{4}/g).join('-');
}
const normalizeRecovery = c => String(c == null ? '' : c).toUpperCase().replace(/[\s-]/g, '');
const isValidRecovery = c => /^[A-HJ-NP-Z2-9]{16}$/.test(normalizeRecovery(c));
const hashRecovery = c => hmac('recovery', normalizeRecovery(c));
const hintRecovery = c => '••••-••••-••••-' + normalizeRecovery(c).slice(-4);

module.exports = { generateRecoveryCode, normalizeRecovery, isValidRecovery, hashRecovery, hintRecovery, generateKey, isValidKey, hashKey, hintOf, deviceHash, encryptKey, decryptKey, parseCookies, cookie, signPass, verifyPass, Lockout, effectiveStatus };
