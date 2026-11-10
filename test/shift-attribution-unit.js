'use strict';
// Rattachement par employé sur un quart partagé : le vrai code de src/shift_attribution.js est exécuté (aucune base, aucune dépendance).
const assert = require('assert');
const A = require('../src/shift_attribution');
let n = 0;
const check = (label, fn) => { fn(); n++; console.log('✔ ' + label); };

// Quart partagé : Awa (pompes 1+2, gasoil), Moussa (pompe 3, super), Fanta (caissière, aucune pompe)
const team = [{ id: 1, name: 'Awa' }, { id: 2, name: 'Moussa' }, { id: 3, name: 'Fanta' }];
const owners = A.buildPumpOwners([{ employee_id: 1, pump_id: 1 }, { employee_id: 1, pump_id: 2 }, { employee_id: 2, pump_id: 3 }]);
const counters = [
  { pump_id: 1, product_id: 10, liters: 100, amount: 70000 },
  { pump_id: 2, product_id: 10, liters: 50, amount: 35000 },
  { pump_id: 3, product_id: 11, liters: 80, amount: 60000 },
];
const fuel = A.fuelByEmployee(counters, owners);

check('chaque pompe est rattachée à son employé', () => {
  assert.strictEqual(fuel.get(1).amount, 105000); assert.strictEqual(fuel.get(1).liters, 150);
  assert.strictEqual(fuel.get(2).amount, 60000);
  assert.strictEqual(fuel.has(3), false, 'la caissière n\'a aucune pompe');
  assert.strictEqual(fuel.has(null), false);
});
check('une pompe donnée à deux employés est refusée', () => {
  assert.throws(() => A.buildPumpOwners([{ employee_id: 1, pump_id: 1 }, { employee_id: 2, pump_id: 1 }]), /deux employés/);
});
check('une pompe sans responsable va dans le lot « non attribué » (null), jamais à un employé au hasard', () => {
  const f = A.fuelByEmployee([{ pump_id: 9, product_id: 10, liters: 5, amount: 3500 }], owners);
  assert.strictEqual(f.get(null).amount, 3500);
});
check('employé seul et aucune pompe attribuée (usage historique) : il est responsable de tout', () => {
  const f = A.fuelByEmployee([{ pump_id: 9, product_id: 10, liters: 5, amount: 3500 }], new Map(), 1);
  assert.strictEqual(f.get(1).amount, 3500); assert.strictEqual(f.has(null), false);
});
check('dès qu\'une pompe est attribuée, les autres pompes restent SANS employé (manque de personnel)', () => {
  const f = A.fuelByEmployee([{ pump_id: 9, product_id: 10, liters: 5, amount: 3500 }, { pump_id: 1, product_id: 10, liters: 7, amount: 4900 }], owners, 1);
  assert.strictEqual(f.get(null).amount, 3500); assert.strictEqual(f.get(1).amount, 4900);
});

// Situation de caisse : Awa a déclaré 40 000 de ventes carburant (payées en espèces), Moussa rien ; Fanta a vendu 5 000 de produits en espèces
const declared = new Map([[1, 40000]]);
const cashDeclared = new Map([[1, 40000], [3, 5000]]);
check('espèces attendues par employé = ses ventes saisies + son carburant non déclaré − ses paiements non espèces', () => {
  const r = A.computeEmployeeClosings({ team, fuelByEmp: fuel, declaredFuelByEmp: declared, cashDeclaredByEmp: cashDeclared, requireInputs: true,
    inputs: [
      { employee_id: 1, counted_cash: 105000, mobile_money: 0, card: 0, credit: 0 },
      { employee_id: 2, counted_cash: 50000, mobile_money: 10000, card: 0, credit: 0 },
      { employee_id: 3, counted_cash: 5000, mobile_money: 0, card: 0, credit: 0 }] });
  const by = Object.fromEntries(r.rows.map(x => [x.employee_id, x]));
  // Awa : 40 000 déclarés (déjà en caisse) + (105 000 − 40 000) non déclarés = 105 000 attendus
  assert.strictEqual(by[1].expected_cash, 105000); assert.strictEqual(by[1].cash_gap, 0);
  // Moussa : 60 000 non déclarés − 10 000 mobile money = 50 000 attendus, remis 50 000
  assert.strictEqual(by[2].expected_cash, 50000); assert.strictEqual(by[2].cash_gap, 0);
  assert.strictEqual(by[3].expected_cash, 5000); assert.strictEqual(by[3].cash_gap, 0);
  assert.strictEqual(r.non_cash_total.mobile_money, 10000);
});
check('le manquant de l\'un n\'est jamais mis sur le compte d\'un autre', () => {
  const r = A.computeEmployeeClosings({ team, fuelByEmp: fuel, declaredFuelByEmp: declared, cashDeclaredByEmp: cashDeclared, requireInputs: true,
    inputs: [
      { employee_id: 1, counted_cash: 105000, mobile_money: 0, card: 0, credit: 0 },
      { employee_id: 2, counted_cash: 47500, mobile_money: 10000, card: 0, credit: 0 },
      { employee_id: 3, counted_cash: 5000, mobile_money: 0, card: 0, credit: 0 }] });
  const by = Object.fromEntries(r.rows.map(x => [x.employee_id, x]));
  assert.strictEqual(by[1].cash_gap, 0); assert.strictEqual(by[3].cash_gap, 0); assert.strictEqual(by[2].cash_gap, -2500);
  // Le résidu = écart global − somme des écarts individuels : ici le global (−2 500) est entièrement expliqué par Moussa
  assert.strictEqual(A.residualGap(-2500, r.rows), 0);
  assert.strictEqual(A.residualGap(-4000, r.rows), -1500, 'la part non attribuable reste distincte et sans employé');
});
check('chaque employé du quart doit remettre sa propre situation (clôture réelle)', () => {
  assert.throws(() => A.computeEmployeeClosings({ team, fuelByEmp: fuel, declaredFuelByEmp: declared, cashDeclaredByEmp: cashDeclared, requireInputs: true,
    inputs: [{ employee_id: 1, counted_cash: 1, mobile_money: 0, card: 0, credit: 0 }] }), /Saisissez les espèces remises par Moussa/);
  // l'aperçu (requireInputs = false) fonctionne sans saisie
  const r = A.computeEmployeeClosings({ team, fuelByEmp: fuel, declaredFuelByEmp: declared, cashDeclaredByEmp: cashDeclared, requireInputs: false, inputs: [] });
  assert.strictEqual(r.rows.find(x => x.employee_id === 2).cash_gap, null);
});
check('paiements non espèces supérieurs au carburant non déclaré de l\'employé : refus nominatif', () => {
  assert.throws(() => A.computeEmployeeClosings({ team, fuelByEmp: fuel, declaredFuelByEmp: declared, cashDeclaredByEmp: cashDeclared, requireInputs: false,
    inputs: [{ employee_id: 2, counted_cash: 0, mobile_money: 70000, card: 0, credit: 0 }] }), /Moussa/);
});
check('un employé étranger au quart est refusé', () => {
  assert.throws(() => A.computeEmployeeClosings({ team, fuelByEmp: fuel, declaredFuelByEmp: declared, cashDeclaredByEmp: cashDeclared, requireInputs: false,
    inputs: [{ employee_id: 99, counted_cash: 0, mobile_money: 0, card: 0, credit: 0 }] }), /ne fait pas partie/);
});
check('ventes déclarées au-dessus de ses compteurs : signalé sur LUI', () => {
  const r = A.computeEmployeeClosings({ team, fuelByEmp: fuel, declaredFuelByEmp: new Map([[2, 65000]]), cashDeclaredByEmp: new Map(), requireInputs: false, inputs: [] });
  assert.strictEqual(r.rows.find(x => x.employee_id === 2).overdeclared, 5000);
  assert.strictEqual(r.rows.find(x => x.employee_id === 1).overdeclared, 0);
});

// Écart de stock
check('écart de stock gasoil réparti selon les litres de chaque employé, somme exacte', () => {
  const sold = new Map();
  const parts = A.attributeStockGap({ gap: -9, productId: 10, fuelByEmp: A.fuelByEmployee([
    { pump_id: 1, product_id: 10, liters: 100, amount: 1 }, { pump_id: 4, product_id: 10, liters: 200, amount: 1 }], A.buildPumpOwners([{ employee_id: 1, pump_id: 1 }, { employee_id: 2, pump_id: 4 }])), soldQtyByEmp: sold });
  assert.deepStrictEqual(parts.map(p => [p.employee_id, p.amount]), [[1, -3], [2, -6]]);
  assert.strictEqual(parts.reduce((a, p) => a + p.amount, 0), -9);
});
check('répartition avec reste : la somme est conservée au millième', () => {
  const p = A.splitByWeights(-10, [{ key: 'a', w: 1 }, { key: 'b', w: 1 }, { key: 'c', w: 1 }]);
  assert.strictEqual(Math.round(p.reduce((a, x) => a + x.amount, 0) * 1000), -10000);
});
check('écart sur un produit sans pompe : selon les quantités vendues par chacun', () => {
  const sold = new Map([[20, new Map([[1, 3], [3, 1]])]]);
  const parts = A.attributeStockGap({ gap: -4, productId: 20, fuelByEmp: fuel, soldQtyByEmp: sold });
  assert.deepStrictEqual(parts.map(p => [p.employee_id, p.amount]), [[1, -3], [3, -1]]);
});
check('aucune base de répartition : l\'écart reste sans employé (jamais attribué au hasard)', () => {
  const parts = A.attributeStockGap({ gap: -4, productId: 99, fuelByEmp: fuel, soldQtyByEmp: new Map() });
  assert.deepStrictEqual(parts, [{ employee_id: null, amount: -4 }]);
});
check('employé seul : tout lui revient', () => {
  assert.deepStrictEqual(A.attributeStockGap({ gap: -4, productId: 99, fuelByEmp: fuel, soldQtyByEmp: new Map(), soleEmployeeId: 7 }), [{ employee_id: 7, amount: -4 }]);
});
console.log(`\n${n} contrôles réussis`);
