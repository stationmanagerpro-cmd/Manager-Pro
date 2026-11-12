// Page « A propos de Manager PRO » : présentation (vision, mission, objectifs…) personnalisable par le Super Admin.
//  - lecture  : GET  /api/me/about          (tout compte connecté : Super Admin et comptes clients ; /me reste ouvert même licence expirée)
//  - édition  : PUT  /api/admin/about        (Super Admin uniquement)
//               POST /api/admin/about/reset  (Super Admin uniquement : retour au modèle d'origine)
// Stockage : table app_settings (clé « about_page »), aucune migration nécessaire.
const express = require('express');
const { z } = require('zod');
const { pool, wrap, body, audit, HttpError } = require('./core');
const About = require('./about_logic');

const KEY = 'about_page';

async function readStored() {
  let row = null;
  try { row = (await pool.query('SELECT value, updated_at FROM app_settings WHERE key = $1', [KEY])).rows[0] || null; } catch (e) { if (e.code !== '42P01') throw e; }
  if (!row) return null;
  let v = row.value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { v = null; } }
  const content = About.readable(v);
  return content ? { content, updated_at: row.updated_at } : null;
}
const writeStored = (content, userId) => pool.query(
  `INSERT INTO app_settings(key, value, updated_by) VALUES ($1, $2::jsonb, $3)
   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
  [KEY, JSON.stringify({ content }), userId || null]);

const appVersion = (() => { try { return require('../package.json').version; } catch (_) { return null; } })();
const principal = (req, res, next) => (req.user && req.user.is_global ? next() : next(new HttpError(403, 'Action réservée au Super Admin.')));
const clean = doc => { try { return About.sanitize(doc); } catch (e) { throw new HttpError(e.status || 400, e.message || 'Contenu invalide'); } };

const r = express.Router();

r.get('/me/about', wrap(async (req, res) => {
  const s = await readStored();
  res.set('Cache-Control', 'no-store').json({
    content: s ? s.content : About.defaultDoc(),
    customized: !!s,
    updated_at: s ? s.updated_at : null,
    editable: !!(req.user && req.user.is_global),
    app_version: appVersion
  });
}));

r.put('/admin/about', principal, body(z.object({ content: z.any() })), wrap(async (req, res) => {
  const content = clean(req.body.content);
  await writeStored(content, req.user.id);
  await audit(pool, req, 'paramètres', 'Page « A propos de Manager PRO » modifiée', 'app_settings', null, null, null);
  res.json({ ok: true, content });
}));

r.post('/admin/about/reset', principal, wrap(async (req, res) => {
  await pool.query('DELETE FROM app_settings WHERE key = $1', [KEY]);
  await audit(pool, req, 'paramètres', 'Page « A propos de Manager PRO » : retour au modèle d’origine', 'app_settings', null, null, null);
  res.json({ ok: true, content: About.defaultDoc() });
}));

// Base non à jour : message explicite au lieu de « Erreur interne ».
r.use((err, req, res, next) => (err && (err.code === '42P01' || err.code === '42703')
  ? next(new HttpError(503, 'Mise à jour de la base requise : arrêtez le serveur, exécutez « npm run migrate », puis redémarrez-le.', { code: 'MIGRATION_REQUIRED' }))
  : next(err)));

module.exports = { r };
