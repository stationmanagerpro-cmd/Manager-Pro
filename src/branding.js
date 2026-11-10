// Identité de l'application (nom, slogan, logo, favicon, panneau connexion, publicité)
// Lecture publique (écran de connexion) ; écriture réservée à l'administrateur principal.
const express = require('express');
const { z } = require('zod');
const { pool, wrap, body, need, audit, HttpError } = require('./core');
const files = require('./files');

const DEFAULTS = {
  name: 'Station Manager PRO',
  tagline: 'Gestion intelligente de votre station-service',
  login_bg_color: '#0a6b5c',
  ad_title: 'PANNEAU PUBLICITAIRE',
  ad_text: '',
  ad_enabled: true
};
const KEYS = {
  name: 'app_name',
  tagline: 'app_tagline',
  logo: 'app_logo_path',
  favicon: 'app_favicon_path',
  login_bg_color: 'app_login_bg_color',
  login_bg_image: 'app_login_bg_image_path',
  banner: 'app_banner_path',
  ad_panel: 'app_ad_panel'
};
let cache = null, cacheAt = 0;

const colorOk = v => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v.trim());

async function load(force = false) {
  if (!force && cache && Date.now() - cacheAt < 30000) return cache;
  let rows = [];
  try { rows = (await pool.query("SELECT key, value FROM app_settings WHERE key = ANY($1)", [Object.values(KEYS)])).rows; }
  catch (e) { if (e.code !== '42P01') throw e; }
  const m = Object.fromEntries(rows.map(x => [x.key, x.value]));
  const str = (v, d) => (typeof v === 'string' && v.trim() ? v.trim() : d);
  let ad = m[KEYS.ad_panel];
  if (typeof ad === 'string') { try { ad = JSON.parse(ad); } catch (_) { ad = null; } }
  if (!ad || typeof ad !== 'object') ad = {};
  cache = {
    name: str(m[KEYS.name], DEFAULTS.name),
    tagline: typeof m[KEYS.tagline] === 'string' ? m[KEYS.tagline].trim() : DEFAULTS.tagline,
    logo_path: str(m[KEYS.logo], null),
    favicon_path: str(m[KEYS.favicon], null),
    login_bg_color: colorOk(m[KEYS.login_bg_color]) ? m[KEYS.login_bg_color].trim() : DEFAULTS.login_bg_color,
    login_bg_image_path: str(m[KEYS.login_bg_image], null),
    banner_path: str(m[KEYS.banner], null),
    ad_title: typeof ad.title === 'string' ? ad.title : DEFAULTS.ad_title,
    ad_text: typeof ad.text === 'string' ? ad.text : DEFAULTS.ad_text,
    ad_enabled: ad.enabled !== false
  };
  cacheAt = Date.now();
  return cache;
}
const invalidate = () => { cache = null; };
const nameSync = () => (cache && cache.name) || DEFAULTS.name;

async function save(key, value, userId) {
  await pool.query(
    `INSERT INTO app_settings(key, value, updated_by) VALUES ($1,$2::jsonb,$3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [key, JSON.stringify(value), userId || null]);
  invalidate();
}

// ---------- Public ----------
const pub = express.Router();
pub.get('/', wrap(async (req, res) => {
  const b = await load();
  res.set('Cache-Control', 'no-cache').json({
    name: b.name,
    tagline: b.tagline,
    has_logo: !!b.logo_path,
    has_favicon: !!b.favicon_path,
    login_bg_color: b.login_bg_color,
    has_login_bg_image: !!b.login_bg_image_path,
    has_banner: !!b.banner_path,
    ad_title: b.ad_title,
    ad_text: b.ad_text,
    ad_enabled: b.ad_enabled,
    v: Math.floor(cacheAt / 1000)
  });
}));
const sendImage = key => wrap(async (req, res) => {
  const b = await load(), rel = b[key], buf = await files.read(rel);
  if (!buf) throw new HttpError(404, 'Aucune image');
  res.set('Content-Type', await files.typeOf(rel)).set('Cache-Control', 'public, max-age=300').send(buf);
});
pub.get('/manifest.json', wrap(async (req, res) => {
  const b = await load(), m = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'manifest.json'), 'utf8'));
  m.name = b.name; m.short_name = b.name.length > 12 ? b.name.slice(0, 12) : b.name; m.description = b.tagline || b.name;
  res.set('Content-Type', 'application/manifest+json').set('Cache-Control', 'no-cache').send(JSON.stringify(m));
}));
pub.get('/logo', sendImage('logo_path'));
pub.get('/favicon', sendImage('favicon_path'));
pub.get('/login-bg', sendImage('login_bg_image_path'));
pub.get('/banner', sendImage('banner_path'));

// ---------- Administration ----------
const admin = express.Router();
const canEdit = [need('appearance.manage'), (req, res, next) =>
  req.user.is_global ? next() : next(new HttpError(403, "Seul l'administrateur principal peut modifier l'identité de l'application."))];

admin.get('/admin/branding', need('appearance.manage', 'settings.edit', 'user.manage'), wrap(async (req, res) => {
  const b = await load(true);
  res.json({
    name: b.name,
    tagline: b.tagline,
    has_logo: !!b.logo_path,
    has_favicon: !!b.favicon_path,
    login_bg_color: b.login_bg_color,
    has_login_bg_image: !!b.login_bg_image_path,
    has_banner: !!b.banner_path,
    ad_title: b.ad_title,
    ad_text: b.ad_text,
    ad_enabled: b.ad_enabled,
    defaults: DEFAULTS,
    editable: !!req.user.is_global && req.user.perms.has('appearance.manage')
  });
}));

admin.put('/admin/branding', ...canEdit, body(z.object({
  name: z.string().trim().min(1, 'Le nom est obligatoire').max(60),
  tagline: z.string().trim().max(120).default(''),
  login_bg_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  ad_title: z.string().trim().max(80).optional(),
  ad_text: z.string().trim().max(500).optional(),
  ad_enabled: z.boolean().optional()
})), wrap(async (req, res) => {
  const old = await load(true);
  await save(KEYS.name, req.body.name, req.user.id);
  await save(KEYS.tagline, req.body.tagline, req.user.id);
  if (req.body.login_bg_color) await save(KEYS.login_bg_color, req.body.login_bg_color, req.user.id);
  if (req.body.ad_title !== undefined || req.body.ad_text !== undefined || req.body.ad_enabled !== undefined) {
    await save(KEYS.ad_panel, {
      title: req.body.ad_title !== undefined ? req.body.ad_title : old.ad_title,
      text: req.body.ad_text !== undefined ? req.body.ad_text : old.ad_text,
      enabled: req.body.ad_enabled !== undefined ? req.body.ad_enabled : old.ad_enabled
    }, req.user.id);
  }
  await audit(pool, req, 'paramètres', "Modification de l'identité / panneau publicitaire", 'app_settings', null,
    { name: old.name, tagline: old.tagline, login_bg_color: old.login_bg_color },
    { name: req.body.name, tagline: req.body.tagline, login_bg_color: req.body.login_bg_color });
  res.json({ ok: true });
}));

admin.post('/admin/branding/reset', ...canEdit, wrap(async (req, res) => {
  const old = await load(true);
  await save(KEYS.name, DEFAULTS.name, req.user.id);
  await save(KEYS.tagline, DEFAULTS.tagline, req.user.id);
  await save(KEYS.login_bg_color, DEFAULTS.login_bg_color, req.user.id);
  await save(KEYS.ad_panel, { title: DEFAULTS.ad_title, text: DEFAULTS.ad_text, enabled: DEFAULTS.ad_enabled }, req.user.id);
  await audit(pool, req, 'paramètres', "Réinitialisation de l'identité de l'application", 'app_settings', null, { name: old.name, tagline: old.tagline }, DEFAULTS);
  res.json({ ok: true });
}));

const imageKinds = {
  logo: { key: KEYS.logo, pathKey: 'logo_path', max: 2 * 1024 * 1024 },
  favicon: { key: KEYS.favicon, pathKey: 'favicon_path', max: 512 * 1024 },
  'login-bg': { key: KEYS.login_bg_image, pathKey: 'login_bg_image_path', max: 3 * 1024 * 1024 },
  banner: { key: KEYS.banner, pathKey: 'banner_path', max: 3 * 1024 * 1024 }   // photo du bandeau du Superadmin
};

admin.put('/admin/branding/:kind', ...canEdit, body(z.object({
  data_url: z.string().min(20)
})), wrap(async (req, res) => {
  const kind = req.params.kind;
  const def = imageKinds[kind];
  if (!def) throw new HttpError(400, 'Type d\'image inconnu');
  const b = await load(true);
  const old = b[def.pathKey];
  // files.save décode data URL, contrôle format/taille, écrit sur disque
  const rel = await files.save('branding', req.body.data_url);
  await save(def.key, rel, req.user.id);
  if (old && old !== rel) try { await files.remove(old); } catch (_) {}
  await audit(pool, req, 'paramètres', 'Image branding ' + kind, 'app_settings', null, { path: old }, { path: rel });
  res.json({ ok: true, path: rel });
}));

admin.delete('/admin/branding/:kind', ...canEdit, wrap(async (req, res) => {
  const kind = req.params.kind;
  const def = imageKinds[kind];
  if (!def) throw new HttpError(400, 'Type d\'image inconnu');
  const b = await load(true);
  const old = b[def.pathKey];
  if (old) try { await files.remove(old); } catch (_) {}
  await save(def.key, null, req.user.id);
  await audit(pool, req, 'paramètres', 'Suppression image branding ' + kind, 'app_settings', null, { path: old }, null);
  res.json({ ok: true });
}));


// Publicité personnalisée par client. La clé et chaque image sont strictement isolées par client.
const clientAdKey = id => `client_ad_panel_${Number(id)}`;
async function readClientAd(id) {
  const { rows } = await pool.query('SELECT value FROM app_settings WHERE key=$1', [clientAdKey(id)]);
  let value = rows[0] && rows[0].value;
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch (_) { value = null; } }
  if (!value || typeof value !== 'object') value = {};
  const interval = Number(value.interval_sec);
  return {
    title: typeof value.title === 'string' ? value.title : '',
    text: typeof value.text === 'string' ? value.text : '',
    enabled: value.enabled === true,
    published: value.published === true,
    interval_sec: Number.isFinite(interval) && interval >= 10 && interval <= 3600 ? Math.round(interval) : 60,
    images: Array.isArray(value.images) ? value.images.slice(0, 5) : []
  };
}
async function saveClientAd(id, value, userId) {
  await pool.query(`INSERT INTO app_settings(key,value,updated_by) VALUES($1,$2::jsonb,$3)
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now(),updated_by=EXCLUDED.updated_by`,
    [clientAdKey(id), JSON.stringify(value), userId || null]);
}
const clientAdAdmin = (req, res, next) => {
  if (!req.user || !req.user.is_global) return next(new HttpError(403, 'Action réservée au Super Admin.'));
  next();
};
async function ensureClientExists(id) {
  const { rows } = await pool.query('SELECT id FROM clients WHERE id=$1', [id]);
  if (!rows.length) throw new HttpError(404, 'Client introuvable');
}
async function sendStoredImage(rel, res) {
  const buf = await files.read(rel);
  if (!buf) throw new HttpError(404, 'Image introuvable');
  res.set('Content-Type', await files.typeOf(rel)).set('Cache-Control', 'private, max-age=60').set('X-Content-Type-Options', 'nosniff').send(buf);
}
admin.get('/admin/clients/:id/advertising', clientAdAdmin, wrap(async (req, res) => {
  const id = Number(req.params.id); if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, 'Identifiant client invalide');
  await ensureClientExists(id);
  const cfg = await readClientAd(id);
  res.set('Cache-Control', 'no-store').json({ ...cfg, client_id: id, images: cfg.images.map((x, i) => ({ index: i, url: `/api/admin/clients/${id}/advertising/images/${i}` })) });
}));
admin.put('/admin/clients/:id/advertising', clientAdAdmin, body(z.object({
  title: z.string().max(100).default(''), text: z.string().max(1000).default(''), enabled: z.boolean().default(false), published: z.boolean().default(false),
  interval_sec: z.number().int().min(10).max(3600).optional()
})), wrap(async (req, res) => {
  const id = Number(req.params.id); if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, 'Identifiant client invalide');
  await ensureClientExists(id);
  const old = await readClientAd(id);
  const interval = req.body.interval_sec != null ? req.body.interval_sec : (old.interval_sec || 60);
  const next = { ...old, title: req.body.title.trim(), text: req.body.text.trim(), enabled: req.body.enabled, published: req.body.published, interval_sec: interval };
  await saveClientAd(id, next, req.user.id);
  await audit(pool, req, 'publicité client', `Configuration publicitaire du client #${id}`, 'clients', id, { enabled: old.enabled, published: old.published }, { enabled: next.enabled, published: next.published });
  res.json({ ok: true });
}));
admin.post('/admin/clients/:id/advertising/images', clientAdAdmin, body(z.object({ data_url: z.string().min(20) })), wrap(async (req, res) => {
  const id = Number(req.params.id); if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, 'Identifiant client invalide');
  await ensureClientExists(id);
  const cfg = await readClientAd(id);
  if (cfg.images.length >= 5) throw new HttpError(400, 'Un panneau publicitaire ne peut contenir que cinq images maximum.');
  const rel = await files.save('client-ads', req.body.data_url);
  cfg.images.push(rel);
  try { await saveClientAd(id, cfg, req.user.id); }
  catch (e) { await files.remove(rel); throw e; }
  await audit(pool, req, 'publicité client', `Ajout d’une image publicitaire au client #${id}`, 'clients', id, null, { image_index: cfg.images.length - 1 });
  res.json({ ok: true, count: cfg.images.length });
}));
admin.delete('/admin/clients/:id/advertising/images/:index', clientAdAdmin, wrap(async (req, res) => {
  const id = Number(req.params.id), index = Number(req.params.index);
  if (!Number.isSafeInteger(id) || id < 1 || !Number.isInteger(index) || index < 0) throw new HttpError(400, 'Paramètres invalides');
  await ensureClientExists(id);
  const cfg = await readClientAd(id); if (index >= cfg.images.length) throw new HttpError(404, 'Image introuvable');
  const [old] = cfg.images.splice(index, 1); await saveClientAd(id, cfg, req.user.id); await files.remove(old);
  await audit(pool, req, 'publicité client', `Suppression d’une image publicitaire du client #${id}`, 'clients', id, { image_index: index }, null);
  res.json({ ok: true, count: cfg.images.length });
}));
admin.put('/admin/clients/:id/advertising/images/order', clientAdAdmin, body(z.object({ order: z.array(z.number().int().min(0).max(4)).min(1).max(5) })), wrap(async (req, res) => {
  const id = Number(req.params.id); if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, 'Identifiant client invalide');
  await ensureClientExists(id); const cfg = await readClientAd(id), order = req.body.order;
  if (order.length !== cfg.images.length || new Set(order).size !== cfg.images.length || order.some(i => i >= cfg.images.length)) throw new HttpError(400, 'Ordre d’images invalide');
  cfg.images = order.map(i => cfg.images[i]); await saveClientAd(id, cfg, req.user.id); res.json({ ok: true });
}));
admin.get('/admin/clients/:id/advertising/images/:index', clientAdAdmin, wrap(async (req, res) => {
  const id = Number(req.params.id), index = Number(req.params.index);
  if (!Number.isSafeInteger(id) || id < 1 || !Number.isInteger(index) || index < 0) throw new HttpError(400, 'Paramètres invalides');
  const cfg = await readClientAd(id); if (!cfg.images[index]) throw new HttpError(404, 'Image introuvable'); await sendStoredImage(cfg.images[index], res);
}));

async function currentClientId(req) {
  if (req.user && req.user.is_global) return null;
  if (req.sid) {
    const { rows } = await pool.query('SELECT client_id FROM stations WHERE id=$1', [req.sid]);
    if (rows[0] && rows[0].client_id) return Number(rows[0].client_id);
  }
  if (req.user && req.user.client_id) return Number(req.user.client_id);
  return null;
}
admin.get('/me/advertising', wrap(async (req, res) => {
  const id = await currentClientId(req);
  if (!id) return res.json({ enabled: false, published: false, title: '', text: '', images: [] });
  const cfg = await readClientAd(id);
  const visible = cfg.enabled && cfg.published;
  res.set('Cache-Control', 'no-store').json({
    client_id: id,
    enabled: visible,
    title: visible ? cfg.title : '',
    text: visible ? cfg.text : '',
    interval_sec: cfg.interval_sec || 60,
    images: visible ? cfg.images.map((_, i) => `/api/me/advertising/images/${i}`) : []
  });
}));
admin.get('/me/advertising/images/:index', wrap(async (req, res) => {
  const id = await currentClientId(req); if (!id) throw new HttpError(404, 'Image introuvable');
  const index = Number(req.params.index); if (!Number.isInteger(index) || index < 0 || index > 4) throw new HttpError(404, 'Image introuvable');
  const cfg = await readClientAd(id); if (!cfg.enabled || !cfg.published || !cfg.images[index]) throw new HttpError(404, 'Image introuvable');
  await sendStoredImage(cfg.images[index], res);
}));

module.exports = { pub, admin, load, nameSync, invalidate, DEFAULTS };
