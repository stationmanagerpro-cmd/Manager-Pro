'use strict';
// Clôture d'un quart PARTAGÉ : le vrai code de src/shifts.js (route POST /:id/close) est exécuté avec une base simulée
// (aucune connexion PostgreSQL). Vérifie que chaque écart, anomalie et notification est rattaché au bon employé.
const assert = require('assert');
const Module = require('module');
const path = require('path');

class HttpError extends Error { constructor(status, message, details) { super(message); this.status = status; this.details = details; } }
class Preview extends Error { constructor(data) { super('preview'); this.data = data; } }
const pool = { query: async () => { throw new Error('requête non simulée'); } };
const f3 = x => Math.round((+x || 0) * 1000) / 1000;
const core = {
  pool, HttpError, Preview, tx: async fn => fn(pool), fl: x => Math.round((+x || 0) * 100) / 100, f3,
  wrap: fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next),
  body: schema => (req, res, next) => { const r = schema.safeParse(req.body); if (!r.success) return next(new HttpError(400, 'Données invalides')); req.body = r.data; next(); },
  need: (...codes) => (req, res, next) => codes.some(c => req.user.perms.has(c)) ? next() : next(new HttpError(403, 'Permission refusée')),
  audit: async () => {}, cashMove: async () => {}, stockMove: async () => {}, setting: async (c, s, k, d) => d, accountMove: async () => 1, assertLinkedMethod: async () => {}, ledger: async () => {},
};
const alerts = [];
const messaging = { sendSystemAlert: async a => { alerts.push(a); } };
const emailService = { notifyQuartEvent: async () => {}, notifyAnomalie: async () => {} };
function Router() {
  const stack = [];
  const add = m => (p, ...hs) => { stack.push({ route: { path: p, methods: { [m]: true }, stack: hs.map(h => ({ handle: h })) } }); };
  return { stack, get: add('get'), post: add('post'), put: add('put'), patch: add('patch'), delete: add('delete'), use() {} };
}
const hooks = { afterClose: [] };
const stubs = { './employee_actions': { afterClose: async (req, shiftId, number) => { hooks.afterClose.push([shiftId, number]); }, track: async () => {} }, './core': core, './notification_rules': { fireNotificationRules: async () => {} }, './messaging': messaging, '../services/emailService': emailService, express: { Router } };
const realLoad = Module._load;
Module._load = function (request, parent) {
  if (parent && /src[\\/]shifts\.js$/.test(parent.filename) && Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
  return realLoad.apply(this, arguments);
};
let n = 0;
async function check(label, fn) { await fn(); n++; console.log('✔ ' + label); }

// ----- Scénario : Awa (P1+P2), Moussa (P3), Fanta (caisse) ; gasoil sur P1, P2 et P3 -----
const TEAM = [{ id: 1, name: 'Awa Traoré', user_id: 101 }, { id: 2, name: 'Moussa Keita', user_id: 102 }, { id: 3, name: 'Fanta Diarra', user_id: 103 }];
const OWN = [{ employee_id: 1, pump_id: 1 }, { employee_id: 1, pump_id: 2 }, { employee_id: 2, pump_id: 3 }];
const METERS = [
  { id: 1, counter_id: 1, pump_id: 1, product_id: 10, index_start: 0, sell_price: 700, buy_price: 600, pname: 'Gasoil', counter_number: 'A', pump_name: 'P1' },
  { id: 2, counter_id: 2, pump_id: 2, product_id: 10, index_start: 0, sell_price: 700, buy_price: 600, pname: 'Gasoil', counter_number: 'A', pump_name: 'P2' },
  { id: 3, counter_id: 3, pump_id: 3, product_id: 10, index_start: 0, sell_price: 700, buy_price: 600, pname: 'Gasoil', counter_number: 'A', pump_name: 'P3' }];
const DB = { gaps: [], anomalies: [], reports: [], team: TEAM, own: OWN, userAlerts: [], fuelSales: [], reassigned: [] };
pool.query = async (sql, params) => {
  const q = sql.replace(/\s+/g, ' ');
  if (/^SELECT \* FROM shifts WHERE id = \$1 AND station_id = \$2 FOR UPDATE/.test(q)) return { rows: [{ id: 5, number: 12, kind: 'jour', status: 'ouvert', opened_at: new Date(Date.now() - 8 * 3600e3), cash_register_id: 1, opening_cash: 20000 }] };
  if (/FROM shifts WHERE station_id = \$1 AND status <> 'annule'/.test(q)) return { rows: [] };
  if (/FROM meter_readings m JOIN products p/.test(q)) return { rows: METERS };
  if (/^UPDATE meter_readings|^UPDATE pump_counters|^UPDATE shift_stock_counts|^UPDATE shifts SET|^UPDATE cash_movements|^UPDATE stock_movements|^UPDATE payments|^UPDATE money_movements/.test(q)) return { rows: [] };
  if (/FROM shift_employees se JOIN employees e ON e.id = se.employee_id WHERE se.shift_id = \$1 ORDER BY se.employee_id/.test(q)) return { rows: DB.team };
  if (/UNION SELECT employee_id, pump_id FROM shift_employee_pumps/.test(q)) return { rows: DB.own };
  if (/^SELECT id, pump_id, employee_id, total FROM sales WHERE shift_id = \$1 AND kind = 'carburant'/.test(q)) return { rows: DB.fuelSales };
  if (/^SELECT id, TRIM.* AS name FROM employees WHERE station_id = \$1$/.test(q)) return { rows: DB.team.map(t => ({ id: t.id, name: t.name })) };
  if (/^SELECT id, name FROM pumps WHERE station_id = \$1$/.test(q)) return { rows: [{ id: 1, name: 'P1' }, { id: 2, name: 'P2' }, { id: 3, name: 'P3' }] };
  if (/^SELECT id, number, status FROM shifts WHERE id = \$1 AND station_id = \$2 FOR UPDATE/.test(q)) return { rows: [{ id: 5, number: 12, status: DB.shiftStatus || 'ouvert' }] };
  if (/^SELECT id, pump_id, employee_id, total FROM sales WHERE id = \$1 AND shift_id = \$2/.test(q)) return { rows: DB.fuelSales.filter(x => String(x.id) === String(params[0])) };
  if (/^SELECT employee_id FROM shift_employees WHERE shift_id = \$1 AND pump_id = \$2 UNION/.test(q)) return { rows: DB.own.filter(o => o.pump_id === params[1]).map(o => ({ employee_id: o.employee_id })) };
  if (/^SELECT id, TRIM.* AS name FROM employees WHERE station_id = \$1 AND id = ANY/.test(q)) return { rows: DB.team.map(t => ({ id: t.id, name: t.name })) };
  if (/^INSERT INTO shift_anomalies\(shift_id, kind, description, amount, created_by, employee_id\) VALUES \(\$1,\$2,\$3,\$4,\$5,\$6\)/.test(q) && params[1] === 'rattachement') { DB.rattach = { desc: params[2], emp: params[5] }; return { rows: [] }; }
  if (/^UPDATE sales SET employee_id = \$2 WHERE id = \$1 AND shift_id = \$3/.test(q)) { DB.reassigned.push([params[0], params[1]]); return { rows: [] }; }
  if (/^SAVEPOINT|^RELEASE SAVEPOINT|^ROLLBACK TO SAVEPOINT|^UPDATE employee_actions/.test(q)) return { rows: [] };
  if (/kind = 'carburant' AND status = 'valide' AND employee_id IS NOT NULL GROUP BY employee_id/.test(q)) return { rows: [{ employee_id: 1, t: 40000 }] };
  if (/p\.method = 'especes' AND sa\.employee_id IS NOT NULL/.test(q)) return { rows: [{ employee_id: 1, t: 40000 }, { employee_id: 3, t: 5000 }] };
  if (/FROM sale_details d JOIN sales sa ON sa\.id = d\.sale_id WHERE sa\.shift_id = \$1 AND sa\.status = 'valide' AND sa\.employee_id IS NOT NULL/.test(q)) return { rows: [] };
  if (/AS total FROM sales WHERE shift_id = \$1 AND kind = 'carburant'/.test(q)) return { rows: [{ total: 40000 }] };
  if (/SELECT p\.method, SUM\(p\.amount\) AS amount FROM payments p JOIN sales sa ON sa\.id = p\.sale_id WHERE sa\.shift_id = \$1 AND sa\.kind = 'carburant'/.test(q)) return { rows: [{ method: 'especes', amount: 40000 }] };
  if (/^INSERT INTO payments/.test(q)) return { rows: [] };
  if (/kind = 'produits' GROUP BY p\.method/.test(q)) return { rows: [{ method: 'especes', amount: 5000 }] };
  if (/^SELECT balance FROM cash_registers/.test(q)) return { rows: [{ balance: 65000 }] };   // 20 000 d'ouverture + 45 000 d'espèces déjà encaissées à la saisie
  if (/FROM products p JOIN categories cat/.test(q)) return { rows: [{ id: 10, name: 'Gasoil', cat: 'CARBURANT', qty: 1230 }] };
  if (/FROM shift_anomalies sa LEFT JOIN employees e ON e\.id = sa\.employee_id WHERE sa\.shift_id = \$1 ORDER BY sa\.id/.test(q)) return { rows: [{ kind: 'autre', description: 'Bidon cassé à la pompe 1', amount: null, employee_id: 1, employee: 'Awa Traoré' }] };
  if (/^INSERT INTO employee_gaps/.test(q)) { DB.gaps.push({ employee_id: params[2], kind: params[3], product_id: params[4], amount: params[5] }); return { rows: [] }; }
  if (/^INSERT INTO shift_anomalies/.test(q)) { DB.anomalies.push({ kind: params[1], description: params[2], amount: params[3], employee_id: params[5] }); return { rows: [] }; }
  if (/^SELECT closed_at FROM shifts/.test(q)) return { rows: [{ closed_at: new Date() }] };
  if (/^INSERT INTO notifications/.test(q)) return { rows: [] };
  if (/^INSERT INTO reports/.test(q)) { DB.reports.push(JSON.parse(params[2])); return { rows: [] }; }
  if (/^SELECT client_id FROM users/.test(q)) return { rows: [{ client_id: 7 }] };
  if (/^SELECT id, user_id FROM employees WHERE id = ANY/.test(q)) return { rows: DB.team.map(t => ({ id: t.id, user_id: t.user_id })) };
  if (/^SELECT name FROM stations/.test(q)) return { rows: [{ name: 'Station Test' }] };
  throw new Error('requête inattendue : ' + q.slice(0, 140));
};
const shifts = require(path.join(__dirname, '..', 'src', 'shifts.js'));
const route = shifts.stack.find(x => x.route && x.route.path === '/:id/close' && x.route.methods.post).route.stack;
async function close(body, query = {}) {
  const req = { params: { id: '5' }, body, sid: 77, ip: '127.0.0.1', query, user: { id: 1, login: 'gerant', perms: new Set(['shift.close']) }, headers: {} };
  const out = { json: null }; let err = null;
  const res = { status() { return this; }, json(j) { out.json = j; return this; } };
  for (const h of route) {
    await new Promise(resolve => { let done = false; const next = e => { if (e) err = e; if (!done) { done = true; resolve(); } };
      try { const r = h.handle(req, res, next); if (r && r.then) r.then(() => { if (!done) { done = true; resolve(); } }, next); } catch (e) { err = e; resolve(); } });
    if (err || out.json) break;
  }
  return { out, err };
}
const reset = () => { DB.gaps.length = 0; DB.anomalies.length = 0; DB.reports.length = 0; alerts.length = 0; DB.team = TEAM; DB.own = OWN; DB.fuelSales = []; DB.reassigned = []; };
// Compteurs finaux : Awa 100 L + 50 L, Moussa 80 L (700/L) ; stock physique 991 L pour 1 000 L théoriques → écart −9 L
const BASE = { counters: [{ counter_id: 1, index_end: 100 }, { counter_id: 2, index_end: 50 }, { counter_id: 3, index_end: 80 }], stock_counts: [{ product_id: 10, physical: 991 }],
  non_cash: {}, justification: 'Rendu de monnaie', observations: '' };
const CLOSINGS = [
  { employee_id: 1, counted_cash: 105000, mobile_money: 0, card: 0, credit: 0 },
  { employee_id: 2, counted_cash: 43500, mobile_money: 10000, card: 0, credit: 0 },
  { employee_id: 3, counted_cash: 5000, mobile_money: 0, card: 0, credit: 0 }];

(async () => {
  await check('quart partagé : l\'écart de caisse de Moussa est sur Moussa, rien sur Awa ni Fanta', async () => {
    reset(); const { out, err } = await close({ ...BASE, counted_cash: 173500, employee_closings: CLOSINGS });
    assert(!err, err && (err.stack || err.message));
    const cash = DB.gaps.filter(g => g.kind === 'caisse');
    assert.deepStrictEqual(cash.map(g => [g.employee_id, g.amount]), [[2, -2500]], 'un seul écart de caisse, sur Moussa');
    assert.strictEqual(out.json.report.cash.gap, -2500); assert.strictEqual(out.json.report.shared, true);
  });
  await check('écart de stock réparti selon les litres de chaque employé (somme = écart du quart)', async () => {
    const st = DB.gaps.filter(g => g.kind === 'stock');
    assert.deepStrictEqual(st.map(g => [g.employee_id, g.product_id]), [[1, 10], [2, 10]]);
    assert(Math.abs(st[0].amount - (-5.87)) < 0.0015 && Math.abs(st[1].amount - (-3.13)) < 0.0015, JSON.stringify(st));
    assert.strictEqual(Math.round(st.reduce((a, g) => a + g.amount, 0) * 1000), -9000);
  });
  await check('chaque anomalie porte l\'employé à l\'origine ; l\'anomalie globale reste « ensemble du quart »', async () => {
    const byEmp = a => DB.anomalies.filter(x => x.employee_id === a).map(x => x.description);
    assert(byEmp(2).some(d => /Écart de caisse de Moussa Keita : -2 500 FCFA/.test(d)), 'écart de caisse chez Moussa');
    assert(byEmp(1).some(d => /Écart de stock Gasoil imputé à Awa Traoré/.test(d)) && byEmp(2).some(d => /imputé à Moussa Keita/.test(d)));
    assert(!byEmp(3).length, 'Fanta : aucune anomalie');
    assert(DB.anomalies.some(x => x.employee_id == null && /\(ensemble du quart\)/.test(x.description)));
  });
  await check('rapport enregistré : une situation par employé, chacun avec SES pompes et SES chiffres', async () => {
    const r = DB.reports[0]; const by = Object.fromEntries(r.employees.map(e => [e.employee_id, e]));
    assert.deepStrictEqual(by[1].pumps, ['P1', 'P2']); assert.deepStrictEqual(by[2].pumps, ['P3']); assert.deepStrictEqual(by[3].pumps, []);
    assert.strictEqual(by[1].fuel_amount, 105000); assert.strictEqual(by[2].fuel_amount, 56000);
    assert.strictEqual(by[2].expected_cash, 46000); assert.strictEqual(by[2].counted_cash, 43500); assert.strictEqual(by[2].cash_gap, -2500);
    assert.strictEqual(by[1].cash_gap, 0); assert.strictEqual(by[3].cash_gap, 0);
    assert.strictEqual(r.unassigned.cash_gap, 0);
    assert(r.anomalies.some(a => a.employee === 'Awa Traoré' && /Bidon cassé/.test(a.description)), 'anomalie déclarée avec son employé');
    assert(Math.abs(by[1].stock_gaps[0].amount + 5.87) < 0.0015);
  });
  await check('journal des actions : appelé après la clôture (écarts et anomalies de chaque employé, historique + messagerie) ; plus aucune alerte « au nom du gérant »', async () => {
    assert.deepStrictEqual(hooks.afterClose[0], [5, 12]);
    assert(alerts.every(a => a.employeeUserId == null), 'le gérant n\'est plus présenté comme « l\'employé » de l\'écart d\'un quart partagé');
  });
  await check('part non attribuable : si les espèces remises ne couvrent pas le comptage de la caisse, le reste n\'est mis sur personne', async () => {
    reset(); const { err } = await close({ ...BASE, counted_cash: 172000, employee_closings: CLOSINGS });   // caisse 1 500 de moins que ce que les employés disent avoir remis
    assert(!err, err && err.message);
    assert.deepStrictEqual(DB.gaps.filter(g => g.kind === 'caisse').map(g => [g.employee_id, g.amount]), [[2, -2500], [null, -1500]]);
  });
  await check('clôture refusée tant qu\'un employé du quart n\'a pas remis sa situation', async () => {
    reset(); const { err } = await close({ ...BASE, counted_cash: 173500, employee_closings: CLOSINGS.slice(0, 2) });
    assert(err && err.status === 400 && /Fanta Diarra/.test(err.message)); assert.strictEqual(DB.gaps.length, 0, 'rien n\'est enregistré');
  });
  await check('aperçu (preview) : fonctionne sans saisie individuelle et n\'enregistre rien', async () => {
    reset(); const { out, err } = await close({ ...BASE, counted_cash: 173500, employee_closings: [] }, { preview: '1' });
    assert(!err, err && err.message); assert.strictEqual(out.json.preview, true);
    assert.strictEqual(DB.gaps.length, 0); assert.strictEqual(DB.reports.length, 0);
    assert.strictEqual(out.json.report.employees.find(e => e.employee_id === 2).cash_gap, null);
  });
  await check('paiements non espèces globaux sans pompe libre : refus (ils doivent être saisis par employé)', async () => {
    reset(); const { err } = await close({ ...BASE, counted_cash: 173500, non_cash: { mobile_money: 99 }, employee_closings: CLOSINGS });
    assert(err && err.status === 400 && /Aucune pompe sans employé/.test(err.message));
  });
  await check('pompe SANS employé (manque de personnel) : son écart n\'est mis sur personne, les employés ne sont pas touchés', async () => {
    // P3 (56 000) sans employé ; Awa a P1+P2 ; Fanta à la caisse. Mobile money de P3 : 10 000 saisi globalement.
    reset(); DB.team = [TEAM[0], TEAM[2]]; DB.own = [OWN[0], OWN[1]];
    const closings = [CLOSINGS[0], CLOSINGS[2]];
    let r = await close({ ...BASE, stock_counts: [], counted_cash: 176000, non_cash: { mobile_money: 10000 }, employee_closings: closings });
    assert(!r.err, r.err && (r.err.stack || r.err.message));
    assert.strictEqual(DB.gaps.length, 0, 'tout est juste : aucun écart');
    assert.strictEqual(DB.reports[0].unassigned.fuel_amount, 56000);
    reset(); DB.team = [TEAM[0], TEAM[2]]; DB.own = [OWN[0], OWN[1]];
    r = await close({ ...BASE, stock_counts: [], counted_cash: 174000, non_cash: { mobile_money: 10000 }, employee_closings: closings });
    assert(!r.err, r.err && r.err.message);
    assert.deepStrictEqual(DB.gaps.map(g => [g.employee_id, g.kind, g.amount]), [[null, 'caisse', -2000]], 'le manquant reste « non attribué »');
  });
  await check('employé seul sur le quart : comportement historique (tout lui est imputé, aucune saisie individuelle requise)', async () => {
    reset(); DB.team = [TEAM[0]]; DB.own = [];
    const { err } = await close({ ...BASE, counted_cash: 170000, employee_closings: [] });
    assert(!err, err && (err.stack || err.message));
    assert(DB.gaps.length >= 1 && DB.gaps.every(g => g.employee_id === 1), JSON.stringify(DB.gaps));
  });
  await check('vérification à la clôture : une vente de la pompe de Moussa saisie au nom d\'Awa BLOQUE la clôture (409) et rien n\'est modifié', async () => {
    reset(); DB.fuelSales = [{ id: 901, pump_id: 3, employee_id: 1, total: 56000 }, { id: 902, pump_id: 1, employee_id: 1, total: 100 }];
    const { out, err } = await close({ ...BASE, counted_cash: 173500, employee_closings: CLOSINGS });
    assert(err && err.status === 409 && /Clôture bloquée : 1 vente/.test(err.message), err && err.message);
    assert.deepStrictEqual(err.details.map(d => d.sale_id), [901]); assert(/Awa Traoré/.test(err.details[0].description) && /Moussa Keita/.test(err.details[0].description));
    assert.deepStrictEqual(DB.reassigned, []); assert.strictEqual(DB.reports.length, 0, 'aucun rapport enregistré'); assert(!out.json);
  });
  await check('aperçu de clôture : bloqué de la même façon (le gérant voit les ventes à corriger)', async () => {
    reset(); DB.fuelSales = [{ id: 901, pump_id: 3, employee_id: 1, total: 56000 }];
    const { err } = await close({ ...BASE, counted_cash: 173500, employee_closings: CLOSINGS }, { preview: '1' });
    assert(err && err.status === 409 && err.details.length === 1);
  });
  await check('vérification à la clôture : rattachement correct → aucune correction', async () => {
    reset(); DB.fuelSales = [{ id: 903, pump_id: 3, employee_id: 2, total: 56000 }];
    const { out, err } = await close({ ...BASE, counted_cash: 173500, employee_closings: CLOSINGS });
    assert(!err, err && (err.stack || err.message)); assert.deepStrictEqual(DB.reassigned, []); assert.strictEqual(out.json.report.attribution_check.checked_sales, 1);
  });
  const fixRoute = shifts.stack.find(x => x.route && x.route.path === '/:id/sales/:saleId/reassign-to-pump-owner' && x.route.methods.post).route.stack;
  async function fix(saleId) {
    const req = { params: { id: '5', saleId: String(saleId) }, body: {}, sid: 77, ip: '127.0.0.1', query: {}, user: { id: 1, login: 'gerant', perms: new Set(['shift.close']) }, headers: {} };
    const out = { json: null }; let err = null; const res = { status() { return this; }, json(j) { out.json = j; return this; } };
    for (const h of fixRoute) { await new Promise(resolve => { let d = false; const next = e => { if (e) err = e; if (!d) { d = true; resolve(); } }; try { const r = h.handle(req, res, next); if (r && r.then) r.then(() => { if (!d) { d = true; resolve(); } }, next); } catch (e) { err = e; resolve(); } }); if (err || out.json) break; }
    return { out, err };
  }
  await check('correction explicite : la vente est remise au responsable de la pompe, tracée en anomalie « rattachement » de ce responsable', async () => {
    reset(); DB.fuelSales = [{ id: 901, pump_id: 3, employee_id: 1, total: 56000 }]; DB.rattach = null;
    const { out, err } = await fix(901); assert(!err, err && (err.stack || err.message));
    assert.deepStrictEqual(DB.reassigned, [[901, 2]]); assert.deepStrictEqual([out.json.from, out.json.to], ['Awa Traoré', 'Moussa Keita']);
    assert.strictEqual(DB.rattach.emp, 2); assert(/Awa Traoré.*Moussa Keita.*responsable de la pompe/.test(DB.rattach.desc));
  });
  await check('correction explicite : refusée si déjà correcte, si pompe sans responsable, ou si le quart est fermé', async () => {
    reset(); DB.fuelSales = [{ id: 903, pump_id: 3, employee_id: 2, total: 1 }, { id: 904, pump_id: 9, employee_id: 1, total: 1 }];
    let r = await fix(903); assert(r.err && r.err.status === 409 && /déjà au nom/.test(r.err.message));
    r = await fix(904); assert(r.err && r.err.status === 409 && /pas de responsable/.test(r.err.message));
    DB.shiftStatus = 'ferme'; r = await fix(903); DB.shiftStatus = null; assert(r.err && r.err.status === 409 && /pas ouvert/.test(r.err.message));
    assert.deepStrictEqual(DB.reassigned, []);
  });
  console.log(`\n${n}/16 contrôles réussis.`); process.exit(0);
})().catch(e => { console.error('✘', e); process.exit(1); });
