'use strict';
// Partage du rapport de quart (e-mail + WhatsApp) : le vrai code de src/finance.js est exécuté avec une base,
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
const docs = { branding: async () => ({ currency: 'FCFA' }), buildPdf: async () => Buffer.from('%PDF-1.4 test'), send() {}, cellText: v => String(v ?? ''), fmtDate: d => new Date(d).toISOString().slice(0, 16).replace('T', ' ') };
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

// ----- Base simulée -----
const DB = { audits: [], station: { name: 'Station Test', email: 'station@example.com', phone: '+223 70 00 00 00' }, emps: [], closer: null, report: true, shift: true };
pool.query = async (sql, params) => {
  if (/FROM shifts sh JOIN users u/.test(sql)) return { rows: DB.shift ? [{ id: 5, number: 12, kind: 'jour', opened_at: new Date('2026-10-24T06:00:00Z'), closed_at: new Date('2026-10-24T14:00:00Z'), closed_by: DB.closer ? 9 : null, gap_justification: 'RAS', observations: 'Aucune', manager: 'gerant', closer_login: 'clot' }] : [] };
  if (/FROM reports WHERE shift_id/.test(sql)) return { rows: DB.report ? [{ content: { fuel_total: 100000, other_sales: { total: 5000, by_method: [] }, fuel_payments: { especes: 60000, mobile_money: 30000, carte: 0, credit: 10000 }, cash: { opening: 0, theoretical: 65000, counted: 64000, gap: -1000 }, counters: [{ pump: 'P1', counter: 'A', product: 'Gasoil', index_start: 10, index_end: 20, liters: 10, unit_price: 700, amount: 7000 }], stock: [], anomalies: [] } }] : [] };
  if (/AS n FROM shift_employees se JOIN employees e/.test(sql)) return { rows: DB.emps.map(e => ({ n: e.name })) };
  if (/FROM stations WHERE id/.test(sql)) return { rows: [DB.station] };
  if (/FROM employees e\s+WHERE e\.station_id/.test(sql)) { assert(/shift_employees/.test(sql) && /sa\.status = 'valide'/.test(sql), 'employés affectés OU ventes valides'); assert.strictEqual(params[1], 77, 'filtré sur la station courante'); return { rows: DB.emps }; }
  if (/WHERE e\.user_id = \$1/.test(sql)) return { rows: DB.closer ? [DB.closer] : [] };
  if (/INSERT INTO audit_logs/.test(sql)) { DB.audits.push(params); return { rows: [] }; }
  throw new Error('requête inattendue : ' + sql.slice(0, 80));
};
const sent = [];
mailer.sendMail = async m => { sent.push(m); return {}; };

const finance = require(path.join(__dirname, '..', 'src', 'finance.js'));
const find = (method, path) => { const l = finance.stack.find(x => x.route && x.route.path === path && x.route.methods[method]); assert(l, 'route absente : ' + path); return l.route.stack; };
async function call(method, path, { params = { id: '5' }, body = {}, perms = ['shift.close'] } = {}) {
  const req = { params, body, sid: 77, ip: '127.0.0.1', user: { id: 1, perms: new Set(perms) }, headers: {}, query: {} };
  let out = { status: 200, json: null }, err = null;
  const res = { status(c) { out.status = c; return this; }, json(j) { out.json = j; return this; } };
  for (const h of find(method, path)) {
    await new Promise(resolve => { let done = false; const next = e => { if (e) err = e; if (!done) { done = true; resolve(); } };
      try { const r = h.handle(req, res, next); if (r && r.then) r.then(() => { if (!done) { done = true; resolve(); } }, next); } catch (e) { err = e; resolve(); } });
    if (err) break;
    if (out.json) break;
  }
  return { out, err };
}
const reset = () => { sent.length = 0; DB.audits.length = 0; DB.report = true; DB.shift = true; DB.station = { name: 'Station Test', email: 'station@example.com', phone: '+223 70 00 00 00' }; DB.closer = null; DB.emps = []; };

(async () => {
  await check('permission requise (403 sans droit)', async () => { reset(); const { err } = await call('post', '/shifts/:id/report-email', { body: { mode: 'employees' }, perms: [] }); assert(err && err.status === 403); });
  await check('mode invalide refusé (400)', async () => { reset(); const { err } = await call('post', '/shifts/:id/report-email', { body: { mode: 'tous' } }); assert(err && /400|invalid|Données|invalide/i.test(String(err.status) + err.message)); });
  await check('quart introuvable (404) et quart non clôturé (409)', async () => {
    reset(); DB.shift = false; let r = await call('post', '/shifts/:id/report-email', { body: { mode: 'employees' } }); assert.strictEqual(r.err.status, 404);
    reset(); DB.report = false; r = await call('post', '/shifts/:id/report-email', { body: { mode: 'employees' } }); assert.strictEqual(r.err.status, 409);
  });
  await check('e-mail aux employés : adresses individuelles, dédoublonnées, invalides ignorées, PDF joint, un e-mail par personne', async () => {
    reset(); DB.emps = [{ id: 1, name: 'Awa Traoré', email: 'Awa@Example.com', phone: '' }, { id: 2, name: 'Doublon', email: 'awa@example.com', phone: '' }, { id: 3, name: 'Sans', email: 'pas-un-mail', phone: '' }, { id: 4, name: 'Bako', email: 'bako@example.com', phone: '' }];
    const { out, err } = await call('post', '/shifts/:id/report-email', { body: { mode: 'employees' } });
    assert(!err, err && err.message); assert.deepStrictEqual(out.json.sent_to, ['awa@example.com', 'bako@example.com']); assert.strictEqual(out.json.fallback_company, false);
    assert.strictEqual(sent.length, 2); assert(sent.every(m => typeof m.to === 'string' && !m.to.includes(',')));
    const a = sent[0].attachments[0]; assert.strictEqual(a.contentType, 'application/pdf'); assert.strictEqual(a.filename, 'quart-12.pdf'); assert(Buffer.isBuffer(a.content) && a.content.toString().startsWith('%PDF'));
    assert.strictEqual(DB.audits.length, 1, 'envoi inscrit dans le journal d’audit'); assert(/Envoi e-mail du rapport de quart 000012/.test(DB.audits[0][3]));
  });
  await check('repli e-mail entreprise seulement si aucune adresse individuelle', async () => {
    reset(); DB.emps = [{ id: 1, name: 'Sans mail', email: null, phone: '' }];
    const { out } = await call('post', '/shifts/:id/report-email', { body: { mode: 'employees' } });
    assert.deepStrictEqual(out.json.sent_to, ['station@example.com']); assert.strictEqual(out.json.fallback_company, true);
  });
  await check('aucune adresse : erreur explicite 422, rien d’envoyé', async () => {
    reset(); DB.station.email = ''; DB.emps = [{ id: 1, name: 'Sans mail', email: '', phone: '' }];
    const { err } = await call('post', '/shifts/:id/report-email', { body: { mode: 'employees' } });
    assert.strictEqual(err.status, 422); assert(/Paramètres > Station/.test(err.message)); assert.strictEqual(sent.length, 0);
  });
  await check('e-mail au clôturant : fiche employé liée, sinon repli entreprise', async () => {
    reset(); DB.closer = { id: 8, name: 'Moussa Keita', email: 'moussa@example.com', phone: '+22370112233' };
    let r = await call('post', '/shifts/:id/report-email', { body: { mode: 'closer' } }); assert.deepStrictEqual(r.out.json.sent_to, ['moussa@example.com']);
    reset(); r = await call('post', '/shifts/:id/report-email', { body: { mode: 'closer' } }); assert.deepStrictEqual(r.out.json.sent_to, ['station@example.com']); assert.strictEqual(r.out.json.fallback_company, true);
  });
  await check('SMTP non configuré (501) : propagé tel quel, rien n’est dit « envoyé »', async () => {
    reset(); DB.emps = [{ id: 1, name: 'A', email: 'a@example.com', phone: '' }];
    mailer.sendMail = async () => { const e = new Error('Email non configuré'); e.status = 501; throw e; };
    const { err, out } = await call('post', '/shifts/:id/report-email', { body: { mode: 'employees' } }); assert.strictEqual(err.status, 501); assert(!out.json);
    mailer.sendMail = async m => { sent.push(m); return {}; };
  });
  await check('échec partiel : les envois réussis sont rapportés, les échecs listés', async () => {
    reset(); DB.emps = [{ id: 1, name: 'A', email: 'a@example.com', phone: '' }, { id: 2, name: 'B', email: 'b@example.com', phone: '' }];
    mailer.sendMail = async m => { if (m.to === 'b@example.com') { const e = new Error('boîte pleine'); e.status = 502; throw e; } sent.push(m); return {}; };
    const { out } = await call('post', '/shifts/:id/report-email', { body: { mode: 'employees' } }); assert.deepStrictEqual(out.json.sent_to, ['a@example.com']); assert.strictEqual(out.json.failed[0].email, 'b@example.com');
    mailer.sendMail = async m => { sent.push(m); return {}; };
  });
  await check('coordonnées WhatsApp : tous les employés concernés, numéros normalisés, sans indicatif signalé', async () => {
    reset(); DB.closer = { id: 8, name: 'Moussa Keita', email: null, phone: '0022370112233' };
    DB.emps = [{ id: 1, name: 'A', email: 'a@example.com', phone: '+223 70 11 22 33' }, { id: 2, name: 'B', email: null, phone: '70112233' }, { id: 3, name: 'C', email: null, phone: null }];
    const { out } = await call('get', '/shifts/:id/report-contacts'); const j = out.json;
    assert.deepStrictEqual(j.employees.map(e => e.whatsapp), ['22370112233', '22370112233', null]); assert.strictEqual(j.closer.whatsapp, '22370112233'); assert.strictEqual(j.station.whatsapp, '22370000000');
    assert.strictEqual(j.employees[1].phone, '70112233', 'numéro local à 8 chiffres : +223 ajouté automatiquement');
  });
  await check('message WhatsApp : dates, carburant, autres ventes, compteurs, paiements, caisse, observations, justification', async () => {
    reset(); const { out } = await call('get', '/shifts/:id/report-contacts'); const m = out.json.message;
    for (const k of [/Rapport de quart 000012/, /Ouverture :/, /Fermeture :/, /Carburant \(compteurs\)/, /Autres produits/, /P1 \/ A \(Gasoil\)/, /Espèces/, /Mobile money/, /Théorique/, /Comptée/, /Écart/, /Justification des écarts : RAS/, /Observations : Aucune/]) assert(k.test(m), 'manque ' + k);
  });
  console.log(`\n${n}/11 contrôles réussis.`); process.exit(0);
})().catch(e => { console.error('✘', e); process.exit(1); });
