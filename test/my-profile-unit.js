'use strict';
// Profil personnel : le vrai code de src/my_profile.js et src/activity_log.js est exécuté (base, express et rendu PDF simulés).
const assert = require('assert'); const Module = require('module');
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const calls = [], audits = [];
const pool = { query: async () => ({ rows: [] }) };
const core = { pool, HttpError, wrap: fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next), audit: async (c, req, mod, action) => { audits.push({ mod, action }); } };
const routes = {};
function Router() { const add = m => (p, ...hs) => { routes[m.toUpperCase() + ' ' + p] = hs[hs.length - 1]; }; return { get: add('get'), post: add('post'), use() {} }; }
const built = {};
const docs = {
  branding: async () => ({ name: 'Station Test', currency: 'FCFA' }), fmtDate: d => String(d),
  buildPdf: async o => { built.pdf = o; return Buffer.from('pdf'); }, buildXlsx: async o => { built.xlsx = o; return Buffer.from('xlsx'); },
  send: (res, fmt, buf, name) => { res.sent = { fmt, name }; }
};
const stubs = { './core': core, './docs': docs, express: { Router } };
const realLoad = Module._load;
Module._load = function (request, parent) { if (parent && /src[\\/](my_profile|activity_log)\.js$/.test(parent.filename) && Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request]; return realLoad.apply(this, arguments); };
const mp = require('../src/my_profile.js'); const al = require('../src/activity_log.js');
let n = 0; const check = async (l, fn) => { await fn(); n++; console.log('✔ ' + l); };
const mkRes = () => ({ body: null, json(b) { this.body = b; return this; }, set() { return this; } });
const run = async (key, req) => { const res = mkRes(); let err = null; await routes[key](req, res, e => { err = e; }); if (err) throw err; return res; };
const baseReq = (over = {}) => ({ user: { id: 11, login: 'awa', role: 'POMPISTE', perms: new Set(['sale.create']), is_global: false }, sid: 5, sessionId: 's1', query: {}, ...over });

(async () => {
  await check('describe : libellé, module, route normalisée et identifiant visé', () => {
    const d = al.describe('POST', '/api/sales/12/cancel?x=1');
    assert.deepStrictEqual([d.route, d.module, d.label, d.recordId, d.skip], ['/sales/:id/cancel', 'Ventes', 'Annulation · Ventes', 12, false]);
    const e = al.describe('DELETE', '/api/customers/5');
    assert.deepStrictEqual([e.route, e.label, e.recordId], ['/customers/:id', 'Suppression · Clients', 5]);
    const g = al.describe('PUT', '/api/hr/employees/7');
    assert.strictEqual(g.module, 'Ressources humaines'); assert.match(g.label, /^Modification · Ressources humaines \(employees\)$/);
    assert.strictEqual(al.describe('POST', '/api/shifts/uuid-less').recordId, null);
  });
  await check('describe : routes de bruit jamais journalisées, jamais de corps de requête', () => {
    for (const p of ['/api/auth/login', '/api/me/profile/activity/export', '/api/me/preferences/theme', '/api/messaging/presence/ping']) assert.strictEqual(al.describe('POST', p).skip, true, p);
    assert.strictEqual(al.describe('POST', '/api/sales').skip, false);
    const src = require('fs').readFileSync('src/activity_log.js', 'utf8');
    assert(!/req\.body/.test(src), 'le middleware ne lit jamais req.body');
  });
  await check('middleware : n’écrit que les POST/PUT/PATCH/DELETE réussis, avec nom et matricule', async () => {
    const rows = []; pool.query = async (sql, p) => {
      if (/FROM users u WHERE u\.id = \$1/.test(sql.replace(/\s+/g, ' '))) return { rows: [{ name: 'Awa Traoré', matricule: 'EMP-007' }] };
      if (/^\s*INSERT INTO user_activity_log/.test(sql)) { rows.push(p); return { rows: [] }; } return { rows: [] };
    };
    const mk = (method, status, url) => { let fin; const res = { statusCode: status, on: (e, fn) => { if (e === 'finish') fin = fn; } }; const req = { method, originalUrl: url, user: { id: 11, login: 'awa', role: 'POMPISTE' }, sid: 5, ip: '10.0.0.2' }; al.middleware(req, res, () => {}); return fin; };
    mk('GET', 200, '/api/sales')?.(); const bad = mk('POST', 403, '/api/sales'); bad && bad(); const ok = mk('POST', 201, '/api/sales'); ok();
    await new Promise(r => setTimeout(r, 20));
    assert.strictEqual(rows.length, 1);
    const [station, uid, login, name, mat, role, method, route, module, label] = rows[0];
    assert.deepStrictEqual([station, uid, login, name, mat, role, method, route, module, label], [5, 11, 'awa', 'Awa Traoré', 'EMP-007', 'POMPISTE', 'POST', '/sales', 'Ventes', 'Création · Ventes']);
  });
  await check('FOCUS : le poste détermine les indicateurs mis en avant', () => {
    assert.strictEqual(mp.FOCUS('POMPISTE', null), 'pompiste'); assert.strictEqual(mp.FOCUS('X', 'Caissière principale'), 'caissier');
    assert.strictEqual(mp.FOCUS('COMPTABLE', null), 'comptable'); assert.strictEqual(mp.FOCUS('ADMIN', null), 'admin'); assert.strictEqual(mp.FOCUS('CUSTOM', 'Chauffeur', new Set()), 'general');
  });
  await check('groupOf / periodDays', () => {
    assert.strictEqual(mp.groupOf('sale.create').label, 'Ventes'); assert.strictEqual(mp.groupOf('hr.payroll.close').label, 'Ressources humaines');
    assert.strictEqual(mp.periodDays('all'), 0); assert.strictEqual(mp.periodDays('7'), 7); assert.strictEqual(mp.periodDays('abc'), 30); assert.strictEqual(mp.periodDays('99999'), 3650);
  });
  await check('GET /me/profile : identité, matricule, rôle, station, connexions — sans module RH', async () => {
    pool.query = async (sql, p) => {
      const q = sql.replace(/\s+/g, ' ');
      if (/FROM users u JOIN roles r ON r\.id = u\.role_id WHERE u\.id = \$1/.test(q)) return { rows: [{ id: 11, login: 'awa', full_name: 'Awa Traoré', job_title: null, last_login_at: '2026-11-01', created_at: '2026-01-01', has_photo: false, logins: 12, role: 'POMPISTE', role_label: 'Pompiste', personal_user_id: null }] };
      if (/FROM employees e WHERE e\.user_id = \$1 AND e\.station_id = \$2/.test(q)) { assert.deepStrictEqual(p, [11, 5]); return { rows: [{ id: 3, matricule: 'EMP-007', first_name: 'Awa', last_name: 'Traoré', position: 'Pompiste', status: 'actif' }] }; }
      if (/FROM stations s JOIN user_stations/.test(q)) return { rows: [{ id: 5, name: 'Station Centre' }] };
      if (/FROM user_sessions/.test(q)) return { rows: [{ id: 's1', ip_address: '10.0.0.2', created_at: 'x', expires_at: 'y', revoked_at: null }] };
      return { rows: [] };
    };
    const { body } = await run('GET /me/profile', baseReq());
    assert.strictEqual(body.identity.matricule, 'EMP-007'); assert.strictEqual(body.identity.name, 'Awa Traoré'); assert.strictEqual(body.focus, 'pompiste');
    assert.strictEqual(body.sessions[0].current, true); assert(body.role_help.length >= 2); assert.match(body.traceability, /matricule/);
  });
  await check('GET /me/profile/permissions : liste effective groupée + droits retirés par la station', async () => {
    pool.query = async sql => {
      const q = sql.replace(/\s+/g, ' ');
      if (/FROM users u JOIN roles r/.test(q)) return { rows: [{ role_id: 2, code: 'POMPISTE', label: 'Pompiste', personal_user_id: 99 }] };
      if (/^SELECT code, label FROM permissions/.test(q)) return { rows: [{ code: 'sale.create', label: 'Enregistrer une vente' }, { code: 'sale.delete', label: 'Annuler une vente' }, { code: 'shift.open', label: 'Ouvrir un quart' }] };
      if (/FROM role_permissions rp/.test(q)) return { rows: [{ code: 'sale.create' }, { code: 'sale.delete' }] };
      return { rows: [] };
    };
    const { body } = await run('GET /me/profile/permissions', baseReq({ user: { id: 11, login: 'awa', role: 'POMPISTE', perms: new Set(['sale.create']) } }));
    assert.strictEqual(body.total, 1); assert.strictEqual(body.groups[0].label, 'Ventes'); assert.deepStrictEqual(body.restricted.map(x => x.code), ['sale.delete']);
    assert.strictEqual(body.role.personal, true); assert.match(body.note, /individuel/);
  });
  await check('journal : seules les données de l’utilisateur connecté (user_id = $1, employé = $3), 3 sources', () => {
    const sql = mp.journalSql().replace(/\s+/g, ' ');
    assert(/FROM user_activity_log l WHERE l\.user_id = \$1/.test(sql)); assert(/FROM audit_logs a WHERE a\.user_id = \$1/.test(sql)); assert(/WHERE ea\.employee_id = \$3::bigint/.test(sql));
    assert(!/\$1 IS NULL/.test(sql), 'jamais de filtre optionnel sur l’utilisateur');
  });
  await check('GET /me/profile/activity : paramètres bornés et résultat sans fuite', async () => {
    let got = null;
    pool.query = async (sql, p) => {
      const q = sql.replace(/\s+/g, ' ');
      if (/^SELECT COALESCE\(NULLIF\(TRIM\(full_name\)/.test(q)) return { rows: [{ name: 'Awa Traoré' }] };
      if (/FROM employees e WHERE e\.user_id/.test(q)) return { rows: [{ id: 3, matricule: 'EMP-007', position: 'Pompiste' }] };
      if (/WITH j AS/.test(q)) { got = p; return { rows: [{ source: 'trace', ref: 10, at: '2026-11-01T10:00:00Z', module: 'Ventes', action: 'Création · Ventes', detail: 'POST /sales', actor: 'Awa Traoré', matricule: 'EMP-007', ip: '10.0.0.2', amount: null, status: 'enregistré', can_reject: false, total_rows: 1 }] }; }
      return { rows: [] };
    };
    const { body } = await run('GET /me/profile/activity', baseReq({ query: { limit: '9999', offset: '-4', source: 'hack', from: '2026-10-01', to: 'nope' } }));
    assert.strictEqual(got[0], 11); assert.strictEqual(got[1], 5); assert.strictEqual(got[2], 3); assert.strictEqual(got[3], '2026-10-01'); assert.strictEqual(got[5], '');   // source inconnue ignorée
    assert.strictEqual(got[8], 200); assert.strictEqual(got[9], 0); assert.strictEqual(body.total, 1); assert.strictEqual(body.items[0].ref, '10'); assert(!('total_rows' in body.items[0]));
  });
  await check('export PDF / Excel : nom + matricule dans l’en-tête, export lui-même audité, format contrôlé', async () => {
    pool.query = async sql => {
      const q = sql.replace(/\s+/g, ' ');
      if (/^SELECT COALESCE\(NULLIF\(TRIM\(full_name\)/.test(q)) return { rows: [{ name: 'Awa Traoré' }] };
      if (/FROM employees e WHERE e\.user_id/.test(q)) return { rows: [{ id: 3, matricule: 'EMP-007', position: 'Pompiste' }] };
      if (/WITH j AS/.test(q)) return { rows: [{ source: 'a_mon_nom', ref: 4, at: '2026-11-01T10:00:00Z', module: 'Fait à mon nom', action: 'Vente N° 9', detail: null, actor: 'Gérant', matricule: 'EMP-001', ip: null, amount: 5000, status: 'fait par un tiers', can_reject: true, total_rows: 1 }] };
      return { rows: [] };
    };
    const r1 = await run('GET /me/profile/activity/export', baseReq({ query: { format: 'pdf' } }));
    assert.strictEqual(r1.sent.fmt, 'pdf'); assert.match(built.pdf.subtitle, /Awa Traoré · matricule EMP-007/); assert.match(r1.sent.name, /^PROFIL-EMP-007-/);
    assert.deepStrictEqual(built.pdf.sections[0].head.slice(5, 7), ['Auteur', 'Matricule']); assert.strictEqual(built.pdf.sections[0].rows[0][5], 'Gérant'); assert.strictEqual(built.pdf.sections[0].rows[0][6], 'EMP-001');
    const r2 = await run('GET /me/profile/activity/export', baseReq({ query: { format: 'xlsx' } })); assert.strictEqual(r2.sent.fmt, 'xlsx'); assert.strictEqual(built.xlsx.sheets[0].rows.length, 1);
    assert.strictEqual(audits.length, 2); assert.match(audits[0].action, /Export de mon journal/);
    await assert.rejects(run('GET /me/profile/activity/export', baseReq({ query: { format: 'csv' } })), /format=pdf\|xlsx/);
    await assert.rejects(run('GET /me/profile/activity/export', baseReq({ sid: null, query: { format: 'pdf' } })), /station/);
  });
  await check('summary : un bloc en erreur n’empêche pas les autres', async () => {
    pool.query = async sql => {
      const q = sql.replace(/\s+/g, ' ');
      if (/FROM employees e WHERE e\.user_id/.test(q)) return { rows: [{ id: 3, matricule: 'EMP-007', position: 'Pompiste' }] };
      if (/FROM sales s WHERE/.test(q)) throw new Error('colonne absente');
      if (/FROM user_activity_log/.test(q)) return { rows: [{ n: 4, last_at: 'x', since: 'y', module: 'Ventes', d: '2026-11-01', h: 9 }] };
      return { rows: [{ n: 0, total: 0, cancelled: 0, as_manager: 0, closed: 0, worked: 0, in_n: 0, in_total: 0, out_n: 0, out_total: 0, credit: 0 }] };
    };
    const { body } = await run('GET /me/profile/summary', baseReq({ query: { days: '30' } }));
    assert.strictEqual(body.sales, null); assert(body.activity && body.activity.total === 4); assert(body.shifts !== null);
  });
  console.log(`\n${n} contrôles réussis`);
})().catch(e => { console.error('✘', e); process.exit(1); });
