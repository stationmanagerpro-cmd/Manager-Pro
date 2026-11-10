'use strict';
// Rôle individuel par employé : le vrai code de src/employee_access.js est exécuté (base, serveur Express et contrat simulés).
const assert = require('assert');
const Module = require('module');
const path = require('path');
class HttpError extends Error { constructor(status, message, details) { super(message); this.status = status; this.details = details; } }
const pool = { query: async () => { throw new Error('requête non simulée'); } };
const core = { pool, HttpError, tx: async fn => fn(pool), wrap: fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next),
  body: schema => (req, res, next) => { const r = schema.safeParse(req.body); if (!r.success) return next(new HttpError(400, 'Données invalides')); req.body = r.data; next(); },
  need: (...codes) => (req, res, next) => codes.some(c => req.user.perms.has(c)) ? next() : next(new HttpError(403, 'Permission refusée')), audit: async (c, req, mod, action) => { DB.audits.push(action); } };
function Router() { const stack = []; const add = m => (p, ...hs) => { stack.push({ route: { path: p, methods: { [m]: true }, stack: hs.map(h => ({ handle: h })) } }); };
  return { stack, get: add('get'), post: add('post'), put: add('put'), patch: add('patch'), delete: add('delete'), use() {} }; }
const tracked = [];
const stubs = { './employee_actions': { track: async (q, d) => { tracked.push(d); } }, './core': core, './contracts': { loadContractForUser: async () => ({ suspended: false, can_manage_users: DB.contractOk }) }, express: { Router } };
const realLoad = Module._load;
Module._load = function (request, parent) {
  if (parent && /src[\\/](employee_access|roles_scope)\.js$/.test(parent.filename) && Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
  return realLoad.apply(this, arguments);
};
let n = 0; const check = async (l, fn) => { await fn(); n++; console.log('✔ ' + l); };

// Employés : Awa (id 1, user 11) et Moussa (id 2, user 12) sont tous deux CAISSIER. Fanta (id 3) n'a pas de compte.
const PERMS = { sale: { id: 1, code: 'sale.create', label: 'Vendre' }, cash: { id: 2, code: 'cash.manage', label: 'Caisse' }, exp: { id: 3, code: 'expense.create', label: 'Dépenses' }, um: { id: 4, code: 'user.manage', label: 'Utilisateurs' }, ra: { id: 5, code: 'role.assign', label: 'Rôles' }, fin: { id: 6, code: 'finance.view', label: 'Finances' } };
const DB = { audits: [], contractOk: true, roles: [], rolePerms: new Map(), users: new Map(), nextRole: 100 };
function reset() {
  DB.audits = []; DB.contractOk = true; DB.nextRole = 100;
  DB.roles = [{ id: 1, code: 'CAISSIER', label: 'Caissier', client_id: null, personal_user_id: null }, { id: 2, code: 'POMPISTE', label: 'Pompiste', client_id: null, personal_user_id: null }];
  DB.rolePerms = new Map([[1, ['sale.create', 'cash.manage']], [2, ['sale.create']]]);
  DB.users = new Map([[11, { id: 11, login: 'awa', active: true, is_global: false, client_id: 5, role_id: 1 }], [12, { id: 12, login: 'moussa', active: true, is_global: false, client_id: 5, role_id: 1 }]]);
}
const EMPS = { 1: { id: 1, user_id: 11, first_name: 'Awa', last_name: 'Traoré', position: 'Caissier' }, 2: { id: 2, user_id: 12, first_name: 'Moussa', last_name: 'Keita', position: 'Caissier' }, 3: { id: 3, user_id: null, first_name: 'Fanta', last_name: 'Diarra', position: 'Caissier' } };
const roleOf = id => DB.roles.find(r => r.id === id);
pool.query = async (sql, params) => {
  const q = sql.replace(/\s+/g, ' ');
  if (/^SELECT id, user_id, first_name, last_name, position FROM employees/.test(q)) return { rows: EMPS[params[0]] ? [EMPS[params[0]]] : [] };
  if (/FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = \$1/.test(q)) { const u = DB.users.get(params[0]); if (!u) return { rows: [] }; const r = roleOf(u.role_id); return { rows: [{ ...u, role_id: r.id, role: r.code, role_label: r.label, personal_user_id: r.personal_user_id }] }; }
  if (/^SELECT client_id FROM users WHERE id = \$1/.test(q)) return { rows: [{ client_id: 5 }] };
  if (/FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = \$1 ORDER BY p.code/.test(q)) return { rows: (DB.rolePerms.get(params[0]) || []).map(c => Object.values(PERMS).find(p => p.code === c)).sort((a, b) => a.code.localeCompare(b.code)) };
  if (/^SELECT code, label FROM permissions/.test(q)) return { rows: Object.values(PERMS).map(p => ({ code: p.code, label: p.label })) };
  if (/^SELECT id, code FROM permissions WHERE code = ANY/.test(q)) return { rows: Object.values(PERMS).filter(p => params[0].includes(p.code)).map(p => ({ id: p.id, code: p.code })) };
  if (/^SELECT id, code, label FROM roles WHERE personal_user_id = \$1/.test(q)) { const r = DB.roles.find(x => x.personal_user_id === params[0]); return { rows: r ? [r] : [] }; }
  if (/^INSERT INTO roles/.test(q)) { const r = { id: ++DB.nextRole, code: params[0], label: params[1], client_id: params[2], personal_user_id: params[3] }; DB.roles.push(r); return { rows: [r] }; }
  if (/^DELETE FROM role_permissions WHERE role_id/.test(q)) { DB.rolePerms.delete(params[0]); return { rows: [] }; }
  if (/^INSERT INTO role_permissions/.test(q)) { const l = DB.rolePerms.get(params[0]) || []; l.push(Object.values(PERMS).find(p => p.id === params[1]).code); DB.rolePerms.set(params[0], l); return { rows: [] }; }
  if (/^UPDATE users SET role_id/.test(q)) { DB.users.get(params[0]).role_id = params[1]; return { rows: [] }; }
  if (/^SELECT id, code, label FROM roles WHERE id = \$1 AND personal_user_id IS NULL/.test(q)) { const r = DB.roles.find(x => x.id === params[0] && x.personal_user_id == null); return { rows: r ? [r] : [] }; }
  if (/^DELETE FROM roles WHERE id/.test(q)) { DB.roles = DB.roles.filter(x => !(x.id === params[0] && x.personal_user_id === params[1])); return { rows: [] }; }
  if (/^SELECT id, code, client_id FROM roles WHERE code = \$1/.test(q)) { const r = DB.roles.find(x => x.code === params[0]); return { rows: r ? [r] : [] }; }
  if (/^SELECT p\.code FROM role_permissions rp JOIN permissions p ON p\.id = rp\.permission_id WHERE rp\.role_id = \$1$/.test(q)) return { rows: (DB.rolePerms.get(params[0]) || []).map(code => ({ code })) };
  throw new Error('requête inattendue : ' + q.slice(0, 120));
};
const router = require(path.join(__dirname, '..', 'src', 'employee_access.js'));
const find = (m, p) => router.stack.find(x => x.route.path === p && x.route.methods[m]).route.stack;
async function call(method, p, { params, body = {}, perms, role = 'ADMIN', uid = 1 }) {
  const req = { params, body, sid: 77, user: { id: uid, role, perms: new Set(perms) } }; const out = { json: null }; let err = null;
  const res = { status() { return this; }, json(j) { out.json = j; return this; } };
  for (const h of find(method, p)) { await new Promise(resolve => { let done = false; const next = e => { if (e) err = e; if (!done) { done = true; resolve(); } };
    try { const r = h.handle(req, res, next); if (r && r.then) r.then(() => { if (!done) { done = true; resolve(); } }, next); } catch (e) { err = e; resolve(); } }); if (err || out.json) break; }
  return { out, err };
}
const ADMIN = ['role.assign', 'user.manage', 'sale.create', 'cash.manage', 'expense.create', 'finance.view'];
const GERANT = ['role.assign', 'user.manage', 'sale.create', 'cash.manage', 'expense.create', 'finance.view'];
const EDIT = '/hr/employees/:id/personal-role', ACCESS = '/hr/employees/:id/access';

(async () => {
  await check('par défaut un caissier ne peut pas enregistrer de dépenses de l\'entreprise', async () => {
    reset(); const { out } = await call('get', ACCESS, { params: { id: 1 }, perms: ADMIN });
    assert.strictEqual(out.json.expense_allowed, false); assert.strictEqual(out.json.role.personal, false); assert.strictEqual(out.json.can_edit, true);
  });
  await check('rôle individuel : Awa reçoit le droit de saisir des dépenses, Moussa (même poste) ne change PAS', async () => {
    reset(); const r = await call('put', EDIT, { params: { id: 1 }, perms: ADMIN, body: { permissions: ['sale.create', 'cash.manage', 'expense.create'] } });
    assert(!r.err, r.err && (r.err.stack || r.err.message)); assert.deepStrictEqual(r.out.json.added, ['expense.create']);
    const awa = DB.users.get(11), moussa = DB.users.get(12);
    assert(roleOf(awa.role_id).personal_user_id === 11 && DB.rolePerms.get(awa.role_id).includes('expense.create'));
    assert.strictEqual(moussa.role_id, 1, 'Moussa garde le rôle Caissier'); assert(!DB.rolePerms.get(1).includes('expense.create'), 'le rôle commun Caissier n\'est pas modifié');
    assert(EMPS[1].position === 'Caissier', 'la fonction (poste) reste inchangée');
    assert(tracked.length === 1 && tracked[0].employeeId === 1 && tracked[0].kind === 'role' && /ajoutés expense\.create/.test(tracked[0].description), 'Awa est informée du changement de ses droits (historique + messagerie)');
  });
  await check('ajuster à nouveau réutilise le même rôle individuel (pas de doublon)', async () => {
    const before = DB.roles.length; const r = await call('put', EDIT, { params: { id: 1 }, perms: ADMIN, body: { permissions: ['sale.create', 'expense.create', 'finance.view'] } });
    assert(!r.err); assert.strictEqual(DB.roles.length, before); assert.deepStrictEqual(r.out.json.removed, ['cash.manage']);
  });
  await check('retour à un rôle commun : le rôle individuel disparaît, les autres employés ne sont pas touchés', async () => {
    const r = await call('post', '/hr/employees/:id/personal-role/revert', { params: { id: 1 }, perms: ADMIN, body: { role: 'POMPISTE' } });
    assert(!r.err, r.err && (r.err.stack || r.err.message)); assert.strictEqual(DB.users.get(11).role_id, 2); assert(!DB.roles.some(x => x.personal_user_id === 11)); assert.strictEqual(DB.users.get(12).role_id, 1);
  });
  await check('un gérant ne peut pas donner de droits d\'administration, ni plus de droits qu\'il n\'en a', async () => {
    reset(); let r = await call('put', EDIT, { params: { id: 2 }, perms: GERANT, role: 'GERANT', body: { permissions: ['sale.create', 'user.manage'] } });
    assert(r.err && r.err.status === 403 && /administration|possédez pas/.test(r.err.message));
    reset(); r = await call('put', EDIT, { params: { id: 2 }, perms: ['role.assign', 'sale.create'], role: 'GERANT', body: { permissions: ['sale.create', 'expense.create'] } });
    assert(r.err && r.err.status === 403 && /possédez pas/.test(r.err.message), 'ne peut pas déléguer expense.create sans le posséder');
  });
  await check('sans droit « role.assign » : refus ; employé sans compte : 409 explicite ; soi-même : refus', async () => {
    reset(); let r = await call('put', EDIT, { params: { id: 2 }, perms: ['sale.create'], body: { permissions: ['sale.create'] } }); assert.strictEqual(r.err.status, 403);
    r = await call('put', EDIT, { params: { id: 3 }, perms: ADMIN, body: { permissions: ['sale.create'] } }); assert.strictEqual(r.err.status, 409);
    r = await call('put', EDIT, { params: { id: 1 }, perms: ADMIN, uid: 11, body: { permissions: ['sale.create'] } }); assert.strictEqual(r.err.status, 400);
  });
  await check('contrat sans gestion des utilisateurs : refus', async () => {
    reset(); DB.contractOk = false; const r = await call('put', EDIT, { params: { id: 2 }, perms: ADMIN, body: { permissions: ['sale.create'] } }); assert.strictEqual(r.err.status, 403);
  });
  await check('un employé voit son propre accès mais ne peut pas le modifier ; un collègue ne voit pas celui d\'un autre', async () => {
    reset(); let r = await call('get', ACCESS, { params: { id: 1 }, perms: ['sale.create'], role: 'CAISSIER', uid: 11 });
    assert(!r.err && r.out.json.can_edit === false && r.out.json.catalogue === undefined);
    r = await call('get', ACCESS, { params: { id: 1 }, perms: ['sale.create'], role: 'CAISSIER', uid: 12 }); assert.strictEqual(r.err.status, 403);
  });
  console.log(`\n${n}/8 contrôles réussis.`);
})().catch(e => { console.error('✘', e); process.exit(1); });
