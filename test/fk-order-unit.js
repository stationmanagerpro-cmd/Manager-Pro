// Tests unitaires de l'ordre des clés étrangères : node test/fk-order-unit.js
const assert = require('assert');
const { planOrder } = require('../src/fk_order');
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('✔', name); };
const fk = (child, child_col, parent) => ({ child, child_col, parent, parent_col: 'id' });
const nullable = (...cols) => (t, c) => cols.includes(t + '.' + c);
const idx = (arr, x) => arr.indexOf(x);

ok('graphe simple : le parent est inséré avant l’enfant (order = enfants d’abord)', () => {
  const r = planOrder(['sales', 'customers', 'lines'], [fk('sales', 'customer_id', 'customers'), fk('lines', 'sale_id', 'sales')], () => false);
  assert.deepStrictEqual(r.order, ['lines', 'sales', 'customers']); assert.strictEqual(r.deferred.length, 0);
});
ok('boucle A<->B avec colonne NULLable : acceptée, une colonne différée (avant : refus)', () => {
  const r = planOrder(['a', 'b'], [fk('a', 'b_id', 'b'), fk('b', 'a_id', 'a')], nullable('b.a_id'));
  assert.strictEqual(r.order.length, 2); assert.deepStrictEqual(r.deferred.map(d => d.child + '.' + d.child_col), ['b.a_id']);
});
ok('boucle sans colonne NULLable : refusée avec la liste des tables', () => {
  assert.throws(() => planOrder(['a', 'b'], [fk('a', 'b_id', 'b'), fk('b', 'a_id', 'a')], () => false), /dépendances cycliques.*a, b|dépendances cycliques.*b, a/);
});
ok('clé auto-référente NULLable (responsable) : différée, pas de blocage', () => {
  const r = planOrder(['emp'], [fk('emp', 'manager_id', 'emp')], nullable('emp.manager_id'));
  assert.strictEqual(r.deferred.length, 1);
});
ok('boucle de 3 tables + une table en aval : seules les colonnes nécessaires sont différées', () => {
  const r = planOrder(['a', 'b', 'c', 'd'], [fk('a', 'b_id', 'b'), fk('b', 'c_id', 'c'), fk('c', 'a_id', 'a'), fk('d', 'a_id', 'a')], nullable('c.a_id', 'a.b_id', 'b.c_id'));
  assert.strictEqual(r.deferred.length, 1);
  const ins = r.order.slice().reverse(); assert(idx(ins, 'a') < idx(ins, 'd'));
});
ok('FK vers une table hors périmètre ignorée', () => assert.deepStrictEqual(planOrder(['a'], [fk('a', 'u', 'users')], () => false).order, ['a']));
ok('schéma réaliste (employés, utilisateurs, quarts, ventes, factures) sans erreur', () => {
  const f = [fk('employees', 'user_id', 'users'), fk('users', 'employee_id', 'employees'), fk('shifts', 'employee_id', 'employees'), fk('sales', 'shift_id', 'shifts'), fk('invoices', 'sale_id', 'sales'), fk('sales', 'invoice_id', 'invoices')];
  const r = planOrder(['employees', 'users', 'shifts', 'sales', 'invoices'], f, nullable('users.employee_id', 'sales.invoice_id', 'employees.user_id'));
  assert.strictEqual(r.order.length, 5); assert(r.deferred.length >= 2);
});
console.log(`\n${n}/${n} tests réussis.`);
