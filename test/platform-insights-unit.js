'use strict';
// Superadmin : score de santé, relances de licence (30/15/7 j), comparaison anonymisée, journal d'erreurs. Base simulée.
const assert = require('assert'), Module = require('module'), fs = require('fs');
let n = 0; const check = async (l, f) => { await f(); n++; console.log('✓ ' + l); };
const { healthScore } = require('../src/client_health'); const { dueBand, reminderText } = require('../src/license_reminders');

const queries = []; let handler = () => ({ rows: [], rowCount: 0 });
const fakePool = { query: async (sql, p) => { queries.push({ sql, p }); return handler(sql, p); } };
const routes = {}; const fakeRouter = () => { const r = {}; for (const m of ['get', 'post', 'put', 'delete']) r[m] = (path, ...h) => { routes[m + ' ' + path] = h[h.length - 1]; return r; }; r.use = () => r; return r; };
const chain = () => new Proxy(function () {}, { get: (_t, k) => (k === 'then' ? undefined : chain()), apply: () => chain() });
const contracts = { needPrincipal: (q, s, nx) => nx && nx(), licenseStatusOf: (row, now) => (row.is_indefinite ? 'INDEFINIE' : new Date(row.expires_at) < now ? 'EXPIREE' : 'ACTIVE'),
  daysRemaining: (e, now) => Math.ceil((new Date(e) - now) / 864e5), getWarningThresholds: async () => [30, 15, 7, 3, 1] };
const orig = Module._load;
Module._load = function (req, parent, ...a) {
  if (parent && /platform_insights\.js$/.test(parent.filename)) {
    if (req === 'express') { const e = () => fakeRouter(); e.Router = fakeRouter; return e; }
    if (req === 'zod') return { z: chain() };
    if (req === './core') return { pool: fakePool, HttpError: Error, wrap: f => f, body: () => (q, s, nx) => nx && nx() };
    if (req === './contracts') return contracts;
    if (req === './safe') return { swallow: () => () => ({ rows: [] }) };
  }
  return orig.call(this, req, parent, ...a);
};
const PI = require('../src/platform_insights'); Module._load = orig;
const call = async (key, req = {}) => { let out; await routes[key]({ query: {}, body: {}, get: () => 'UA', ...req }, { json: v => { out = v; return v; } }); return out; };

(async () => {
  await check('santé : client sain ≈ 100, client inactif/expiré à risque', () => {
    const good = healthScore({ activeDays: 25, windowDays: 30, shiftsOpened: 40, shiftsClosed: 40, staleOpenShifts: 0, gapShifts: 0, license: { status: 'ACTIVE', daysRemaining: 200 } });
    assert.strictEqual(good.score, 100); assert.strictEqual(good.level, 'bon'); assert.strictEqual(good.incomplete, false);
    const bad = healthScore({ activeDays: 0, windowDays: 30, shiftsOpened: 0, shiftsClosed: 0, license: { status: 'EXPIREE' } });
    assert.ok(bad.score < 40 && bad.level === 'a_risque', JSON.stringify(bad)); assert.ok(bad.reasons.some(r => /expirée/.test(r)) && bad.incomplete);
  });
  await check('santé : pénalités (quarts ouverts trop longtemps, écarts fréquents, licence proche) et bornes 0–100', () => {
    const a = healthScore({ activeDays: 20, windowDays: 30, shiftsOpened: 20, shiftsClosed: 18, staleOpenShifts: 2, gapShifts: 9, license: { status: 'EXPIRANT_BIENTOT', daysRemaining: 5 } });
    assert.ok(a.score > 0 && a.score < 70); assert.ok(a.reasons.length >= 3);
    for (const x of [a, healthScore({}), healthScore({ activeDays: 999, windowDays: 1, shiftsOpened: 1, shiftsClosed: 5, license: { indefinite: true } })]) assert.ok(x.score >= 0 && x.score <= 100);
    assert.strictEqual(healthScore({ activeDays: 30, windowDays: 30, shiftsOpened: 1, shiftsClosed: 1, license: { status: 'ACTIVE', daysRemaining: 90 } }).parts.ecarts, 20);
  });
  await check('relance : paliers 30/15/7, rien au-delà, rien si expirée', () => {
    assert.strictEqual(dueBand(45), null); assert.strictEqual(dueBand(30), 30); assert.strictEqual(dueBand(20), 30); assert.strictEqual(dueBand(15), 15);
    assert.strictEqual(dueBand(12), 15); assert.strictEqual(dueBand(7), 7); assert.strictEqual(dueBand(1), 7); assert.strictEqual(dueBand(-1), null); assert.strictEqual(dueBand(null), null);
    assert.match(reminderText({ band: 7, days: 5, expiresOn: '2026-12-01' }), /Renouveler/);
  });
  await check('relance : une seule par (client, échéance, palier) ; notification par station', async () => {
    const inserted = new Set(); const notifs = [];
    const exp = new Date(Date.now() + 10 * 864e5).toISOString();
    handler = (sql, p) => {
      if (/FROM clients c JOIN client_contracts/.test(sql)) return { rows: [{ id: 5, name: 'Client X', expires_at: exp, is_indefinite: false, contract_status: 'actif', client_status: 'actif' }] };
      if (/INSERT INTO license_reminders/.test(sql)) { const k = p.join('|'); if (inserted.has(k)) return { rowCount: 0, rows: [] }; inserted.add(k); return { rowCount: 1, rows: [] }; }
      if (/FROM stations WHERE client_id/.test(sql)) return { rows: [{ id: 1 }, { id: 2 }] };
      if (/INSERT INTO notifications/.test(sql)) { notifs.push(p); return { rows: [] }; }
      return { rows: [], rowCount: 0 };
    };
    assert.strictEqual(await PI.sendLicenseReminders(), 1); assert.strictEqual(notifs.length, 2); assert.strictEqual(notifs[0][0], 1);
    assert.strictEqual(await PI.sendLicenseReminders(), 0); assert.strictEqual(notifs.length, 2);
  });
  await check('relance : licence éloignée (> 30 j) ou illimitée → aucune', async () => {
    const far = new Date(Date.now() + 90 * 864e5).toISOString(); let ins = 0;
    handler = sql => (/FROM clients c JOIN client_contracts/.test(sql) ? { rows: [{ id: 6, name: 'Y', expires_at: far, contract_status: 'actif' }] } : /INSERT INTO license_reminders/.test(sql) ? (ins++, { rowCount: 1, rows: [] }) : { rows: [] });
    assert.strictEqual(await PI.sendLicenseReminders(), 0); assert.strictEqual(ins, 0);
  });
  await check('comparaison : anonymisée par défaut, nominative sur demande ; classement par ventes', async () => {
    handler = () => ({ rows: [{ id: 1, station: 'Nord', client: 'Alpha', sales: '100', shop_margin: '10', cash_gap: '-5', shifts_closed: 3 }, { id: 2, station: 'Sud', client: 'Beta', sales: '900', shop_margin: '90', cash_gap: '0', shifts_closed: 9 }] });
    const anon = await call('get /admin/platform/compare'); assert.strictEqual(anon.stations[0].sales, 900); assert.match(anon.stations[0].label, /^Station A$/); assert.ok(!JSON.stringify(anon).includes('Alpha') && !JSON.stringify(anon).includes('Sud'));
    const named = await call('get /admin/platform/compare', { query: { names: '1' } }); assert.strictEqual(named.stations[0].label, 'Beta — Sud');
  });
  await check('santé (route) : tri du plus fragile au plus sain', async () => {
    handler = sql => /FROM clients c LEFT JOIN client_contracts/.test(sql) ? { rows: [{ id: 1, name: 'Sain', expires_at: new Date(Date.now() + 200 * 864e5).toISOString() }, { id: 2, name: 'Dormant', expires_at: new Date(Date.now() - 864e5).toISOString() }] }
      : /FROM user_usage/.test(sql) ? { rows: [{ client_id: 1, active_days: 25 }] } : /FROM shifts sh/.test(sql) ? { rows: [{ client_id: 1, opened: 20, closed: 20, stale: 0, gaps: 0 }] } : { rows: [] };
    const out = await call('get /admin/platform/health'); assert.strictEqual(out.clients[0].name, 'Dormant'); assert.ok(out.clients[0].score < out.clients[1].score); assert.strictEqual(out.at_risk, 1);
  });
  await check('journal : erreur enregistrée sans jamais lever, même si la base échoue', async () => {
    handler = () => { throw new Error('db down'); }; await PI.logError({ source: 'server', message: 'x' });
    handler = () => ({ rows: [] }); queries.length = 0; await PI.logError({ source: 'client', message: 'boom', view: 'ventes', user_id: 3 });
    assert.ok(queries.some(q => /INSERT INTO error_log/.test(q.sql) && q.p[5] === 'boom'));
  });
  await check('branchements : routeur, planificateur, journal serveur, capture écran, bouton Renouveler, onglets', () => {
    const rd = f => fs.readFileSync(f, 'utf8');
    assert.match(rd('src/server.js'), /platform_insights'\)\.r/); assert.match(rd('src/server.js'), /platform_insights'\)\.startScheduler/);
    assert.match(rd('src/core.js'), /logError/); assert.match(rd('public/index.html'), /ext-platform-insights\.js/);
    assert.match(rd('public/app.js'), /licence_expiration[^\n]*requestRenewal/); assert.match(rd('public/ext-p12.js'), /pilotage/);
    assert.match(rd('migrations/112_platform_insights.sql'), /error_log/);
  });
  console.log(`\n${n} contrôles réussis.`);
})().catch(e => { console.error('✘', e); process.exit(1); });
