'use strict';
// Historique des actions au nom d'un employé : le vrai code de src/employee_actions.js est exécuté (base et messagerie simulées).
const assert = require('assert'); const Module = require('module'); const path = require('path');
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const pool = { query: async () => { throw new Error('requête non simulée'); } };
const core = { pool, HttpError, tx: async fn => fn(pool), wrap: fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next),
  body: schema => (req, res, next) => { const r = schema.safeParse(req.body); if (!r.success) return next(new HttpError(400, 'Données invalides')); req.body = r.data; next(); } };
const sent = [];
const messaging = { deliverSystemMessage: async m => { sent.push(m); return { ok: true }; }, clientAdminIds: async () => [1] };
function Router() { const stack = []; const add = m => (p, ...hs) => { stack.push({ route: { path: p, methods: { [m]: true }, stack: hs.map(h => ({ handle: h })) } }); };
  return { stack, get: add('get'), post: add('post'), put: add('put'), patch: add('patch'), delete: add('delete'), use() {} }; }
const stubs = { './core': core, './messaging': messaging, express: { Router } };
const realLoad = Module._load;
Module._load = function (request, parent) { if (parent && /src[\\/]employee_actions\.js$/.test(parent.filename) && Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request]; return realLoad.apply(this, arguments); };
let n = 0; const check = async (l, fn) => { await fn(); n++; console.log('✔ ' + l); };

const EMPS = { 1: { id: 1, user_id: 11, first_name: 'Awa', last_name: 'Traoré' }, 2: { id: 2, user_id: 12, first_name: 'Moussa', last_name: 'Keita' }, 3: { id: 3, user_id: null, first_name: 'Fanta', last_name: 'Diarra' } };
const USERS = { 1: 'gerant', 11: 'awa', 12: 'moussa' };
const DB = { actions: [], gaps: [], events: [], sale: null, gapRows: [], anomalyRows: [], nextId: 1 };
const reset = () => { DB.actions = []; sent.length = 0; DB.events = []; DB.gaps = [{ id: 50, status: 'en_attente' }]; };
pool.query = async (sql, p) => {
  const q = sql.replace(/\s+/g, ' ');
  if (/^SELECT user_id FROM employees WHERE id = \$1 AND station_id = \$2/.test(q)) return { rows: EMPS[p[0]] ? [{ user_id: EMPS[p[0]].user_id }] : [] };
  if (/^SELECT user_id FROM employees WHERE id = \$1$/.test(q)) return { rows: [{ user_id: EMPS[p[0]].user_id }] };
  if (/^INSERT INTO employee_actions/.test(q)) {
    const [station, emp, kind, desc, amount, rt, rid, by, self] = p;
    if (rid != null && ['vente', 'dette_client', 'ecart', 'anomalie'].includes(kind) && DB.actions.some(a => a.employee_id === emp && a.kind === kind && a.ref_table === rt && a.ref_id === rid)) return { rows: [] };
    const a = { id: DB.nextId++, station_id: station, employee_id: emp, kind, description: desc, amount, ref_table: rt, ref_id: rid, performed_by: by, self_made: self, status: 'actif', notified_at: null }; DB.actions.push(a); return { rows: [a] };
  }
  if (/FROM employees e JOIN users u ON u\.id = e\.user_id WHERE e\.id = \$1/.test(q)) { const e = EMPS[p[0]]; return { rows: e && e.user_id ? [{ user_id: e.user_id, client_id: 7, actor: USERS[p[1]] || null }] : [] }; }
  if (/^UPDATE employee_actions SET notified_at/.test(q)) { DB.actions.find(a => a.id === p[0]).notified_at = 'now'; return { rows: [] }; }
  if (/FROM sales sa LEFT JOIN customers cu ON cu\.id = sa\.customer_id WHERE sa\.id = \$1/.test(q)) return { rows: DB.sale ? [DB.sale] : [] };
  if (/FROM employee_gaps g LEFT JOIN products p/.test(q)) return { rows: DB.gapRows };
  if (/FROM shift_anomalies\s+WHERE shift_id = \$1 AND employee_id IS NOT NULL/.test(q)) return { rows: DB.anomalyRows };
  if (/^SELECT id, user_id, first_name, last_name FROM employees WHERE id = \$1 AND station_id = \$2 AND deleted_at IS NULL/.test(q)) return { rows: EMPS[p[0]] ? [EMPS[p[0]]] : [] };
  if (/^SELECT id, user_id FROM employees WHERE id = \$1 AND station_id = \$2 AND deleted_at IS NULL/.test(q)) return { rows: EMPS[p[0]] ? [EMPS[p[0]]] : [] };
  if (/FROM employee_actions a LEFT JOIN users u ON u\.id = a\.performed_by WHERE a\.employee_id = \$1/.test(q)) return { rows: DB.actions.filter(a => a.employee_id === Number(p[0])).reverse().map(a => ({ ...a, performed_by_name: USERS[a.performed_by] })) };
  if (/FROM employee_actions a JOIN employees e ON e\.id = a\.employee_id WHERE a\.id = \$1/.test(q)) { const a = DB.actions.find(x => x.id === Number(p[0])); return { rows: a ? [{ ...a, emp_user: EMPS[a.employee_id].user_id, first_name: EMPS[a.employee_id].first_name, last_name: EMPS[a.employee_id].last_name }] : [] }; }
  if (/^UPDATE employee_actions SET status = 'rejete'/.test(q)) { Object.assign(DB.actions.find(a => a.id === p[0]), { status: 'rejete', rejected_reason: p[1] }); return { rows: [] }; }
  if (/^SELECT id, status FROM employee_gaps WHERE id = \$1/.test(q)) return { rows: DB.gaps.filter(g => g.id === p[0]) };
  if (/^UPDATE employee_gaps SET status = 'conteste'/.test(q)) { DB.gaps.find(g => g.id === p[0]).status = 'conteste'; return { rows: [] }; }
  if (/^INSERT INTO employee_gap_events/.test(q)) { DB.events.push(p); return { rows: [] }; }
  if (/^SELECT client_id FROM users WHERE id = \$1/.test(q)) return { rows: [{ client_id: 7 }] };
  if (/^SELECT id, employee_id, status, description FROM employee_actions/.test(q)) { const a = DB.actions.find(x => x.id === Number(p[0])); return { rows: a ? [a] : [] }; }
  if (/^UPDATE employee_actions SET review_note/.test(q)) { DB.actions.find(a => a.id === p[0]).review_note = p[1]; return { rows: [] }; }
  if (/FROM customer_ledger cl JOIN sales sa/.test(q)) return { rows: [
    { sale_id: 1, sold_at: 'x', customer_id: 9, customer: 'Transport Keita', amount: 100000, sale_status: 'valide', paid_linked: 0 },
    { sale_id: 2, sold_at: 'x', customer_id: 9, customer: 'Transport Keita', amount: 100000, sale_status: 'valide', paid_linked: 40000 },
    { sale_id: 3, sold_at: 'x', customer_id: 9, customer: 'Transport Keita', amount: 100000, sale_status: 'valide', paid_linked: 100000 },
    { sale_id: 4, sold_at: 'x', customer_id: 9, customer: 'Transport Keita', amount: 100000, sale_status: 'annule', paid_linked: 0 }] };
  throw new Error('requête inattendue : ' + q.slice(0, 120));
};
const A = require(path.join(__dirname, '..', 'src', 'employee_actions.js'));
const find = (m, pth) => A.stack.find(x => x.route.path === pth && x.route.methods[m]).route.stack;
async function call(method, pth, { params = {}, body = {}, uid, perms = [] }) {
  const req = { params, body, sid: 77, user: { id: uid, perms: new Set(perms) } }; const out = { json: null }; let err = null;
  const res = { status() { return this; }, json(j) { out.json = j; return this; } };
  for (const h of find(method, pth)) { await new Promise(resolve => { let done = false; const next = e => { if (e) err = e; if (!done) { done = true; resolve(); } };
    try { const r = h.handle(req, res, next); if (r && r.then) r.then(() => { if (!done) { done = true; resolve(); } }, next); } catch (e) { err = e; resolve(); } }); if (err || out.json) break; }
  return { out, err };
}
const asUser = uid => ({ sid: 77, user: { id: uid, perms: new Set() } });

(async () => {
  await check('vente enregistrée au nom d\'Awa par le gérant : journalisée ET Awa est prévenue dans sa messagerie', async () => {
    reset(); DB.sale = { id: 31, employee_id: 1, total: 12500, customer: null, credit: 0 };
    await A.afterSale(asUser(1), 31);
    assert.strictEqual(DB.actions.length, 1); assert.strictEqual(DB.actions[0].kind, 'vente'); assert.strictEqual(DB.actions[0].self_made, false);
    assert.strictEqual(sent.length, 1); assert.deepStrictEqual(sent[0].userIds, [11]); assert(/enregistrée à votre nom/.test(sent[0].description || sent[0].body) && /gerant/.test(sent[0].body));
    assert(DB.actions[0].notified_at);
  });
  await check('ses propres ventes courantes : aucun bruit ni message', async () => {
    reset(); DB.sale = { id: 32, employee_id: 1, total: 800, customer: null, credit: 0 }; await A.afterSale(asUser(11), 32);
    assert.strictEqual(DB.actions.length, 0); assert.strictEqual(sent.length, 0);
  });
  await check('dette client : toujours journalisée ; message seulement si une AUTRE personne l\'a enregistrée', async () => {
    reset(); DB.sale = { id: 33, employee_id: 1, total: 50000, customer: 'Transport Keita', credit: 50000 };
    await A.afterSale(asUser(11), 33);   // Awa elle-même
    assert.strictEqual(DB.actions[0].kind, 'dette_client'); assert.strictEqual(DB.actions[0].self_made, true); assert.strictEqual(sent.length, 0);
    reset(); await A.afterSale(asUser(1), 33);   // le gérant, au nom d'Awa
    assert.strictEqual(DB.actions[0].self_made, false); assert.strictEqual(sent.length, 1); assert(/Transport Keita/.test(sent[0].body));
  });
  await check('idempotent : rejouer la même vente ne double ni le journal ni le message', async () => {
    reset(); DB.sale = { id: 34, employee_id: 1, total: 900, customer: null, credit: 0 }; await A.afterSale(asUser(1), 34); await A.afterSale(asUser(1), 34);
    assert.strictEqual(DB.actions.length, 1); assert.strictEqual(sent.length, 1);
  });
  await check('clôture : chaque employé reçoit SES écarts et anomalies, jamais ceux d\'un collègue', async () => {
    reset(); DB.gapRows = [{ id: 50, employee_id: 2, kind: 'caisse', amount: -2500, product: null }, { id: 51, employee_id: 1, kind: 'stock', amount: -5.87, product: 'Gasoil' }];
    DB.anomalyRows = [{ id: 70, employee_id: 1, description: 'Bidon cassé', amount: null }];
    await A.afterClose(asUser(1), 5, 12);
    const byEmp = id => sent.filter(m => m.userIds[0] === id).map(m => m.body).join('\n');
    assert(/Écart de caisse/.test(byEmp(12)) && !/Gasoil|Bidon/.test(byEmp(12)), 'Moussa : son écart de caisse seulement');
    assert(/Gasoil/.test(byEmp(11)) && /Bidon cassé/.test(byEmp(11)) && !/Écart de caisse/.test(byEmp(11)), 'Awa : son stock et son anomalie');
    assert.strictEqual(DB.actions.filter(a => a.employee_id === 3).length, 0, 'Fanta : rien');
  });
  await check('un employé sans compte est journalisé mais ne reçoit pas de message', async () => {
    reset(); DB.gapRows = [{ id: 60, employee_id: 3, kind: 'caisse', amount: -100, product: null }]; DB.anomalyRows = []; await A.afterClose(asUser(1), 5, 12);
    assert.strictEqual(DB.actions.length, 1); assert.strictEqual(sent.length, 0); assert.strictEqual(DB.actions[0].notified_at, null);
  });
  await check('historique : l\'employé voit le sien (et peut rejeter) ; un collègue non ; le gérant oui (sans pouvoir rejeter à sa place)', async () => {
    reset(); DB.gapRows = [{ id: 50, employee_id: 1, kind: 'caisse', amount: -2500, product: null }]; DB.anomalyRows = []; await A.afterClose(asUser(1), 5, 12);
    let r = await call('get', '/hr/employees/:id/actions', { params: { id: 1 }, uid: 11 }); assert(!r.err && r.out.json.can_reject && r.out.json.actions.length === 1);
    r = await call('get', '/hr/employees/:id/actions', { params: { id: 1 }, uid: 12 }); assert.strictEqual(r.err.status, 403);
    r = await call('get', '/hr/employees/:id/actions', { params: { id: 1 }, uid: 1, perms: ['hr.view'] }); assert(!r.err && !r.out.json.can_reject);
  });
  await check('rejet : l\'action n\'est PAS supprimée, elle porte le rejet et son motif ; l\'écart passe « contesté » ; le gérant est prévenu', async () => {
    const id = DB.actions[0].id; sent.length = 0;
    const r = await call('post', '/hr/actions/:id/reject', { params: { id }, body: { reason: 'Je n\'étais pas à la caisse à ce moment' }, uid: 11 });
    assert(!r.err, r.err && r.err.message); assert.strictEqual(DB.actions.length, 1, 'rien n\'est supprimé');
    assert.strictEqual(DB.actions[0].status, 'rejete'); assert(/pas à la caisse/.test(DB.actions[0].rejected_reason));
    assert.strictEqual(DB.gaps[0].status, 'conteste'); assert.strictEqual(DB.events.length, 1);
    assert(sent.length === 1 && sent[0].userIds.includes(1) && /rejette/.test(sent[0].body));
  });
  await check('rejet refusé : par un collègue (403), deux fois (409), sur sa propre action (409), sans motif (400)', async () => {
    reset(); DB.sale = { id: 40, employee_id: 1, total: 10, customer: null, credit: 0 }; await A.afterSale(asUser(1), 40); const id = DB.actions[0].id;
    let r = await call('post', '/hr/actions/:id/reject', { params: { id }, body: { reason: 'pas moi' }, uid: 12 }); assert.strictEqual(r.err.status, 403);
    r = await call('post', '/hr/actions/:id/reject', { params: { id }, body: { reason: 'x' }, uid: 11 }); assert.strictEqual(r.err.status, 400);
    r = await call('post', '/hr/actions/:id/reject', { params: { id }, body: { reason: 'pas moi' }, uid: 11 }); assert(!r.err);
    r = await call('post', '/hr/actions/:id/reject', { params: { id }, body: { reason: 'encore' }, uid: 11 }); assert.strictEqual(r.err.status, 409);
    DB.sale = { id: 41, employee_id: 1, total: 5, customer: 'C', credit: 5 }; await A.afterSale(asUser(11), 41); const mine = DB.actions.find(a => a.ref_id === 41);
    r = await call('post', '/hr/actions/:id/reject', { params: { id: mine.id }, body: { reason: 'je l\'ai faite' }, uid: 11 }); assert.strictEqual(r.err.status, 409);
  });
  await check('réponse du gérant à un rejet : réservée aux responsables, l\'employé est prévenu', async () => {
    const rej = DB.actions.find(a => a.status === 'rejete'); sent.length = 0;
    let r = await call('post', '/hr/actions/:id/review', { params: { id: rej.id }, body: { note: 'Erreur de saisie, corrigée' }, uid: 12, perms: [] }); assert.strictEqual(r.err.status, 403);
    r = await call('post', '/hr/actions/:id/review', { params: { id: rej.id }, body: { note: 'Erreur de saisie, corrigée' }, uid: 1, perms: ['hr.gaps'] });
    assert(!r.err && rej.review_note === 'Erreur de saisie, corrigée'); assert(sent.some(m => m.userIds[0] === 11 && /Réponse à votre rejet/.test(m.body)));
    const active = DB.actions.find(a => a.status === 'actif'); r = await call('post', '/hr/actions/:id/review', { params: { id: active.id }, body: { note: 'ok merci' }, uid: 1, perms: ['hr.gaps'] }); assert.strictEqual(r.err.status, 409);
  });
  await check('dettes clients de l\'employé : statut ouverte / partielle / soldée / annulée, restant dû', async () => {
    const r = await call('get', '/hr/employees/:id/customer-debts', { params: { id: 1 }, uid: 11 });
    assert.deepStrictEqual(r.out.json.items.map(x => [x.status, x.remaining]), [['ouverte', 100000], ['partielle', 60000], ['soldée', 0], ['annulée', 0]]);
    const bad = await call('get', '/hr/employees/:id/customer-debts', { params: { id: 1 }, uid: 12 }); assert.strictEqual(bad.err.status, 403);
  });
  console.log(`\n${n}/11 contrôles réussis.`);
})().catch(e => { console.error('✘', e); process.exit(1); });
