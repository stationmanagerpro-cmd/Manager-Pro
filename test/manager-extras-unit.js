'use strict';
// Compléments gérant : résumé hebdomadaire (lundi, une fois, texte), justificatifs photo (auteur, type, taille). Base simulée.
const assert = require('assert'), Module = require('module'), fs = require('fs');
let n = 0; const check = async (l, f) => { await f(); n++; console.log('✓ ' + l); };
const queries = []; let handler = () => ({ rows: [], rowCount: 0 });
const pool = { query: async (sql, p) => { queries.push({ sql, p }); return handler(sql, p); } };
const routes = {}; const fakeRouter = () => { const r = {}; for (const m of ['get', 'post', 'put', 'delete']) r[m] = (path, ...h) => { routes[m + ' ' + path] = h; return r; }; r.use = () => r; return r; };
const chain = () => new Proxy(function () {}, { get: (_t, k) => (k === 'then' ? undefined : chain()), apply: () => chain() });
const core = { pool, tx: async f => f(pool), HttpError: class extends Error { constructor(s, m) { super(m); this.status = s; } }, wrap: f => f, body: () => (q, s, nx) => nx && nx(), need: () => (q, s, nx) => nx && nx(), audit: async () => {} };
const orig = Module._load;
Module._load = function (req, parent, ...a) {
  if (parent && /manager_extras\.js$/.test(parent.filename)) {
    if (req === 'express') { const e = () => fakeRouter(); e.Router = fakeRouter; return e; }
    if (req === 'zod') return { z: chain() };
    if (req === './core') return core;
    if (req === './safe') return { swallow: () => () => ({ rows: [] }) };
  }
  return orig.call(this, req, parent, ...a);
};
const X = require('../src/manager_extras'); Module._load = orig;

(async () => {
  await check('lundi : semaine précédente ; autres jours : rien', async () => {
    handler = () => ({ rows: [] });
    assert.strictEqual(await X.runWeekly(new Date('2026-11-17T08:00:00Z')), 0); // mardi
    assert.strictEqual(queries.filter(q => /weekly_summaries_sent/.test(q.sql)).length, 0);
  });
  await check('lundi : une notification par station, une seule fois par semaine', async () => {
    const seen = new Set(); const notifs = [];
    handler = (sql, p) => {
      if (/FROM stations s JOIN clients/.test(sql)) return { rows: [{ id: 1, name: 'Nord' }] };
      if (/INSERT INTO weekly_summaries_sent/.test(sql)) { const k = p.join('|'); if (seen.has(k)) return { rowCount: 0, rows: [] }; seen.add(k); return { rowCount: 1, rows: [] }; }
      if (/INSERT INTO notifications/.test(sql)) { notifs.push(p); return { rows: [] }; }
      if (/WITH f AS/.test(sql)) return { rows: [{ fuel_amount: 120000, liters: 500 }] };
      if (/FROM sales sa WHERE/.test(sql)) return { rows: [{ shop_amount: 30000, sales_count: 3 }] };
      if (/FROM shifts/.test(sql)) return { rows: [{ cash_gap: -1500, shifts_closed: 4 }] };
      if (/GROUP BY e.id/.test(sql)) return { rows: [{ name: 'Awa Traoré', amount: 70000 }] };
      return { rows: [] };
    };
    const mon = new Date('2026-11-16T06:00:00Z');
    assert.strictEqual(await X.runWeekly(mon), 1); assert.strictEqual(await X.runWeekly(mon), 0);
    assert.strictEqual(notifs.length, 1); assert.match(notifs[0][1], /Résumé de la semaine du 2026-11-09 au 2026-11-15 — Nord/);
    assert.match(notifs[0][1], /ventes 150[\s\u202f\u00a0]000/); assert.match(notifs[0][1], /500 L/); assert.match(notifs[0][1], /écart de caisse cumulé -1[\s\u202f\u00a0]500/); assert.match(notifs[0][1], /Awa Traoré/);
  });
  await check('résumé : évolution calculée seulement avec une semaine précédente > 0', () => {
    const s = { week_start: '2026-11-09', week_end: '2026-11-15', amount: 120000, liters: 500, shifts_closed: 4, cash_gap: 0, top_seller: null, evolution_pct: 20 };
    assert.match(X.summaryText(s), /\+20 % vs semaine précédente/); assert.ok(!/vs semaine/.test(X.summaryText({ ...s, evolution_pct: null })));
  });
  await check('semaine : lundi UTC correct, y compris dimanche', () => {
    assert.strictEqual(X.mondayOf(new Date('2026-11-15T23:00:00Z')).toISOString().slice(0, 10), '2026-11-09');
    assert.strictEqual(X.mondayOf(new Date('2026-11-16T00:00:00Z')).toISOString().slice(0, 10), '2026-11-16');
  });
  await check('justificatif : contrôle du contenu réel (signature de fichier)', () => {
    assert.ok(X.magicOk('image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0])));
    assert.ok(X.magicOk('application/pdf', Buffer.from('%PDF-1.4')));
    assert.ok(!X.magicOk('image/png', Buffer.from('<html>')), 'HTML déguisé refusé');
  });
  await check('justificatif : seul l\'auteur peut joindre ; un fichier falsifié est refusé avant la base', async () => {
    const post = routes['post /expenses/:id/receipts'].at(-1);
    const b64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]).toString('base64');
    handler = sql => (/FROM expenses WHERE/.test(sql) ? { rows: [{ id: 7, created_by: 99 }] } : { rows: [] });
    let err; try { await post({ params: { id: '7' }, body: { filename: 'a.jpg', mime: 'image/jpeg', data: b64 }, sid: 1, user: { id: 5 } }, { status: () => ({ json: () => {} }), json: () => {} }); } catch (e) { err = e; }
    assert.ok(err && err.status === 403, 'auteur différent → 403');
    let err2; try { await post({ params: { id: '7' }, body: { filename: 'x.png', mime: 'image/png', data: Buffer.from('<html>').toString('base64') }, sid: 1, user: { id: 5 } }, {}); } catch (e) { err2 = e; }
    assert.ok(err2 && err2.status === 400);
  });
  await check('branchements : serveur, planificateur, prompt après dépense, bandeau hors-ligne', () => {
    const rd = f => fs.readFileSync(f, 'utf8');
    assert.match(rd('src/server.js'), /manager_extras'\)\.r/); assert.match(rd('src/server.js'), /manager_extras'\)\.startScheduler/);
    assert.match(rd('public/app.js'), /askExpenseReceipt\(ex\.id\)/); assert.match(rd('public/index.html'), /ext-manager-extras\.js/);
    assert.match(rd('public/pwa.js'), /Hors connexion/); assert.match(rd('migrations/113_expense_receipts_weekly.sql'), /expense_receipts/);
  });
  console.log(`\n${n} contrôles réussis.`);
})().catch(e => { console.error('✘', e); process.exit(1); });
