'use strict';
// CORR-040 : cartes carburant / flottes. Le vrai code de src/fleet_logic.js est exécuté (aucune base nécessaire).
const assert = require('assert');
const { evaluateCard, consumption, localParts } = require('../src/fleet_logic');
let n = 0; const check = (l, fn) => { fn(); n++; console.log('✓ ' + l); };
const base = { status: 'active', allowed_product_ids: [], allowed_days: [] };
const NOW = new Date('2026-11-04T10:30:00Z');   // mercredi 4 novembre 2026, 10 h 30 à Bamako (UTC+0)
const ev = (card, tx, usage, now = NOW) => evaluateCard({ card: { ...base, ...card }, tx: { productId: 1, liters: 40, amount: 30000, pinOk: true, ...tx }, usage, now });
const codes = r => r.reasons.map(x => x.code);

check('carte sans restriction : autorisée', () => assert.strictEqual(ev({}, {}).ok, true));
check('carte bloquée / perdue / expirée par statut : refusée avec motif', () => {
  assert.deepStrictEqual(codes(ev({ status: 'blocked', blocked_reason: 'véhicule vendu' }, {})), ['CARTE_INACTIVE']);
  assert.match(ev({ status: 'lost' }, {}).reasons[0].message, /perdue/);
  assert.match(ev({ status: 'expired' }, {}).reasons[0].message, /expirée/);
});
check('date d\'expiration dépassée : refusée ; expire aujourd\'hui : encore valable', () => {
  assert.deepStrictEqual(codes(ev({ expires_on: '2026-11-03' }, {})), ['CARTE_EXPIREE']);
  assert.strictEqual(ev({ expires_on: '2026-11-04' }, {}).ok, true);
});
check('PIN : exigé seulement si la carte en a un', () => {
  assert.strictEqual(ev({}, { pinOk: false }).ok, true);
  assert.deepStrictEqual(codes(ev({ pin_hash: 'x' }, { pinOk: false })), ['PIN_INVALIDE']);
  assert.strictEqual(ev({ pin_hash: 'x' }, { pinOk: true }).ok, true);
});
check('restriction par produit : gasoil seulement', () => {
  assert.strictEqual(ev({ allowed_product_ids: [1] }, { productId: 1 }).ok, true);
  assert.deepStrictEqual(codes(ev({ allowed_product_ids: [2] }, { productId: 1 })), ['PRODUIT_NON_AUTORISE']);
});
check('plafond par transaction : litres et montant', () => {
  assert.deepStrictEqual(codes(ev({ max_liters_tx: 30 }, {})), ['PLAFOND_TRANSACTION_L']);
  assert.deepStrictEqual(codes(ev({ max_amount_tx: 25000 }, {})), ['PLAFOND_TRANSACTION_MONTANT']);
  assert.strictEqual(ev({ max_liters_tx: 40, max_amount_tx: 30000 }, {}).ok, true);   // égalité acceptée
});
check('plafond journalier : cumul du jour + la prise demandée', () => {
  assert.strictEqual(ev({ max_liters_day: 100 }, {}, { dayLiters: 60 }).ok, true);          // 60 + 40 = 100
  assert.deepStrictEqual(codes(ev({ max_liters_day: 100 }, {}, { dayLiters: 61 })), ['PLAFOND_JOUR_L']);
  assert.deepStrictEqual(codes(ev({ max_amount_day: 50000 }, {}, { dayAmount: 25000 })), ['PLAFOND_JOUR_MONTANT']);
});
check('plafond mensuel : exemple Dakar 450 L par camion', () => {
  assert.strictEqual(ev({ max_liters_month: 450 }, { liters: 50 }, { monthLiters: 400 }).ok, true);
  const r = ev({ max_liters_month: 450 }, { liters: 50.5 }, { monthLiters: 400 });
  assert.deepStrictEqual(codes(r), ['PLAFOND_MOIS_L']); assert.match(r.reasons[0].message, /450 L/);
});
check('nombre de prises par jour', () => {
  assert.strictEqual(ev({ max_tx_day: 2 }, {}, { dayCount: 1 }).ok, true);
  assert.deepStrictEqual(codes(ev({ max_tx_day: 2 }, {}, { dayCount: 2 })), ['NB_TRANSACTIONS_JOUR']);
});
check('jours autorisés : lundi–vendredi, refus un dimanche', () => {
  assert.strictEqual(ev({ allowed_days: [1, 2, 3, 4, 5] }, {}).ok, true);                                  // mercredi
  assert.deepStrictEqual(codes(ev({ allowed_days: [1, 2, 3, 4, 5] }, {}, {}, new Date('2026-11-08T10:00:00Z'))), ['JOUR_NON_AUTORISE']);   // dimanche
});
check('horaires : plage de jour, plage de nuit, hors plage', () => {
  assert.strictEqual(ev({ hours_from: '08:00', hours_to: '18:00' }, {}).ok, true);
  assert.deepStrictEqual(codes(ev({ hours_from: '11:00', hours_to: '18:00' }, {})), ['HORAIRE_NON_AUTORISE']);
  assert.strictEqual(ev({ hours_from: '22:00', hours_to: '06:00' }, {}, {}, new Date('2026-11-04T23:30:00Z')).ok, true);
  assert.strictEqual(ev({ hours_from: '22:00', hours_to: '06:00' }, {}, {}, new Date('2026-11-04T03:00:00Z')).ok, true);
  assert.deepStrictEqual(codes(ev({ hours_from: '22:00', hours_to: '06:00' }, {})), ['HORAIRE_NON_AUTORISE']);
});
check('fuseau horaire pris en compte (UTC+2 : 23 h 30 UTC = 1 h 30 le lendemain)', () => {
  const p = localParts(new Date('2026-11-04T23:30:00Z'), 'Africa/Johannesburg'); assert.strictEqual(p.date, '2026-11-05'); assert.strictEqual(p.minutes, 90);
});
check('kilométrage : requis, incohérent, valide', () => {
  assert.deepStrictEqual(codes(ev({ requires_odometer: true }, {})), ['KILOMETRAGE_REQUIS']);
  assert.deepStrictEqual(codes(ev({ requires_odometer: true, last_odometer: 12000 }, { odometer: 11990 })), ['KILOMETRAGE_INCOHERENT']);
  assert.strictEqual(ev({ requires_odometer: true, last_odometer: 12000 }, { odometer: 12400 }).ok, true);
});
check('plusieurs violations : toutes les raisons sont renvoyées', () => {
  const r = ev({ status: 'blocked', max_liters_tx: 10, allowed_product_ids: [9] }, {});
  assert.deepStrictEqual(codes(r).sort(), ['CARTE_INACTIVE', 'PLAFOND_TRANSACTION_L', 'PRODUIT_NON_AUTORISE']);
});
check('quota restant renvoyé (jour, mois) ; null si pas de plafond', () => {
  const r = ev({ max_liters_day: 100, max_liters_month: 450 }, {}, { dayLiters: 30, monthLiters: 200 });
  assert.deepStrictEqual([r.remaining.day_liters, r.remaining.month_liters, r.remaining.day_amount], [70, 250, null]);
});
check('consommation L/100 km : plein à plein, premier plein exclu', () => {
  const c = consumption([{ liters: 60, odometer: 10000 }, { liters: 40, odometer: 10500 }, { liters: 45, odometer: 11000 }]);
  assert.deepStrictEqual(c, { km: 1000, liters: 85, l_per_100km: 8.5 });
  assert.strictEqual(consumption([{ liters: 10, odometer: 100 }]), null); assert.strictEqual(consumption([{ liters: 10 }, { liters: 12 }]), null);
});
console.log(`\n${n}/${n} contrôles réussis.`);
