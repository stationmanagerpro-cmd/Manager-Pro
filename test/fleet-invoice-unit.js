'use strict';
// CORR-042 : facture mensuelle flotte — logique pure exécutée + contrôles statiques (migration 096, comptabilité, paiement, annulation, double facturation).
const fs = require('fs'); const path = require('path'); const assert = require('assert');
const rd = f => fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8');
const { buildFleetInvoiceLines, addDays, monthEnd, canInvoiceMonth } = require('../src/fleet_invoice_logic');
let n = 0; const check = (l, fn) => { fn(); n++; console.log('✓ ' + l); };

check('regroupement par carte + produit, total = somme exacte', () => {
  const ev = [
    { card_id: 1, product_id: 7, label: 'AB-123', card_number: 'C1', product_name: 'Gasoil', liters: 40, amount: 30000 },
    { card_id: 1, product_id: 7, label: 'AB-123', card_number: 'C1', product_name: 'Gasoil', liters: 20.5, amount: 15375 },
    { card_id: 1, product_id: 8, label: 'AB-123', card_number: 'C1', product_name: 'Super', liters: 10, amount: 8500 },
    { card_id: 2, product_id: 7, label: 'CD-456', card_number: 'C2', product_name: 'Gasoil', liters: 33.333, amount: 25000 }];
  const r = buildFleetInvoiceLines(ev);
  assert.strictEqual(r.lines.length, 3); assert.strictEqual(r.total, 78875);
  assert.strictEqual(r.lines.reduce((a, l) => a + l.amount, 0), r.total);
  const g = r.lines.find(l => /AB-123.*Gasoil/.test(l.description)); assert.strictEqual(g.quantity, 60.5); assert.match(g.description, /2 prise/);
});
check('litres nuls : ligne quand même facturée au montant', () => {
  const r = buildFleetInvoiceLines([{ card_id: 1, product_id: null, label: 'X', card_number: 'C', liters: 0, amount: 500 }]);
  assert.strictEqual(r.lines[0].quantity, 1); assert.strictEqual(r.lines[0].unit_price, 500); assert.strictEqual(r.total, 500);
});
check('dates : échéance et fin de mois (février bissextile inclus)', () => {
  assert.strictEqual(addDays('2026-11-05', 30), '2026-12-05'); assert.strictEqual(monthEnd('2028-02'), '2028-02-29'); assert.strictEqual(monthEnd('2026-10'), '2026-10-31');
});
check('un mois en cours ne se facture pas sans forcer', () => {
  assert.strictEqual(canInvoiceMonth('2026-11', '2026-11-05', false).ok, false);
  assert.strictEqual(canInvoiceMonth('2026-11', '2026-11-05', true).ok, true);
  assert.strictEqual(canInvoiceMonth('2026-10', '2026-11-01', false).ok, true);
  assert.strictEqual(canInvoiceMonth('2026-13', '2026-11-01', false).ok, false);
});
const mig = rd('migrations/096_fleet_invoices.sql'), fleet = rd('src/fleet.js'), bill = rd('src/billing.js'), acc = rd('src/accounting.js'), cat = rd('src/catalog.js');
check('migration 096 : colonnes, index unique mois actif, retour arrière', () => {
  for (const k of ['invoices ADD COLUMN IF NOT EXISTS source', 'invoices ADD COLUMN IF NOT EXISTS period_month', 'fleet_card_events ADD COLUMN IF NOT EXISTS invoice_id']) assert.ok(mig.includes(k), k);
  assert.match(mig, /UNIQUE INDEX IF NOT EXISTS invoices_fleet_month_uq[\s\S]*status <> 'annulee'/); assert.match(mig, /Réversible/);
});
check('route de génération : station, client verrouillé, double facturation, ventes valides, événements liés', () => {
  const s = fleet.slice(fleet.indexOf("'/fleet/invoices/generate'"));
  assert.match(s, /FROM customers WHERE id=\$1 AND station_id=\$2/); assert.match(s, /source='fleet' AND period_month=\$3/);
  assert.match(s, /s\.status = 'valide'/); assert.match(s, /e\.invoice_id IS NULL/); assert.match(s, /UPDATE fleet_card_events SET invoice_id = \$1 WHERE id = ANY\(\$2::bigint\[\]\) AND station_id = \$3/);
  assert.match(s, /assertBilling/); assert.match(s, /'fleet'/);
});
check('paiement : une facture flotte réduit le solde client ; annulation libère les prises', () => {
  assert.match(bill, /cur\.sale_id \|\| cur\.source === 'fleet'/);
  assert.match(bill, /UPDATE fleet_card_events SET invoice_id = NULL WHERE invoice_id = \$1 AND station_id = \$2/);
});
check('pas de double comptage : comptabilité, créances et from-sale', () => {
  assert.match(acc, /COALESCE\(i\.source,''\) <> 'fleet'/); assert.match(acc, /i\.source = 'fleet'\) AS linked/);
  assert.match(cat, /i\.sale_id \|\| i\.source === 'fleet'/); assert.match(bill, /déjà facturée dans la facture flotte/);
});
check('exports billing utilisés par fleet.js', () => { assert.match(bill, /module\.exports\.assertBilling/); assert.match(bill, /module\.exports\.nextInvoiceNo/); });
check('UI : bouton et appels', () => { const u = rd('public/ext-fleet.js'); assert.match(u, /fleetInvoices/); assert.match(u, /\/fleet\/invoices\/pending/); assert.match(u, /\/fleet\/invoices\/generate/); });
console.log(`${n} contrôles OK`);
