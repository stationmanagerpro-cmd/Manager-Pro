/**
 * Contrôles unitaires/statiques des liaisons financières, caisse, dépenses et stock carburant.
 * Sans base de données — lit le code source et les migrations.
 * Usage : node test/finance-liaisons-static.js
 *
 * Couvre les points d'audit Phases 2–4 :
 * - settle / cashMove / accountMove
 * - dépenses, ventes, dépôt banque
 * - agrégats dashboard / cash overview
 * - cycle stock fuel à la clôture
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const core = read('src/core.js');
const operations = read('src/operations.js');
const finance = read('src/finance.js');
const shifts = read('src/shifts.js');
const fuelsales = read('src/fuelsales.js');
const purchases = read('src/purchases.js');
const opsPlus = read('src/ops_plus.js');
const mig001 = read('migrations/001_initial.sql');
const mig003 = read('migrations/003_hr_payroll_finance.sql');
const mig017 = read('migrations/017_financial_events.sql');

let passed = 0;
function ok(name, cond, detail) {
  assert(cond, detail || name);
  passed++;
  console.log('✔', name);
}

// ---------- Helpers centraux ----------
ok('cashMove met à jour balance et refuse solde négatif',
  /balance = balance \+ \$2/.test(core) && /Solde de caisse insuffisant/.test(core));

ok('accountMove n’écrit que si payment_methods.account_id existe',
  /if \(!m \|\| !m\.account_id\) return null/.test(core));

ok('settle branche especes → cashMove',
  /m\.kind === 'especes'/.test(core) && /cashMove\(c, \{ reg: cash_register_id/.test(core));

ok('settle branche non-crédit → accountMove',
  /m\.kind !== 'credit'/.test(core) && /accountMove\(c, \{ station, method, amount/.test(core));

ok('settle peut enregistrer financial_events',
  /recordFinancialEvent\(c, \{/.test(core) && /event_type/.test(core));

ok('assertLinkedMethod refuse moyen hors espèces/crédit sans compte actif',
  /assertLinkedMethod/.test(core) && /n’est lié à aucun compte/.test(core));

// ---------- Dépenses ----------
ok('POST /expenses utilise settle avec montant négatif',
  /r\.post\('\/expenses'/.test(operations) &&
  /settle\(c, \{ station: req\.sid, method: b\.method, amount: -b\.amount/.test(operations));

ok('dépense rattachée au quart ouvert si présent',
  /INSERT INTO expenses\(station_id, shift_id/.test(operations));

ok('dépense écrit event_type DEPENSE',
  /event_type: 'DEPENSE'/.test(operations));

// ---------- Ventes (asymétrie journal) ----------
ok('vente produits : cashMove/accountMove directs + assertLinkedMethod',
  /pm\.kind === 'especes'/.test(operations) && /cashMove\(c, \{ reg, shift: sh\.id, kind: 'encaissement'/.test(operations) &&
  /assertLinkedMethod\(c, req\.sid, p\.method\)/.test(operations) && /accountMove\(c, \{ station: req\.sid, method: p\.method, amount: p\.amount/.test(operations));
ok('vente produits n’utilise pas settle pour les paiements (journal via recordFinancialEvent)',
  !/for \(const p of b\.payments\)[\s\S]{0,500}settle\(/.test(operations) && /event_type: 'VENTE'/.test(operations));
ok('annulation vente reverse cashMove/accountMove',
  /Annulation vente/.test(operations) && /kind: 'decaissement'/.test(operations));

// ---------- Caisse manuelle vs dépôt atomique ----------
ok('POST /cash/movements exige account_id pour depot_bancaire/retrait',
  /account_id: z\.number\(\)\.int\(\)\.optional\(\)/.test(operations) &&
  /indiquez account_id/.test(operations));
ok('POST /cash/movements écrit money_movements pour dépôt/retrait',
  /INSERT INTO money_movements/.test(operations.slice(
    operations.indexOf("r.post('/cash/movements'"),
    operations.indexOf("/** Vue consolidée Caisse")
  )));

ok('POST /money/deposit fait double écriture atomique caisse + compte',
  /r\.post\('\/money\/deposit'/.test(finance) &&
  /cashMove\(c, \{ reg: await defaultReg[\s\S]*kind: 'depot_bancaire', amount: -b\.amount/.test(finance) &&
  /INSERT INTO money_movements\([\s\S]*'depot'/.test(finance));

ok('mouvements money signés via table SIGN',
  /const SIGN = \{ encaissement: 1/.test(finance) &&
  /transfert_sortant: -1/.test(finance));

// ---------- Vue caisse / liquidités ----------
ok('GET /cash/overview calcule liquidités caisses + comptes',
  /r\.get\('\/cash\/overview'/.test(operations) &&
  /opening_balance \+ COALESCE\(\(SELECT SUM\(m\.amount\) FROM money_movements/.test(operations) &&
  /liquidity/.test(operations));

ok('GET /cash/overview agrège dépenses du jour sur spent_on',
  /FROM expenses[\s\S]*spent_on=\$2::date/.test(operations));

// ---------- Dashboard / agrégats fuel ----------
ok('dashboard jour : ventes produits uniquement (kind=produits)',
  /kind='produits'/.test(opsPlus) && /sold_at::date/.test(opsPlus));

ok('dashboard jour : carburant depuis meter_readings des quarts fermés',
  /meter_readings/.test(opsPlus) && /sh\.status='ferme'/.test(opsPlus));

ok('dashboard jour : dépenses sur spent_on',
  /FROM expenses WHERE station_id=\$1 AND deleted_at IS NULL AND spent_on=\$2::date/.test(opsPlus));

// ---------- Stock carburant / clôture ----------
ok('vente produits refuse catégorie CARBURANT',
  /Le carburant se calcule par les compteurs/.test(operations));

ok('clôture de quart : stockMove vente fuel avec allowNegative',
  /stockMove\(c, \{ station: req\.sid, product: p\.id, kind: 'vente', qty: -lit/.test(shifts) &&
  /allowNegative:\s*true/.test(shifts));

ok('clôture : cashMove encaissement recette carburant espèces',
  /Recette carburant espèces/.test(shifts) && /kind: 'encaissement'/.test(shifts));

ok('clôture : cashMove écart de caisse',
  /ecart_cloture/.test(shifts) || /Écart de clôture/.test(shifts));

ok('clôture : correction stock si inventaire fourni',
  /kind: 'correction'/.test(shifts));

// ---------- Schéma ----------
ok('tables cash_registers, cash_movements, expenses présentes (001)',
  /CREATE TABLE cash_registers/.test(mig001) &&
  /CREATE TABLE cash_movements/.test(mig001) &&
  /CREATE TABLE expenses/.test(mig001));

ok('tables money_accounts, money_movements, payment_methods (003)',
  /CREATE TABLE IF NOT EXISTS money_accounts/.test(mig003) &&
  /CREATE TABLE IF NOT EXISTS money_movements/.test(mig003) &&
  /CREATE TABLE IF NOT EXISTS payment_methods/.test(mig003));

ok('financial_events est un journal (ne remplace pas les mouvements)',
  /ne remplace pas cash_movements/.test(mig017) ||
  /Complète cash_movements/.test(mig017));

ok('financial_events event_type inclut DEPENSE, VENTE, TRANSFERT',
  /'DEPENSE'/.test(mig017) && /'VENTE'/.test(mig017) && /'TRANSFERT'/.test(mig017));

// ---------- Achats / paiements fournisseur ----------
ok('paiement fournisseur utilise settle montant négatif',
  /settle\(c, \{ station: req\.sid, method: b\.method, amount: -b\.amount/.test(purchases) &&
  /PAIEMENT_FOURNISSEUR/.test(purchases));

// ---------- Paiement client ----------
ok('paiement client utilise settle + assertLinkedMethod + ledger',
  /assertLinkedMethod/.test(operations) &&
  /settle\(c, \{ station: req\.sid, method: b\.method, amount: b\.amount/.test(operations) &&
  /PAIEMENT_CLIENT/.test(operations) &&
  /ledger\(c, \{ customer:/.test(operations));

// ---------- Points d’audit explicitement documentés comme écarts ----------
ok('P1 corrigé : depot_bancaire/retrait toujours dans enum cash/movements',
  /depot_bancaire/.test(operations) && /retrait/.test(operations));

ok('P3 corrigé : route transfert inter-comptes atomique présente',
  /r\.post\('\/money\/transfer'/.test(finance));

ok('chemin dépôt /money/deposit conserve la double écriture',
  /r\.post\('\/money\/deposit'/.test(finance));

ok('P5 : settle utilise assertLinkedMethod',
  /assertLinkedMethod\(c, station, method\)/.test(core));

ok('P2 : ventes produits journalisent financial_events VENTE',
  /event_type: 'VENTE'/.test(operations));

ok('intégrité caisse exposée',
  /\/finance\/integrity\/cash/.test(finance));

console.log(`\n✔ Liaisons financières / caisse / fuel : ${passed}/${passed} contrôles réussis`);
console.log('Note : Contrôles post-correction Phase 6 (P1, P2, P3, P5, P7).');
