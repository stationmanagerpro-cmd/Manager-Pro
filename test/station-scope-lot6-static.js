'use strict';
// CORR-035 : écritures restantes filtrées par station_id (règlement de commissions, liaison employé–compte).
const fs = require('fs'); const path = require('path'); const assert = require('assert');
const rd = f => fs.readFileSync(path.resolve(__dirname, '../src', f), 'utf8');
const sc = rd('seller_commissions.js'), au = rd('auth.js');
let n = 0; const check = (l, fn) => { fn(); n++; console.log('✓ ' + l); };
check('commissions : règlement total et partiel filtrés par station', () => {
  assert.match(sc, /settled_by = \$2\s+WHERE id = \$1 AND station_id = \$3/);
  assert.match(sc, /SET amount_remaining = \$2\s+WHERE id = \$1 AND station_id = \$3/);
});
check('auth : liaison employé–compte filtrée par station', () => assert.match(au, /UPDATE employees SET user_id = \$2 WHERE id = \$1 AND station_id = \$3/));
console.log(`\n${n}/${n} contrôles réussis.`);
