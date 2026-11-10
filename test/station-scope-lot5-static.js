'use strict';
// CORR-034 : écritures restantes filtrées par station_id (hr_v2, employee_actions, shifts).
// hr_v2 : le paramètre $2 (station) était passé sans être utilisé dans le SQL (PostgreSQL : « could not determine data type of parameter $2 »).
const fs = require('fs'); const path = require('path'); const assert = require('assert');
const rd = f => fs.readFileSync(path.resolve(__dirname, '../src', f), 'utf8');
const hr = rd('hr_v2.js'), ea = rd('employee_actions.js'), sh = rd('shifts.js');
let n = 0; const check = (l, fn) => { fn(); n++; console.log('✓ ' + l); };
const has = (c, re) => assert.match(c, re);
check('hr_v2 : décision de congé filtrée par station', () => has(hr, /UPDATE hr_leave_requests SET status = \$3[^`]*WHERE id = \$1 AND station_id = \$2/));
check('hr_v2 : heures supplémentaires (valider, approuver, refuser) filtrées par station', () => {
  has(hr, /status='valide_responsable'[^`]*WHERE id=\$1 AND station_id=\$2/);
  has(hr, /status='approuve_rh'[^`]*WHERE id=\$1 AND station_id=\$2/);
  has(hr, /status='refuse'[^`]*WHERE id=\$1 AND station_id=\$2/);
});
check('hr_v2 : aucun UPDATE hr_leave_requests / hr_overtime sans station_id', () => {
  for (const m of hr.matchAll(/UPDATE (hr_leave_requests|hr_overtime) SET[^`]*`/g)) assert.match(m[0], /station_id/, m[0].slice(0, 80));
});
check('employee_actions : rejet, contestation de l\'écart et réponse filtrés par station', () => {
  has(ea, /rejected_reason = \$2 WHERE id = \$1 AND station_id = \$3/);
  has(ea, /status = 'conteste', updated_at = now\(\) WHERE id = \$1 AND station_id = \$2/);
  has(ea, /reviewed_at = now\(\) WHERE id = \$1 AND station_id = \$4/);
});
check('shifts : clôture du quart filtrée par station', () => has(sh, /observations = \$7 WHERE id = \$1 AND station_id = \$9/));
console.log(`\n${n}/${n} contrôles réussis.`);
