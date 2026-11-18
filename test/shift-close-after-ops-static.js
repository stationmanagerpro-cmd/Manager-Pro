'use strict';
// Règle : aucune clôture de quart ne peut être antérieure à une opération du même quart.
// Contrôle statique du code de clôture (la base n'est pas disponible ici).
const fs = require('fs'), path = require('path'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'shifts.js'), 'utf8');
let n = 0; const check = (l, fn) => { fn(); n++; console.log('✔ ' + l); };
const rule = src.indexOf('Règle métier : aucune clôture ne peut être antérieure');
const neighbours = src.indexOf('const nbc = s.opened_at ? await shiftNeighbours');
check('la règle existe dans la route de clôture', () => assert(rule > 0));
check('elle compare la date de clôture aux ventes, paiements et mouvements de caisse du quart', () => {
  const block = src.slice(rule, rule + 700);
  assert(/MAX\(sold_at\) FROM sales WHERE shift_id = \$1/.test(block));
  assert(/MAX\(paid_at\) FROM payments WHERE shift_id = \$1/.test(block));
  assert(/MAX\(created_at\) FROM cash_movements WHERE shift_id = \$1/.test(block));
});
check('elle refuse une clôture antérieure avec un message explicite (400)', () => {
  assert(src.includes("'La clôture ne peut pas être antérieure à la dernière opération du quart ('"));
});
check('elle est exécutée après la résolution de closed_at et avant le contrôle de placement', () => {
  const resolved = src.indexOf('resolvedClosedAt = d;');
  assert(resolved > 0 && resolved < rule && rule < neighbours, 'ordre des contrôles incorrect');
});
check('l’écart de clôture est daté à l’heure de clôture retenue', () => {
  assert(src.includes("UPDATE cash_movements SET created_at = $2::timestamptz WHERE shift_id = $1 AND kind = 'ecart_cloture'"));
});
console.log(`\n${n}/5 contrôles réussis.`);
