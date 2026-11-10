'use strict';
/** Moteur de comptabilité générale en partie double (plan OHADA) — fonctions PURES, sans accès base (testées dans test/accounting-unit.js).
 *
 *  Principe : les écritures « automatiques » sont DÉRIVÉES des données déjà saisies dans les autres modules (ventes, compteurs de
 *  pompes, achats, règlements, dépenses, paie, trésorerie, stocks). Aucune double saisie, aucune synchronisation à maintenir :
 *  modifier ou annuler une opération dans son module corrige automatiquement la comptabilité.
 *  S'y ajoutent les écritures MANUELLES (opérations diverses, à-nouveaux) et les immobilisations saisies dans le module Comptabilité.
 *  Chaque écriture dérivée est équilibrée par construction (débit = crédit). */
const { LABELS } = require('./accounting_plan');

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const num = n => Number(n) || 0;
const isDay = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const toUTC = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const fromUTC = t => new Date(t).toISOString().slice(0, 10);
const addDays = (s, n) => fromUTC(toUTC(s) + n * 864e5);
const daysBetween = (a, b) => Math.round((toUTC(b) - toUTC(a)) / 864e5);
const endOfMonth = s => fromUTC(Date.UTC(+s.slice(0, 4), +s.slice(5, 7), 0));
const startOfYear = s => s.slice(0, 4) + '-01-01';

const JOURNALS = {
  VE: 'Journal des ventes', HA: 'Journal des achats', CA: 'Journal de caisse', BQ: 'Journal de banque', MM: 'Journal Mobile Money',
  PA: 'Journal de paie', IM: 'Journal des immobilisations', ST: 'Journal des stocks (inventaire)', AN: 'Journal des à-nouveaux', OD: 'Opérations diverses'
};
const MANUAL_JOURNALS = Object.keys(JOURNALS);

/* ------------------------------------------------------------------ comptes / moyens de paiement */
const classOf = code => +String(code).charAt(0) || 0;
const startsAny = (code, prefixes) => prefixes.some(p => String(code).startsWith(p));

function methodKind(methods, code) {
  const m = (methods || []).find(x => x.code === code);
  if (m && m.kind) return m.kind;
  const c = String(code || '').toLowerCase();
  if (/credit/.test(c)) return 'credit';
  if (/mobile|orange|wave|moov|money|mtn/.test(c)) return 'mobile_money';
  if (/banque|virement|cheque|chèque|carte|card/.test(c)) return 'banque';
  return 'especes';
}
const treasuryAccount = kind => ({ especes: '571', banque: '521', carte: '521', mobile_money: '551', credit: '411', autre: '571' }[kind] || '571');
const journalOfTreasury = acc => (String(acc).startsWith('57') ? 'CA' : String(acc).startsWith('55') ? 'MM' : 'BQ');
const revenueAccount = cat => (cat === 'CARBURANT' ? '7011' : (cat === 'LUBRIFIANT' || cat === 'HUILE') ? '7012' : '7013');
const depreciationAccount = code => {
  const c = String(code);
  if (c.startsWith('21')) return '281';
  if (c.startsWith('23')) return '283';
  if (c.startsWith('241')) return '2841';
  if (c.startsWith('244')) return '2844';
  if (c.startsWith('245')) return '2845';
  if (c.startsWith('246')) return '2846';
  return '2848';
};
const norm = s => String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
/** Compte de charge d'une dépense selon sa catégorie libre (mots-clés, sinon 638 Autres charges externes). */
function expenseAccount(category) {
  const c = norm(category);
  const rules = [
    [/salaire|paie|personnel|prime|indemnit/, '661'], [/loyer|location/, '622'], [/electri|eau\b|energie|senelec|edm|groupe electrogene/, '605'],
    [/entretien|reparation|maintenance|nettoyage/, '624'], [/transport|deplacement|mission/, '618'], [/telephon|internet|telecom|credit de comm|communication/, '628'],
    [/assurance/, '625'], [/impot|taxe|patente|cfe|tfp|douane/, '641'], [/frais bancaire|banque|commission/, '631'], [/publicite|pub\b|affichage/, '627'],
    [/honoraire|comptab|avocat|conseil/, '632'], [/fourniture|bureau|papeterie|consommable/, '604'], [/ecart|manquant|perte de caisse/, '658']
  ];
  const hit = rules.find(([re]) => re.test(c));
  return hit ? hit[1] : '638';
}

/* ------------------------------------------------------------------ outils d'écritures */
const line = (account, debit, credit, extra) => ({ account, debit: r2(debit), credit: r2(credit), ...(extra || {}) });
const Dr = (account, amount, extra) => line(account, amount, 0, extra);
const Cr = (account, amount, extra) => line(account, 0, amount, extra);
const party = (t, id) => (id == null ? null : { t, id: String(id) });

/** Aligne un arrondi résiduel (≤ 0,50) sur la dernière ligne concernée ; au-delà, l'écart est conservé (signalé par les contrôles). */
function settleRounding(lines) {
  const d = r2(lines.reduce((a, l) => a + l.debit, 0)), c = r2(lines.reduce((a, l) => a + l.credit, 0)), diff = r2(d - c);
  if (diff === 0 || Math.abs(diff) > 0.5) return lines;
  const pick = (side) => { for (let i = lines.length - 1; i >= 0; i--) if (lines[i][side] > 0) return lines[i]; return null; };
  if (diff > 0) { const l = pick('credit'); if (l) l.credit = r2(l.credit + diff); else { const m = pick('debit'); if (m) m.debit = r2(m.debit - diff); } }
  else { const l = pick('debit'); if (l) l.debit = r2(l.debit - diff); else { const m = pick('credit'); if (m) m.credit = r2(m.credit + diff); } }
  return lines;
}

class Book {
  constructor() { this.entries = []; this.seq = 0; }
  add(journal, date, ref, label, source, lines, meta) {
    const clean = lines.filter(l => l && (l.debit > 0 || l.credit > 0));
    if (!clean.length || !isDay(date)) return;
    settleRounding(clean);
    this.entries.push({ key: `${source}:${++this.seq}`, journal, date, ref, label, source, auto: true, lines: clean, ...(meta || {}) });
  }
}

/* ------------------------------------------------------------------ stocks & amortissements */
/** Valeur du stock à une date : (quantité courante − mouvements postérieurs) × prix d'achat courant. */
function makeStockValuer(stock) {
  const prods = (stock && stock.products) || [];
  const byProd = new Map();
  ((stock && stock.moves) || []).forEach(m => { const a = byProd.get(m.product_id) || []; a.push({ day: m.day, qty: num(m.qty) }); byProd.set(m.product_id, a); });
  byProd.forEach(a => a.sort((x, y) => (x.day < y.day ? -1 : x.day > y.day ? 1 : 0)));
  return function valueAt(day) {
    let v = 0;
    for (const p of prods) {
      const mv = byProd.get(p.id) || [];
      let after = 0;
      for (let i = mv.length - 1; i >= 0 && mv[i].day > day; i--) after += mv[i].qty;
      v += (num(p.qty) - after) * num(p.price);
    }
    return r2(v);
  };
}
function originStockValue(stock) {
  const prods = (stock && stock.products) || [];
  const tot = {};
  ((stock && stock.moves) || []).forEach(m => { tot[m.product_id] = (tot[m.product_id] || 0) + num(m.qty); });
  return r2(prods.reduce((a, p) => a + (num(p.qty) - (tot[p.id] || 0)) * num(p.price), 0));
}
/** Amortissement linéaire cumulé à une date (prorata temporis journalier). Les terrains (durée vide) ne s'amortissent pas. */
function depreciationAt(asset, day) {
  const life = num(asset.life_years);
  if (!(life > 0) || !isDay(asset.acquired_on) || day < asset.acquired_on) return 0;
  const end = asset.disposed_on && asset.disposed_on < day ? asset.disposed_on : day;
  const base = Math.max(0, num(asset.cost) - num(asset.residual_value));
  const used = Math.max(0, daysBetween(asset.acquired_on, end) + 1);
  return r2(base * Math.min(1, used / (life * 365)));
}

/* ------------------------------------------------------------------ dérivation des écritures */
/** @param src données brutes des modules (voir src/accounting.js : loadSources)
 *  @param opts { from, to } — `to` : dernière date comptabilisée ; `from` : début de période (ajoute un point d'inventaire la veille) */
function deriveEntries(src, opts) {
  const to = opts.to, from = opts.from && isDay(opts.from) ? opts.from : null;
  const methods = src.methods || [];
  const B = new Book();
  const inRange = d => isDay(d) && d <= to;
  const tAcc = code => treasuryAccount(methodKind(methods, code));

  // Date d'ouverture : veille de la première opération connue (les soldes initiaux y sont repris)
  const days = [];
  const seen = d => { if (isDay(d)) days.push(d); };
  ['productSales', 'fuelRevenue', 'salePayments', 'creditSales', 'customerCredits', 'customerPayments', 'invoices', 'invoicePayments', 'supplierPayments', 'expenses', 'advances', 'treasuryOther', 'empDebts', 'empDebtPayments']
    .forEach(k => (src[k] || []).forEach(x => seen(x.day)));
  (src.purchases || []).forEach(p => { seen(p.received_day); seen(p.invoice_day); });
  (src.payslips || []).forEach(p => { seen(p.vday); seen(p.pday); });
  (src.assets || []).forEach(a => seen(a.acquired_on));
  (src.manual || []).forEach(e => seen(e.date));
  (src.stock && src.stock.moves || []).forEach(m => seen(m.day));
  const firstDay = days.length ? days.sort()[0] : to;
  const openingDate = opts.openingDate && isDay(opts.openingDate) ? opts.openingDate : (firstDay < to ? firstDay : to);

  /* ---- Ouverture : soldes initiaux repris des modules (clients, caisses, comptes bancaires/Mobile Money, stock) ---- */
  const op = [];
  (src.customerOpening || []).forEach(o => { const a = r2(o.amount); if (a > 0) op.push(Dr('411', a, { party: party('client', o.customer_id) })); else if (a < 0) op.push(Cr('411', -a, { party: party('client', o.customer_id) })); });
  (src.treasuryOpening || []).forEach(o => {
    const a = r2(o.amount), acc = o.kind === 'banque' ? '521' : o.kind === 'mobile_money' ? '551' : '571';
    if (a > 0) op.push(Dr(acc, a, { label: o.label })); else if (a < 0) op.push(Cr(acc, -a, { label: o.label }));
  });
  const v0 = originStockValue(src.stock);
  if (v0 > 0) op.push(Dr('311', v0, { label: 'Stock initial' })); else if (v0 < 0) op.push(Cr('311', -v0));
  if (op.length) {
    const net = r2(op.reduce((a, l) => a + l.debit - l.credit, 0));
    if (net > 0) op.push(Cr('101', net, { label: 'Apports et soldes d’ouverture' })); else if (net < 0) op.push(Dr('101', -net, { label: 'Apports et soldes d’ouverture' }));
    B.add('AN', openingDate, 'OUVERTURE', 'Soldes d’ouverture repris des modules (clients, caisses, comptes, stock)', 'opening', op);
  }

  /* ---- Ventes (journal VE), centralisées par jour ---- */
  const revByDay = {};
  const pushRev = (row) => { const d = row.day; (revByDay[d] = revByDay[d] || []).push(row); };
  (src.productSales || []).filter(x => inRange(x.day)).forEach(pushRev);
  (src.fuelRevenue || []).filter(x => inRange(x.day)).forEach(pushRev);
  const payByDay = {}, creditByDay = {};
  (src.salePayments || []).filter(x => inRange(x.day)).forEach(p => {
    if (methodKind(methods, p.method) === 'credit') return;
    const acc = tAcc(p.method); (payByDay[p.day] = payByDay[p.day] || {})[acc] = r2(((payByDay[p.day] || {})[acc] || 0) + num(p.amount));
  });
  (src.creditSales || []).filter(x => inRange(x.day)).forEach(c => { (creditByDay[c.day] = creditByDay[c.day] || []).push(c); });
  const saleDays = [...new Set([...Object.keys(revByDay), ...Object.keys(payByDay), ...Object.keys(creditByDay)])].sort();
  for (const day of saleDays) {
    const rows = revByDay[day] || [], rev = {}, vat = {};
    let ttc = 0;
    rows.forEach(r => {
      const t = num(r.ttc), rate = num(r.rate), tax = rate > 0 ? t * rate / (100 + rate) : 0, ht = t - tax, acc = revenueAccount(r.cat);
      ttc += t; rev[acc] = (rev[acc] || 0) + ht;
      const k = String(rate); if (rate > 0) { vat[k] = vat[k] || { rate, tax: 0, base: 0 }; vat[k].tax += tax; vat[k].base += ht; }
    });
    const lines = [];
    let debit = 0;
    Object.entries(payByDay[day] || {}).forEach(([acc, amt]) => { if (amt) { lines.push(Dr(acc, amt)); debit += amt; } });
    (creditByDay[day] || []).forEach(c => { const a = r2(c.amount); if (a) { lines.push(Dr('411', a, { party: party('client', c.customer_id), label: 'Vente à crédit' })); debit += a; } });
    const resid = r2(ttc - debit);
    if (resid > 0.005) lines.push(Dr('471', resid, { label: 'Ventes non encaissées / à régulariser' }));
    else if (resid < -0.005) lines.push(Cr('471', -resid, { label: 'Encaissements sans vente / à régulariser' }));
    Object.entries(rev).forEach(([acc, v]) => lines.push(Cr(acc, v)));
    Object.values(vat).forEach(v => lines.push(Cr('4431', v.tax, { label: 'TVA collectée ' + v.rate + ' %', meta: { rate: v.rate, base: r2(v.base) } })));
    B.add('VE', day, 'VE ' + day, 'Ventes du ' + day, 'sales', lines);
  }

  /* ---- Règlements clients ---- */
  (src.customerPayments || []).filter(x => inRange(x.day)).forEach(p => {
    if (methodKind(methods, p.method) === 'credit') return;
    const acc = tAcc(p.method), a = r2(p.amount);
    B.add(journalOfTreasury(acc), p.day, 'RC-' + p.id, 'Règlement client', 'customer_payments', [Dr(acc, a), Cr('411', a, { party: party('client', p.customer_id) })]);
  });
  /* ---- Factures clients hors vente (services) et leurs règlements ---- */
  (src.invoices || []).filter(x => inRange(x.day)).forEach(i => {
    const ht = r2(i.ht), tax = r2(i.tax), ttc = r2(i.ttc || ht + tax);
    B.add('VE', i.day, i.no, 'Facture client ' + i.no, 'invoices', [
      Dr('411', ttc, { label: 'Facture hors vente (non suivie en fiche client)' }), Cr('706', ttc - tax), ...(tax ? [Cr('4431', tax, { label: 'TVA facturée', meta: { rate: null, base: ttc - tax } })] : [])]);
  });
  (src.invoicePayments || []).filter(x => inRange(x.day)).forEach(p => {
    if (methodKind(methods, p.method) === 'credit') return;
    const acc = tAcc(p.method), a = r2(p.amount);
    B.add(journalOfTreasury(acc), p.day, 'RF-' + p.id, 'Règlement de facture', 'invoice_payments', [Dr(acc, a), Cr('411', a, p.linked ? { party: party('client', p.customer_id) } : {})]);
  });

  /* ---- Achats (journal HA) : réception → 408, facture → 401 ---- */
  (src.purchases || []).forEach(p => {
    const rv = r2(p.received_value), it = p.invoice_total == null ? null : r2(p.invoice_total), sup = party('fournisseur', p.supplier_id);
    if (rv > 0 && inRange(p.received_day)) B.add('HA', p.received_day, 'RÉC ' + p.no, 'Réception marchandises ' + p.no, 'purchases', [Dr('601', rv), Cr('408', rv, { party: sup })]);
    if (it != null && it > 0 && inRange(p.invoice_day || p.received_day)) {
      const d = p.invoice_day || p.received_day, gap = r2(it - rv);
      const hasRec = rv > 0 && inRange(p.received_day);
      const lines = [Cr('401', it, { party: sup })];
      if (hasRec) lines.push(Dr('408', rv, { party: sup }));
      if (hasRec) { if (gap > 0) lines.push(Dr('601', gap)); else if (gap < 0) lines.push(Cr('601', -gap)); }
      else lines.push(Dr('601', it));
      B.add('HA', d, p.no, 'Facture fournisseur ' + p.no, 'purchases', lines);
    }
  });
  (src.customerCredits || []).filter(x => inRange(x.day)).forEach(c => {   // avoirs clients imputés sur la créance
    const a = r2(c.amount); if (a > 0) B.add('VE', c.day, 'AV-C' + c.id, 'Avoir client', 'customer_credits', [Dr('709', a), Cr('411', a, { party: party('client', c.customer_id) })]);
  });
  (src.supplierPayments || []).filter(x => inRange(x.day)).forEach(p => {
    if (p.method === 'avoir') {   // avoir fournisseur : dette réduite sans mouvement de trésorerie
      B.add('HA', p.day, 'AV-F' + p.id, 'Avoir fournisseur imputé', 'supplier_payments', [Dr('401', p.amount, { party: party('fournisseur', p.supplier_id) }), Cr('609', p.amount)]);
      return;
    }
    if (methodKind(methods, p.method) === 'credit') return;
    const acc = tAcc(p.method), a = r2(p.amount);
    B.add(journalOfTreasury(acc), p.day, 'RFO-' + p.id, 'Règlement fournisseur', 'supplier_payments', [Dr('401', a, { party: party('fournisseur', p.supplier_id) }), Cr(acc, a)]);
  });

  /* ---- Dépenses ---- */
  (src.expenses || []).filter(x => inRange(x.day)).forEach(e => {
    if (methodKind(methods, e.method) === 'credit') {   // dépense à crédit : dette diverse
      B.add('OD', e.day, 'DEP-' + e.id, 'Dépense ' + e.category, 'expenses', [Dr(expenseAccount(e.category), e.amount), Cr('471', e.amount, { label: 'Dépense à régler' })]);
      return;
    }
    const acc = tAcc(e.method);
    B.add(journalOfTreasury(acc), e.day, 'DEP-' + e.id, 'Dépense : ' + e.category + (e.comment ? ' — ' + e.comment : ''), 'expenses', [Dr(expenseAccount(e.category), e.amount), Cr(acc, e.amount)]);
  });

  /* ---- Paie : constatation à la validation du bulletin, règlement au paiement ---- */
  (src.payslips || []).forEach(s => {
    const charge = r2(s.rectifies_id ? s.net : s.gross), net = r2(s.net), adv = r2(s.rectifies_id ? 0 : s.advances), emp = r2(s.employer_charges);
    const debt = r2(s.rectifies_id ? 0 : (s.debts || 0));   // dettes / prêts du salarié retenus sur le bulletin (compte 4252, pas 431)
    if (inRange(s.vday)) {
      const resid = r2(charge - adv - debt - net), lines = [Dr('661', charge)];
      if (adv > 0) lines.push(Cr('4251', adv, { label: 'Avance retenue' }));
      if (debt > 0) lines.push(Cr('4252', debt, { label: 'Retenue de dette / prêt du salarié' }));
      lines.push(Cr('422', net));
      if (resid > 0) lines.push(Cr('431', resid, { label: 'Retenues sociales et fiscales' })); else if (resid < 0) lines.push(Dr('431', -resid));
      if (emp > 0) { lines.push(Dr('664', emp)); lines.push(Cr('431', emp, { label: 'Charges patronales' })); }
      B.add('PA', s.vday, s.number, 'Bulletin de paie ' + s.number, 'payslips', lines);
    }
    if (s.status === 'paye' && inRange(s.pday) && net > 0) {
      const acc = tAcc(s.paid_method || 'especes');
      B.add('PA', s.pday, 'PAY ' + s.number, 'Paiement du bulletin ' + s.number, 'payslips', [Dr('422', net), Cr(acc, net)]);
    }
  });
  (src.advances || []).filter(x => inRange(x.day)).forEach(a => {
    const acc = tAcc(a.method);
    B.add('PA', a.day, 'AV-' + a.id, 'Avance sur salaire', 'salary_advances', [Dr('4251', a.amount), Cr(acc, a.amount)]);
  });

  /* ---- Trésorerie : virements internes, frais, écarts de caisse, mouvements non rattachés ---- */
  (src.treasuryOther || []).filter(x => inRange(x.day)).forEach(m => {
    const a = r2(m.amount); if (!a) return;
    const acc = m.account || '571';
    let counter = '471', label = m.label || 'Mouvement de trésorerie non rattaché';
    if (['depot_bancaire', 'retrait', 'transfert', 'depot', 'transfert_entrant', 'transfert_sortant'].includes(m.kind)) { counter = '585'; label = m.label || 'Virement interne'; }
    else if (m.kind === 'ecart_cloture') { counter = a < 0 ? '658' : '758'; label = m.label || 'Écart de caisse'; }
    else if (m.kind === 'frais') counter = '631';
    else if (m.ref === 'personal_loans') { counter = '271'; label = m.label || 'Prêt hors exploitation'; }   // prêt consenti / remboursement reçu
    else if (m.ref === 'financial_events') { counter = '471'; label = m.label || 'Opération financière manuelle (à régulariser)'; }
    const j = journalOfTreasury(acc);
    B.add(j, m.day, (m.src === 'cash' ? 'CM-' : 'MM-') + m.id, label, 'treasury', a > 0 ? [Dr(acc, a), Cr(counter, a)] : [Dr(counter, -a), Cr(acc, -a)]);
  });

  /* ---- Dettes et prêts aux employés (4252) : créance constatée à la date de la dette, soldée par encaissement ou retenue sur bulletin ---- */
  (src.empDebts || []).filter(d => inRange(d.day)).forEach(d => {
    const a = r2(d.amount); if (a <= 0) return;
    if (d.cash_out) { const acc = tAcc(d.method || 'especes'); B.add(journalOfTreasury(acc), d.day, 'PRE-' + d.id, 'Prêt au salarié : ' + (d.reason || ''), 'employee_debts', [Dr('4252', a, { party: party('employe', d.employee_id) }), Cr(acc, a)]); }
    else B.add('PA', d.day, 'DET-' + d.id, 'Dette du salarié : ' + (d.reason || ''), 'employee_debts', [Dr('4252', a, { party: party('employe', d.employee_id) }), Cr('758', a)]);
  });
  (src.empDebtPayments || []).filter(x => inRange(x.day)).forEach(x => {
    if (x.source === 'salaire' || x.method === 'retenue_salaire') return;   // déjà comptabilisé par le bulletin de paie
    const a = r2(x.amount); if (a <= 0) return;
    const acc = tAcc(x.method || 'especes');
    B.add(journalOfTreasury(acc), x.day, 'RDE-' + x.id, 'Remboursement de dette par le salarié', 'employee_debt_payments', [Dr(acc, a), Cr('4252', a, { party: party('employe', x.employee_id) })]);
  });

  /* ---- Points d'inventaire (stocks) et d'amortissement : fins de mois, veille de période et date d'arrêté ---- */
  const cps = new Set([to]);
  if (from) cps.add(addDays(from, -1));
  for (let d = endOfMonth(openingDate); d <= to; d = endOfMonth(addDays(d, 1))) cps.add(d);
  const checkpoints = [...cps].filter(d => d >= openingDate && d <= to).sort();

  if (src.stock && (src.stock.products || []).length) {
    const valueAt = makeStockValuer(src.stock);
    let prev = v0;
    checkpoints.forEach(c => {
      const v = valueAt(c), dlt = r2(v - prev); prev = v;
      if (Math.abs(dlt) >= 0.005) B.add('ST', c, 'INV ' + c, 'Variation de stock au ' + c, 'stock', dlt > 0 ? [Dr('311', dlt), Cr('6031', dlt)] : [Dr('6031', -dlt), Cr('311', -dlt)]);
    });
  }

  (src.assets || []).forEach(a => {
    if (!isDay(a.acquired_on) || a.acquired_on > to) return;
    const cost = r2(a.cost), fund = { apport: '101', especes: '571', banque: '521', mobile_money: '551', dette: '481' }[a.funding] || '101';
    B.add('IM', a.acquired_on, 'IMM-' + a.id, 'Acquisition : ' + a.label, 'assets', [Dr(a.category, cost), Cr(fund, cost)]);
    const last = a.disposed_on && a.status !== 'en_service' ? a.disposed_on : null;
    const dep = depreciationAccount(a.category);
    let prev = 0;
    const cp = [...checkpoints.filter(c => c >= a.acquired_on && (!last || c < last))];
    if (last && last <= to) cp.push(last);
    [...new Set(cp)].sort().forEach(c => {
      const d = depreciationAt(a, c), dlt = r2(d - prev); prev = d;
      if (dlt > 0) B.add('IM', c, 'DOT-' + a.id, 'Dotation aux amortissements : ' + a.label, 'assets', [Dr('681', dlt), Cr(dep, dlt)]);
    });
    if (last && last <= to) {
      const acc = r2(prev), vnc = r2(cost - acc), price = r2(a.disposal_price);
      const lines = [Cr(a.category, cost)];
      if (acc > 0) lines.push(Dr(dep, acc));
      if (vnc > 0) lines.push(Dr('675', vnc, { label: 'Valeur nette comptable cédée' })); else if (vnc < 0) lines.push(Cr('675', -vnc));
      if (price > 0) { const t = a.disposal_method === 'creance' ? '485' : treasuryAccount(a.disposal_method || 'especes'); lines.push(Dr(t, price)); lines.push(Cr('775', price)); }
      B.add('IM', last, 'CES-' + a.id, (a.status === 'rebut' ? 'Mise au rebut : ' : 'Cession : ') + a.label, 'assets', lines);
    }
  });

  /* ---- Écritures manuelles (déjà équilibrées en base) ---- */
  (src.manual || []).filter(e => inRange(e.date)).forEach(e => {
    B.entries.push({ key: 'manual:' + e.id, id: e.id, journal: e.journal, date: e.date, ref: e.number, label: e.label, source: 'manual', auto: false, reference: e.reference || null,
      lines: e.lines.map(l => ({ account: l.account, debit: r2(l.debit), credit: r2(l.credit), label: l.label || null, party: l.party_type ? party(l.party_type, l.party_id) : null })) });
  });

  const order = Object.keys(JOURNALS);
  B.entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (order.indexOf(a.journal) - order.indexOf(b.journal)) || (a.key < b.key ? -1 : 1)));
  return B.entries;
}

/* ------------------------------------------------------------------ lecture du livre */
function flatten(entries) {
  const out = [];
  for (const e of entries) for (const l of e.lines) out.push({ date: e.date, journal: e.journal, entry: e.key, ref: e.ref, entryLabel: e.label, account: l.account, label: l.label || e.label, debit: l.debit, credit: l.credit, party: l.party || null, meta: l.meta || null, auto: e.auto });
  return out;
}
const entryTotals = e => ({ debit: r2(e.lines.reduce((a, l) => a + l.debit, 0)), credit: r2(e.lines.reduce((a, l) => a + l.credit, 0)) });

function labelOf(code, names) {
  if (names && names[code]) return names[code];
  if (LABELS[code]) return LABELS[code];
  for (let n = String(code).length - 1; n >= 2; n--) { const p = String(code).slice(0, n); if (names && names[p]) return names[p]; if (LABELS[p]) return LABELS[p]; }
  return 'Compte ' + code;
}

/** Balance générale : report (avant `from`), mouvements de la période et solde de clôture, par compte. */
function trialBalance(lines, from, to, names) {
  const acc = new Map();
  for (const l of lines) {
    if (l.date > to) continue;
    const a = acc.get(l.account) || { account: l.account, open: 0, debit: 0, credit: 0 };
    if (from && l.date < from) a.open += l.debit - l.credit; else { a.debit += l.debit; a.credit += l.credit; }
    acc.set(l.account, a);
  }
  const rows = [...acc.values()].map(a => {
    const open = r2(a.open), debit = r2(a.debit), credit = r2(a.credit), end = r2(open + debit - credit);
    return { account: a.account, label: labelOf(a.account, names), class: classOf(a.account), open_debit: open > 0 ? open : 0, open_credit: open < 0 ? -open : 0, debit, credit, end_debit: end > 0 ? end : 0, end_credit: end < 0 ? -end : 0, net: end };
  }).filter(r => r.open_debit || r.open_credit || r.debit || r.credit).sort((a, b) => (a.account < b.account ? -1 : 1));
  const sum = k => r2(rows.reduce((a, r) => a + r[k], 0));
  return { rows, totals: { open_debit: sum('open_debit'), open_credit: sum('open_credit'), debit: sum('debit'), credit: sum('credit'), end_debit: sum('end_debit'), end_credit: sum('end_credit') } };
}

/** Grand livre d'un compte (ou d'une liste de comptes) avec solde progressif et report. */
function ledgerOf(lines, accounts, from, to, names) {
  const set = new Set(accounts);
  return accounts.map(code => {
    const mine = lines.filter(l => l.account === code && l.date <= to).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    let run = r2(mine.filter(l => from && l.date < from).reduce((a, l) => a + l.debit - l.credit, 0));
    const opening = run, rows = [];
    for (const l of mine) {
      if (from && l.date < from) continue;
      run = r2(run + l.debit - l.credit);
      rows.push({ date: l.date, journal: l.journal, ref: l.ref, label: l.label, debit: l.debit, credit: l.credit, balance: run });
    }
    return { account: code, label: labelOf(code, names), opening, rows, debit: r2(rows.reduce((a, r) => a + r.debit, 0)), credit: r2(rows.reduce((a, r) => a + r.credit, 0)), closing: run };
  }).filter(g => set.has(g.account));
}

/** Compte de résultat (SYSCOHADA simplifié) sur [from, to]. Montants positifs : charges = débit − crédit ; produits = crédit − débit. */
function incomeStatement(lines, from, to, names) {
  const by = {};
  for (const l of lines) { if (l.date > to || (from && l.date < from) || classOf(l.account) < 6) continue; by[l.account] = (by[l.account] || 0) + l.debit - l.credit; }
  const pick = (test, sign) => Object.entries(by).filter(([c]) => test(c)).map(([c, v]) => ({ code: c, label: labelOf(c, names), amount: r2(sign * v) })).filter(x => x.amount !== 0).sort((a, b) => (a.code < b.code ? -1 : 1));
  const total = ls => r2(ls.reduce((a, x) => a + x.amount, 0));
  const S = [];
  const sec = (key, label, kind, ls) => { const s = { key, label, kind, lines: ls, total: total(ls) }; S.push(s); return s; };
  const ventes = sec('ventes', 'Ventes de marchandises', 'produit', pick(c => c.startsWith('701'), -1));
  const achats = sec('achats', 'Achats de marchandises', 'charge', pick(c => c.startsWith('601'), 1));
  const varstk = sec('varstock', 'Variation de stocks de marchandises', 'charge', pick(c => c.startsWith('6031'), 1));
  const marge = r2(ventes.total - achats.total - varstk.total);
  const autresP = sec('autres_produits', 'Autres produits d’exploitation', 'produit', pick(c => (c.startsWith('70') && !c.startsWith('701')) || /^7[1-6]/.test(c) || c.startsWith('78') || c.startsWith('79'), -1));
  const ext = sec('charges_externes', 'Autres achats et charges externes', 'charge', pick(c => /^(604|605|61|62|63)/.test(c) || (c.startsWith('60') && !/^(601|6031)/.test(c)), 1));
  const imp = sec('impots', 'Impôts et taxes', 'charge', pick(c => c.startsWith('64'), 1));
  const pers = sec('personnel', 'Charges de personnel', 'charge', pick(c => c.startsWith('66'), 1));
  const autresC = sec('autres_charges', 'Autres charges', 'charge', pick(c => c.startsWith('65'), 1));
  const dot = sec('dotations', 'Dotations aux amortissements et provisions', 'charge', pick(c => /^(68|69)/.test(c), 1));
  const exploitation = r2(marge + autresP.total - ext.total - imp.total - pers.total - autresC.total - dot.total);
  const finP = sec('produits_financiers', 'Produits financiers', 'produit', pick(c => c.startsWith('77') && !c.startsWith('775'), -1));
  const finC = sec('charges_financieres', 'Charges financières', 'charge', pick(c => c.startsWith('67') && !c.startsWith('675'), 1));
  const financier = r2(finP.total - finC.total);
  const haoP = sec('hao_produits', 'Produits hors activités ordinaires', 'produit', pick(c => /^(775|82|84|86|88)/.test(c), -1));
  const haoC = sec('hao_charges', 'Charges hors activités ordinaires', 'charge', pick(c => /^(675|81|83|85)/.test(c), 1));
  const hao = r2(haoP.total - haoC.total);
  const avantImpot = r2(exploitation + financier + hao);
  const tax = sec('impot_resultat', 'Impôts sur le résultat', 'charge', pick(c => c.startsWith('89'), 1));
  const net = r2(avantImpot - tax.total);
  const produits = r2(S.filter(s => s.kind === 'produit').reduce((a, s) => a + s.total, 0)), charges = r2(S.filter(s => s.kind === 'charge').reduce((a, s) => a + s.total, 0));
  return { from, to, sections: S, totals: { marge_commerciale: marge, resultat_exploitation: exploitation, resultat_financier: financier, resultat_hao: hao, resultat_avant_impot: avantImpot, resultat_net: net, produits, charges } };
}

/** Résultat net sur [from, to] (classes 6 à 8) — produits − charges. */
function resultOf(lines, from, to) {
  let r = 0;
  for (const l of lines) { if (l.date > to || (from && l.date < from) || classOf(l.account) < 6) continue; r += l.credit - l.debit; }
  return r2(r);
}

/** Bilan arrêté à `to`. L'exercice commence à `fyStart` : son résultat est isolé, les exercices antérieurs vont en report à nouveau. */
function balanceSheet(lines, to, fyStart) {
  const net = {}, pty = {};
  for (const l of lines) {
    if (l.date > to || classOf(l.account) >= 6) continue;
    net[l.account] = (net[l.account] || 0) + l.debit - l.credit;
    if (l.party && /^(40|41)/.test(l.account)) { const k = l.account.slice(0, 2) + ':' + l.party.id; pty[k] = (pty[k] || 0) + l.debit - l.credit; }
    else if (/^(40|41)/.test(l.account) && !/^(409|419)/.test(l.account)) { const k = l.account.slice(0, 2) + ':none'; pty[k] = (pty[k] || 0) + l.debit - l.credit; }
  }
  const sum = (prefixes) => Object.entries(net).filter(([c]) => startsAny(c, prefixes)).reduce((a, [, v]) => a + v, 0);
  const A = {}, P = {};
  const add = (o, k, v) => { o[k] = r2((o[k] || 0) + v); };
  const used = new Set();
  const take = (prefixes) => { Object.keys(net).forEach(c => { if (startsAny(c, prefixes)) used.add(c); }); return sum(prefixes); };

  A.immo_corp = r2(take(['22', '23', '24', '25']));
  A.immo_autres = r2(take(['20', '21', '26', '27']));
  A.amort = r2(take(['28', '29']));
  A.stocks = r2(take(['3']));
  // Tiers : soldes par tiers (un client créditeur ne se compense pas avec un client débiteur)
  let cliD = 0, cliC = 0, fouD = 0, fouC = 0;
  Object.entries(pty).forEach(([k, v]) => {
    if (k.startsWith('41')) { if (v >= 0) cliD += v; else cliC += -v; }
    else { if (v <= 0) fouC += -v; else fouD += v; }
  });
  const n419 = net['419'] || 0, n409 = net['409'] || 0;
  if (n419 < 0) cliC += -n419; else cliD += n419;
  if (n409 > 0) fouD += n409; else fouC += -n409;
  ['40', '41'].forEach(p => Object.keys(net).forEach(c => { if (c.startsWith(p)) used.add(c); }));
  A.clients = r2(cliD); P.clients_crediteurs = r2(cliC); A.fournisseurs_debiteurs = r2(fouD); P.fournisseurs = r2(fouC);
  const vatNet = -take(['4431', '4441', '4451', '4452', '4453']);   // > 0 : TVA due à l'État
  if (vatNet >= 0) P.tva_due = r2(vatNet); else A.tva_recuperable = r2(-vatNet);
  A.banques = r2(take(['52', '53', '56']));
  A.caisse = r2(take(['57']));
  A.portefeuille = r2(take(['55']));
  const staff = take(['42', '43']);
  if (staff <= 0) P.personnel = r2(-staff); else add(A, 'autres_creances', staff);
  const loans = take(['16']);
  if (loans <= 0) P.emprunts = r2(-loans); else add(A, 'autres_creances', loans);
  P.capital = r2(-take(['10']));
  P.reserves = r2(-take(['11', '14', '15']));
  const ran = -take(['12']), manualResult = -take(['13']);
  // Reste des comptes de bilan : selon le sens du solde
  Object.keys(net).filter(c => !used.has(c)).forEach(c => { const v = net[c]; if (v >= 0) add(A, 'autres_creances', v); else add(P, 'autres_dettes', -v); });
  // Trésorerie négative (découvert) : reclassée en dettes
  ['banques', 'caisse', 'portefeuille'].forEach(k => { if (A[k] < 0) { add(P, 'autres_dettes', -A[k]); A[k] = 0; } });
  if (A.clients < 0) A.clients = 0; if (A.stocks < 0) { add(P, 'autres_dettes', -A.stocks); A.stocks = 0; }

  const before = fyStart ? addDays(fyStart, -1) : null;
  const priorResult = before ? resultOf(lines, null, before) : 0;
  P.report = r2(ran + priorResult);
  P.resultat = r2(resultOf(lines, fyStart || null, to) + manualResult);

  const actifLines = [
    ['immo_corp', 'Immobilisations corporelles (brut)'], ['immo_autres', 'Autres immobilisations (brut)', true], ['amort', 'Amortissements cumulés'], ['stocks', 'Stocks de marchandises'],
    ['clients', 'Clients'], ['fournisseurs_debiteurs', 'Fournisseurs débiteurs'], ['tva_recuperable', 'État, TVA récupérable'], ['autres_creances', 'Autres créances'],
    ['banques', 'Banques'], ['caisse', 'Caisse'], ['portefeuille', 'Portefeuille électronique']
  ];
  const passifLines = [
    ['capital', 'Capital social et apports'], ['reserves', 'Réserves'], ['report', 'Report à nouveau (résultats antérieurs)'], ['resultat', 'Résultat de l’exercice'],
    ['fournisseurs', 'Fournisseurs'], ['clients_crediteurs', 'Clients créditeurs (avances reçues)'], ['tva_due', 'État, TVA due'],
    ['personnel', 'Personnel et organismes sociaux'], ['emprunts', 'Emprunts'], ['autres_dettes', 'Autres dettes']
  ];
  const mk = (arr, src) => arr.filter(([k, , opt]) => !(opt && !src[k])).map(([k, label]) => ({ key: k, label, amount: r2(src[k] || 0) }));
  const actif = mk(actifLines, A), passif = mk(passifLines, P);
  const totalActif = r2(actif.reduce((a, x) => a + x.amount, 0)), totalPassif = r2(passif.reduce((a, x) => a + x.amount, 0));
  return { as_of: to, fiscal_year_start: fyStart || null, actif, passif, total_actif: totalActif, total_passif: totalPassif, difference: r2(totalActif - totalPassif), balanced: Math.abs(totalActif - totalPassif) < 0.5 };
}

/** TVA sur [from, to] : collectée (4431/4441 créditeurs), déductible (4452 débiteur), mensualisée, ventilée par taux. */
function vatReport(entries, from, to) {
  const months = {}, rates = {};
  let coll = 0, ded = 0;
  for (const e of entries) {
    if (e.date > to || (from && e.date < from)) continue;
    for (const l of e.lines) {
      const m = e.date.slice(0, 7);
      if (l.account === '4431' || l.account === '4441') {
        const v = l.credit - l.debit; coll += v; months[m] = months[m] || { month: m, collected: 0, deductible: 0 }; months[m].collected += v;
        const rate = l.meta && l.meta.rate != null ? l.meta.rate : 'autre';
        rates[rate] = rates[rate] || { rate, tax: 0, base: 0 }; rates[rate].tax += v; if (l.meta && l.meta.base) rates[rate].base += l.meta.base;
      } else if (/^445[1-3]$/.test(l.account)) {
        const v = l.debit - l.credit; ded += v; months[m] = months[m] || { month: m, collected: 0, deductible: 0 }; months[m].deductible += v;
      }
    }
  }
  const rows = Object.values(months).sort((a, b) => (a.month < b.month ? -1 : 1)).map(x => ({ month: x.month, collected: r2(x.collected), deductible: r2(x.deductible), due: r2(x.collected - x.deductible) }));
  return {
    from, to, collected: r2(coll), deductible: r2(ded), due: r2(coll - ded), credit: r2(Math.max(0, ded - coll)), months: rows,
    rates: Object.values(rates).map(x => ({ rate: x.rate, base: r2(x.base), tax: r2(x.tax) })).sort((a, b) => num(a.rate) - num(b.rate))
  };
}

/** Contrôles de cohérence : le livre comptable face aux soldes réels des modules sources. */
function buildControls(ctx) {
  const T = 1;   // tolérance (FCFA)
  const rows = [];
  const cmp = (key, label, ledger, actual, hint, level) => {
    const diff = r2(ledger - actual);
    rows.push({ key, label, ledger: r2(ledger), actual: r2(actual), diff, status: Math.abs(diff) <= T ? 'ok' : (level || 'warn'), hint: Math.abs(diff) <= T ? '' : hint });
  };
  rows.push({ key: 'balanced', label: 'Écritures équilibrées (débit = crédit)', ledger: ctx.totalDebit, actual: ctx.totalCredit, diff: r2(ctx.totalDebit - ctx.totalCredit), status: Math.abs(ctx.totalDebit - ctx.totalCredit) <= T ? 'ok' : 'error', hint: 'Une écriture est déséquilibrée : contactez le support.' });
  rows.push({ key: 'bilan', label: 'Bilan : Actif = Passif', ledger: ctx.bilan.total_actif, actual: ctx.bilan.total_passif, diff: ctx.bilan.difference, status: ctx.bilan.balanced ? 'ok' : 'error', hint: 'Le bilan n’est pas équilibré.' });
  cmp('clients', 'Clients (411) ↔ soldes de la fiche clients', ctx.ledger.clients, ctx.actual.clients, 'Passez une écriture d’à-nouveau (journal AN) ou vérifiez les règlements clients.');
  cmp('fournisseurs', 'Fournisseurs (401/408) ↔ dettes de la fiche fournisseurs', ctx.ledger.fournisseurs, ctx.actual.fournisseurs, 'Écart d’ouverture fournisseurs : passez une écriture d’à-nouveau (journal AN : Débit 101 / Crédit 401).');
  cmp('caisse', 'Caisse (571) ↔ soldes des caisses', ctx.ledger.caisse, ctx.actual.caisse, 'Mouvements de caisse non rattachés à une opération : voir le compte d’attente 471.');
  cmp('banque', 'Banques (521) ↔ comptes bancaires', ctx.ledger.banque, ctx.actual.banque, 'Rapprochez le compte bancaire (Trésorerie) et vérifiez les mouvements non rattachés.');
  cmp('mobile', 'Mobile Money (551) ↔ portefeuilles électroniques', ctx.ledger.mobile, ctx.actual.mobile, 'Rapprochez le portefeuille (Trésorerie) et vérifiez les mouvements non rattachés.');
  cmp('attente', 'Compte d’attente (471) soldé', ctx.ledger.attente, 0, 'Des opérations restent à régulariser (ventes non encaissées, mouvements non rattachés).');
  return rows;
}

module.exports = {
  r2, isDay, addDays, daysBetween, endOfMonth, startOfYear, JOURNALS, MANUAL_JOURNALS, classOf, methodKind, treasuryAccount, revenueAccount, depreciationAccount, expenseAccount,
  deriveEntries, flatten, entryTotals, labelOf, trialBalance, ledgerOf, incomeStatement, resultOf, balanceSheet, vatReport, buildControls, depreciationAt, makeStockValuer, originStockValue, settleRounding
};
