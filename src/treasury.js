'use strict';
/** Trésorerie et Créances & dettes : agrégats lus sur les sources existantes (caisses, comptes, mouvements,
 *  dépenses, factures clients, achats fournisseurs, règlements) + relances de paiement. Lecture seule, sauf :
 *  PUT /money/accounts/:id (modifier un compte) et POST /debts/reminders (journal des relances). */
const express = require('express');
const { swallow } = require('./safe');
const { z } = require('zod');
const { pool, HttpError, wrap, body, need, audit } = require('./core');

const r = express.Router();
const TREASURY = ['cash.manage', 'finance.view', 'money.manage'];
const DEBTS = ['finance.view', 'receivable.view', 'debt.view', 'cash.manage'];
const ymd = /^\d{4}-\d{2}-\d{2}$/;
const num = v => Number(v) || 0;
const monthStart = () => new Date().toISOString().slice(0, 8) + '01';
const today = () => new Date().toISOString().slice(0, 10);
const period = req => ({
  from: ymd.test(req.query.from) ? req.query.from : monthStart(),
  to: ymd.test(req.query.to) ? req.query.to : today()
});
const can = (req, p) => req.user.perms.has(p) || !!req.user.is_global;
const rows = (sql, p) => pool.query(sql, p).then(x => x.rows);

// Mouvements internes (remise en banque, retrait, transferts) : ni encaissement ni décaissement réel
const CASH_INTERNAL = ['ouverture', 'transfert', 'depot_bancaire', 'retrait', 'ecart_cloture'];
const MONEY_INTERNAL = ['depot', 'retrait', 'transfert_entrant', 'transfert_sortant'];

/* ===================== TRÉSORERIE ===================== */
r.get('/treasury/overview', need(...TREASURY), wrap(async (req, res) => {
  const s = req.sid;
  const [registers, accounts, cashFlow, moneyFlow, recv, pay, gaps, tr] = await Promise.all([
    rows(`SELECT r.id, r.name, r.balance,
            COALESCE(SUM(m.amount) FILTER (WHERE m.amount > 0 AND m.kind <> 'ouverture'), 0) AS in_month,
            COALESCE(-SUM(m.amount) FILTER (WHERE m.amount < 0), 0) AS out_month
          FROM cash_registers r
          LEFT JOIN cash_movements m ON m.cash_register_id = r.id AND m.created_at >= date_trunc('month', now())
          WHERE r.station_id = $1 AND r.active GROUP BY r.id ORDER BY r.id`, [s]),
    rows(`SELECT a.id, a.kind, a.name, a.provider, a.account_ref,
            a.opening_balance + COALESCE((SELECT SUM(x.amount) FROM money_movements x WHERE x.account_id = a.id), 0) AS balance,
            COALESCE((SELECT SUM(x.amount) FROM money_movements x WHERE x.account_id = a.id AND x.amount > 0 AND x.moved_on >= date_trunc('month', CURRENT_DATE)::date), 0) AS in_month,
            COALESCE((SELECT -SUM(x.amount) FROM money_movements x WHERE x.account_id = a.id AND x.amount < 0 AND x.moved_on >= date_trunc('month', CURRENT_DATE)::date), 0) AS out_month
          FROM money_accounts a WHERE a.station_id = $1 AND a.active ORDER BY a.kind, a.name`, [s]),
    rows(`SELECT COALESCE(SUM(m.amount) FILTER (WHERE m.amount > 0 AND m.created_at >= date_trunc('month', now())), 0) AS in_month,
                 COALESCE(-SUM(m.amount) FILTER (WHERE m.amount < 0 AND m.created_at >= date_trunc('month', now())), 0) AS out_month,
                 COALESCE(SUM(m.amount) FILTER (WHERE m.amount > 0 AND m.created_at >= date_trunc('day', now())), 0) AS in_today,
                 COALESCE(-SUM(m.amount) FILTER (WHERE m.amount < 0 AND m.created_at >= date_trunc('day', now())), 0) AS out_today
          FROM cash_movements m JOIN cash_registers r ON r.id = m.cash_register_id
          WHERE r.station_id = $1 AND m.kind <> ALL($2::text[])`, [s, CASH_INTERNAL]),
    rows(`SELECT COALESCE(SUM(m.amount) FILTER (WHERE m.amount > 0 AND m.moved_on >= date_trunc('month', CURRENT_DATE)::date), 0) AS in_month,
                 COALESCE(-SUM(m.amount) FILTER (WHERE m.amount < 0 AND m.moved_on >= date_trunc('month', CURRENT_DATE)::date), 0) AS out_month,
                 COALESCE(SUM(m.amount) FILTER (WHERE m.amount > 0 AND m.moved_on = CURRENT_DATE), 0) AS in_today,
                 COALESCE(-SUM(m.amount) FILTER (WHERE m.amount < 0 AND m.moved_on = CURRENT_DATE), 0) AS out_today
          FROM money_movements m JOIN money_accounts a ON a.id = m.account_id
          WHERE a.station_id = $1 AND m.kind <> ALL($2::text[])`, [s, MONEY_INTERNAL]),
    rows('SELECT COALESCE(SUM(GREATEST(balance, 0)), 0) AS total, COUNT(*) FILTER (WHERE balance > 0)::int AS n FROM customers WHERE station_id = $1 AND deleted_at IS NULL', [s]),
    rows('SELECT COALESCE(SUM(GREATEST(balance_due, 0)), 0) AS total, COUNT(*) FILTER (WHERE balance_due > 0)::int AS n FROM suppliers WHERE station_id = $1 AND deleted_at IS NULL', [s]),
    rows(`SELECT COUNT(*)::int AS n, COALESCE(SUM(ABS(amount)), 0) AS total FROM employee_gaps WHERE station_id = $1 AND kind = 'caisse' AND status NOT IN ('cloture','regularise')`, [s]).catch(swallow('treasury:56', [{ n: 0, total: 0 }])),
    rows(`SELECT COUNT(*)::int AS n FROM money_movements m JOIN money_accounts a ON a.id = m.account_id
          WHERE a.station_id = $1 AND m.kind = 'transfert_sortant' AND m.moved_on >= date_trunc('month', CURRENT_DATE)::date`, [s])
  ]);
  const cash = registers.reduce((a, x) => a + num(x.balance), 0);
  const byKind = {}; accounts.forEach(a => { byKind[a.kind] = (byKind[a.kind] || 0) + num(a.balance); });
  const mm = byKind.mobile_money || 0, bank = byKind.banque || 0;
  const other = Object.entries(byKind).filter(([k]) => k !== 'mobile_money' && k !== 'banque').reduce((a, [, v]) => a + v, 0);
  const liquidity = cash + mm + bank + other;
  const cf = cashFlow[0] || {}, mf = moneyFlow[0] || {};
  const flows = {
    in_month: num(cf.in_month) + num(mf.in_month), out_month: num(cf.out_month) + num(mf.out_month),
    in_today: num(cf.in_today) + num(mf.in_today), out_today: num(cf.out_today) + num(mf.out_today)
  };
  flows.net_month = flows.in_month - flows.out_month; flows.net_today = flows.in_today - flows.out_today;
  const showRecv = can(req, 'receivable.view'), showDebt = can(req, 'debt.view');
  const receivables = showRecv ? num(recv[0].total) : null, payables = showDebt ? num(pay[0].total) : null;
  res.json({
    as_of: today(),
    liquidity: { cash, mobile_money: mm, bank, other, total: liquidity },
    flows, receivables, payables,
    net_position: receivables != null && payables != null ? liquidity + receivables - payables : null,
    registers: registers.map(x => ({ ...x, balance: num(x.balance), in_month: num(x.in_month), out_month: num(x.out_month) })),
    accounts: accounts.map(x => ({ ...x, balance: num(x.balance), in_month: num(x.in_month), out_month: num(x.out_month) })),
    accounts_count: registers.length + accounts.length,
    transfers_month: tr[0] ? tr[0].n : 0,
    gaps: gaps[0] || { n: 0, total: 0 }
  });
}));

r.get('/treasury/movements', need(...TREASURY), wrap(async (req, res) => {
  const { from, to } = period(req), s = req.sid, acc = String(req.query.account || '');
  const dir = String(req.query.dir || '');
  const m = /^(cash|acc):(\d+)$/.exec(acc);
  const wantCash = !m || m[1] === 'cash', wantMoney = !m || m[1] === 'acc';
  const [cash, money] = await Promise.all([
    wantCash ? rows(`SELECT 'cash' AS src, m.id, m.created_at AS at, to_char(m.created_at, 'YYYY-MM-DD') AS day, r.name AS account, m.kind, m.amount, m.label, NULL::text AS reference
        FROM cash_movements m JOIN cash_registers r ON r.id = m.cash_register_id
        WHERE r.station_id = $1 AND m.kind <> 'ouverture' AND m.created_at >= $2::date AND m.created_at < $3::date + 1
          AND ($4::bigint IS NULL OR r.id = $4) ORDER BY m.created_at DESC LIMIT 400`, [s, from, to, m && m[1] === 'cash' ? +m[2] : null]) : [],
    wantMoney ? rows(`SELECT 'money' AS src, m.id, m.created_at AS at, to_char(m.moved_on, 'YYYY-MM-DD') AS day, a.name AS account, m.kind, m.amount, m.label, m.reference
        FROM money_movements m JOIN money_accounts a ON a.id = m.account_id
        WHERE a.station_id = $1 AND m.moved_on BETWEEN $2::date AND $3::date
          AND ($4::bigint IS NULL OR a.id = $4) ORDER BY m.moved_on DESC, m.id DESC LIMIT 400`, [s, from, to, m && m[1] === 'acc' ? +m[2] : null]) : []
  ]);
  let lines = cash.concat(money).map(x => ({ ...x, amount: num(x.amount) }));
  if (dir === 'in') lines = lines.filter(x => x.amount > 0); else if (dir === 'out') lines = lines.filter(x => x.amount < 0);
  lines.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : new Date(b.at) - new Date(a.at)));
  lines = lines.slice(0, 400);
  const inn = lines.filter(x => x.amount > 0).reduce((a, x) => a + x.amount, 0), out = -lines.filter(x => x.amount < 0).reduce((a, x) => a + x.amount, 0);
  res.json({ from, to, lines, totals: { in: inn, out, net: inn - out } });
}));

r.get('/treasury/expenses', need(...TREASURY, 'expense.create'), wrap(async (req, res) => {
  const { from, to } = period(req);
  const lines = await rows(`SELECT e.id, to_char(e.spent_on, 'YYYY-MM-DD') AS spent_on, e.category, e.amount, COALESCE(pm.label, e.method) AS method,
        e.beneficiary, e.comment, e.receipt_url, u.login
      FROM expenses e
      LEFT JOIN payment_methods pm ON pm.station_id = e.station_id AND pm.code = e.method
      LEFT JOIN users u ON u.id = e.created_by
      WHERE e.station_id = $1 AND e.deleted_at IS NULL AND e.spent_on BETWEEN $2::date AND $3::date
      ORDER BY e.spent_on DESC, e.id DESC LIMIT 500`, [req.sid, from, to]);
  const by = {}; let total = 0;
  lines.forEach(x => { const a = num(x.amount); total += a; by[x.category] = (by[x.category] || 0) + a; });
  res.json({ from, to, lines: lines.map(x => ({ ...x, amount: num(x.amount) })), total,
    by_category: Object.entries(by).map(([category, t]) => ({ category, total: t })).sort((a, b) => b.total - a.total) });
}));

r.get('/treasury/transfers', need(...TREASURY), wrap(async (req, res) => {
  const f = ymd.test(req.query.from) ? req.query.from : new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10), t = ymd.test(req.query.to) ? req.query.to : today();
  const [money, cash] = await Promise.all([
    rows(`SELECT 'money' AS src, m.id, to_char(m.moved_on, 'YYYY-MM-DD') AS day, a.name AS account, m.kind, m.amount, m.label, m.reference
          FROM money_movements m JOIN money_accounts a ON a.id = m.account_id
          WHERE a.station_id = $1 AND m.kind = ANY($4::text[]) AND m.moved_on BETWEEN $2::date AND $3::date ORDER BY m.moved_on DESC, m.id DESC LIMIT 300`,
      [req.sid, f, t, ['transfert_entrant', 'transfert_sortant', 'depot', 'retrait']]),
    rows(`SELECT 'cash' AS src, m.id, to_char(m.created_at, 'YYYY-MM-DD') AS day, r.name AS account, m.kind, m.amount, m.label, NULL::text AS reference
          FROM cash_movements m JOIN cash_registers r ON r.id = m.cash_register_id
          WHERE r.station_id = $1 AND m.kind = ANY($4::text[]) AND m.created_at >= $2::date AND m.created_at < $3::date + 1 ORDER BY m.created_at DESC LIMIT 300`,
      [req.sid, f, t, ['depot_bancaire', 'retrait', 'transfert']])
  ]);
  const lines = money.concat(cash).map(x => ({ ...x, amount: num(x.amount) })).sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
  res.json({ from: f, to: t, lines });
}));

r.get('/treasury/reconciliation', need(...TREASURY), wrap(async (req, res) => {
  const list = await rows(`SELECT a.id, a.kind, a.name, a.provider,
        a.opening_balance + COALESCE((SELECT SUM(m.amount) FROM money_movements m WHERE m.account_id = a.id), 0) AS book_now,
        to_char(ls.statement_date, 'YYYY-MM-DD') AS statement_date, ls.balance AS statement_balance, ls.note,
        CASE WHEN ls.statement_date IS NULL THEN NULL
             ELSE a.opening_balance + COALESCE((SELECT SUM(m.amount) FROM money_movements m WHERE m.account_id = a.id AND m.moved_on <= ls.statement_date), 0) END AS book_at
      FROM money_accounts a
      LEFT JOIN LATERAL (SELECT s.statement_date, s.balance, s.note FROM bank_statements s WHERE s.account_id = a.id ORDER BY s.statement_date DESC, s.id DESC LIMIT 1) ls ON TRUE
      WHERE a.station_id = $1 AND a.active ORDER BY a.kind, a.name`, [req.sid]);
  res.json(list.map(x => ({
    ...x, book_now: num(x.book_now), statement_balance: x.statement_balance == null ? null : num(x.statement_balance),
    book_at: x.book_at == null ? null : num(x.book_at),
    gap: x.statement_balance == null ? null : Math.round((num(x.statement_balance) - num(x.book_at)) * 100) / 100
  })));
}));

// Modifier un compte (nom, opérateur, référence, activation) — l'activation est refusée tant que le solde n'est pas nul
r.put('/money/accounts/:id', need('money.manage'), body(z.object({
  name: z.string().trim().min(2).optional(), provider: z.string().trim().nullable().optional(),
  account_ref: z.string().trim().nullable().optional(), active: z.boolean().optional()
})), wrap(async (req, res) => {
  const b = req.body;
  const [a] = await rows(`SELECT a.*, a.opening_balance + COALESCE((SELECT SUM(m.amount) FROM money_movements m WHERE m.account_id = a.id), 0) AS balance
      FROM money_accounts a WHERE a.id = $1 AND a.station_id = $2`, [req.params.id, req.sid]);
  if (!a) throw new HttpError(404, 'Compte introuvable');
  if (b.active === false && Math.abs(num(a.balance)) > 0.005) throw new HttpError(400, 'Impossible de désactiver un compte dont le solde n’est pas nul (' + num(a.balance) + ').');
  const [u] = await rows(`UPDATE money_accounts SET name = COALESCE($3::text, name), provider = CASE WHEN $4::boolean THEN $5::text ELSE provider END,
        account_ref = CASE WHEN $6::boolean THEN $7::text ELSE account_ref END, active = COALESCE($8::boolean, active)
      WHERE id = $1 AND station_id = $2 RETURNING id, name, provider, account_ref, active`,
    [a.id, req.sid, b.name || null, b.provider !== undefined, b.provider || null, b.account_ref !== undefined, b.account_ref || null, b.active ?? null]);
  await audit(pool, req, 'finance', 'Modification du compte ' + a.name, 'money_accounts', a.id, { name: a.name, provider: a.provider, account_ref: a.account_ref, active: a.active }, b);
  res.json(u);
}));

/* ===================== CRÉANCES & DETTES ===================== */
r.get('/debts/overview', need(...DEBTS), wrap(async (req, res) => {
  const s = req.sid, showRecv = can(req, 'receivable.view') || can(req, 'finance.view'), showDebt = can(req, 'debt.view') || can(req, 'finance.view');
  const [customers, invoices, suppliers, purchases] = await Promise.all([
    showRecv ? rows(`SELECT c.id, c.name, c.phone, c.email, c.balance, c.credit_limit, c.credit_blocked,
          (SELECT MIN(i.due_date) FROM invoices i WHERE i.station_id = c.station_id AND i.customer_id = c.id AND i.status IN ('emise','partielle') AND i.total_ttc - i.amount_paid > 0) AS oldest_due
        FROM customers c WHERE c.station_id = $1 AND c.deleted_at IS NULL AND c.balance > 0 ORDER BY c.balance DESC`, [s]) : [],
    showRecv ? rows(`SELECT i.id, i.invoice_no, i.status, to_char(i.issued_on, 'YYYY-MM-DD') AS issued_on, to_char(i.due_date, 'YYYY-MM-DD') AS due_date,
          i.total_ttc, i.amount_paid, i.total_ttc - i.amount_paid AS remaining, i.customer_id, COALESCE(c.name, 'Client de passage') AS customer_name, c.phone,
          CASE WHEN i.due_date IS NOT NULL AND i.due_date < CURRENT_DATE THEN (CURRENT_DATE - i.due_date) ELSE 0 END AS days_late
        FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id
        WHERE i.station_id = $1 AND i.status IN ('emise','partielle') AND i.total_ttc - i.amount_paid > 0
        ORDER BY i.due_date NULLS LAST, i.id LIMIT 500`, [s]) : [],
    showDebt ? rows(`SELECT id, name, phone, email, contact, balance_due, payment_terms_days FROM suppliers
        WHERE station_id = $1 AND deleted_at IS NULL AND balance_due <> 0 ORDER BY balance_due DESC`, [s]) : [],
    showDebt ? rows(`SELECT pu.id, pu.order_no, pu.invoice_no, pu.status, pu.supplier_id, s.name AS supplier, s.phone,
          to_char(pu.invoice_date, 'YYYY-MM-DD') AS invoice_date, to_char(pu.due_date, 'YYYY-MM-DD') AS due_date,
          COALESCE(pu.invoice_total, 0) AS invoice_total, pu.paid, COALESCE(pu.invoice_total, 0) - pu.paid AS remaining,
          CASE WHEN pu.due_date IS NOT NULL AND pu.due_date < CURRENT_DATE THEN (CURRENT_DATE - pu.due_date) ELSE 0 END AS days_late
        FROM purchases pu JOIN suppliers s ON s.id = pu.supplier_id
        WHERE pu.station_id = $1 AND pu.status IN ('facture','recu','partiel') AND COALESCE(pu.invoice_total, 0) - pu.paid > 0
        ORDER BY pu.due_date NULLS LAST, pu.id LIMIT 500`, [s]) : []
  ]);
  const cv = a => a.map(x => { const o = { ...x }; for (const k of ['balance', 'credit_limit', 'total_ttc', 'amount_paid', 'remaining', 'balance_due', 'invoice_total', 'paid', 'days_late']) if (k in o) o[k] = num(o[k]); return o; });
  res.json({
    as_of: today(), restricted: { receivables: !showRecv, payables: !showDebt },
    customers: cv(customers), invoices: cv(invoices), suppliers: cv(suppliers), purchases: cv(purchases)
  });
}));

r.get('/debts/payments', need(...DEBTS), wrap(async (req, res) => {
  const { from, to } = period(req), s = req.sid;
  const showRecv = can(req, 'receivable.view') || can(req, 'finance.view'), showDebt = can(req, 'debt.view') || can(req, 'finance.view');
  const [cp, ip, sp] = await Promise.all([
    showRecv ? rows(`SELECT p.id, p.paid_at, c.name AS party, p.amount, COALESCE(pm.label, p.method) AS method, NULL::text AS ref
        FROM customer_payments p JOIN customers c ON c.id = p.customer_id LEFT JOIN payment_methods pm ON pm.station_id = c.station_id AND pm.code = p.method
        WHERE c.station_id = $1 AND p.paid_at >= $2::date AND p.paid_at < $3::date + 1`, [s, from, to]) : [],
    showRecv ? rows(`SELECT ip.id, ip.paid_at, COALESCE(c.name, 'Client de passage') AS party, ip.amount, COALESCE(pm.label, ip.method) AS method, i.invoice_no AS ref
        FROM invoice_payments ip JOIN invoices i ON i.id = ip.invoice_id LEFT JOIN customers c ON c.id = i.customer_id
        LEFT JOIN payment_methods pm ON pm.station_id = ip.station_id AND pm.code = ip.method
        WHERE ip.station_id = $1 AND ip.paid_at >= $2::date AND ip.paid_at < $3::date + 1`, [s, from, to]) : [],
    showDebt ? rows(`SELECT sp.id, sp.paid_at, su.name AS party, sp.amount, COALESCE(pm.label, sp.method) AS method, pu.order_no AS ref
        FROM supplier_payments sp JOIN suppliers su ON su.id = sp.supplier_id LEFT JOIN purchases pu ON pu.id = sp.purchase_id
        LEFT JOIN payment_methods pm ON pm.station_id = su.station_id AND pm.code = sp.method
        WHERE su.station_id = $1 AND sp.paid_at >= $2::date AND sp.paid_at < $3::date + 1`, [s, from, to]) : []
  ]);
  const lines = []
    .concat(cp.map(x => ({ ...x, side: 'client' })), ip.map(x => ({ ...x, side: 'client' })), sp.map(x => ({ ...x, side: 'fournisseur' })))
    .map(x => ({ ...x, amount: num(x.amount) })).sort((a, b) => new Date(b.paid_at) - new Date(a.paid_at)).slice(0, 500);
  res.json({ from, to, lines,
    totals: { clients: lines.filter(x => x.side === 'client').reduce((a, x) => a + x.amount, 0), fournisseurs: lines.filter(x => x.side === 'fournisseur').reduce((a, x) => a + x.amount, 0) } });
}));

// Relances : clients ayant des factures échues sans relance depuis 7 jours + historique des relances envoyées
r.get('/debts/reminders', need(...DEBTS), wrap(async (req, res) => {
  const s = req.sid;
  if (!(can(req, 'receivable.view') || can(req, 'finance.view'))) return res.json({ pending: [], history: [] });
  const [pending, history] = await Promise.all([
    rows(`SELECT x.customer_id, x.name, x.phone, x.email, COUNT(*)::int AS invoices, SUM(x.remaining) AS due, MAX(x.late)::int AS max_late, MAX(x.last_rem) AS last_reminder
          FROM (SELECT i.customer_id, c.name, c.phone, c.email, i.total_ttc - i.amount_paid AS remaining, (CURRENT_DATE - i.due_date) AS late,
                  (SELECT MAX(r.created_at) FROM payment_reminders r WHERE r.station_id = i.station_id AND r.customer_id = i.customer_id) AS last_rem
                FROM invoices i JOIN customers c ON c.id = i.customer_id
                WHERE i.station_id = $1 AND i.status IN ('emise','partielle') AND i.total_ttc - i.amount_paid > 0 AND i.due_date < CURRENT_DATE) x
          GROUP BY x.customer_id, x.name, x.phone, x.email
          HAVING MAX(x.last_rem) IS NULL OR MAX(x.last_rem) < now() - interval '7 days'
          ORDER BY max_late DESC`, [s]),
    rows(`SELECT r.id, r.created_at, r.channel, r.amount, r.message, c.name AS customer, u.login
          FROM payment_reminders r JOIN customers c ON c.id = r.customer_id LEFT JOIN users u ON u.id = r.created_by
          WHERE r.station_id = $1 ORDER BY r.created_at DESC LIMIT 100`, [s])
  ]);
  res.json({ pending: pending.map(x => ({ ...x, due: num(x.due) })), history: history.map(x => ({ ...x, amount: x.amount == null ? null : num(x.amount) })) });
}));

r.post('/debts/reminders', need('customer.edit', 'cash.manage', 'finance.view'), body(z.object({
  customer_id: z.number().int().positive(), channel: z.enum(['whatsapp', 'email', 'sms', 'appel', 'autre']).default('whatsapp'),
  amount: z.number().min(0).optional().nullable(), message: z.string().max(2000).optional().nullable(), invoice_id: z.number().int().positive().optional().nullable()
})), wrap(async (req, res) => {
  const b = req.body;
  const [c] = await rows('SELECT id, name FROM customers WHERE id = $1 AND station_id = $2 AND deleted_at IS NULL', [b.customer_id, req.sid]);
  if (!c) throw new HttpError(404, 'Client introuvable');
  const [x] = await rows(`INSERT INTO payment_reminders(station_id, customer_id, invoice_id, channel, amount, message, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, created_at`, [req.sid, c.id, b.invoice_id || null, b.channel, b.amount ?? null, b.message || null, req.user.id]);
  await audit(pool, req, 'clients', 'Relance de paiement : ' + c.name + ' (' + b.channel + ')', 'customers', c.id, null, { channel: b.channel, amount: b.amount });
  res.status(201).json(x);
}));

module.exports = { r };
