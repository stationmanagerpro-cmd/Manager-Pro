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
// Historique : les 10 dernières versions enregistrées sont conservées (clé « about_page_history »), pour ne jamais perdre une présentation.
const HKEY = 'about_page_history', HMAX = 10;
async function readHistory() {
  try {
    const row = (await pool.query('SELECT value FROM app_settings WHERE key = $1', [HKEY])).rows[0];
    let v = row && row.value; if (typeof v === 'string') v = JSON.parse(v);
    return Array.isArray(v && v.items) ? v.items : [];
  } catch (_) { return []; }
}
async function archiveCurrent(userId) {
  const cur = await readStored(); if (!cur) return;
  const items = [{ saved_at: cur.updated_at || new Date().toISOString(), archived_by: userId || null, content: cur.content }, ...(await readHistory())].slice(0, HMAX);
  await pool.query(`INSERT INTO app_settings(key, value, updated_by) VALUES ($1, $2::jsonb, $3)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`, [HKEY, JSON.stringify({ items }), userId || null]);
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
  await archiveCurrent(req.user.id);
  await writeStored(content, req.user.id);
  await audit(pool, req, 'paramètres', 'Page « A propos de Manager PRO » modifiée', 'app_settings', null, null, null);
  res.json({ ok: true, content });
}));

r.post('/admin/about/reset', principal, wrap(async (req, res) => {
  await archiveCurrent(req.user.id);
  await pool.query('DELETE FROM app_settings WHERE key = $1', [KEY]);
  await audit(pool, req, 'paramètres', 'Page « A propos de Manager PRO » : retour au modèle d’origine', 'app_settings', null, null, null);
  res.json({ ok: true, content: About.defaultDoc() });
}));

r.get('/admin/about/history', principal, wrap(async (req, res) => {
  const items = await readHistory();
  const cur = await readStored();
  res.json({
    current: cur ? { saved_at: cur.updated_at, sections: cur.content.sections.length, solutions: cur.content.solutions.length } : { saved_at: null, sections: About.defaultDoc().sections.length, solutions: About.defaultDoc().solutions.length, model: true },
    versions: items.map((it, i) => { let c = null; try { c = About.sanitize(it.content); } catch (_) { /* version illisible */ } return { index: i, saved_at: it.saved_at, sections: c ? c.sections.length : null, solutions: c ? c.solutions.length : null, readable: !!c }; })
  });
}));

r.post('/admin/about/restore', principal, body(z.object({ index: z.coerce.number().int().min(0).max(HMAX - 1) })), wrap(async (req, res) => {
  const items = await readHistory(); const it = items[req.body.index];
  if (!it) throw new HttpError(404, 'Version introuvable.');
  const content = clean(it.content);
  await archiveCurrent(req.user.id);
  await writeStored(content, req.user.id);
  await audit(pool, req, 'paramètres', 'Page « A propos de Manager PRO » : version précédente restaurée', 'app_settings', null, null, null);
  res.json({ ok: true, content });
}));

/** Complète la page actuelle avec les rubriques et solutions du modèle qui y manquent (aucune suppression, aucune modification de l'existant). */
r.post('/admin/about/complete', principal, wrap(async (req, res) => {
  const cur = await readStored(); const D = About.defaultDoc();
  const base = cur ? cur.content : D;
  const norm = x => String(x || '').trim().toLowerCase();
  const haveSol = new Set(base.solutions.map(x => norm(x.name))), haveSec = new Set(base.sections.map(x => norm(x.title)));
  const addSol = D.solutions.filter(x => !haveSol.has(norm(x.name))), addSec = D.sections.filter(x => !haveSec.has(norm(x.title)));
  const merged = { ...base, solutions: [...base.solutions, ...addSol], sections: [...base.sections, ...addSec] };
  if (!merged.upcoming || (!merged.upcoming.title && !merged.upcoming.text)) merged.upcoming = D.upcoming;
  if (!merged.approach || !(merged.approach.commitments || []).length) merged.approach = D.approach;
  if (!merged.why || !(merged.why.items || merged.why.points || []).length) merged.why = D.why;
  const content = clean(merged);
  await archiveCurrent(req.user.id);
  await writeStored(content, req.user.id);
  await audit(pool, req, 'paramètres', `Page « A propos » complétée avec le modèle (+${addSol.length} solution(s), +${addSec.length} rubrique(s))`, 'app_settings', null, null, null);
  res.json({ ok: true, added_solutions: addSol.length, added_sections: addSec.length, content });
}));

// Base non à jour : message explicite au lieu de « Erreur interne ».
r.use((err, req, res, next) => (err && (err.code === '42P01' || err.code === '42703')
  ? next(new HttpError(503, 'Mise à jour de la base requise : arrêtez le serveur, exécutez « npm run migrate », puis redémarrez-le.', { code: 'MIGRATION_REQUIRED' }))
  : next(err)));

module.exports = { r };
