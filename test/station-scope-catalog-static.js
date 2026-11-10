'use strict';
// CORR-025 (D6, lot 1) : défense en profondeur — les écritures par id de src/catalog.js portent aussi station_id.
const fs = require('fs'); const path = require('path'); const assert = require('assert');
const code = fs.readFileSync(path.resolve(__dirname, '../src/catalog.js'), 'utf8');
let n = 0; const check = (l, fn) => { fn(); n++; console.log('✓ ' + l); };
check('UPDATE pumps filtré par station_id', () => assert.match(code, /UPDATE pumps SET number = \$2[^']*WHERE id = \$1 AND station_id = \$6'/));
check('UPDATE customer_credits filtré par station_id', () => assert.match(code, /UPDATE customer_credits SET remaining=\$2, status=\$3 WHERE id=\$1 AND station_id=\$4'/));
check('UPDATE customers (solde) filtré par station_id', () => assert.match(code, /UPDATE customers SET balance = balance - \$2 WHERE id=\$1 AND station_id=\$3'/));
check('UPDATE invoices filtré par station_id', () => assert.match(code, /UPDATE invoices SET amount_paid=\$2, status=\$3, updated_at=now\(\) WHERE id=\$1 AND station_id=\$4'/));
check('les paramètres station passent bien req.sid', () => { assert.match(code, /after\.status \?\? old\.status, req\.sid\]/); assert.match(code, /\[custId, amount, req\.sid\]/); });
console.log(`\n${n}/${n} contrôles réussis.`);
