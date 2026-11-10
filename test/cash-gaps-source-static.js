'use strict';
// CORR-036 (audit B1) : les écarts de caisse non clôturés se lisent dans employee_gaps (la table cash_gaps n'existe dans aucune migration).
const fs = require('fs'); const path = require('path'); const assert = require('assert');
const src = path.resolve(__dirname, '../src'), mig = path.resolve(__dirname, '../migrations');
let n = 0; const check = (l, fn) => { fn(); n++; console.log('✓ ' + l); };
const allMig = fs.readdirSync(mig).filter(f => f.endsWith('.sql')).map(f => fs.readFileSync(path.join(mig, f), 'utf8')).join('\n');
check('cash_gaps toujours absente des migrations (sinon revoir ce test)', () => assert.ok(!/CREATE TABLE[^;]*\bcash_gaps\b/i.test(allMig)));
check('aucune requête ne lit encore cash_gaps', () => {
  for (const f of fs.readdirSync(src).filter(f => f.endsWith('.js')))
    assert.ok(!/FROM\s+cash_gaps/i.test(fs.readFileSync(path.join(src, f), 'utf8')), f);
});
for (const f of ['operations.js', 'ops_plus.js', 'treasury.js', 'reports.js'])
  check(f + ' : écarts de caisse lus dans employee_gaps (station, kind caisse, non clôturés)', () =>
    assert.match(fs.readFileSync(path.join(src, f), 'utf8'), /FROM employee_gaps\s+WHERE station_id\s*=\s*\$1 AND kind = 'caisse' AND status NOT IN \('cloture','regularise'\)/));
check('colonnes lues présentes dans employee_gaps (station_id, kind, status, amount)', () => {
  const m = allMig.match(/CREATE TABLE IF NOT EXISTS employee_gaps \(([\s\S]*?)\);/)[1];
  for (const c of ['station_id', 'kind', 'status', 'amount']) assert.match(m, new RegExp('\\b' + c + '\\b'));
});
console.log(`\n${n}/${n} contrôles réussis.`);
