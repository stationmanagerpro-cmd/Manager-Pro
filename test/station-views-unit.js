// Tests unitaires de la logique des vues consolidée / par station (sans base) : node test/station-views-unit.js
const assert = require('assert');
const L = require('../src/station_views_logic');
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('✔', name); };

ok('fenêtres : semaine et mois comparés à périodes équivalentes', () => {
  const w = L.windowsFor('2025-08-21');                       // jeudi
  assert.deepStrictEqual(w.week, ['2025-08-18', '2025-08-21']);
  assert.deepStrictEqual(w.weekPrev, ['2025-08-11', '2025-08-14']);   // mêmes 4 jours de S-1
  assert.deepStrictEqual(w.month, ['2025-08-01', '2025-08-21']);
  assert.deepStrictEqual(w.monthPrev, ['2025-07-01', '2025-07-21']);
  assert.deepStrictEqual(w.year, ['2025-01-01', '2025-08-21']);
  assert.strictEqual(w.isoWeek, 34);
});
ok('mois précédent plus court : jour borné (31 mars → 28 février)', () => {
  assert.deepStrictEqual(L.windowsFor('2026-03-31').monthPrev, ['2026-02-01', '2026-02-28']);
  assert.deepStrictEqual(L.windowsFor('2026-01-15').monthPrev, ['2025-12-01', '2025-12-15']);
});
ok('semaine ISO aux frontières d\'année', () => {
  assert.strictEqual(L.isoWeek('2024-12-30'), 1); assert.strictEqual(L.isoWeek('2026-01-01'), 1); assert.strictEqual(L.isoWeek('2021-01-03'), 53);
});
ok('minStart couvre toutes les fenêtres', () => {
  const w = L.windowsFor('2026-01-03'); assert.strictEqual(w.minStart, '2025-12-01');
});
ok('date invalide refusée', () => { assert.throws(() => L.windowsFor('2025-13-01')); assert.throws(() => L.windowsFor("2025-01-01'; DROP")); });
ok('variation : jamais de division par zéro ni de faux 0 %', () => {
  assert.strictEqual(L.variation(120, 100), 20); assert.strictEqual(L.variation(50, 100), -50);
  assert.strictEqual(L.variation(10, 0), null); assert.strictEqual(L.variation('x', 5), null);
});
ok('répartition : pourcentages sur le total, null si total nul', () => {
  const s = L.shares([{ value: 41.5 }, { value: 29.8 }, { value: 19.3 }, { value: 9.4 }]); assert.strictEqual(s[0].pct, 41.5);
  assert.strictEqual(L.shares([{ value: 0 }])[0].pct, null);
});
ok('jauge : null sans capacité, bornée à 0-100', () => {
  assert.strictEqual(L.gaugePct(500, 0), null); assert.strictEqual(L.gaugePct(500, null), null);
  assert.strictEqual(L.gaugePct(500, 1000), 50); assert.strictEqual(L.gaugePct(2000, 1000), 100); assert.strictEqual(L.gaugePct(-5, 1000), 0);
});
ok('abréviations des carburants', () => {
  assert.strictEqual(L.fuelShort('Gasoil'), 'GAS'); assert.strictEqual(L.fuelShort('Super Sans Plomb'), 'SSP');
  assert.strictEqual(L.fuelShort('Gasoil Premium'), 'GAS PREM'); assert.strictEqual(L.fuelShort(''), '—');
});
ok('santé stock : cuve vide, seuil mini, niveau bas', () => {
  assert.strictEqual(L.healthStock({ fuel: [{ name: 'G', quantity: 0, capacity: 1000 }] }).level, 'crit');
  assert.strictEqual(L.healthStock({ fuel: [{ name: 'G', quantity: 90, min_stock: 100, capacity: 1000 }] }).level, 'crit');
  assert.strictEqual(L.healthStock({ fuel: [{ name: 'G', quantity: 250, capacity: 1000 }] }).level, 'warn');
  assert.strictEqual(L.healthStock({ fuel: [{ name: 'G', quantity: 800, capacity: 1000 }], lowOther: 0 }).level, 'ok');
  assert.strictEqual(L.healthStock({ fuel: [], lowOther: 6 }).level, 'crit');
  assert.strictEqual(L.healthStock({ fuel: [{ name: 'G', quantity: 400 }] }).level, 'ok');     // sans capacité : pas de niveau inventé
});
ok('santé finance : écarts de caisse rapportés au CA, plafond de crédit', () => {
  assert.strictEqual(L.healthFinance({ cashGapAbs7d: 0, sales7d: 1e6 }).level, 'ok');
  assert.strictEqual(L.healthFinance({ cashGapAbs7d: 5000, sales7d: 1e6 }).level, 'warn');
  assert.strictEqual(L.healthFinance({ cashGapAbs7d: 50000, sales7d: 1e6 }).level, 'crit');
  assert.strictEqual(L.healthFinance({ cashGapAbs7d: 100, sales7d: 0 }).level, 'warn');
  assert.strictEqual(L.healthFinance({ overLimitCustomers: 2 }).level, 'warn');
});
ok('santé opérations : quart ouvert trop longtemps, anomalies, aucune saisie hier', () => {
  assert.strictEqual(L.healthOps({ oldestOpenHours: 40 }).level, 'crit');
  assert.strictEqual(L.healthOps({ anomalies7d: 5 }).level, 'crit'); assert.strictEqual(L.healthOps({ anomalies7d: 1 }).level, 'warn');
  assert.strictEqual(L.healthOps({ shiftsYesterday: 0, shiftsPrev7d: 4 }).level, 'warn');
  assert.strictEqual(L.healthOps({ shiftsYesterday: 0, shiftsPrev7d: 0 }).level, 'ok');       // station récente / sans activité : pas d'alerte inventée
  assert.strictEqual(L.healthOps({ oldestOpenHours: 3, anomalies7d: 0, shiftsYesterday: 2, shiftsPrev7d: 8 }).level, 'ok');
});
ok('période libre : fenêtre précédente de même durée, bornes et validations', () => {
  const w = L.windowsFor('2026-11-03', { from: '2026-10-01', to: '2026-11-03' });
  assert.deepStrictEqual(w.range, ['2026-10-01', '2026-11-03']); assert.strictEqual(w.rangeDays, 34);
  assert.deepStrictEqual(w.rangePrev, ['2026-08-28', '2026-09-30']);               // 34 jours juste avant
  assert.deepStrictEqual(w.htRange, w.range); assert.ok(w.minStart <= '2026-01-01');
  assert.deepStrictEqual(L.windowsFor('2026-11-03').htRange, ['2026-11-01', '2026-11-03']);   // sans période : mois courant
  assert.throws(() => L.windowsFor('2026-11-03', { from: '2026-11-04', to: '2026-11-03' }));
  assert.throws(() => L.windowsFor('2026-11-03', { from: '2000-01-01', to: '2026-11-03' }), /dépasser/);
  assert.throws(() => L.windowsFor('2026-11-03', { from: 'x', to: '2026-11-03' }));
});
console.log(`\n${n}/${n} tests réussis.`);
