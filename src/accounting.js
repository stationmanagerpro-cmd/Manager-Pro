'use strict';
/** Module Comptabilité (OHADA) — API. Calculs : src/accounting_engine.js (pur). Contrat : features.modules.accounting (+ options accounting_*). */
const express = require('express');
const { swallow } = require('./safe');
const { z } = require('zod');
const { pool, tx, HttpError, wrap, need, audit, settle } = require('./core');
const { featureOn } = require('./contracts');
const { assertNotLocked } = require('./premium');
const E = require('./accounting_engine');
const csvCell = require('./csv_safe');

const router = express.Router();
/** Validation du corps de requête (zod) : renvoie les données validées ou lève une erreur 400.
 *  (core.body est un middleware Express : il ne peut pas être appelé ainsi dans un handler.) */
const body = (schema, req) => {
  const r = schema.safeParse(req.body);
  if (!r.success) throw new HttpError(400, 'Données invalides', r.error.issues.map(i => i.path.join('.') + ' : ' + i.message));
  return r.data;
};
const D = x => x == null ? null : x;
const today = () => new Date().toISOString().slice(0, 10);
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Option contractuelle (sous-module) : le module principal est déjà contrôlé par server.js. */
const sub = (key, label) => wrap(async (req, _res, next) => {
  const c = req.contract;
  if (req.user.is_global || !c || c.unrestricted || featureOn(c, 'module:' + key)) return next();
  throw new HttpError(403, `L’option « ${label} » de la Comptabilité n’est pas incluse dans votre contrat.`);
});
const view = need('accounting.view');
const manage = need('accounting.manage');

function period(req) {
  const to = dateStr.safeParse(req.query.to).success ? req.query.to : today();
  let from = dateStr.safeParse(req.query.from).success ? req.query.from : null;
  if (from && from > to) from = to;
  return { from, to };
}

/* ---------------------------------------------------------------- chargement des sources */
async function loadSources(sid, to) {
  // PostgreSQL refuse un nombre de paramètres différent du nombre de $n de la requête (« bind message supplies N parameters… »,
  // renvoyé à l'utilisateur sous la forme « Erreur interne ») : on ne transmet donc que les paramètres réellement utilisés.
  const q = (sql, p) => {
    const used = Math.max(0, ...(sql.match(/\$(\d+)/g) || []).map(x => +x.slice(1)));
    return pool.query(sql, (p || [sid, to]).slice(0, used)).then(r => r.rows);
  };
  const day = x => `to_char(${x},'YYYY-MM-DD')`;
  const [methods, productSales, fuelClosed, fuelOpen, salePayments, creditShop, creditShift, customerPayments, customerOpening, customerCredits, invoices, invoicePayments,
    purchases, supplierPayments, expenses, payslips, advances, cashOther, moneyOther, cashOpening, moneyOpening, empDebts, empDebtPayments, products, moves, assets, manualH, manualL] = await Promise.all([
    q(`SELECT code, kind FROM payment_methods WHERE station_id=$1`, [sid]),
    q(`SELECT ${day('s.sold_at::date')} AS day, cat.code AS cat, COALESCE(d.tax_rate,0)::float AS rate, SUM(d.amount)::float AS ttc
         FROM sales s JOIN sale_details d ON d.sale_id=s.id JOIN products p ON p.id=d.product_id JOIN categories cat ON cat.id=p.category_id
        WHERE s.station_id=$1 AND s.status='valide' AND s.kind='produits' AND s.sold_at::date<=$2::date GROUP BY 1,2,3`),
    q(`SELECT ${day('sh.shift_date')} AS day, cat.code AS cat, COALESCE(p.tax_rate,0)::float AS rate, SUM(m.amount)::float AS ttc
         FROM meter_readings m JOIN shifts sh ON sh.id=m.shift_id JOIN products p ON p.id=m.product_id JOIN categories cat ON cat.id=p.category_id
        WHERE sh.station_id=$1 AND sh.status='ferme' AND m.amount IS NOT NULL AND sh.shift_date<=$2::date GROUP BY 1,2,3`),
    q(`SELECT ${day('s.sold_at::date')} AS day, cat.code AS cat, COALESCE(p.tax_rate,0)::float AS rate, SUM(d.amount)::float AS ttc
         FROM sales s JOIN shifts sh ON sh.id=s.shift_id JOIN sale_details d ON d.sale_id=s.id JOIN products p ON p.id=d.product_id JOIN categories cat ON cat.id=p.category_id
        WHERE s.station_id=$1 AND s.status='valide' AND s.kind='carburant' AND sh.status<>'ferme' AND s.sold_at::date<=$2::date GROUP BY 1,2,3`),
    q(`SELECT x.day, x.method, SUM(x.amount)::float AS amount FROM (
         SELECT ${day('s.sold_at::date')} AS day, p.method, p.amount FROM payments p JOIN sales s ON s.id=p.sale_id
          WHERE s.station_id=$1 AND s.status='valide' AND s.sold_at::date<=$2::date
         UNION ALL
         SELECT ${day('sh.shift_date')}, p.method, p.amount FROM payments p JOIN shifts sh ON sh.id=p.shift_id
          WHERE p.station_id=$1 AND p.sale_id IS NULL AND p.reference='carburant' AND sh.shift_date<=$2::date) x GROUP BY 1,2`),
    q(`SELECT ${day('s.sold_at::date')} AS day, s.customer_id, SUM(p.amount)::float AS amount
         FROM payments p JOIN sales s ON s.id=p.sale_id JOIN payment_methods pm ON pm.station_id=s.station_id AND pm.code=p.method AND pm.kind='credit'
        WHERE s.station_id=$1 AND s.status='valide' AND s.customer_id IS NOT NULL AND s.sold_at::date<=$2::date GROUP BY 1,2`),
    q(`SELECT ${day('sh.shift_date')} AS day, l.customer_id, SUM(l.amount)::float AS amount
         FROM customer_ledger l JOIN shifts sh ON sh.id=l.ref_id
        WHERE l.station_id=$1 AND l.kind='credit' AND l.ref_table='shifts' AND sh.shift_date<=$2::date GROUP BY 1,2`),
    q(`SELECT cp.id, ${day('cp.paid_at::date')} AS day, cp.customer_id, cp.amount::float AS amount, cp.method
         FROM customer_payments cp JOIN customers c ON c.id=cp.customer_id WHERE c.station_id=$1 AND cp.paid_at::date<=$2::date`),
    q(`SELECT customer_id, SUM(amount)::float AS amount FROM customer_ledger WHERE station_id=$1 AND kind='solde_initial' AND occurred_at::date<=$2::date GROUP BY 1`),
    q(`SELECT l.id, ${day('l.occurred_at::date')} AS day, l.customer_id, (-l.amount)::float AS amount FROM customer_ledger l WHERE l.station_id=$1 AND l.kind='avoir' AND l.occurred_at::date<=$2::date`),
    q(`SELECT i.id, i.invoice_no AS no, ${day("COALESCE(i.issued_on, i.created_at::date)")} AS day, i.total_ht::float AS ht, i.total_tax::float AS tax, i.total_ttc::float AS ttc
         FROM invoices i WHERE i.station_id=$1 AND i.sale_id IS NULL AND COALESCE(i.source,'') <> 'fleet' AND i.status IN ('emise','partielle','payee') AND COALESCE(i.issued_on, i.created_at::date)<=$2::date`),
    q(`SELECT ip.id, ${day('ip.paid_at::date')} AS day, ip.method, ip.amount::float AS amount, i.customer_id, (i.sale_id IS NOT NULL OR i.source = 'fleet') AS linked
         FROM invoice_payments ip JOIN invoices i ON i.id=ip.invoice_id WHERE ip.station_id=$1 AND i.status<>'annulee' AND ip.paid_at::date<=$2::date`),
    q(`SELECT p.id, COALESCE(p.invoice_no, p.order_no) AS no, p.supplier_id, ${day('COALESCE(p.received_at, p.ordered_at)::date')} AS received_day,
              COALESCE((SELECT SUM(d.qty_received*d.unit_cost) FROM purchase_details d WHERE d.purchase_id=p.id),0)::float AS received_value,
              ${day('p.invoice_date')} AS invoice_day, p.invoice_total::float AS invoice_total
         FROM purchases p WHERE p.station_id=$1 AND p.status<>'annule'`),
    q(`SELECT sp.id, ${day('sp.paid_at::date')} AS day, sp.supplier_id, sp.amount::float AS amount, sp.method
         FROM supplier_payments sp JOIN suppliers s ON s.id=sp.supplier_id WHERE s.station_id=$1 AND sp.paid_at::date<=$2::date`),
    q(`SELECT e.id, ${day('e.spent_on')} AS day, e.category, e.amount::float AS amount, e.method, e.comment
         FROM expenses e WHERE e.station_id=$1 AND e.deleted_at IS NULL AND e.spent_on<=$2::date
          AND NOT (e.category='Salaires' AND COALESCE(e.comment,'') LIKE 'Bulletin %')`),
    q(`SELECT s.id, s.number, s.status, s.gross::float AS gross, s.net_pay::float AS net, COALESCE(s.advances_deducted,0)::float AS advances, COALESCE(s.debts_deducted,0)::float AS debts,
              COALESCE(s.employer_charges_total,0)::float AS employer_charges, s.rectifies_id, s.paid_method,
              ${day('COALESCE(s.validated_at, s.created_at)::date')} AS vday, ${day('s.paid_at::date')} AS pday
         FROM payslips s WHERE s.station_id=$1 AND s.status IN ('valide','paye') AND COALESCE(s.validated_at, s.created_at)::date<=$2::date`),
    q(`SELECT id, ${day('advance_date')} AS day, amount::float AS amount, method FROM salary_advances WHERE station_id=$1 AND status<>'annule' AND advance_date<=$2::date`),
    q(`SELECT m.id, ${day('m.created_at::date')} AS day, m.kind, m.amount::float AS amount, m.label, m.ref_table AS ref
         FROM cash_movements m JOIN cash_registers r ON r.id=m.cash_register_id
        WHERE r.station_id=$1 AND m.created_at::date<=$2::date
          AND (m.kind IN ('depot_bancaire','retrait','transfert','ecart_cloture','ouverture')
               OR (m.kind IN ('encaissement','decaissement') AND m.ref_table IS NULL AND COALESCE(m.label,'') NOT LIKE 'Recette carburant%')
               OR (m.kind IN ('encaissement','decaissement') AND m.ref_table IN ('personal_loans','financial_events')))`),
    q(`SELECT m.id, ${day('m.moved_on')} AS day, m.kind, m.amount::float AS amount, m.label, a.kind AS acc_kind, m.ref_table AS ref
         FROM money_movements m JOIN money_accounts a ON a.id=m.account_id
        WHERE a.station_id=$1 AND m.moved_on<=$2::date
          AND (m.kind IN ('depot','retrait','transfert_entrant','transfert_sortant','frais')
               OR (m.kind IN ('encaissement','virement_recu','virement_emis','remboursement') AND (m.ref_table IS NULL OR m.ref_table IN ('personal_loans','financial_events'))))`),
    q(`SELECT r.name AS label, (r.balance - COALESCE((SELECT SUM(m.amount) FROM cash_movements m WHERE m.cash_register_id=r.id),0))::float AS amount FROM cash_registers r WHERE r.station_id=$1`, [sid]),
    q(`SELECT a.name AS label, a.kind, a.opening_balance::float AS amount FROM money_accounts a WHERE a.station_id=$1`, [sid]),
    q(`SELECT d.id, ${day('d.debt_date')} AS day, d.employee_id, d.amount::float AS amount, d.cash_out, d.method, d.reason
         FROM employee_debts d WHERE d.station_id=$1 AND d.status<>'annule' AND d.debt_date<=$2::date`),
    q(`SELECT p.id, ${day('p.paid_at::date')} AS day, d.employee_id, p.amount::float AS amount, p.method, p.source
         FROM employee_debt_payments p JOIN employee_debts d ON d.id=p.debt_id WHERE d.station_id=$1 AND d.status<>'annule' AND p.paid_at::date<=$2::date`),
    q(`SELECT p.id, COALESCE(st.quantity,0)::float AS qty, COALESCE(p.buy_price,0)::float AS price FROM products p LEFT JOIN stock st ON st.product_id=p.id WHERE p.station_id=$1 AND p.deleted_at IS NULL`, [sid]),
    q(`SELECT m.product_id, ${day('m.created_at::date')} AS day, SUM(m.quantity)::float AS qty FROM stock_movements m WHERE m.station_id=$1 GROUP BY 1,2`, [sid]),
    q(`SELECT id, label, category, ${day('acquired_on')} AS acquired_on, cost::float AS cost, residual_value::float AS residual_value, life_years::float AS life_years, funding, status,
              ${day('disposed_on')} AS disposed_on, disposal_price::float AS disposal_price, disposal_method FROM acc_assets WHERE station_id=$1`, [sid]),
    q(`SELECT id, number, journal, ${day('entry_date')} AS date, label, reference FROM acc_entries WHERE station_id=$1 AND status='valide' AND entry_date<=$2::date`),
    q(`SELECT l.entry_id, l.account_code AS account, l.label, l.debit::float AS debit, l.credit::float AS credit, l.party_type, l.party_id
         FROM acc_entry_lines l JOIN acc_entries e ON e.id=l.entry_id WHERE e.station_id=$1 AND e.status='valide' AND e.entry_date<=$2::date ORDER BY l.entry_id, l.line_no`)
  ]);
  const byE = new Map(); manualL.forEach(l => { const a = byE.get(l.entry_id) || []; a.push(l); byE.set(l.entry_id, a); });
  return {
    methods, productSales, fuelRevenue: fuelClosed.concat(fuelOpen), salePayments, creditSales: creditShop.concat(creditShift), customerPayments,
    customerOpening: customerOpening.map(o => ({ customer_id: o.customer_id, amount: o.amount })), customerCredits, invoices, invoicePayments, purchases, supplierPayments, expenses, payslips, advances,
    treasuryOther: cashOther.map(m => ({ ...m, src: 'cash', account: '571' })).concat(moneyOther.map(m => ({ ...m, src: 'money', account: m.acc_kind === 'banque' ? '521' : '551' }))),
    treasuryOpening: cashOpening.map(c => ({ kind: 'especes', amount: c.amount, label: 'Caisse ' + c.label })).concat(moneyOpening.map(a => ({ kind: a.kind === 'banque' ? 'banque' : 'mobile_money', amount: a.amount, label: a.label }))),
    empDebts, empDebtPayments, stock: { products, moves }, assets,
    manual: manualH.map(h => ({ ...h, lines: byE.get(h.id) || [] }))
  };
}

const cache = new Map();
const bust = sid => { for (const k of cache.keys()) if (k.startsWith(sid + '|')) cache.delete(k); };
async function build(sid, from, to) {
  const key = `${sid}|${from || ''}|${to}`, hit = cache.get(key);
  if (hit && Date.now() - hit.t < 5000) return hit.v;
  const src = await loadSources(sid, to);
  const entries = E.deriveEntries(src, { from, to });
  const v = { entries, lines: E.flatten(entries) };
  if (cache.size > 40) cache.clear();
  cache.set(key, { t: Date.now(), v });
  return v;
}
async function accountNames(sid) {
  const { rows } = await pool.query(`SELECT code, label, active, is_custom, station_id FROM acc_accounts WHERE station_id IS NULL OR station_id=$1 ORDER BY station_id NULLS FIRST`, [sid]);
  const names = {}; rows.forEach(r => { names[r.code] = r.label; });
  return { names, rows };
}
async function fiscalYearFor(sid, date) {
  const { rows } = await pool.query(`SELECT id, label, to_char(start_date,'YYYY-MM-DD') AS start_date, to_char(end_date,'YYYY-MM-DD') AS end_date, status FROM acc_fiscal_years WHERE station_id=$1 AND $2::date BETWEEN start_date AND end_date`, [sid, date]);
  return rows[0] || { id: null, label: String(date).slice(0, 4), start_date: E.startOfYear(date), end_date: date.slice(0, 4) + '-12-31', status: 'ouvert', virtual: true };
}
async function assertOpen(c, sid, date) {
  const { rows } = await c.query(`SELECT label FROM acc_fiscal_years WHERE station_id=$1 AND status='cloture' AND $2::date BETWEEN start_date AND end_date`, [sid, date]);
  if (rows.length) throw new HttpError(423, `L’exercice « ${rows[0].label} » est clôturé : aucune écriture ne peut être passée à cette date.`);
  await assertNotLocked(sid, new Date(date + 'T12:00:00Z'));
}
const decorate = (e, names) => ({ ...e, lines: e.lines.map(l => ({ ...l, label_account: E.labelOf(l.account, names) })), ...E.entryTotals(e) });

/* ---------------------------------------------------------------- synthèse & contrôles */
router.get('/summary', view, wrap(async (req, res) => {
  const sid = req.sid, { from, to } = period(req);
  const [{ names }, fy, cur, now] = await Promise.all([accountNames(sid), fiscalYearFor(sid, to), build(sid, from, to), build(sid, null, today())]);
  const is = E.incomeStatement(cur.lines, from || fy.start_date, to, names);
  const bs = E.balanceSheet(cur.lines, to, fy.start_date);
  const net = a => cur.lines.filter(l => l.date <= to && l.account.startsWith(a)).reduce((s, l) => s + l.debit - l.credit, 0);
  const nowNet = (a, party) => now.lines.filter(l => l.account.startsWith(a) && (!party || l.party)).reduce((s, l) => s + l.debit - l.credit, 0);
  const one = async (sql) => (await pool.query(sql, [sid])).rows;
  const [cu, su, ca, mo, locks] = await Promise.all([
    one(`SELECT COALESCE(SUM(balance),0)::float AS v FROM customers WHERE station_id=$1 AND deleted_at IS NULL`),
    one(`SELECT COALESCE(SUM(balance_due),0)::float AS v FROM suppliers WHERE station_id=$1 AND deleted_at IS NULL`),
    one(`SELECT COALESCE(SUM(balance),0)::float AS v FROM cash_registers WHERE station_id=$1`),
    one(`SELECT a.kind, SUM(a.opening_balance + COALESCE((SELECT SUM(x.amount) FROM money_movements x WHERE x.account_id=a.id),0))::float AS v FROM money_accounts a WHERE a.station_id=$1 GROUP BY a.kind`),
    pool.query(`SELECT period_type, period_key FROM period_locks WHERE station_id=$1 AND unlocked_at IS NULL ORDER BY period_key DESC LIMIT 12`, [sid]).then(r => r.rows).catch(swallow('accounting:172', []))
  ]);
  const moK = k => (mo.find(x => x.kind === k) || { v: 0 }).v;
  const tb = E.trialBalance(now.lines, null, today(), names);
  const controls = E.buildControls({
    totalDebit: tb.totals.debit, totalCredit: tb.totals.credit, bilan: E.balanceSheet(now.lines, today(), (await fiscalYearFor(sid, today())).start_date),
    ledger: { clients: nowNet('411', true), fournisseurs: -(nowNet('401') + nowNet('408') + nowNet('409')), caisse: nowNet('571'), banque: nowNet('521'), mobile: nowNet('551'), attente: nowNet('471') + nowNet('585') },
    actual: { clients: cu[0].v, fournisseurs: su[0].v, caisse: ca[0].v, banque: moK('banque'), mobile: moK('mobile_money') }
  });
  const counts = {}; cur.entries.filter(e => e.date <= to && (!from || e.date >= from)).forEach(e => { counts[e.journal] = (counts[e.journal] || 0) + 1; });
  res.json({
    from, to, fiscal_year: fy, controls, journals_count: counts, locks,
    kpis: { produits: is.totals.produits, charges: is.totals.charges, resultat: is.totals.resultat_net, marge_commerciale: is.totals.marge_commerciale,
      tresorerie: E.r2(net('57') + net('52') + net('55')), clients: bs.actif.find(x => x.key === 'clients').amount, fournisseurs: bs.passif.find(x => x.key === 'fournisseurs').amount,
      tva_due: (bs.passif.find(x => x.key === 'tva_due') || { amount: 0 }).amount }
  });
}));

/* ---------------------------------------------------------------- journaux / grand livre / balance */
router.get('/journals', view, wrap(async (req, res) => {
  const sid = req.sid, { from, to } = period(req), jr = String(req.query.journal || ''), q = norm(req.query.q);
  const limit = Math.min(+req.query.limit || 200, 1000), offset = Math.max(+req.query.offset || 0, 0);
  const [{ names }, cur] = await Promise.all([accountNames(sid), build(sid, from, to)]);
  let list = cur.entries.filter(e => (!from || e.date >= from) && e.date <= to);
  const summary = Object.keys(E.JOURNALS).map(code => {
    const es = list.filter(e => e.journal === code);
    return { code, label: E.JOURNALS[code], count: es.length, debit: E.r2(es.reduce((a, e) => a + E.entryTotals(e).debit, 0)) };
  });
  if (jr) list = list.filter(e => e.journal === jr);
  if (q) list = list.filter(e => norm(e.label + ' ' + e.ref + ' ' + (e.reference || '') + ' ' + e.lines.map(l => l.account).join(' ')).includes(q));
  res.json({ from, to, journals: summary, total: list.length, entries: list.slice(offset, offset + limit).map(e => decorate(e, names)) });
}));
function norm(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }

router.get('/ledger', view, wrap(async (req, res) => {
  const sid = req.sid, { from, to } = period(req), acc = String(req.query.account || '').replace(/[^0-9]/g, '');
  const [{ names }, cur] = await Promise.all([accountNames(sid), build(sid, from, to)]);
  const active = [...new Set(cur.lines.filter(l => l.date <= to).map(l => l.account))].sort();
  const pick = acc ? active.filter(c => c.startsWith(acc)) : active;
  const tb = E.trialBalance(cur.lines, from, to, names);
  if (!acc) return res.json({ from, to, accounts: tb.rows.map(r => ({ account: r.account, label: r.label, debit: r.debit, credit: r.credit, net: r.net })) });
  res.json({ from, to, ledgers: E.ledgerOf(cur.lines, pick.slice(0, Math.min(Math.max(+req.query.max || 40, 1), 400)), from, to, names) });
}));
router.get('/trial-balance', view, wrap(async (req, res) => {
  const { from, to } = period(req), [{ names }, cur] = await Promise.all([accountNames(req.sid), build(req.sid, from, to)]);
  res.json({ from, to, ...E.trialBalance(cur.lines, from, to, names) });
}));
router.get('/income-statement', view, wrap(async (req, res) => {
  const { from, to } = period(req), [{ names }, cur] = await Promise.all([accountNames(req.sid), build(req.sid, from, to)]);
  res.json(E.incomeStatement(cur.lines, from, to, names));
}));
router.get('/balance-sheet', view, wrap(async (req, res) => {
  const { to } = period(req), fy = await fiscalYearFor(req.sid, to), cur = await build(req.sid, fy.start_date, to);
  res.json({ ...E.balanceSheet(cur.lines, to, fy.start_date), fiscal_year: fy });
}));
router.get('/vat', view, sub('accounting_vat', 'TVA'), wrap(async (req, res) => {
  const { from, to } = period(req), cur = await build(req.sid, from, to);
  res.json(E.vatReport(cur.entries, from, to));
}));

/* ---------------------------------------------------------------- export CSV */
router.get('/export', view, sub('accounting_export', 'Export comptable'), wrap(async (req, res) => {
  const sid = req.sid, { from, to } = period(req), kind = String(req.query.kind || 'journal');
  const [{ names }, cur] = await Promise.all([accountNames(sid), build(sid, from, to)]);
  const rows = [];
  if (kind === 'balance') {
    rows.push(['Compte', 'Libellé', 'Report débit', 'Report crédit', 'Débit', 'Crédit', 'Solde débiteur', 'Solde créditeur']);
    E.trialBalance(cur.lines, from, to, names).rows.forEach(r => rows.push([r.account, r.label, r.open_debit, r.open_credit, r.debit, r.credit, r.end_debit, r.end_credit]));
  } else {
    rows.push(['Date', 'Journal', 'Pièce', 'Compte', 'Libellé compte', 'Libellé écriture', 'Débit', 'Crédit']);
    cur.lines.filter(l => (!from || l.date >= from) && l.date <= to).forEach(l => rows.push([l.date, l.journal, l.ref, l.account, E.labelOf(l.account, names), l.label, l.debit, l.credit]));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="compta_${kind}_${from || 'debut'}_${to}.csv"`);
  res.send('\uFEFF' + rows.map(r => r.map(csvCell).join(';')).join('\r\n'));
}));

/** Moyens de paiement utilisables pour financer / encaisser une immobilisation (liaison Trésorerie). */
router.get('/payment-methods', view, wrap(async (req, res) => {
  const { rows } = await pool.query(`SELECT code, label, kind FROM payment_methods WHERE station_id=$1 AND kind IN ('especes','banque','carte','mobile_money') ORDER BY label`, [req.sid]);
  res.json({ methods: rows });
}));

/* ---------------------------------------------------------------- plan comptable */
router.get('/accounts', view, wrap(async (req, res) => {
  const sid = req.sid, { from, to } = period(req), { rows } = await accountNames(sid);
  const cur = await build(sid, from, to), tb = new Map(E.trialBalance(cur.lines, from, to).rows.map(r => [r.account, r]));
  const merged = new Map(); rows.forEach(r => merged.set(r.code, r));
  const list = [...merged.values()].map(r => { const t = tb.get(r.code); return { code: r.code, label: r.label, class: E.classOf(r.code), active: r.active, is_custom: r.is_custom, debit: t ? t.debit : 0, credit: t ? t.credit : 0, net: t ? t.net : 0 }; });
  tb.forEach((t, code) => { if (!merged.has(code)) list.push({ code, label: t.label, class: t.class, active: true, is_custom: false, debit: t.debit, credit: t.credit, net: t.net }); });
  res.json({ accounts: list.sort((a, b) => (a.code < b.code ? -1 : 1)) });
}));
router.post('/accounts', manage, wrap(async (req, res) => {
  const b = body(z.object({ code: z.string().regex(/^[0-9]{3,10}$/), label: z.string().trim().min(2).max(120) }), req);
  const { rows: ex } = await pool.query(`SELECT 1 FROM acc_accounts WHERE code=$2 AND (station_id IS NULL OR station_id=$1)`, [req.sid, b.code]);
  if (ex.length) throw new HttpError(409, 'Ce numéro de compte existe déjà dans le plan comptable.');
  const { rows } = await pool.query(`INSERT INTO acc_accounts(station_id, code, label, is_custom, created_by) VALUES ($1,$2,$3,TRUE,$4) RETURNING id, code, label`, [req.sid, b.code, b.label, req.user.id]);
  await audit(pool, req, 'comptabilite', 'Création du compte ' + b.code, 'acc_accounts', rows[0].id, null, rows[0]);
  res.status(201).json(rows[0]);
}));
router.put('/accounts/:code', manage, wrap(async (req, res) => {
  const b = body(z.object({ label: z.string().trim().min(2).max(120).optional(), active: z.boolean().optional() }), req);
  const { rows } = await pool.query(`UPDATE acc_accounts SET label=COALESCE($3,label), active=COALESCE($4,active) WHERE station_id=$1 AND code=$2 AND is_custom RETURNING code,label,active`, [req.sid, req.params.code, D(b.label), D(b.active)]);
  if (!rows.length) throw new HttpError(404, 'Seuls les comptes personnalisés de votre société sont modifiables.');
  await audit(pool, req, 'comptabilite', 'Modification du compte ' + req.params.code, 'acc_accounts', null, null, rows[0]);
  res.json(rows[0]);
}));

/* ---------------------------------------------------------------- écritures manuelles */
const lineSchema = z.object({
  account: z.string().regex(/^[0-9]{2,10}$/), label: z.string().max(200).optional().nullable(),
  debit: z.coerce.number().min(0).default(0), credit: z.coerce.number().min(0).default(0),
  party_type: z.enum(['client', 'fournisseur']).optional().nullable(), party_id: z.coerce.number().int().positive().optional().nullable()
});
router.get('/entries', view, wrap(async (req, res) => {
  const { from, to } = period(req);
  const { rows } = await pool.query(`SELECT e.id, e.number, e.journal, to_char(e.entry_date,'YYYY-MM-DD') AS date, e.label, e.reference, e.status, e.cancel_reason, u.full_name AS author,
      (SELECT COALESCE(SUM(debit),0) FROM acc_entry_lines WHERE entry_id=e.id)::float AS total FROM acc_entries e LEFT JOIN users u ON u.id=e.created_by
      WHERE e.station_id=$1 AND e.entry_date <= $2::date AND ($3::date IS NULL OR e.entry_date >= $3::date) ORDER BY e.entry_date DESC, e.id DESC LIMIT 300`, [req.sid, to, from]);
  res.json({ entries: rows });
}));
router.post('/entries', manage, sub('accounting_entries', 'Saisie d’écritures'), wrap(async (req, res) => {
  const b = body(z.object({
    journal: z.enum(E.MANUAL_JOURNALS).default('OD'), entry_date: dateStr, label: z.string().trim().min(2).max(200), reference: z.string().max(80).optional().nullable(),
    lines: z.array(lineSchema).min(2).max(60)
  }), req);
  const lines = b.lines.map(l => ({ ...l, debit: E.r2(l.debit), credit: E.r2(l.credit) }));
  if (lines.some(l => (l.debit > 0) === (l.credit > 0))) throw new HttpError(400, 'Chaque ligne doit comporter soit un débit, soit un crédit (pas les deux, pas aucun).');
  const d = E.r2(lines.reduce((a, l) => a + l.debit, 0)), c = E.r2(lines.reduce((a, l) => a + l.credit, 0));
  if (d !== c) throw new HttpError(400, `Écriture déséquilibrée : débit ${d} ≠ crédit ${c}.`);
  const { rows: known } = await pool.query(`SELECT code FROM acc_accounts WHERE active AND (station_id IS NULL OR station_id=$1) AND code = ANY($2)`, [req.sid, [...new Set(lines.map(l => l.account))]]);
  const ok = new Set(known.map(r => r.code)), bad = lines.find(l => !ok.has(l.account));
  if (bad) throw new HttpError(400, `Compte ${bad.account} inconnu ou inactif dans le plan comptable.`);
  const out = await tx(async c2 => {
    await assertOpen(c2, req.sid, b.entry_date);
    for (const l of lines) if (l.party_id) {
      const t = l.party_type === 'fournisseur' ? 'suppliers' : 'customers';
      const { rows } = await c2.query(`SELECT 1 FROM ${t} WHERE id=$1 AND station_id=$2`, [l.party_id, req.sid]);
      if (!rows.length) throw new HttpError(400, 'Tiers introuvable pour la ligne ' + l.account);
    }
    await c2.query(`SELECT pg_advisory_xact_lock($1)`, [7900000 + Number(req.sid)]);
    const yr = b.entry_date.slice(0, 4);
    const { rows: n } = await c2.query(`SELECT COUNT(*)::int AS n FROM acc_entries WHERE station_id=$1 AND journal=$2 AND number LIKE $3`, [req.sid, b.journal, `${b.journal}-${yr}-%`]);
    const number = `${b.journal}-${yr}-${String(n[0].n + 1).padStart(4, '0')}`;
    const { rows: e } = await c2.query(`INSERT INTO acc_entries(station_id, journal, number, entry_date, label, reference, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, number`,
      [req.sid, b.journal, number, b.entry_date, b.label, D(b.reference), req.user.id]);
    let i = 0;
    for (const l of lines) await c2.query(`INSERT INTO acc_entry_lines(entry_id, line_no, account_code, label, debit, credit, party_type, party_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [e[0].id, ++i, l.account, D(l.label), l.debit, l.credit, l.party_id ? l.party_type : null, l.party_id || null]);
    await audit(c2, req, 'comptabilite', 'Écriture ' + number + ' — ' + b.label, 'acc_entries', e[0].id, null, { total: d });
    return e[0];
  });
  bust(req.sid);
  res.status(201).json(out);
}));
router.post('/entries/:id/cancel', manage, sub('accounting_entries', 'Saisie d’écritures'), wrap(async (req, res) => {
  const b = body(z.object({ reason: z.string().trim().min(3).max(300) }), req);
  const out = await tx(async c => {
    const { rows } = await c.query(`SELECT id, number, to_char(entry_date,'YYYY-MM-DD') AS d, status FROM acc_entries WHERE id=$1 AND station_id=$2 FOR UPDATE`, [req.params.id, req.sid]);
    if (!rows.length) throw new HttpError(404, 'Écriture introuvable.');
    if (rows[0].status === 'annule') throw new HttpError(409, 'Écriture déjà annulée.');
    await assertOpen(c, req.sid, rows[0].d);
    await c.query(`UPDATE acc_entries SET status='annule', cancel_reason=$2, cancelled_by=$3, cancelled_at=now() WHERE id=$1 AND station_id=$4`, [rows[0].id, b.reason, req.user.id, req.sid]);
    await audit(c, req, 'comptabilite', 'Annulation de l’écriture ' + rows[0].number + ' : ' + b.reason, 'acc_entries', rows[0].id, { status: 'valide' }, { status: 'annule' });
    return { id: rows[0].id, number: rows[0].number };
  });
  bust(req.sid);
  res.json(out);
}));

/* ---------------------------------------------------------------- immobilisations */
router.get('/assets', view, sub('accounting_assets', 'Immobilisations'), wrap(async (req, res) => {
  const { to } = period(req), { rows } = await pool.query(`SELECT id, label, category, to_char(acquired_on,'YYYY-MM-DD') AS acquired_on, cost::float AS cost, residual_value::float AS residual_value, life_years::float AS life_years,
      funding, status, to_char(disposed_on,'YYYY-MM-DD') AS disposed_on, disposal_price::float AS disposal_price, supplier_name, notes FROM acc_assets WHERE station_id=$1 ORDER BY acquired_on DESC, id DESC`, [req.sid]);
  const assets = rows.map(a => { const dep = E.depreciationAt(a, to); return { ...a, depreciation: dep, net_value: E.r2(a.cost - dep) }; });
  res.json({ as_of: to, assets, totals: { cost: E.r2(assets.filter(a => a.status === 'en_service').reduce((s, a) => s + a.cost, 0)), depreciation: E.r2(assets.filter(a => a.status === 'en_service').reduce((s, a) => s + a.depreciation, 0)) } });
}));
router.post('/assets', manage, sub('accounting_assets', 'Immobilisations'), wrap(async (req, res) => {
  const b = body(z.object({
    label: z.string().trim().min(2).max(150), category: z.string().regex(/^2[0-9]{1,9}$/), acquired_on: dateStr, cost: z.coerce.number().positive(), residual_value: z.coerce.number().min(0).default(0),
    life_years: z.coerce.number().positive().max(100).optional().nullable(), funding: z.enum(['apport', 'dette', 'tresorerie']).default('apport'), funding_method: z.string().max(40).optional().nullable(),
    supplier_name: z.string().max(150).optional().nullable(), notes: z.string().max(500).optional().nullable()
  }), req);
  if (b.residual_value > b.cost) throw new HttpError(400, 'La valeur résiduelle ne peut dépasser le coût.');
  if (!b.category.startsWith('22') && !b.life_years) throw new HttpError(400, 'Indiquez la durée d’amortissement (années). Seuls les terrains ne sont pas amortis.');
  const out = await tx(async c => {
    await assertOpen(c, req.sid, b.acquired_on);
    let funding = b.funding;
    if (b.funding === 'tresorerie') {
      if (!b.funding_method) throw new HttpError(400, 'Choisissez le moyen de paiement utilisé.');
      const { rows } = await c.query(`SELECT kind FROM payment_methods WHERE station_id=$1 AND code=$2`, [req.sid, b.funding_method]);
      if (!rows.length) throw new HttpError(400, 'Moyen de paiement inconnu.');
      funding = { especes: 'especes', banque: 'banque', carte: 'banque', mobile_money: 'mobile_money' }[rows[0].kind];
      if (!funding) throw new HttpError(400, 'Ce moyen de paiement ne peut pas financer une immobilisation.');
    }
    const { rows } = await c.query(`INSERT INTO acc_assets(station_id,label,category,acquired_on,cost,residual_value,life_years,funding,funding_method,supplier_name,notes,created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [req.sid, b.label, b.category, b.acquired_on, b.cost, b.residual_value, b.category.startsWith('22') ? null : D(b.life_years), funding, b.funding === 'tresorerie' ? b.funding_method : null, D(b.supplier_name), D(b.notes), req.user.id]);
    if (b.funding === 'tresorerie')   // liaison Trésorerie : le décaissement réel est enregistré dans la caisse / le compte concerné
      await settle(c, { station: req.sid, method: b.funding_method, amount: -b.cost, label: 'Acquisition immobilisation : ' + b.label, ref: ['acc_assets', rows[0].id], by: req.user.id });
    await audit(c, req, 'comptabilite', 'Immobilisation : ' + b.label, 'acc_assets', rows[0].id, null, { cost: b.cost, category: b.category });
    return rows[0];
  });
  bust(req.sid);
  res.status(201).json(out);
}));
router.post('/assets/:id/dispose', manage, sub('accounting_assets', 'Immobilisations'), wrap(async (req, res) => {
  const b = body(z.object({ status: z.enum(['cede', 'rebut']), disposed_on: dateStr, price: z.coerce.number().min(0).default(0), method: z.string().max(40).optional().nullable() }), req);
  const out = await tx(async c => {
    const { rows } = await c.query(`SELECT id, label, status, to_char(acquired_on,'YYYY-MM-DD') AS acquired_on FROM acc_assets WHERE id=$1 AND station_id=$2 FOR UPDATE`, [req.params.id, req.sid]);
    if (!rows.length) throw new HttpError(404, 'Immobilisation introuvable.');
    if (rows[0].status !== 'en_service') throw new HttpError(409, 'Immobilisation déjà sortie du patrimoine.');
    if (b.disposed_on < rows[0].acquired_on) throw new HttpError(400, 'La date de sortie précède l’acquisition.');
    await assertOpen(c, req.sid, b.disposed_on);
    let dm = null;
    if (b.price > 0) {
      if (b.method === 'creance') dm = 'creance';
      else {
        const { rows: m } = await c.query(`SELECT kind FROM payment_methods WHERE station_id=$1 AND code=$2`, [req.sid, b.method || '']);
        if (!m.length) throw new HttpError(400, 'Indiquez le moyen d’encaissement du prix de cession.');
        dm = { especes: 'especes', banque: 'banque', carte: 'banque', mobile_money: 'mobile_money' }[m[0].kind] || 'especes';
        await settle(c, { station: req.sid, method: b.method, amount: b.price, label: 'Cession immobilisation : ' + rows[0].label, ref: ['acc_assets', rows[0].id], by: req.user.id });
      }
    }
    await c.query(`UPDATE acc_assets SET status=$2, disposed_on=$3, disposal_price=$4, disposal_method=$5 WHERE id=$1 AND station_id=$6`, [rows[0].id, b.status, b.disposed_on, b.price, dm, req.sid]);
    await audit(c, req, 'comptabilite', (b.status === 'cede' ? 'Cession' : 'Mise au rebut') + ' : ' + rows[0].label, 'acc_assets', rows[0].id, { status: 'en_service' }, { status: b.status, price: b.price });
    return { id: rows[0].id };
  });
  bust(req.sid);
  res.json(out);
}));

/* ---------------------------------------------------------------- exercices */
router.get('/fiscal-years', view, wrap(async (req, res) => {
  const { rows } = await pool.query(`SELECT id, label, to_char(start_date,'YYYY-MM-DD') AS start_date, to_char(end_date,'YYYY-MM-DD') AS end_date, status, closing_result::float AS closing_result, closed_at FROM acc_fiscal_years WHERE station_id=$1 ORDER BY start_date DESC`, [req.sid]);
  const cur = rows.length ? await build(req.sid, null, today()) : null;
  res.json({ fiscal_years: rows.map(r => ({ ...r, result: cur ? E.resultOf(cur.lines, r.start_date, r.end_date) : 0 })) });
}));
router.post('/fiscal-years', manage, sub('accounting_closing', 'Exercices et clôture'), wrap(async (req, res) => {
  const b = body(z.object({ label: z.string().trim().min(2).max(40), start_date: dateStr, end_date: dateStr }), req);
  if (b.end_date < b.start_date) throw new HttpError(400, 'La date de fin précède la date de début.');
  if (E.daysBetween(b.start_date, b.end_date) > 400) throw new HttpError(400, 'Un exercice ne peut pas dépasser environ 12 mois (400 jours max).');
  const { rows: ov } = await pool.query(`SELECT label FROM acc_fiscal_years WHERE station_id=$1 AND daterange(start_date, end_date, '[]') && daterange($2::date, $3::date, '[]')`, [req.sid, b.start_date, b.end_date]);
  if (ov.length) throw new HttpError(409, `Chevauchement avec l’exercice « ${ov[0].label} ».`);
  const { rows } = await pool.query(`INSERT INTO acc_fiscal_years(station_id,label,start_date,end_date,created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [req.sid, b.label, b.start_date, b.end_date, req.user.id]);
  await audit(pool, req, 'comptabilite', 'Exercice ' + b.label, 'acc_fiscal_years', rows[0].id, null, b);
  res.status(201).json(rows[0]);
}));
router.post('/fiscal-years/:id/close', manage, sub('accounting_closing', 'Exercices et clôture'), wrap(async (req, res) => {
  const out = await tx(async c => {
    const { rows } = await c.query(`SELECT id, label, to_char(start_date,'YYYY-MM-DD') AS s, to_char(end_date,'YYYY-MM-DD') AS e, status FROM acc_fiscal_years WHERE id=$1 AND station_id=$2 FOR UPDATE`, [req.params.id, req.sid]);
    if (!rows.length) throw new HttpError(404, 'Exercice introuvable.');
    if (rows[0].status === 'cloture') throw new HttpError(409, 'Exercice déjà clôturé.');
    if (rows[0].e >= today()) throw new HttpError(400, 'Impossible de clôturer un exercice qui n’est pas terminé.');
    const cur = await build(req.sid, rows[0].s, rows[0].e), bs = E.balanceSheet(cur.lines, rows[0].e, rows[0].s);
    if (!bs.balanced) throw new HttpError(409, `Le bilan n’est pas équilibré (écart ${bs.difference}) : clôture refusée.`);
    const result = E.resultOf(cur.lines, rows[0].s, rows[0].e);
    await c.query(`UPDATE acc_fiscal_years SET status='cloture', closing_result=$2, closed_at=now(), closed_by=$3 WHERE id=$1 AND station_id=$4`, [rows[0].id, result, req.user.id, req.sid]);
    await audit(c, req, 'comptabilite', 'Clôture de l’exercice ' + rows[0].label, 'acc_fiscal_years', rows[0].id, { status: 'ouvert' }, { status: 'cloture', result });
    return { id: rows[0].id, result };
  });
  bust(req.sid);
  res.json(out);
}));
router.post('/fiscal-years/:id/reopen', manage, sub('accounting_closing', 'Exercices et clôture'), wrap(async (req, res) => {
  if (!req.user.is_global && req.user.role !== 'ADMIN') throw new HttpError(403, 'Seul un administrateur peut rouvrir un exercice clôturé.');
  const b = body(z.object({ reason: z.string().trim().min(3).max(300) }), req);
  const { rows } = await pool.query(`UPDATE acc_fiscal_years SET status='ouvert', closed_at=NULL, closed_by=NULL WHERE id=$1 AND station_id=$2 AND status='cloture' RETURNING id, label`, [req.params.id, req.sid]);
  if (!rows.length) throw new HttpError(404, 'Exercice clôturé introuvable.');
  await audit(pool, req, 'comptabilite', 'Réouverture de l’exercice ' + rows[0].label + ' : ' + b.reason, 'acc_fiscal_years', rows[0].id, { status: 'cloture' }, { status: 'ouvert' });
  res.json(rows[0]);
}));

module.exports = router;
