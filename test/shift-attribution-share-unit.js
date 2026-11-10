'use strict';
// Quart PARTAGÉ : e-mail / WhatsApp / PDF propres à chaque employé. Le vrai code de src/finance.js est exécuté avec une base,
// un serveur Express et un envoi d'e-mails simulés (aucune connexion PostgreSQL ni SMTP, aucune dépendance sauf zod).
const assert = require('assert');
const Module = require('module');
const path = require('path');

class HttpError extends Error { constructor(status, message, details) { super(message); this.status = status; this.details = details; } }
const pool = { query: async () => { throw new Error('requête non simulée'); } };
const core = {
  pool, HttpError, tx: async fn => fn(pool), fl: x => Math.round((+x || 0) * 100) / 100,
  wrap: fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next),
  body: schema => (req, res, next) => { const r = schema.safeParse(req.body); if (!r.success) return next(new HttpError(400, 'Données invalides')); req.body = r.data; next(); },
  need: (...codes) => (req, res, next) => codes.some(c => req.user.perms.has(c)) ? next() : next(new HttpError(403, 'Permission refusée : ' + codes.join(' ou '))),
  audit: (c, req, module, action, table, recId, oldV, newV) => c.query('INSERT INTO audit_logs(station_id, user_id, module, action, table_name, record_id, old_value, new_value, ip_address)', [req.sid, req.user.id, module, action, table, recId, oldV, newV, req.ip]),
  cashMove() {}, defaultReg() {}, recordFinancialEvent() {}, settle() {}
};
const built = [];
const docs = { branding: async () => ({ currency: 'FCFA' }), buildPdf: async a => { built.push(a); return Buffer.from('%PDF-1.4 ' + a.ref); }, send() {}, cellText: v => String(v ?? ''), fmtDate: d => new Date(d).toISOString().slice(0, 16).replace('T', ' ') };
const mailer = { sendMail: async () => ({}) };
function Router() {
  const stack = [];
  const add = m => (p, ...hs) => { stack.push({ route: { path: p, methods: { [m]: true }, stack: hs.map(h => ({ handle: h })) } }); };
  return { stack, get: add('get'), post: add('post'), put: add('put'), patch: add('patch'), delete: add('delete'), use() {} };
}
const stubs = { './core': core, './admin': { getSetting: async () => null }, './docs': docs, './mailer': mailer, express: { Router } };
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (parent && /src[\\/]finance\.js$/.test(parent.filename) && Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
  return realLoad.apply(this, arguments);
};

let n = 0;
async function check(label, fn) { await fn(); n++; console.log('✔ ' + label); }


// ----- Rapport d'un quart partagé par Awa (pompes P1+P2), Moussa (pompe P3) et Fanta (caisse) -----
const REPORT = {
  shift: { id: 5, number: 12, kind: 'jour' }, shared: true, fuel_total: 165000, other_sales: { total: 5000, by_method: [] },
  fuel_payments: { especes: 155000, mobile_money: 10000, carte: 0, credit: 0 }, fuel_declared: { total: 40000, undeclared: 125000, by_method: [] },
  cash: { opening: 20000, theoretical: 190000, counted: 187500, gap: -2500 }, stock: [{ product: 'Gasoil', theoretical: 1000, physical: 991, gap: -9 }],
  counters: [
    { pump: 'P1', counter: 'A', product: 'Gasoil', index_start: 0, index_end: 100, liters: 100, unit_price: 700, amount: 70000 },
    { pump: 'P2', counter: 'A', product: 'Gasoil', index_start: 0, index_end: 50, liters: 50, unit_price: 700, amount: 35000 },
    { pump: 'P3', counter: 'A', product: 'Super', index_start: 0, index_end: 80, liters: 80, unit_price: 750, amount: 60000 }],
  employees: [
    { employee_id: 1, name: 'Awa Traoré', pumps: ['P1', 'P2'], fuel_liters: 150, fuel_amount: 105000, declared_fuel: 40000, undeclared: 65000, non_cash: { mobile_money: 0, card: 0, credit: 0 }, cash_declared: 40000, expected_cash: 105000, counted_cash: 105000, cash_gap: 0, stock_gaps: [{ product: 'Gasoil', amount: -3 }] },
    { employee_id: 2, name: 'Moussa Keita', pumps: ['P3'], fuel_liters: 80, fuel_amount: 60000, declared_fuel: 0, undeclared: 60000, non_cash: { mobile_money: 10000, card: 0, credit: 0 }, cash_declared: 0, expected_cash: 50000, counted_cash: 47500, cash_gap: -2500, stock_gaps: [{ product: 'Gasoil ', amount: -6.004 }] },
    { employee_id: 3, name: 'Fanta Diarra', pumps: [], fuel_liters: 0, fuel_amount: 0, declared_fuel: 0, undeclared: 0, non_cash: { mobile_money: 0, card: 0, credit: 0 }, cash_declared: 5000, expected_cash: 5000, counted_cash: 5000, cash_gap: 0, stock_gaps: [] }],
  unassigned: { cash_gap: 0, fuel_amount: 0, stock_gaps: [] },
  anomalies: [
    { kind: 'ecart_stock', description: 'Écart de stock Gasoil  imputé à Moussa Keita : -6.004', amount: -6.004, employee_id: 2, employee: 'Moussa Keita' },
    { kind: 'ecart_caisse', description: 'Écart de caisse de Moussa Keita : -2500', amount: -2500, employee_id: 2, employee: 'Moussa Keita' },
    { kind: 'ecart_caisse', description: 'Écart de caisse : -2500 (ensemble du quart)', amount: -2500, employee_id: null, employee: null },
    { kind: 'ecart_caisse', description: 'Écart de caisse de Moussa Keita : -2500', amount: -2500, employee_id: 2, employee: 'Moussa Keita' },
    { kind: 'autre', description: 'Bidon cassé à la pompe 1', amount: null, employee_id: 1, employee: 'Awa Traoré' }],
};
const DB = { audits: [], station: { name: 'Station Test', email: 'station@example.com', phone: '+223 70 00 00 00' }, emps: [], closer: null };
pool.query = async (sql, params) => {
  if (/FROM shifts sh JOIN users u/.test(sql)) return { rows: [{ id: 5, number: 12, kind: 'jour', opened_at: new Date('2026-11-01T06:00:00Z'), closed_at: new Date('2026-11-01T14:00:00Z'), closed_by: DB.closer ? 8 : null, gap_justification: 'Erreur de rendu de monnaie', observations: 'RAS', manager: 'gerant', closer_login: 'gerant', closer: 'gerant' }] };
  if (/FROM reports WHERE shift_id/.test(sql)) return { rows: [{ content: REPORT }] };
  if (/AS n FROM shift_employees se JOIN employees e/.test(sql)) return { rows: REPORT.employees.map(e => ({ n: e.name })) };
  if (/FROM stations WHERE id/.test(sql)) return { rows: [DB.station] };
  if (/FROM employees e\s+WHERE e\.station_id/.test(sql)) return { rows: DB.emps };
  if (/WHERE e\.user_id = \$1/.test(sql)) return { rows: DB.closer ? [DB.closer] : [] };
  if (/INSERT INTO audit_logs/.test(sql)) { DB.audits.push(params); return { rows: [] }; }
  throw new Error('requête inattendue : ' + sql.slice(0, 80));
};
const sent = [];
mailer.sendMail = async m => { sent.push(m); return {}; };
const finance = require(path.join(__dirname, '..', 'src', 'finance.js'));
const find = (method, p) => { const l = finance.stack.find(x => x.route && x.route.path === p && x.route.methods[method]); assert(l, 'route absente : ' + p); return l.route.stack; };
async function call(method, p, { params = { id: '5' }, body = {}, perms = ['shift.close'] } = {}) {
  const req = { params, body, sid: 77, ip: '127.0.0.1', user: { id: 1, perms: new Set(perms) }, headers: {}, query: {} };
  let out = { status: 200, json: null }, err = null;
  const res = { status(c) { out.status = c; return this; }, json(j) { out.json = j; return this; } };
  for (const h of find(method, p)) {
    await new Promise(resolve => { let done = false; const next = e => { if (e) err = e; if (!done) { done = true; resolve(); } };
      try { const r = h.handle(req, res, next); if (r && r.then) r.then(() => { if (!done) { done = true; resolve(); } }, next); } catch (e) { err = e; resolve(); } });
    if (err) break; if (out.json) break;
  }
  return { out, err };
}
const reset = () => { sent.length = 0; built.length = 0; DB.audits.length = 0; DB.closer = null;
  DB.emps = [{ id: 1, name: 'Awa Traoré', email: 'awa@example.com', phone: '+223 70 11 22 33' }, { id: 2, name: 'Moussa Keita', email: 'moussa@example.com', phone: '70445566' }, { id: 3, name: 'Fanta Diarra', email: 'fanta@example.com', phone: null }, { id: 9, name: 'Sans situation', email: 'x@example.com', phone: null }]; };
const dump = o => JSON.stringify(o);

(async () => {
  await check('e-mail aux employés : chaque employé reçoit SON PDF, un par personne, nommé par employé', async () => {
    reset(); const { out, err } = await call('post', '/shifts/:id/report-email', { body: { mode: 'employees' } });
    assert(!err, err && err.message); assert.deepStrictEqual(out.json.sent_to.sort(), ['awa@example.com', 'fanta@example.com', 'moussa@example.com']);
    assert.strictEqual(sent.length, 3); assert(!sent.some(m => m.to === 'x@example.com'), "un employé sans situation sur le quart ne reçoit rien");
    const names = sent.map(m => m.attachments[0].filename).sort(); assert.deepStrictEqual(names, ['quart-12-employe-1.pdf', 'quart-12-employe-2.pdf', 'quart-12-employe-3.pdf']);
    assert(sent.every(m => /votre situation personnelle/.test(m.text)));
  });
  await check("le PDF d'Awa ne contient rien sur Moussa ni sur Fanta (et inversement)", async () => {
    reset(); await call('post', '/shifts/:id/report-email', { body: { mode: 'employees' } });
    const personal = built.filter(b => /-E\d$/.test(b.ref));
    assert.strictEqual(personal.length, 3);
    const awa = dump(personal.find(b => b.ref.endsWith('-E1')).sections), moussa = dump(personal.find(b => b.ref.endsWith('-E2')).sections);
    assert(awa.includes('Awa Traoré') && !/Moussa|Fanta|P3|47500|-2500/.test(awa), 'Awa ne voit que sa situation');
    assert(moussa.includes('Moussa Keita') && !/Awa|Fanta|P1|P2/.test(moussa), 'Moussa ne voit que sa situation');
    assert(moussa.includes('-2500') && moussa.includes('Bidon') === false, "l'écart de Moussa figure chez Moussa, l'anomalie d'Awa chez Awa");
    assert(awa.includes('Bidon cassé'), "l'anomalie déclarée d'Awa figure chez Awa");
    assert(!/Erreur de rendu de monnaie/.test(awa + moussa), 'la justification commune du quart ne fuite pas dans les états individuels');
  });
  await check('mode « employee » : un seul employé, son PDF seulement ; employé étranger au quart refusé (404)', async () => {
    reset(); let r = await call('post', '/shifts/:id/report-email', { body: { mode: 'employee', employee_id: 2 } });
    assert.deepStrictEqual(r.out.json.sent_to, ['moussa@example.com']); assert.strictEqual(sent.length, 1); assert(/employe-2\.pdf/.test(sent[0].attachments[0].filename));
    reset(); r = await call('post', '/shifts/:id/report-email', { body: { mode: 'employee', employee_id: 555 } }); assert.strictEqual(r.err.status, 404);
  });
  await check('clôturant : rapport COMPLET avec situation par employé et employé à l\'origine de chaque anomalie', async () => {
    reset(); DB.closer = { id: 8, name: 'Gérant', email: 'gerant@example.com', phone: '+22370999999' };
    const { out } = await call('post', '/shifts/:id/report-email', { body: { mode: 'closer' } });
    assert.deepStrictEqual(out.json.sent_to, ['gerant@example.com']); assert.strictEqual(sent[0].attachments[0].filename, 'quart-12.pdf');
    const full = built.find(b => b.ref === 'QRT-000012'); const all = dump(full.sections);
    assert(/Situation par employé/.test(all)); for (const nme of ['Awa Traoré', 'Moussa Keita', 'Fanta Diarra']) assert(all.includes(nme), nme + ' figure dans le rapport complet');
    const an = full.sections.find(s => /Anomalies détectées/.test(s.title)); assert.deepStrictEqual(an.head, ["Employé à l'origine", 'Description']);
    assert(an.rows.some(r => r[0] === 'Moussa Keita' && /Écart de caisse de Moussa/.test(r[1])) && an.rows.some(r => r[0] === 'Awa Traoré' && /Bidon/.test(r[1])) && an.rows.some(r => r[0] === 'Ensemble du quart'));
  });
  await check('WhatsApp : un message propre à chaque employé, le message complet pour le clôturant', async () => {
    reset(); DB.closer = { id: 8, name: 'Gérant', email: null, phone: '+22370999999' };
    const { out } = await call('get', '/shifts/:id/report-contacts'); const j = out.json;
    const byId = Object.fromEntries(j.employees.map(e => [e.id, e.message]));
    assert(/RAPPORT INDIVIDUEL DE FIN DE QUART/.test(byId[2]) && /Employé : Moussa Keita/.test(byId[2]) && /P3/.test(byId[2]) && /-2[\s\u202f\u00a0]?500/.test(byId[2]) && !/Awa|Fanta|P1|P2/.test(byId[2]), 'Moussa : sa situation seulement');
    assert(/Bidon cassé/.test(byId[1]) && !/Moussa|Fanta/.test(byId[1]), "Awa : son anomalie, rien sur les autres");
    assert(/Situation par employé/.test(j.message) && /Moussa Keita \(P3\)/.test(j.message) && /Awa Traoré/.test(j.message), 'message du clôturant : tous, avec le nom de l\'employé');
    assert(/Anomalies par employé/.test(j.message) && /Awa Traoré : Bidon cassé/.test(j.message));
  });
  await check('message du clôturant : écarts de stock = quantités sans devise (arrondies, noms nettoyés), pas de doublon ni de valeur brute, caisse en devise', async () => {
    reset(); const { out } = await call('get', '/shifts/:id/report-contacts'); const m = out.json.message;
    const emp = m.split('\n').find(l => /^- Moussa Keita/.test(l));
    assert(/écart de caisse -2[\s\u202f\u00a0]?500 [A-Z]+ ; écarts de stock Gasoil : -6( |$)/.test(emp) && !/Gasoil  /.test(m), emp);
    assert(!/-6[.,]004|-6\.0/.test(m), 'pas de valeur brute à 3 décimales');
    assert(!m.split('\n').some(l => /FCFA|XOF|CFA/.test((l.split(/écarts? de stock/i)[1]) || '')), 'aucune devise après « écarts de stock » (la partie caisse de la ligne peut en porter une)');
    const sec = m.split('Anomalies par employé :')[1] || ''; assert(!/Écart de (caisse|stock)/.test(sec), 'les écarts ne sont pas répétés dans les anomalies');
  });
  console.log(`\n${n}/6 contrôles réussis.`); process.exit(0);
})().catch(e => { console.error('✘', e); process.exit(1); });
