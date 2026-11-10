// Clés d'accès à l'écran de connexion (Super Admin) — la clé n'ouvre QUE l'écran de connexion : elle ne remplace jamais le mot de passe.
//  - pub   : /api/public/access/*   (visiteur non connecté)
//  - admin : /api/admin/access-keys* (Super Admin uniquement, routes protégées côté serveur)
// Politique par défaut prudente : exigée automatiquement si au moins une clé est active ; sinon reste ouverte pour éviter de bloquer tous les comptes.
// Une clé = UNE utilisation par appareil : l'appareil qui a saisi une clé valide devient « appareil de confiance » et n'a plus à la ressaisir,
// même si la clé expire ensuite (l'expiration ne ferme que l'enrôlement de NOUVEAUX appareils ; la révocation, elle, retire la confiance).
// Recours Superadmin (anti-blocage) : 1) code de secours à usage unique (POST /api/public/access/recovery),
//   2) commande serveur « npm run access:rescue », 3) variable ACCESS_KEY_DISABLE=1 dans .env (puis redémarrer le serveur).
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const { pool, wrap, body, audit, HttpError } = require('./core');
const L = require('./access_keys_logic');

const POLICY_KEY = 'access_key_policy';
const DEFAULT_POLICY = { required: false, pass_minutes: 60 };
let policyCache = null, policyAt = 0;
async function getPolicy(force = false) {
  if (!force && policyCache && Date.now() - policyAt < 15000) return policyCache;
  let v = null, settingsAvailable = true;
  try { v = (await pool.query('SELECT value FROM app_settings WHERE key = $1', [POLICY_KEY])).rows[0]?.value; }
  catch (e) { if (e.code === '42P01') settingsAvailable = false; else throw e; }
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { v = null; } }
  // Si aucune politique n'a été enregistrée, activer le contrôle dès qu'une clé valide existe.
  // Ne jamais fermer l'accès à toute l'installation lorsqu'aucune clé n'a été créée/activée.
  let defaultRequired = false;
  if (v == null && settingsAvailable) {
    try {
      const { rows: [active] } = await pool.query(`SELECT COUNT(*)::int AS n FROM access_keys WHERE status = 'disponible' AND (expires_at IS NULL OR expires_at > now())`);
      defaultRequired = Number(active && active.n) > 0;
    } catch (e) { if (e.code !== '42P01') throw e; }
  }
  policyCache = {
    required: (v && typeof v.required === 'boolean' ? v.required : defaultRequired) && process.env.ACCESS_KEY_DISABLE !== '1',
    pass_minutes: Math.min(1440, Math.max(5, Number(v && v.pass_minutes) || DEFAULT_POLICY.pass_minutes))
  };
  policyAt = Date.now();
  return policyCache;
}

// ---------- Appareil : identifiant aléatoire émis par le SERVEUR (cookie HttpOnly), jamais fourni librement par le navigateur ----------
const DEV_COOKIE = 'smp_dev', PASS_COOKIE = 'smp_gate';
const isSecure = req => req.secure || req.headers['x-forwarded-proto'] === 'https';
function deviceOf(req, res) {
  const c = L.parseCookies(req.headers.cookie);
  let id = /^[a-f0-9]{48}$/.test(c[DEV_COOKIE] || '') ? c[DEV_COOKIE] : null;
  if (!id) {
    id = require('crypto').randomBytes(24).toString('hex');
    res.append('Set-Cookie', L.cookie(DEV_COOKIE, id, { maxAgeSec: 5 * 365 * 86400, secure: isSecure(req) }));
  }
  return { id, hash: L.deviceHash(id) };
}
function passValid(req) {
  const c = L.parseCookies(req.headers.cookie);
  const id = c[DEV_COOKIE];
  if (!/^[a-f0-9]{48}$/.test(id || '')) return false;
  return L.verifyPass(c[PASS_COOKIE], L.deviceHash(id));
}

const lockIp = new L.Lockout(), lockDev = new L.Lockout();
// Le code de secours a ses propres compteurs : des fautes de frappe sur la clé ne doivent jamais bloquer le recours.
const lockRecIp = new L.Lockout({ free: 5 }), lockRecDev = new L.Lockout({ free: 5 });
const RECOVERY_KEY = 'access_key_recovery';

/** Appareil de confiance : a déjà utilisé une clé (non révoquée). L'expiration d'une clé ne retire PAS la confiance. */
async function trustedDevice(devHash) {
  const { rows } = await pool.query(
    `SELECT 1 FROM access_key_uses u JOIN access_keys k ON k.id = u.key_id WHERE u.device_hash = $1 AND k.status <> 'revoquee' LIMIT 1`, [devHash]);
  return rows.length > 0;
}
function issuePass(req, res, devHash, keyId, minutes) {
  const expiresAt = Date.now() + minutes * 60000;
  res.append('Set-Cookie', L.cookie(PASS_COOKIE, L.signPass({ devHash, keyId, expiresAt }), { maxAgeSec: minutes * 60, secure: isSecure(req) }));
  return expiresAt;
}
/** Vrai si l'écran de connexion est accessible à cet appareil ; renouvelle silencieusement le laissez-passer d'un appareil de confiance. */
async function gateOpen(req, res) {
  const p = await getPolicy();
  if (!p.required || passValid(req)) return true;
  const id = L.parseCookies(req.headers.cookie)[DEV_COOKIE];
  if (!/^[a-f0-9]{48}$/.test(id || '')) return false;
  const hash = L.deviceHash(id);
  if (!(await trustedDevice(hash))) return false;
  issuePass(req, res, hash, 0, p.pass_minutes);
  return true;
}
const countLiveKeys = async () => Number((await pool.query(
  `SELECT COUNT(*)::int AS n FROM access_keys WHERE status = 'disponible' AND (expires_at IS NULL OR expires_at > now())`)).rows[0].n);
async function getRecovery() {
  let v = (await pool.query('SELECT value FROM app_settings WHERE key = $1', [RECOVERY_KEY])).rows[0]?.value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { v = null; } }
  return v || null;
}
const event = (kind, o = {}) => pool.query(
  'INSERT INTO access_key_events(kind, key_id, device_hash, ip, user_id, detail) VALUES ($1,$2,$3,$4,$5,$6)',
  [kind, o.keyId || null, o.dev || null, o.ip || null, o.userId || null, o.detail || null]).catch(() => {});

/** Middleware : exige un laissez-passer valide pour POST /auth/login lorsque la clé d'accès est activée. */
async function requireGate(req, res, next) {
  try {
    if (await gateOpen(req, res)) return next();
    return res.status(403).json({ error: 'Une clé d’accès est requise avant la connexion.', code: 'ACCESS_KEY_REQUIRED' });
  } catch (e) { return next(e); }
}

// ---------- Public ----------
const pub = express.Router();
const verifyLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Trop de tentatives, réessayez plus tard.', code: 'RATE_LIMIT' } });

pub.get('/access/status', wrap(async (req, res) => {
  const p = await getPolicy();
  res.json({ required: p.required, ok: await gateOpen(req, res) });
}));

pub.post('/access/verify', verifyLimiter, body(z.object({ key: z.string().max(16) })), wrap(async (req, res) => {
  const p = await getPolicy();
  if (!p.required) return res.json({ ok: true, required: false });
  const dev = deviceOf(req, res), ip = req.ip || '';
  const wait = Math.max(lockIp.check('ip:' + ip), lockDev.check('dev:' + dev.hash));
  if (wait > 0) {
    await event('locked', { dev: dev.hash, ip, detail: 'attente ' + wait + ' s' });
    res.set('Retry-After', String(wait));
    return res.status(429).json({ error: `Trop d’échecs. Réessayez dans ${wait > 90 ? Math.ceil(wait / 60) + ' min' : wait + ' s'}.`, code: 'LOCKED', retry_after: wait });
  }
  const fail = async (status, code, msg, detail, keyId) => {
    lockIp.fail('ip:' + ip); lockDev.fail('dev:' + dev.hash);
    await event('fail', { dev: dev.hash, ip, keyId, detail });
    return res.status(status).json({ error: msg, code });
  };
  if (await trustedDevice(dev.hash)) { issuePass(req, res, dev.hash, 0, p.pass_minutes); return res.json({ ok: true, trusted: true }); }   // une seule utilisation par appareil : plus de clé à ressaisir
  const key = req.body.key.trim();
  if (!L.isValidKey(key)) return fail(400, 'INVALID', 'La clé comporte exactement 4 chiffres.', 'format');

  const { rows } = await pool.query(
    `SELECT id, status, expires_at FROM access_keys WHERE key_hash = $1 ORDER BY (status = 'disponible') DESC, id DESC LIMIT 5`, [L.hashKey(key)]);
  const live = rows.find(r => L.effectiveStatus(r) === 'disponible');
  if (!live) {
    return rows.length
      ? fail(401, 'EXPIRED', 'Cette clé est expirée, révoquée ou n’est pas encore activée.', 'expiree_ou_revoquee', rows[0].id)
      : fail(401, 'INVALID', 'Clé invalide.', 'inconnue');
  }
  // Insertion atomique : la contrainte UNIQUE (key_id, device_hash) garantit « une seule utilisation par appareil », même en requêtes simultanées.
  const ins = await pool.query(
    `INSERT INTO access_key_uses (key_id, device_hash, ip, user_agent)
     SELECT $1, $2, $3, $4 WHERE EXISTS (SELECT 1 FROM access_keys WHERE id = $1 AND status = 'disponible' AND (expires_at IS NULL OR expires_at > now()))
     ON CONFLICT (key_id, device_hash) DO NOTHING RETURNING id`,
    [live.id, dev.hash, ip.slice(0, 64), String(req.headers['user-agent'] || '').slice(0, 200)]);
  if (!ins.rows.length) {
    const used = await pool.query('SELECT 1 FROM access_key_uses WHERE key_id = $1 AND device_hash = $2', [live.id, dev.hash]);
    return used.rows.length
      ? fail(409, 'ALREADY_USED', 'Cette clé a déjà été utilisée sur cet appareil. Demandez une nouvelle clé à l’administrateur.', 'deja_utilisee', live.id)
      : fail(401, 'EXPIRED', 'Cette clé n’est plus valide.', 'invalidee_pendant_saisie', live.id);
  }
  lockIp.reset('ip:' + ip); lockDev.reset('dev:' + dev.hash);
  const expiresAt = issuePass(req, res, dev.hash, live.id, p.pass_minutes);
  await event('success', { dev: dev.hash, ip, keyId: live.id });
  res.json({ ok: true, expires_at: new Date(expiresAt).toISOString() });
}));

// Recours Superadmin : un code de secours à usage unique ouvre l'écran de connexion sur CET appareil (le mot de passe reste obligatoire).
const recoveryLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 15, standardHeaders: true, legacyHeaders: false, message: { error: 'Trop de tentatives, réessayez plus tard.', code: 'RATE_LIMIT' } });
pub.post('/access/recovery', recoveryLimiter, body(z.object({ code: z.string().max(40) })), wrap(async (req, res) => {
  const p = await getPolicy();
  if (!p.required) return res.json({ ok: true, required: false });
  const dev = deviceOf(req, res), ip = req.ip || '';
  const wait = Math.max(lockRecIp.check('ip:' + ip), lockRecDev.check('dev:' + dev.hash));
  if (wait > 0) {
    res.set('Retry-After', String(wait));
    return res.status(429).json({ error: `Trop d’échecs. Réessayez dans ${wait > 90 ? Math.ceil(wait / 60) + ' min' : wait + ' s'}.`, code: 'LOCKED', retry_after: wait });
  }
  const fail = async (status, msg, detail) => {
    lockRecIp.fail('ip:' + ip); lockRecDev.fail('dev:' + dev.hash);
    await event('fail', { dev: dev.hash, ip, detail });
    return res.status(status).json({ error: msg, code: 'RECOVERY_INVALID' });
  };
  if (!L.isValidRecovery(req.body.code)) return fail(400, 'Code de secours invalide (16 caractères, lettres et chiffres).', 'secours_format');
  // Consommation atomique : le hachage est retiré dans la même requête, donc le code ne sert qu'une fois, même en requêtes simultanées.
  const { rows } = await pool.query(
    `UPDATE app_settings
        SET value = jsonb_build_object('hint', value->'hint', 'created_at', value->'created_at', 'created_by_name', value->'created_by_name', 'used_at', to_jsonb(now()), 'used_ip', to_jsonb($3::text)),
            updated_at = now()
      WHERE key = $1 AND value->>'hash' = $2 RETURNING key`,
    [RECOVERY_KEY, L.hashRecovery(req.body.code), ip.slice(0, 64)]);
  if (!rows.length) return fail(401, 'Code de secours invalide ou déjà utilisé.', 'secours_invalide_ou_utilise');
  lockRecIp.reset('ip:' + ip); lockRecDev.reset('dev:' + dev.hash);
  const expiresAt = issuePass(req, res, dev.hash, 0, Math.max(p.pass_minutes, 60));
  await event('recovery', { dev: dev.hash, ip, detail: 'code de secours Superadmin utilisé' });
  res.json({ ok: true, recovery_used: true, expires_at: new Date(expiresAt).toISOString() });
}));

// ---------- Administration (Super Admin) ----------
const admin = express.Router();
const principal = (req, res, next) => (req.user && req.user.is_global ? next() : next(new HttpError(403, 'Action réservée au Super Admin.')));
const idOf = req => { const n = Number(req.params.id); if (!Number.isSafeInteger(n) || n < 1) throw new HttpError(400, 'Identifiant invalide'); return n; };

admin.get('/admin/access-keys/settings', principal, wrap(async (req, res) => {
  const p = await getPolicy(true);
  const rec = await getRecovery();
  res.json({ ...p, forced_off: process.env.ACCESS_KEY_DISABLE === '1', live_keys: await countLiveKeys(), recovery_configured: !!(rec && rec.hash) });
}));
admin.put('/admin/access-keys/settings', principal, body(z.object({ required: z.boolean(), pass_minutes: z.number().int().min(5).max(1440) }).strict()), wrap(async (req, res) => {
  const old = await getPolicy(true);
  if (req.body.required) {
    if (!(await countLiveKeys())) throw new HttpError(409, 'Activez d’abord au moins une clé (Générer puis Enregistrer et activer) : sinon plus personne ne pourrait se connecter.');
  }
  await pool.query(
    `INSERT INTO app_settings(key, value, updated_by) VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [POLICY_KEY, JSON.stringify({ required: req.body.required, pass_minutes: req.body.pass_minutes }), req.user.id]);
  policyCache = null;
  await event('policy', { userId: req.user.id, detail: `required=${req.body.required}; pass=${req.body.pass_minutes} min` });
  await audit(pool, req, 'sécurité', 'Politique de clé d’accès modifiée', 'app_settings', null, old, req.body);
  res.json({ ok: true, ...(await getPolicy(true)) });
}));

admin.get('/admin/access-keys', principal, wrap(async (req, res) => {
  const day = /^\d{4}-\d{2}-\d{2}$/;
  const from = day.test(req.query.from || '') ? req.query.from : null, to = day.test(req.query.to || '') ? req.query.to : null;
  const { rows } = await pool.query(
    `SELECT k.id, k.key_hint, k.key_enc, k.status, k.created_at, k.confirmed_at, k.expires_at, k.revoked_at, k.note,
            COALESCE(cu.full_name, cu.login) AS created_by_name, COALESCE(fu.full_name, fu.login) AS confirmed_by_name,
            (SELECT COUNT(*)::int FROM access_key_uses u WHERE u.key_id = k.id) AS devices,
            (SELECT MAX(u.used_at) FROM access_key_uses u WHERE u.key_id = k.id) AS last_used_at
       FROM access_keys k
       LEFT JOIN users cu ON cu.id = k.created_by
       LEFT JOIN users fu ON fu.id = k.confirmed_by
      WHERE ($1::date IS NULL OR k.created_at >= $1::date) AND ($2::date IS NULL OR k.created_at < $2::date + 1)
      ORDER BY k.created_at DESC LIMIT 500`, [from, to]);
  // Archive consultable : la clé est écrite sur l'interface (Superadmin uniquement) tant qu'elle est utilisable ; les clés révoquées/expirées
  // restent consultables à la demande (bouton œil, journalisé). Le texte chiffré ne quitte jamais le serveur.
  let out = rows.map(({ key_enc, ...r }) => { const effective_status = L.effectiveStatus(r); let key = null;
    if (['provisoire', 'disponible'].includes(effective_status)) { try { key = L.decryptKey(key_enc); } catch (_) { key = null; } }
    return { ...r, effective_status, key }; });
  if (req.query.status) out = out.filter(r => r.effective_status === req.query.status);
  res.json(out);
}));

admin.post('/admin/access-keys/generate', principal, wrap(async (req, res) => {
  await pool.query(`UPDATE access_keys SET status = 'revoquee', revoked_at = now(), note = 'Clé provisoire non confirmée (7 jours)' WHERE status = 'provisoire' AND created_at < now() - interval '7 days'`);
  for (let i = 0; i < 40; i++) {
    const key = L.generateKey();
    try {
      const { rows: [k] } = await pool.query(
        `INSERT INTO access_keys (key_hash, key_enc, key_hint, created_by) VALUES ($1, $2, $3, $4) RETURNING id, status, created_at`,
        [L.hashKey(key), L.encryptKey(key), L.hintOf(key), req.user.id]);
      await event('generate', { keyId: k.id, userId: req.user.id });
      await audit(pool, req, 'sécurité', 'Clé d’accès générée (provisoire)', 'access_keys', k.id, null, { status: 'provisoire' });
      return res.json({ id: k.id, key, status: k.status, created_at: k.created_at });
    } catch (e) { if (e.code === '23505') continue; throw e; }
  }
  throw new HttpError(409, 'Aucune clé libre trouvée : trop de clés actives. Révoquez les clés inutilisées.');
}));

admin.post('/admin/access-keys/:id/confirm', principal, body(z.object({ expires_in_hours: z.number().int().min(1).max(17520).nullable().optional() })), wrap(async (req, res) => {
  const id = idOf(req), h = req.body.expires_in_hours;
  const { rows } = await pool.query(
    `UPDATE access_keys SET status = 'disponible', confirmed_by = $2, confirmed_at = now(), expires_at = CASE WHEN $3::int IS NULL THEN NULL ELSE now() + ($3::int * interval '1 hour') END
      WHERE id = $1 AND status = 'provisoire' RETURNING id, expires_at`, [id, req.user.id, h || null]);
  if (!rows.length) throw new HttpError(409, 'Cette clé n’est plus provisoire (déjà activée, révoquée ou introuvable).');
  await event('confirm', { keyId: id, userId: req.user.id });
  await audit(pool, req, 'sécurité', 'Clé d’accès activée', 'access_keys', id, { status: 'provisoire' }, { status: 'disponible', expires_at: rows[0].expires_at });
  res.json({ ok: true, expires_at: rows[0].expires_at });
}));

admin.post('/admin/access-keys/:id/revoke', principal, wrap(async (req, res) => {
  const id = idOf(req);
  const { rows } = await pool.query(
    `UPDATE access_keys SET status = 'revoquee', revoked_by = $2, revoked_at = now() WHERE id = $1 AND status IN ('provisoire', 'disponible') RETURNING id`, [id, req.user.id]);
  if (!rows.length) throw new HttpError(409, 'Cette clé est déjà révoquée ou introuvable.');
  await event('revoke', { keyId: id, userId: req.user.id });
  await audit(pool, req, 'sécurité', 'Clé d’accès révoquée', 'access_keys', id, null, { status: 'revoquee' });
  res.json({ ok: true });   // l'historique des utilisations est conservé
}));

admin.post('/admin/access-keys/:id/reveal', principal, wrap(async (req, res) => {
  const id = idOf(req);
  const { rows: [k] } = await pool.query('SELECT key_enc, status FROM access_keys WHERE id = $1', [id]);
  if (!k) throw new HttpError(404, 'Clé introuvable');
  await event('reveal', { keyId: id, userId: req.user.id });
  await audit(pool, req, 'sécurité', 'Clé d’accès consultée', 'access_keys', id, null, null);
  res.json({ key: L.decryptKey(k.key_enc) });
}));

admin.get('/admin/access-keys/recovery', principal, wrap(async (req, res) => {
  const v = await getRecovery();
  res.json({ configured: !!(v && v.hash), hint: v && v.hint || null, created_at: v && v.created_at || null, created_by_name: v && v.created_by_name || null, used_at: v && v.used_at || null });
}));
const recoveryAdminLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Trop de tentatives, réessayez plus tard.', code: 'RATE_LIMIT' } });
// Génération : exige le mot de passe du Super Admin (une session volée ne suffit pas). Remplace tout code précédent ; le code n'est affiché qu'UNE fois.
admin.post('/admin/access-keys/recovery/generate', principal, recoveryAdminLimiter, body(z.object({ password: z.string().min(1).max(200) }).strict()), wrap(async (req, res) => {
  const { rows: [u] } = await pool.query('SELECT password_hash, COALESCE(full_name, login) AS name FROM users WHERE id = $1', [req.user.id]);
  if (!u || !(await bcrypt.compare(req.body.password, u.password_hash))) throw new HttpError(400, 'Mot de passe incorrect.');
  const code = L.generateRecoveryCode();
  await pool.query(
    `INSERT INTO app_settings(key, value, updated_by) VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [RECOVERY_KEY, JSON.stringify({ hash: L.hashRecovery(code), hint: L.hintRecovery(code), created_at: new Date().toISOString(), created_by_name: u.name }), req.user.id]);
  await event('recovery_generate', { userId: req.user.id, detail: 'nouveau code de secours' });
  await audit(pool, req, 'sécurité', 'Code de secours Superadmin généré', 'app_settings', null, null, null);
  res.json({ code });
}));
admin.post('/admin/access-keys/recovery/revoke', principal, wrap(async (req, res) => {
  await pool.query('DELETE FROM app_settings WHERE key = $1', [RECOVERY_KEY]);
  await event('recovery_revoke', { userId: req.user.id });
  await audit(pool, req, 'sécurité', 'Code de secours Superadmin supprimé', 'app_settings', null, null, null);
  res.json({ ok: true });
}));

admin.get('/admin/access-keys/events', principal, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT e.id, e.at, e.kind, e.key_id, e.ip, e.detail, COALESCE(u.full_name, u.login) AS user_name
       FROM access_key_events e LEFT JOIN users u ON u.id = e.user_id ORDER BY e.at DESC LIMIT 200`);
  res.json(rows);
}));


// Base non à jour (migration 053 non appliquée) : message explicite au lieu de « Erreur interne ».
const schemaGuard = (err, req, res, next) => (err && (err.code === '42P01' || err.code === '42703')
  ? next(new HttpError(503, 'Mise à jour de la base requise : arrêtez le serveur, exécutez « npm run migrate », puis redémarrez-le.', { code: 'MIGRATION_REQUIRED' }))
  : next(err));
pub.use(schemaGuard); admin.use(schemaGuard);

module.exports = { pub, admin, requireGate, getPolicy, passValid, gateOpen };
