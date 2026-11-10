'use strict';
// ANO-08 / RG-07 : validation du mouvement de stock manuel. Exécute le vrai schéma extrait de src/operations.js (zod requis).
const fs = require('fs'), path = require('path'), assert = require('assert');
let z; try { z = require('zod').z; } catch { console.log('zod absent (npm ci requis) : test non exécuté'); process.exit(2); }
const src = fs.readFileSync(path.join(__dirname, '../src/operations.js'), 'utf8');
const cFrom = src.indexOf('const STOCK_QTY_MAX'), route = src.indexOf("r.post('/stock/movements'");
assert.ok(cFrom > 0 && route > cFrom, 'schéma introuvable dans src/operations.js');
const zFrom = src.indexOf('z.object({', route), zTo = src.indexOf('}).strict()', zFrom) + '}).strict()'.length;
const schema = new Function('z', src.slice(cFrom, route) + '\nreturn ' + src.slice(zFrom, zTo) + ';')(z);
let passed = 0;
function check(label, fn) { fn(); passed++; console.log('✓ ' + label); }
const ok = o => schema.safeParse({ product_id: 1, kind: 'entree', quantity: 10, comment: 'Livraison citerne', ...o });
check('mouvement valide accepté', () => assert.ok(ok({}).success));
check('quantité 1e12 refusée (400 au lieu d’une erreur 500 NUMERIC)', () => assert.ok(!ok({ quantity: 1e12 }).success));
check('quantité -1e12 refusée', () => assert.ok(!ok({ kind: 'correction', quantity: -1e12 }).success));
check('limite 1 000 000 acceptée, au-delà refusée', () => { assert.ok(ok({ quantity: 1000000 }).success); assert.ok(!ok({ quantity: 1000000.001 }).success); });
check('plus de 3 décimales refusé, 3 décimales acceptées', () => { assert.ok(ok({ quantity: 12.345 }).success); assert.ok(!ok({ quantity: 1.2345 }).success); });
check('NaN et Infinity refusés', () => { assert.ok(!ok({ quantity: NaN }).success); assert.ok(!ok({ quantity: Infinity }).success); });
check('motif absent, vide ou < 3 caractères refusé pour chaque type', () => {
  for (const kind of ['entree', 'retour', 'perte', 'casse', 'correction']) {
    assert.ok(!schema.safeParse({ product_id: 1, kind, quantity: 1 }).success, kind + ' sans motif');
    assert.ok(!ok({ kind, comment: '  ab ' }).success, kind + ' motif court');
    assert.ok(ok({ kind, comment: 'abc' }).success, kind + ' motif valide');
  }
});
check('champ inconnu refusé (schéma strict)', () => assert.ok(!ok({ station_id: 2 }).success));
check('la route journalise toujours le mouvement (audit) et renvoie 201', () => {
  const r = src.slice(src.indexOf("r.post('/stock/movements'"), src.indexOf('// CRÉANCES'));
  assert.match(r, /audit\(c, req, 'stock'/); assert.match(r, /status\(201\)/);
});
console.log(`${passed}/${passed} contrôles réussis`);
