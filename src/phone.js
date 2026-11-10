/* Numéros de téléphone : format international, indicatif par défaut +223 (Mali).
 * - « 70 11 22 33 » (8 chiffres)  -> « +223 70 11 22 33 »
 * - « 00223… » / « 223… »        -> « +223 … »
 * - « +33 … » (autre pays)       -> conservé
 * Une valeur non reconnue est laissée telle quelle (la saisie est contrôlée côté interface). */
const DEFAULT_CC = '223';
const fmt8 = d => d.replace(/(\d{2})(?=\d)/g, '$1 ').trim();

function normalizePhone(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return s;
  const t = s.replace(/[\s.\-()]/g, '');
  let d, intl = false;
  if (t.startsWith('+')) { d = t.slice(1).replace(/\D/g, ''); intl = true; }
  else if (t.startsWith('00')) { d = t.slice(2).replace(/\D/g, ''); intl = true; }
  else d = t.replace(/\D/g, '');
  if (d.startsWith(DEFAULT_CC) && d.length === 11) return `+${DEFAULT_CC} ${fmt8(d.slice(3))}`;
  if (!intl) return d.length === 8 ? `+${DEFAULT_CC} ${fmt8(d)}` : s;
  return d.length >= 8 && d.length <= 15 ? '+' + d : s;
}

const PHONE_KEYS = ['phone', 'emergency_phone', 'contact_phone', 'borrower_phone'];
/** Middleware Express : normalise les champs téléphone des corps JSON (POST/PUT/PATCH). */
function phoneMiddleware(req, _res, next) {
  if (req.method !== 'GET' && req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
    for (const k of PHONE_KEYS) if (typeof req.body[k] === 'string' && req.body[k].trim()) req.body[k] = normalizePhone(req.body[k]);
  }
  next();
}
module.exports = { normalizePhone, phoneMiddleware, DEFAULT_CC };
