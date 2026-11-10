'use strict';
// CORR-027 (D6, lot 3) : soldes clients, numéros de facture de vente, mouvements d'argent et prêts filtrés aussi par station_id.
const fs = require('fs'); const path = require('path'); const assert = require('assert');
const rd = f => fs.readFileSync(path.resolve(__dirname, '../src', f), 'utf8');
const f = { shifts: rd('shifts.js'), operations: rd('operations.js'), fuelsales: rd('fuelsales.js'), imports: rd('imports.js'), finance: rd('finance.js') };
let n = 0; const check = (l, fn) => { fn(); n++; console.log('✓ ' + l); };
const has = (k, re) => assert.match(f[k], re);
check('shifts : solde client (carburant à crédit)', () => has('shifts', /UPDATE customers SET balance = balance \+ \$2 WHERE id = \$1 AND station_id = \$3', \[cid, credit, req\.sid\]/));
check('operations : soldes client (crédit, annulation, règlement) et numéro de vente', () => { has('operations', /balance \+ \$2 WHERE id = \$1 AND station_id = \$3', \[cu\.id, p\.amount, req\.sid\]/); has('operations', /balance - \$2 WHERE id = \$1 AND station_id = \$3', \[s\.customer_id, p\.amount, req\.sid\]/); has('operations', /balance - \$2 WHERE id = \$1 AND station_id = \$3 RETURNING balance/); has('operations', /UPDATE sales SET total = \$2, invoice_no = \$3 WHERE id = \$1 AND station_id = \$4 RETURNING/); });
check('fuelsales : solde client et numéro de vente', () => { has('fuelsales', /balance \+ \$2 WHERE id = \$1 AND station_id = \$3', \[cu\.id, p\.amount, req\.sid\]/); has('fuelsales', /UPDATE sales SET invoice_no = \$2 WHERE id = \$1 AND station_id = \$3 RETURNING/); });
check('imports : solde client et numéro de vente', () => { has('imports', /balance \+ \$2 WHERE id = \$1 AND station_id = \$3', \[customerId, amount, sid\]/); has('imports', /UPDATE sales SET invoice_no = \$2 WHERE id = \$1 AND station_id = \$3', \[sale\.id, inv, sid\]/); });
check('finance : référence du virement et remboursement de prêt', () => { has('finance', /UPDATE money_movements SET reference = \$2 WHERE id = \$1 AND station_id = \$3/); has('finance', /UPDATE personal_loans SET repaid_amount=\$2, status=\$3, updated_at=now\(\) WHERE id=\$1 AND station_id=\$4/); });
console.log(`\n${n}/${n} contrôles réussis.`);
