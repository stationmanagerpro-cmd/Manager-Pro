// Contrôle statique des décisions d'accès de l'audit 2026-11-21 (A-01 à A-04).
// node test/acces-audit-decisions-static.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const core = read('src/core.js');
const ops = read('src/operations.js');
const plus = read('src/ops_plus.js');
const rep = read('src/reports.js');

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('✔', name); };

ok('règles partagées : gestionnaire, notifications sensibles exportées', () => {
  assert.ok(/const MANAGER_PERMS = \['report\.view', 'finance\.view', 'cash\.manage'\]/.test(core), 'MANAGER_PERMS absent');
  assert.ok(/SENSITIVE_NOTIF_KINDS = \['ecart_caisse', 'paie', 'rh', 'contrat'\]/.test(core), 'liste sensible absente');
  assert.ok(/module\.exports = \{ hasManagerView, isSensitiveNotif, canSeeSensitiveNotif,/.test(core), 'export absent');
});

ok('A-01 : GET /sales limité aux gestionnaires, vendeur limité à ses ventes', () => {
  assert.ok(ops.includes("if (!manager && !req.user.perms.has('sale.create')) throw new HttpError(403"), 'refus sans permission absent');
  assert.ok(ops.includes("WHERE user_id = $1 AND station_id = $2 AND deleted_at IS NULL LIMIT 1', [req.user.id, req.sid]"), 'rattachement employé absent');
  assert.ok(ops.includes("' AND employee_id = $5' : ''") && ops.includes("' AND employee_id = $3' : ''"), 'filtre vendeur absent');
});

ok('A-02 : centre d\'alertes filtré par source (RH, paie, dettes)', () => {
  assert.ok(plus.includes("hr_alerts: ['hr.view', 'hr.manage']"), 'règle RH absente');
  assert.ok(plus.includes("payroll: ['hr.payroll', 'hr.manage']"), 'règle paie absente');
  assert.ok(plus.includes("customers: ['finance.view', 'cash.manage', 'money.manage']"), 'règle dettes clients absente');
  assert.ok(plus.includes("suppliers: ['finance.view', 'money.manage']"), 'règle dettes fournisseurs absente');
});

ok('A-03 : acquittement RH exige hr.manage', () => {
  assert.ok(plus.includes("if (source === 'hr_alerts' && !req.user.perms.has('hr.manage'))"), 'contrôle absent');
});

ok('A-04 : notifications sensibles réservées aux gestionnaires (liste, centre, acquittement)', () => {
  assert.ok(rep.includes("res.json(canSeeSensitiveNotif(req) ? rows : rows.filter(n => !isSensitiveNotif(n.kind)));"), 'filtre liste absent');
  assert.ok(rep.includes("if (n && isSensitiveNotif(n.kind)) throw new HttpError(403"), 'contrôle acquittement absent');
  assert.ok(plus.includes("return !isSensitiveNotif(i.module) || canSeeSensitiveNotif(req);"), 'filtre centre absent');
  assert.ok(plus.includes("if (n && isSensitiveNotif(n.kind) && !canSeeSensitiveNotif(req))"), 'contrôle ack centre absent');
});

console.log('\n' + n + '/' + n + ' contrôles réussis.');
