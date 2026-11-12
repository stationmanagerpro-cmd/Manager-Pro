'use strict';
// « A propos de Manager PRO » : test HTTP réel de la route (express + zod réels), SANS base PostgreSQL.
// Le module ./core (qui exige PostgreSQL) est remplacé par une doublure fidèle de wrap / body / HttpError / audit,
// et la table app_settings par une mémoire. Vérifie : droits (client = lecture seule, Super Admin = édition), validation,
// enregistrement, retour au modèle, contenu corrompu, base non migrée, audit.
const path = require('path'), assert = require('assert'), http = require('http');
const { z } = require('zod'), express = require('express');

const mem = new Map(); const audits = []; const sqls = []; let missingTable = false;
class HttpError extends Error { constructor(status, message, details) { super(message); this.status = status; this.details = details; } }
const core = {
  HttpError,
  wrap: fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next),
  body: schema => (req, res, next) => { const r = schema.safeParse(req.body); if (!r.success) return next(new HttpError(400, 'Données invalides', r.error.issues.map(i => i.path.join('.') + ' : ' + i.message))); req.body = r.data; next(); },
  audit: async (c, req, module, action, table) => { audits.push({ module, action, table, user: req.user && req.user.id }); },
  pool: {
    async query(sql, params) {
      sqls.push(sql.replace(/\s+/g, ' ').trim());
      if (missingTable) { const e = new Error('relation "app_settings" does not exist'); e.code = '42P01'; throw e; }
      if (/^SELECT value, updated_at FROM app_settings WHERE key = \$1/.test(sql.trim())) { assert.strictEqual(params[0], 'about_page'); const v = mem.get(params[0]); return { rows: v ? [{ value: v, updated_at: new Date('2026-11-12T12:00:00Z') }] : [] }; }
      if (/^INSERT INTO app_settings/.test(sql.trim())) { assert.strictEqual(params[0], 'about_page'); mem.set(params[0], JSON.parse(params[1])); return { rows: [] }; }
      if (/^DELETE FROM app_settings WHERE key = \$1/.test(sql.trim())) { assert.strictEqual(params[0], 'about_page'); mem.delete(params[0]); return { rows: [] }; }
      throw new Error('requête inattendue : ' + sql);
    }
  }
};
const corePath = path.join(__dirname, '..', 'src', 'core.js');
require.cache[corePath] = { id: corePath, filename: corePath, loaded: true, exports: core };
const About = require('../src/about_logic.js');
const { r: aboutRouter } = require('../src/about_page.js');

const app = express(); app.use(express.json());
app.use((req, res, next) => { const u = req.get('x-user'); req.user = u === 'sa' ? { id: 9, is_global: true } : u === 'client' ? { id: 1, is_global: false } : null; if (!req.user) return res.status(401).json({ error: 'non connecté' }); next(); });
app.use('/api', aboutRouter);
app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message, code: err.code, details: err.details }));

let n = 0; const check = async (l, f) => { await f(); n++; console.log('✔ ' + l); };
(async () => {
  const srv = http.createServer(app); await new Promise(r => srv.listen(0, r)); const base = 'http://127.0.0.1:' + srv.address().port;
  const call = async (method, url, user, data) => { const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(user ? { 'x-user': user } : {}) }, body: data === undefined ? undefined : JSON.stringify(data) }); let j = null; try { j = await res.json(); } catch (_) {} return { s: res.status, j }; };

  await check('non connecté : refusé (401)', async () => { assert.strictEqual((await call('GET', '/api/me/about')).s, 401); });
  await check('compte client : lecture du modèle d’origine, non modifiable', async () => {
    const r = await call('GET', '/api/me/about', 'client'); assert.strictEqual(r.s, 200);
    assert.deepStrictEqual(r.j.content, About.defaultDoc()); assert.strictEqual(r.j.customized, false); assert.strictEqual(r.j.editable, false);
  });
  await check('Super Admin : lecture avec droit d’édition', async () => { const r = await call('GET', '/api/me/about', 'sa'); assert.strictEqual(r.j.editable, true); });
  await check('compte client : écriture et remise à zéro refusées (403), rien enregistré', async () => {
    const doc = About.defaultDoc(); doc.header.title = 'Piraté';
    assert.strictEqual((await call('PUT', '/api/admin/about', 'client', { content: doc })).s, 403);
    assert.strictEqual((await call('POST', '/api/admin/about/reset', 'client', {})).s, 403);
    assert.strictEqual(mem.size, 0); assert.strictEqual(audits.length, 0);
  });
  await check('Super Admin : lien http:// refusé (400), corps invalide refusé, rien enregistré', async () => {
    const doc = About.defaultDoc(); doc.downloads.android_url = 'http://exemple.ml/app.apk';
    const r = await call('PUT', '/api/admin/about', 'sa', { content: doc }); assert.strictEqual(r.s, 400); assert.match(r.j.error, /https/);
    assert.strictEqual((await call('PUT', '/api/admin/about', 'sa', {})).s, 400);
    assert.strictEqual(mem.size, 0);
  });
  await check('Super Admin : enregistrement valide, relu par un client, audit tracé', async () => {
    const doc = About.defaultDoc(); doc.header.title = '<img src=x onerror=alert(1)>Titre'; doc.downloads.android_url = 'https://exemple.ml/telecharger'; doc.solutions[1].status = 'bientot';
    const r = await call('PUT', '/api/admin/about', 'sa', { content: doc }); assert.strictEqual(r.s, 200, JSON.stringify(r.j));
    const g = await call('GET', '/api/me/about', 'client'); assert.strictEqual(g.j.customized, true); assert.strictEqual(g.j.content.downloads.android_url, 'https://exemple.ml/telecharger');
    assert.strictEqual(g.j.content.header.title, '<img src=x onerror=alert(1)>Titre', 'conservé comme texte (l’interface l’échappe à l’affichage)');
    assert.strictEqual(g.j.content.solutions[1].status, 'bientot'); assert.strictEqual(g.j.editable, false);
    assert.strictEqual(audits.length, 1); assert.strictEqual(audits[0].user, 9); assert.strictEqual(audits[0].table, 'app_settings');
  });
  await check('contenu enregistré corrompu : la page revient au modèle (aucune erreur)', async () => {
    mem.set('about_page', { content: { header: {} } }); const g = await call('GET', '/api/me/about', 'client');
    assert.strictEqual(g.s, 200); assert.deepStrictEqual(g.j.content, About.defaultDoc()); assert.strictEqual(g.j.customized, false);
  });
  await check('Super Admin : retour au modèle d’origine (supprime la personnalisation, audit tracé)', async () => {
    const before = audits.length; const r = await call('POST', '/api/admin/about/reset', 'sa', {}); assert.strictEqual(r.s, 200);
    assert.strictEqual(mem.size, 0); assert.deepStrictEqual(r.j.content, About.defaultDoc()); assert.strictEqual(audits.length, before + 1);
  });
  await check('base non migrée : lecture = modèle d’origine ; écriture = message clair (503), pas « erreur interne »', async () => {
    missingTable = true;
    const g = await call('GET', '/api/me/about', 'client'); assert.strictEqual(g.s, 200); assert.strictEqual(g.j.customized, false);
    const w = await call('PUT', '/api/admin/about', 'sa', { content: About.defaultDoc() }); assert.strictEqual(w.s, 503); assert.strictEqual(w.j.details.code, 'MIGRATION_REQUIRED'); assert.match(w.j.error, /migrate/);
    missingTable = false;
  });
  await check('toutes les requêtes SQL sont paramétrées (aucune valeur concaténée)', async () => {
    assert(sqls.length > 5 && sqls.every(s => !/about_page/.test(s)), 'la clé « about_page » passe par un paramètre $n');
  });
  srv.close(); console.log(`\n${n}/${n} contrôles réussis.`);
})().catch(e => { console.error(e); process.exit(1); });
