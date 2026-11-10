// Tests unitaires SANS base de données : node test/platform-unit.js
const assert = require('assert'); const { payState, toCsv } = require('../src/platform_utils');
let fails = 0; const ok = (c, m) => { console.log((c ? '  ✔ ' : '  ✖ ') + m); if (!c) fails++; };
const T = '2026-10-10';
ok(payState({ amount: 100, paid: 0, due_on: null }, T) === 'impayee', 'rien payé, sans échéance : impayée');
ok(payState({ amount: 100, paid: 40, due_on: '2026-12-01' }, T) === 'partielle', 'règlement partiel');
ok(payState({ amount: 100, paid: 100, due_on: '2026-01-01' }, T) === 'soldee', 'soldée même si l\'échéance est passée');
ok(payState({ amount: 100, paid: 10, due_on: '2026-10-09' }, T) === 'en_retard', 'échéance dépassée : en retard');
ok(payState({ amount: 100, paid: 0, due_on: '2026-10-10' }, T) === 'impayee', 'échéance aujourd\'hui : pas encore en retard');
ok(payState({ amount: 100, paid: 0, cancelled: true }, T) === 'annulee', 'annulée');
ok(payState({ amount: 0.1 + 0.2, paid: 0.3 }, T) === 'soldee', 'arrondi flottant (0,1 + 0,2 = 0,3)');
const csv = toCsv(['A', 'B'], [['x', '=1+1'], ['a;b', 'dit "oui"'], [null, 12.5]]);
ok(csv.startsWith('\ufeffA;B\r\n'), 'CSV : BOM UTF-8 et en-tête');
ok(csv.includes("'=1+1"), 'CSV : formule neutralisée (injection)');
ok(csv.includes('"a;b"') && csv.includes('"dit ""oui"""'), 'CSV : séparateurs et guillemets échappés');
ok(csv.endsWith(';12.5') || csv.includes('\r\n;12.5'), 'CSV : null vide, nombre conservé');
console.log(fails ? `\n${fails} ÉCHEC(S)` : '\nTOUS LES TESTS UNITAIRES PASSENT'); process.exit(fails ? 1 : 0);
