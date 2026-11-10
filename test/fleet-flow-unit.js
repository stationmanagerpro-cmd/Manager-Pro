'use strict';
// CORR-040 : le vrai code de src/fleet.js (contrôle d'une prise, PIN, refus journalisés hors transaction) est exécuté avec une base simulée.
const assert = require('assert'); const Module = require('module'); const path = require('path');
class HttpError extends Error { constructor(status, message, details) { super(message); this.status = status; this.details = details; } }
const poolCalls = [];
const pool = { query: async (sql, p) => { poolCalls.push({ sql, p }); return { rows: [] }; } };
const core = { pool, tx: async fn => fn(pool), HttpError, wrap: fn => fn, body: () => (q, s, n) => n && n(), need: () => (q, s, n) => n && n(), audit: async () => {} };
const chain = new Proxy(function () {}, { get: (_, k) => k === 'then' ? undefined : chain, apply: () => chain });
const stubs = { './core': core, zod: { z: chain }, express: { Router: () => new Proxy({}, { get: () => () => {} }) } };
const origLoad = Module._load; Module._load = function (req, parent, isMain) { return (parent && parent.filename && parent.filename.endsWith(path.join('src', 'fleet.js')) && stubs[req]) || origLoad.apply(this, arguments); };
process.env.FLEET_TZ = 'Africa/Bamako';
const fleet = require('../src/fleet'); Module._load = origLoad;
let n = 0; const check = async (l, fn) => { await fn(); n++; console.log('✓ ' + l); };

// Faux client de transaction : répond selon la requête.
function client(card, usage = {}, credit = 'credit') {
  return { query: async (sql) => {
    if (/FROM fleet_cards WHERE station_id/.test(sql)) return { rows: card ? [card] : [] };
    if (/FROM fleet_card_events e JOIN sales/.test(sql)) return { rows: [{ day_liters: usage.dl || 0, day_amount: usage.da || 0, day_count: usage.dc || 0, month_liters: usage.ml || 0, month_amount: usage.ma || 0 }] };
    if (/FROM payment_methods/.test(sql)) return { rows: credit ? [{ code: credit }] : [] };
    throw new Error('requête inattendue : ' + sql.slice(0, 60));
  } };
}
const card = (o = {}) => ({ id: 7, station_id: 1, customer_id: 42, card_number: 'FC1', label: 'DK-123-AB', status: 'active', allowed_product_ids: [], allowed_days: [], ...o });
const args = (o = {}) => ({ sid: 1, number: ' fc1 ', productId: 5, liters: 40, amount: 30000, userId: 9, ...o });

(async () => {
  await check('PIN : hachage salé, vérification correcte, jamais en clair', () => {
    const h = fleet.hashPin('1234'); assert.ok(!h.includes('1234')); assert.notStrictEqual(h, fleet.hashPin('1234'));
    assert.strictEqual(fleet.verifyPin('1234', h), true); assert.strictEqual(fleet.verifyPin('1235', h), false);
    assert.strictEqual(fleet.verifyPin('', h), false); assert.strictEqual(fleet.verifyPin(undefined, h), false); assert.strictEqual(fleet.verifyPin('1234', 'abc'), false);
  });
  await check('prise autorisée : numéro normalisé, moyen de paiement crédit trouvé, quota restant renvoyé', async () => {
    const f = await fleet.fleetCheck(client(card({ max_liters_day: 100 }), { dl: 30 }), args());
    assert.strictEqual(f.creditMethod, 'credit'); assert.strictEqual(f.evaluation.remaining.day_liters, 70); assert.strictEqual(f.card.customer_id, 42);
  });
  await check('carte inconnue : 404', async () => {
    await assert.rejects(() => fleet.fleetCheck(client(null), args()), e => e.status === 404);
  });
  await check('refus : 403, toutes les raisons, détails du refus pour la journalisation hors transaction', async () => {
    await assert.rejects(() => fleet.fleetCheck(client(card({ max_liters_tx: 10, status: 'blocked' })), args()), e => {
      assert.strictEqual(e.status, 403); assert.match(e.message, /Carte refusée/);
      const d = e.details.fleet_decline; assert.deepStrictEqual(d.codes.sort(), ['CARTE_INACTIVE', 'PLAFOND_TRANSACTION_L']);
      assert.strictEqual(d.card_id, 7); assert.strictEqual(d.pin_failed, false); assert.strictEqual(d.user_id, 9); return true;
    });
  });
  await check('PIN erroné : refus avec pin_failed ; PIN correct : autorisé', async () => {
    const withPin = card({ pin_hash: fleet.hashPin('4321') });
    await assert.rejects(() => fleet.fleetCheck(client(withPin), args({ pin: '0000' })), e => e.details.fleet_decline.pin_failed === true && e.details.fleet_decline.codes[0] === 'PIN_INVALIDE');
    const f = await fleet.fleetCheck(client(withPin), args({ pin: '4321' })); assert.strictEqual(f.pinned, true);
  });
  await check('plafond mensuel 450 L : cumul du mois pris en compte', async () => {
    await assert.rejects(() => fleet.fleetCheck(client(card({ max_liters_month: 450 }), { ml: 420 }), args()), e => e.details.fleet_decline.codes.includes('PLAFOND_MOIS_L'));
    await fleet.fleetCheck(client(card({ max_liters_month: 450 }), { ml: 410 }), args());
  });
  await check('aucun moyen de paiement crédit actif : refus explicite (409), pas de vente', async () => {
    await assert.rejects(() => fleet.fleetCheck(client(card(), {}, null), args()), e => e.status === 409 && /crédit/.test(e.message));
  });
  await check('fleetGuard : un refus est journalisé HORS transaction (événement decline + échec PIN), puis relancé tel quel', async () => {
    poolCalls.length = 0;
    const err = new HttpError(403, 'Carte refusée', { fleet_decline: { card_id: 7, station_id: 1, codes: ['PIN_INVALIDE'], product_id: 5, liters: 40, amount: 30000, odometer: null, pin_failed: true, user_id: 9 } });
    await assert.rejects(() => fleet.fleetGuard(Promise.reject(err)), e => e === err);
    assert.match(poolCalls[0].sql, /INSERT INTO fleet_card_events[\s\S]*'decline'/);
    assert.match(poolCalls[1].sql, /pin_failures = pin_failures \+ 1/); assert.match(poolCalls[1].sql, /THEN 'blocked'/); assert.strictEqual(poolCalls[1].p[2], fleet.MAX_PIN_FAILURES);
  });
  await check('fleetGuard : une erreur ordinaire (non liée à la carte) n\'écrit rien dans le journal', async () => {
    poolCalls.length = 0; const err = new HttpError(409, 'Stock insuffisant');
    await assert.rejects(() => fleet.fleetGuard(Promise.reject(err)), e => e === err); assert.strictEqual(poolCalls.length, 0);
  });
  await check('refus sans PIN en cause : journalisé sans toucher au compteur d\'échecs', async () => {
    poolCalls.length = 0;
    await fleet.logDecline({ card_id: 7, station_id: 1, codes: ['PLAFOND_JOUR_L'], pin_failed: false, odometer: null }); assert.strictEqual(poolCalls.length, 1);
  });
  await check('fleetRecordUse : enregistre la prise liée à la vente, met à jour le dernier kilométrage, remet les échecs PIN à zéro', async () => {
    const calls = []; const c = { query: async (sql, p) => { calls.push({ sql, p }); return { rows: [] }; } };
    await fleet.fleetRecordUse(c, { card: { id: 7, station_id: 1 } }, { saleId: 99, productId: 5, liters: 40, amount: 30000, odometer: 12500, userId: 9 });
    assert.match(calls[0].sql, /'use'/); assert.deepStrictEqual(calls[0].p.slice(0, 3), [7, 1, 99]);
    assert.match(calls[1].sql, /pin_failures = 0, last_odometer = COALESCE\(\$2, last_odometer\)/); assert.strictEqual(calls[1].p[1], 12500);
  });
  console.log(`\n${n}/${n} contrôles réussis.`);
})().catch(e => { console.error(e); process.exit(1); });
