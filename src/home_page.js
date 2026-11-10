// Page d'accueil publique « éditeur visuel » (Super Admin) : brouillon -> aperçu -> publication.
//  - pub   : GET /api/public/home, GET /api/public/home/image/:id (contenu PUBLIÉ uniquement)
//  - admin : /api/admin/home* (Super Admin uniquement)
// Le contenu est un arbre d'éléments validé par home-core.js (couleurs, nombres et listes fermées) : aucun HTML libre,
// donc aucune injection de script. Les images (PNG/JPEG/WebP, 2 Mo chacune) sont en nombre illimité jusqu'à LIMITS.images.
const express = require('express');
const crypto = require('crypto');
const { z } = require('zod');
const { pool, wrap, body, audit, HttpError } = require('./core');
const files = require('./files');
const keys = require('./access_keys');
const Home = require('../public/home-core.js');

const PUB_KEY = 'home_page_published', DRAFT_KEY = 'home_page_draft';
const ID_RE = Home.ID_RE;

async function readSetting(key) {
  let v = null;
  try { v = (await pool.query('SELECT value FROM app_settings WHERE key = $1', [key])).rows[0]?.value; } catch (e) { if (e.code !== '42P01') throw e; }
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { v = null; } }
  return v && typeof v === 'object' ? v : null;
}
const writeSetting = (key, value, userId) => pool.query(
  `INSERT INTO app_settings(key, value, updated_by) VALUES ($1, $2::jsonb, $3)
   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`, [key, JSON.stringify(value), userId || null]);

function clean(doc) {
  try { return Home.sanitize(doc); } catch (e) { throw new HttpError(e.status || 400, e.message || 'Page d’accueil invalide'); }
}
function validOrNull(doc) { try { return Home.sanitize(doc); } catch (_) { return null; } }
// Les anciennes versions (modèle v1 à emplacements fixes) sont remplacées par le nouveau modèle ; leurs images restent dans la bibliothèque.
const imagesOf = d => (d && d.images && typeof d.images === 'object' ? Object.fromEntries(Object.entries(d.images).filter(([k, v]) => ID_RE.test(k) && typeof v === 'string')) : {});
const namesOf = d => (d && d.names && typeof d.names === 'object' ? d.names : {});

async function publishedDoc() {
  const p = await readSetting(PUB_KEY);
  const content = p && validOrNull(p.content);
  return { content: content || Home.defaultDoc(), images: imagesOf(p), names: namesOf(p), published_at: (p && p.published_at) || null };
}
async function draftDoc() {
  const d = await readSetting(DRAFT_KEY);
  const content = d && validOrNull(d.content);
  if (content) return { content, images: imagesOf(d), names: namesOf(d), saved_at: d.saved_at || null };
  const p = await publishedDoc();
  return { content: p.content, images: { ...p.images }, names: { ...p.names }, saved_at: null };
}
const saveDraft = (d, userId) => writeSetting(DRAFT_KEY, { content: d.content, images: d.images, names: d.names, saved_at: new Date().toISOString() }, userId);
const referenced = (rel, ...docs) => docs.some(d => d && d.images && Object.values(d.images).includes(rel));
async function sendRel(res, rel) {
  const buf = rel && await files.read(rel);
  if (!buf) throw new HttpError(404, 'Image introuvable');
  res.set('Content-Type', await files.typeOf(rel)).set('Cache-Control', 'public, max-age=300').set('X-Content-Type-Options', 'nosniff').send(buf);
}
const idOf = req => { const id = String(req.params.id || ''); if (!ID_RE.test(id)) throw new HttpError(400, 'Identifiant d’image invalide'); return id; };

// ---------- Public ----------
const pub = express.Router();
pub.get('/home', wrap(async (req, res) => {
  const [doc, p] = await Promise.all([publishedDoc(), keys.getPolicy()]);
  res.json({
    content: doc.content,
    images: Object.fromEntries(Object.keys(doc.images).map(k => [k, true])),
    v: doc.published_at || '0',
    access: { required: p.required, ok: await keys.gateOpen(req, res) }
  });
}));
pub.get('/home/image/:id', wrap(async (req, res) => {
  const doc = await publishedDoc();
  await sendRel(res, doc.images[idOf(req)]);
}));

// ---------- Administration ----------
const admin = express.Router();
const principal = (req, res, next) => (req.user && req.user.is_global ? next() : next(new HttpError(403, 'Action réservée au Super Admin.')));
const view = (d, p) => ({
  draft: d.content,
  images: Object.fromEntries(Object.keys(d.images).map(k => [k, { name: d.names[k] || k }])),
  builtin: Home.BUILTIN_IMAGES,
  published_at: p.published_at, saved_at: d.saved_at,
  dirty: JSON.stringify(d.content) !== JSON.stringify(p.content) || JSON.stringify(d.images) !== JSON.stringify(p.images)
});

admin.get('/admin/home', principal, wrap(async (req, res) => {
  const [d, p] = await Promise.all([draftDoc(), publishedDoc()]);
  res.json(view(d, p));
}));
admin.put('/admin/home', principal, body(z.object({ content: z.any() })), wrap(async (req, res) => {
  const content = clean(req.body.content), d = await draftDoc();
  await saveDraft({ ...d, content }, req.user.id);
  await audit(pool, req, 'paramètres', 'Brouillon de la page d’accueil enregistré', 'app_settings', null, null, null);
  res.json({ ok: true });
}));
admin.post('/admin/home/publish', principal, wrap(async (req, res) => {
  const d = await draftDoc();
  await writeSetting(PUB_KEY, { content: d.content, images: d.images, names: d.names, published_at: new Date().toISOString(), published_by: req.user.id }, req.user.id);
  await audit(pool, req, 'paramètres', 'Page d’accueil publique publiée', 'app_settings', null, null, null);
  res.json({ ok: true });
}));
admin.post('/admin/home/discard', principal, wrap(async (req, res) => {
  const p = await publishedDoc(), d = await draftDoc();
  await writeSetting(DRAFT_KEY, { content: p.content, images: { ...p.images }, names: { ...p.names }, saved_at: new Date().toISOString() }, req.user.id);
  for (const rel of Object.values(d.images)) if (rel && !referenced(rel, p)) try { await files.remove(rel); } catch (_) { /* déjà supprimé */ }
  res.json({ ok: true });
}));
admin.post('/admin/home/reset', principal, wrap(async (req, res) => {
  const d = await draftDoc();
  await saveDraft({ ...d, content: Home.defaultDoc() }, req.user.id);
  await audit(pool, req, 'paramètres', 'Page d’accueil : retour au modèle d’origine (brouillon)', 'app_settings', null, null, null);
  res.json({ ok: true });
}));
admin.get('/admin/home/image/:id', principal, wrap(async (req, res) => {
  const d = await draftDoc();
  res.set('Cache-Control', 'no-store'); await sendRel(res, d.images[idOf(req)]);
}));
admin.put('/admin/home/media', principal, body(z.object({ data_url: z.string().min(20), name: z.string().max(120).optional() })), wrap(async (req, res) => {
  const d = await draftDoc();
  if (Object.keys(d.images).length >= Home.LIMITS.images) throw new HttpError(400, 'Bibliothèque pleine (' + Home.LIMITS.images + ' images) : supprimez des images inutilisées.');
  const rel = await files.save('home', req.body.data_url);   // contrôle le contenu réel (PNG/JPEG/WebP) et la taille
  const id = 'm' + crypto.randomBytes(6).toString('hex');
  d.images[id] = rel; d.names[id] = (req.body.name || id).replace(/[<>"']/g, '').slice(0, 80);
  await saveDraft(d, req.user.id);
  await audit(pool, req, 'paramètres', 'Image ajoutée à la page d’accueil', 'app_settings', null, null, null);
  res.json({ ok: true, id });
}));
admin.delete('/admin/home/image/:id', principal, wrap(async (req, res) => {
  const id = idOf(req), d = await draftDoc(), p = await publishedDoc();
  const old = d.images[id];
  delete d.images[id]; delete d.names[id];
  await saveDraft(d, req.user.id);
  if (old && !referenced(old, p)) try { await files.remove(old); } catch (_) { /* déjà supprimé */ }
  res.json({ ok: true });
}));

// Base non à jour (migration 053 non appliquée) : message explicite au lieu de « Erreur interne ».
const schemaGuard = (err, req, res, next) => (err && (err.code === '42P01' || err.code === '42703')
  ? next(new HttpError(503, 'Mise à jour de la base requise : arrêtez le serveur, exécutez « npm run migrate », puis redémarrez-le.', { code: 'MIGRATION_REQUIRED' }))
  : next(err));
pub.use(schemaGuard); admin.use(schemaGuard);

module.exports = { pub, admin, sanitize: Home.sanitize, defaultDoc: Home.defaultDoc };
