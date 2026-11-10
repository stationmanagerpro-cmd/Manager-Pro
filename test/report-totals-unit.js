// Tests unitaires des totaux de fin de rapport : node test/report-totals-unit.js
const assert = require('assert');
const { totalsRow, reportTotals } = require('../src/report_totals');
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('✔', name); };
const head = ['Employé', 'Salaire', 'Indemnité', 'Total'];
const rows = [['A', 200000, 25000, 225000], ['B', 250000, 30000, 280000], ['C', 300000, 20000, 320000]];
ok('exemple du cahier des charges : 750 000 / 75 000 / 825 000', () => assert.deepStrictEqual(totalsRow(head, rows, [1, 2, 3]), ['TOTAL', 750000, 75000, 825000]));
ok('texte numérique ("12.5") et valeurs vides gérés', () => assert.deepStrictEqual(totalsRow(['x', 'm'], [['a', '12.5'], ['b', null], ['c', 7.25]], [1]), ['TOTAL', 19.75]));
ok('aucune ligne : total à 0 (jamais de total faux)', () => assert.deepStrictEqual(totalsRow(head, [], [1, 2, 3]), ['TOTAL', 0, 0, 0]));
ok('aucune colonne monétaire : pas de ligne de total', () => assert.strictEqual(totalsRow(head, rows, []), null));
ok('arrondi sans dérive flottante (0.1 + 0.2)', () => assert.strictEqual(totalsRow(['x', 'm'], [['a', 0.1], ['b', 0.2]], [1])[1], 0.3));
ok('reportTotals : sumCols puis totals() personnalisé', () => {
  assert.deepStrictEqual(reportTotals({ columns: head, sumCols: [1] }, rows), [['TOTAL', 750000, '', '']]);
  assert.deepStrictEqual(reportTotals({ columns: head, totals: r => [['Z', r.length]] }, rows), [['Z', 3]]);
  assert.deepStrictEqual(reportTotals({ columns: head }, rows), []);
});
console.log(`\n${n}/${n} tests réussis.`);
