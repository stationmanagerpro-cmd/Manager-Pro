// Test unitaire du moteur comptable (sans base) : npm run test:accounting
const assert = require('assert');
const fs = require('fs');
const E = require('../src/accounting_engine');
const { PLAN } = require('../src/accounting_plan');

let n = 0;
const ok = (c, m) => { assert(c, m); n++; };
const near = (a, b, m) => { assert(Math.abs(a - b) < 0.011, `${m} : ${a} ≠ ${b}`); n++; };

const methods = [
  { code: 'especes', kind: 'especes' }, { code: 'orange_money', kind: 'mobile_money' }, { code: 'banque', kind: 'banque' },
  { code: 'credit', kind: 'credit' }, { code: 'carte', kind: 'carte' }
];
const src = {
  methods,
  productSales: [{ day: '2026-10-05', cat: 'BOUTIQUE', rate: 18, ttc: 11800 }, { day: '2026-10-05', cat: 'HUILE', rate: 0, ttc: 5000 }],
  fuelRevenue: [{ day: '2026-10-05', cat: 'CARBURANT', rate: 18, ttc: 118000 }, { day: '2026-10-06', cat: 'CARBURANT', rate: 18, ttc: 59000 }],
  salePayments: [
    { day: '2026-10-05', method: 'especes', amount: 100000 }, { day: '2026-10-05', method: 'orange_money', amount: 14800 },
    { day: '2026-10-06', method: 'especes', amount: 39000 }
  ],
  creditSales: [{ day: '2026-10-05', customer_id: 7, amount: 20000 }, { day: '2026-10-06', customer_id: 7, amount: 20000 }],
  customerPayments: [{ id: 1, day: '2026-10-07', customer_id: 7, amount: 15000, method: 'especes' }],
  customerOpening: [{ customer_id: 7, amount: 50000 }],
  purchases: [
    { id: 1, no: 'CMD-1', supplier_id: 3, received_day: '2026-10-02', received_value: 80000, invoice_day: '2026-10-03', invoice_total: 82000 },
    { id: 2, no: 'CMD-2', supplier_id: 3, received_day: '2026-10-06', received_value: 30000, invoice_day: null, invoice_total: null }
  ],
  supplierPayments: [{ id: 1, day: '2026-10-04', supplier_id: 3, amount: 40000, method: 'banque' }],
  expenses: [{ id: 1, day: '2026-10-06', category: 'Loyer', amount: 25000, method: 'especes', comment: '' }, { id: 2, day: '2026-10-06', category: 'Divers', amount: 1000, method: 'orange_money', comment: null }],
  payslips: [{ id: 1, number: 'B-1', status: 'paye', gross: 100000, net: 80000, advances: 5000, employer_charges: 8000, vday: '2026-10-05', pday: '2026-10-06', paid_method: 'especes' }],
  advances: [{ id: 1, day: '2026-09-28', amount: 5000, method: 'especes' }],
  treasuryOpening: [{ kind: 'especes', amount: 100000, label: 'Caisse' }, { kind: 'banque', amount: 500000, label: 'Banque' }],
  treasuryOther: [
    { src: 'cash', id: 1, day: '2026-10-06', kind: 'depot_bancaire', amount: -30000, account: '571' }, { src: 'money', id: 1, day: '2026-10-06', kind: 'depot', amount: 30000, account: '521' },
    { src: 'cash', id: 2, day: '2026-10-07', kind: 'ecart_cloture', amount: -500, account: '571' }
  ],
  stock: { products: [{ id: 1, qty: 900, price: 100 }], moves: [{ product_id: 1, day: '2026-10-02', qty: 500 }, { product_id: 1, day: '2026-10-05', qty: -200 }] },
  assets: [{ id: 1, label: 'Pompe', category: '2411', acquired_on: '2026-01-01', cost: 3650000, residual_value: 0, life_years: 10, funding: 'apport', status: 'en_service' }],
  manual: [{ id: 9, number: 'OD-2026-0001', journal: 'OD', date: '2026-10-07', label: 'Capital', reference: null, lines: [{ account: '521', debit: 1000000, credit: 0 }, { account: '101', debit: 0, credit: 1000000 }] }]
};

const to = '2026-10-08', from = '2026-10-01';
const entries = E.deriveEntries(src, { from, to });
ok(entries.length > 10, 'des écritures sont produites');

// 1. Chaque écriture est équilibrée
entries.forEach(e => { const t = E.entryTotals(e); near(t.debit, t.credit, 'écriture équilibrée ' + e.key + ' ' + e.label); });

const lines = E.flatten(entries);
const tb = E.trialBalance(lines, null, to);
near(tb.totals.debit, tb.totals.credit, 'balance générale : total débit = total crédit');
near(tb.totals.end_debit, tb.totals.end_credit, 'balance générale : soldes équilibrés');

// 2. Ventes et TVA : (11800 + 118000 + 59000) à 18 % → TVA = TTC × 18/118
const vat = E.vatReport(entries, from, to);
near(vat.collected, (11800 + 118000 + 59000) * 18 / 118, 'TVA collectée');
ok(vat.rates.some(r => r.rate === 18), 'TVA ventilée par taux');
const ca = lines.filter(l => l.account.startsWith('701')).reduce((a, l) => a + l.credit - l.debit, 0);
near(ca, 11800 * 100 / 118 + 5000 + 118000 * 100 / 118 + 59000 * 100 / 118, 'ventes HT');

// 3. Ventes sans paiement correspondant : le résidu va en compte d'attente (jamais perdu)
const att = lines.filter(l => l.account === '471').reduce((a, l) => a + l.debit - l.credit, 0);
near(att, (11800 + 5000 + 118000 - 100000 - 14800 - 20000) + (59000 - 39000 - 20000) + 0, 'compte d’attente 471 (écarts ventes/paiements)');

// 4. Achats : réception puis facture (écart de facturation en 601, 408 soldé)
const f408 = lines.filter(l => l.account === '408' && l.party && l.party.id === '3').reduce((a, l) => a + l.credit - l.debit, 0);
near(f408, 30000, 'facture non parvenue (réception 30 000 non facturée)');
const f401 = lines.filter(l => l.account === '401').reduce((a, l) => a + l.credit - l.debit, 0);
near(f401, 82000 - 40000, 'dette fournisseur = facture − règlement');

// 5. Paie : charge 661 = brut ; 422 soldé après paiement ; avance 4251 apurée
near(lines.filter(l => l.account === '661').reduce((a, l) => a + l.debit - l.credit, 0), 100000, 'charge de personnel');
near(lines.filter(l => l.account === '422').reduce((a, l) => a + l.debit - l.credit, 0), 0, 'rémunérations dues soldées');
near(lines.filter(l => l.account === '4251').reduce((a, l) => a + l.debit - l.credit, 0), 0, 'avance sur salaire apurée par la retenue');

// 6. Virements internes : 585 se compense
near(lines.filter(l => l.account === '585').reduce((a, l) => a + l.debit - l.credit, 0), 0, 'virements internes compensés');

// 7. Amortissements : 3 650 000 sur 10 ans = 1 000/jour ; du 01/01 au 08/10 = 281 jours
const dep = lines.filter(l => l.account === '2841').reduce((a, l) => a + l.credit - l.debit, 0);
near(dep, 281 * 1000, 'amortissement linéaire prorata temporis');
near(E.depreciationAt(src.assets[0], '2026-12-31'), 365 * 1000, 'amortissement fin d’année');
near(E.depreciationAt({ ...src.assets[0], life_years: null }, '2026-12-31'), 0, 'terrain non amorti');

// 8. Stock : valeur = (900 − mouvements postérieurs) × 100 ; stock initial = 900 − 300 = 600 → 60 000
near(E.originStockValue(src.stock), 60000, 'stock initial');
const valueAt = E.makeStockValuer(src.stock);
near(valueAt('2026-10-08'), 90000, 'stock au 08/10');
near(valueAt('2026-10-04'), 110000, 'stock au 04/10 (avant la sortie de 200)');
near(lines.filter(l => l.account === '311').reduce((a, l) => a + l.debit - l.credit, 0), 90000, 'compte 311 = valeur du stock');

// 9. Bilan : Actif = Passif (identité comptable) et lignes attendues
const bs = E.balanceSheet(lines, to, '2026-01-01');
ok(bs.balanced, 'bilan équilibré : écart ' + bs.difference);
const L = k => (bs.actif.concat(bs.passif).find(x => x.key === k) || {}).amount;
near(L('immo_corp'), 3650000, 'immobilisations brutes');
near(L('amort'), -281000, 'amortissements cumulés (négatif)');
near(L('stocks'), 90000, 'stocks au bilan');
near(L('tva_due'), vat.due, 'TVA due au bilan');
ok(L('clients') > 0, 'clients débiteurs');
near(L('capital'), -E.flatten(entries).filter(l => l.account === '101').reduce((a, l) => a + l.debit - l.credit, 0), 'capital et apports');

// 10. Résultat : produits − charges = résultat du bilan
const is = E.incomeStatement(lines, '2026-01-01', to);
near(is.totals.resultat_net, L('resultat'), 'résultat du compte de résultat = résultat du bilan');
near(is.totals.produits - is.totals.charges, is.totals.resultat_net, 'produits − charges = résultat net');

// 11. Report à nouveau : un exercice antérieur (résultat 2025) bascule en report
const lines2 = lines.concat([{ date: '2025-12-31', journal: 'OD', entry: 'x', ref: 'x', entryLabel: 'x', account: '7013', label: 'x', debit: 0, credit: 1000, party: null }, { date: '2025-12-31', journal: 'OD', entry: 'x', ref: 'x', entryLabel: 'x', account: '571', label: 'x', debit: 1000, credit: 0, party: null }]);
const bs2 = E.balanceSheet(lines2, to, '2026-01-01');
near((bs2.passif.find(x => x.key === 'report') || {}).amount, 1000, 'report à nouveau = résultat des exercices antérieurs');
ok(bs2.balanced, 'bilan équilibré avec report');

// 12. Client créditeur : le solde négatif d'un client passe en « avances reçues », sans compensation
const lines3 = [
  { date: '2026-10-01', account: '411', debit: 100, credit: 0, party: { t: 'client', id: '1' } }, { date: '2026-10-01', account: '101', debit: 0, credit: 100, party: null },
  { date: '2026-10-02', account: '411', debit: 0, credit: 40, party: { t: 'client', id: '2' } }, { date: '2026-10-02', account: '571', debit: 40, credit: 0, party: null }
];
const bs3 = E.balanceSheet(lines3, '2026-10-05', '2026-01-01');
near(bs3.actif.find(x => x.key === 'clients').amount, 100, 'clients débiteurs');
near(bs3.passif.find(x => x.key === 'clients_crediteurs').amount, 40, 'clients créditeurs non compensés');
ok(bs3.balanced, 'bilan équilibré avec client créditeur');

// 13. Grand livre : report + solde progressif
const gl = E.ledgerOf(lines, ['571'], '2026-10-06', to)[0];
near(gl.rows.length ? gl.rows[gl.rows.length - 1].balance : gl.opening, gl.closing, 'solde progressif');
near(gl.opening + gl.debit - gl.credit, gl.closing, 'report + mouvements = solde');

// 14. Mots-clés de dépenses
ok(E.expenseAccount('Loyer du local') === '622' && E.expenseAccount('Électricité') === '605' && E.expenseAccount('Truc') === '638', 'catégories de dépenses → comptes');
ok(E.methodKind(methods, 'orange_money') === 'mobile_money' && E.methodKind([], 'wave') === 'mobile_money', 'nature des moyens de paiement');

// 15. Contrôles
const ctl = E.buildControls({
  totalDebit: tb.totals.debit, totalCredit: tb.totals.credit, bilan: bs,
  ledger: { clients: 10, fournisseurs: 0, caisse: 0, banque: 0, mobile: 0, attente: 0, ventes_ttc: 100, depenses: 5 },
  actual: { clients: 10, fournisseurs: 50, caisse: 0, banque: 0, mobile: 0, ventes_ttc: 100, depenses: 5 }
});
ok(ctl.find(c => c.key === 'clients').status === 'ok', 'contrôle clients conforme');
ok(ctl.find(c => c.key === 'fournisseurs').status === 'warn', 'contrôle fournisseurs : écart signalé');

// 16. Plan comptable : tous les comptes utilisés par le moteur existent dans le plan et dans la migration SQL
const codes = new Set(PLAN.map(p => p[0]));
['101', '311', '401', '408', '411', '422', '431', '4251', '4431', '471', '481', '485', '521', '551', '571', '585', '601', '6031', '605', '622', '631', '638', '641', '658', '661', '664', '675', '681', '706', '7011', '7012', '7013', '758', '775', '2411', '2841', '281', '283', '2844', '2845', '2846', '2848']
  .forEach(c => ok(codes.has(c), 'compte ' + c + ' absent du plan'));
const mig = fs.readFileSync(__dirname + '/../migrations/079_comptabilite.sql', 'utf8') + fs.readFileSync(__dirname + '/../migrations/085_comptabilite_prets_personnel.sql', 'utf8');
PLAN.forEach(([c]) => ok(mig.includes("('" + c + "',"), 'compte ' + c + ' absent de la migration 079'));
E.deriveEntries(src, { from, to }).forEach(e => e.lines.forEach(l => ok(codes.has(l.account) || /^(?:4452|441|4441)$/.test(l.account), 'compte inconnu produit par le moteur : ' + l.account)));

console.log(`✔ Moteur comptable : ${n} contrôles réussis`);

// 17. Avoirs : client (709 ↔ 411) et fournisseur (401 ↔ 609, sans mouvement de trésorerie)
{
  const e2 = E.deriveEntries({ methods, customerCredits: [{ id: 1, day: '2026-10-02', customer_id: 4, amount: 3000 }], supplierPayments: [{ id: 5, day: '2026-10-03', supplier_id: 2, amount: 7000, method: 'avoir' }] }, { to: '2026-10-08' });
  const l2 = E.flatten(e2);
  near(l2.filter(l => l.account === '709').reduce((a, l) => a + l.debit, 0), 3000, 'avoir client en 709');
  near(l2.filter(l => l.account === '609').reduce((a, l) => a + l.credit, 0), 7000, 'avoir fournisseur en 609');
  ok(!l2.some(l => l.account === '571'), 'un avoir ne touche pas la trésorerie');
}
console.log('✔ Avoirs');
