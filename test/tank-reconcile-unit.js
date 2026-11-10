'use strict';
// CORR-038 : réconciliation du stock en cuve. Le vrai code de src/tank_logic.js est exécuté (aucune base nécessaire).
const assert = require('assert');
const { reconcileProduct, tolerancePct } = require('../src/tank_logic');
let n = 0; const check = (l, fn) => { fn(); n++; console.log('✓ ' + l); };
const T = (o, c, id = 1) => ({ id, name: 'C' + id, opening: o, closing: c });

check('cas équilibré : 10 000 + 5 000 − 4 000 = 11 000 → ok', () => {
  const r = reconcileProduct({ tanks: [T(10000, 11000)], received: 5000, pumped: 4000, tolPct: 0.5 });
  assert.strictEqual(r.theoretical, 11000); assert.strictEqual(r.variance, 0); assert.strictEqual(r.level, 'ok');
});
check('tolérance 0,5 % de 4 000 L = 20 L : écart −15 L ok, −25 L avertissement', () => {
  assert.strictEqual(reconcileProduct({ tanks: [T(10000, 15985)], received: 10000, pumped: 4000, tolPct: 0.5 }).level, 'ok');
  const w = reconcileProduct({ tanks: [T(10000, 15975)], received: 10000, pumped: 4000, tolPct: 0.5 });
  assert.strictEqual(w.variance, -25); assert.strictEqual(w.level, 'warning'); assert.match(w.diagnosis, /Manque en cuve/);
});
check('écart supérieur à 5 × la tolérance (> 100 L ici) : critique', () => {
  const r = reconcileProduct({ tanks: [T(10000, 15880)], received: 10000, pumped: 4000, tolPct: 0.5 });
  assert.strictEqual(r.variance, -120); assert.strictEqual(r.level, 'critical');
});
check('excédent en cuve : diagnostic dédié', () => {
  const r = reconcileProduct({ tanks: [T(10000, 16050)], received: 10000, pumped: 4000, tolPct: 0.5 });
  assert.strictEqual(r.variance, 50); assert.match(r.diagnosis, /Excédent/);
});
check('plusieurs cuves du même produit : jauges additionnées', () => {
  const r = reconcileProduct({ tanks: [T(5000, 4000, 1), T(3000, 3000, 2)], pumped: 1000, tolPct: 0.5 });
  assert.strictEqual(r.opening, 8000); assert.strictEqual(r.closing, 7000); assert.strictEqual(r.variance, 0);
});
check('jauge manquante : réconciliation refusée (incomplet) avec la liste des jauges à saisir', () => {
  const r = reconcileProduct({ tanks: [T(5000, null, 1), T(null, 3000, 2)], pumped: 100 });
  assert.strictEqual(r.status, 'incomplet'); assert.deepStrictEqual(r.missing.map(m => m.what), ['clôture', 'ouverture']);
});
check('jauge 0 L est une vraie valeur (cuve vide), pas une jauge manquante', () => {
  const r = reconcileProduct({ tanks: [T(1000, 0)], pumped: 1000, tolPct: 0.5 });
  assert.strictEqual(r.status, 'calcule'); assert.strictEqual(r.level, 'ok');
});
check('aucun litre pompé : tolérance plancher de 1 L', () => {
  assert.strictEqual(reconcileProduct({ tanks: [T(1000, 999.5)], pumped: 0 }).level, 'ok');
  assert.strictEqual(reconcileProduct({ tanks: [T(1000, 990)], pumped: 0 }).level, 'critical');
});
check('mouvements « autres » (pertes, casses) pris en compte ; pas de flottants parasites', () => {
  const r = reconcileProduct({ tanks: [T(1000, 899.9)], other: -0.1, pumped: 100, tolPct: 0.5 });
  assert.strictEqual(r.theoretical, 899.9); assert.strictEqual(r.variance, 0);
});
check('pas de cuve : statut sans_cuve', () => assert.strictEqual(reconcileProduct({ tanks: [] }).status, 'sans_cuve'));
check('tolérance lue dans RECONCILE_TOLERANCE_PCT, 0,5 par défaut, valeurs invalides ignorées', () => {
  assert.strictEqual(tolerancePct({}), 0.5); assert.strictEqual(tolerancePct({ RECONCILE_TOLERANCE_PCT: '1' }), 1);
  assert.strictEqual(tolerancePct({ RECONCILE_TOLERANCE_PCT: 'abc' }), 0.5); assert.strictEqual(tolerancePct({ RECONCILE_TOLERANCE_PCT: '-2' }), 0.5);
});
console.log(`\n${n}/${n} contrôles réussis.`);
