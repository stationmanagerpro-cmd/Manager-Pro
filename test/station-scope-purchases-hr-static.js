'use strict';
// CORR-026 (D6, lot 2) : écritures par id de src/purchases.js et src/hr.js filtrées aussi par station_id.
const fs = require('fs'); const path = require('path'); const assert = require('assert');
const rd = f => fs.readFileSync(path.resolve(__dirname, '../src', f), 'utf8');
const pur = rd('purchases.js'), hr = rd('hr.js');
let n = 0; const check = (l, fn) => { fn(); n++; console.log('✓ ' + l); };
const has = (code, re) => assert.match(code, re);
check('purchases : order_no, statut et paiement filtrés par station', () => { has(pur, /UPDATE purchases SET order_no = \$2 WHERE id = \$1 AND station_id = \$3 RETURNING/); has(pur, /UPDATE purchases SET status = \$2, received_at = now\(\) WHERE id = \$1 AND station_id = \$3/); has(pur, /UPDATE purchases SET paid = \$2, status = \$3 WHERE id = \$1 AND station_id = \$4/); });
check('purchases : dernier coût produit et dette fournisseur filtrés par station', () => { has(pur, /UPDATE products SET buy_price = \$2 WHERE id = \$1 AND station_id = \$3/); has(pur, /balance_due \+ \$2 WHERE id = \$1 AND station_id = \$3/); has(pur, /balance_due - \$2 WHERE id = \$1 AND station_id = \$3/); });
check('hr : écarts employé filtrés par station', () => { has(hr, /UPDATE employee_gaps SET employee_id = \$2, updated_at = now\(\) WHERE id = \$1 AND station_id = \$3/); has(hr, /employee_justification = \$2, updated_at = now\(\) WHERE id = \$1 AND station_id = \$3/); has(hr, /manager_decision = \$3, updated_at = now\(\) WHERE id = \$1 AND station_id = \$4/); });
check('hr : ajustements et bulletins (numéro, suppression) filtrés par station', () => { has(hr, /DELETE FROM payroll_adjustments WHERE id = \$1 AND station_id = \$2/); has(hr, /UPDATE payslips SET number = \$2 WHERE id = \$1 AND station_id = \$3/); has(hr, /DELETE FROM payslips WHERE id = \$1 AND station_id = \$2/); });
console.log(`\n${n}/${n} contrôles réussis.`);
