'use strict';
// CORR-037 (audit B2) : la réconciliation lit des tables/colonnes qui existent réellement, sans avaler les erreurs.
const fs = require('fs'); const path = require('path'); const assert = require('assert');
const prem = fs.readFileSync(path.resolve(__dirname, '../src/premium.js'), 'utf8');
const mig = fs.readdirSync(path.resolve(__dirname, '../migrations')).filter(f => f.endsWith('.sql')).map(f => fs.readFileSync(path.resolve(__dirname, '../migrations', f), 'utf8')).join('\n');
const blk = prem.slice(prem.indexOf("r.post('/reconcile/run'"), prem.indexOf("r.get('/reconcile/runs'"));
let n = 0; const check = (l, fn) => { fn(); n++; console.log('✓ ' + l); };
check('plus aucune référence aux objets inexistants (sale_items, shift_counters, products.quantity, sales.deleted_at)', () => {
  assert.ok(!/sale_items|shift_counters|sa\.deleted_at|\bquantity < min_stock/.test(blk));
});
check('litres pompés : meter_readings.liters, index final renseigné, filtré par station', () => {
  assert.match(blk, /FROM meter_readings mr[\s\S]*sh\.station_id = \$1[\s\S]*mr\.index_end IS NOT NULL/);
  assert.match(mig, /liters\s+NUMERIC\(14,3\) GENERATED ALWAYS AS \(index_end - index_start\)/);
});
check('litres vendus : sale_details des ventes carburant valides seulement', () => {
  assert.match(blk, /FROM sale_details d JOIN sales sa[\s\S]*sa\.kind = 'carburant' AND sa\.status = 'valide'/);
});
check('stock bas : quantité lue dans la table stock', () => assert.match(blk, /JOIN stock st ON st\.product_id = p\.id/));
check('requêtes de calcul sans swallow (erreur visible)', () => {
  const calc = blk.slice(0, blk.indexOf('INSERT INTO reconciliation_runs'));
  assert.ok(!/swallow\(/.test(calc));
});
check('tolérance paramétrable (RECONCILE_TOLERANCE_PCT) et critique à 5 × la tolérance', () => {
  assert.match(blk, /RECONCILE_TOLERANCE_PCT/); assert.match(blk, /> 5 \* tol/);
});
console.log(`\n${n}/${n} contrôles réussis.`);
