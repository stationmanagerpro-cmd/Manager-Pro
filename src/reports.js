// Tableau de bord, audit, notifications.
const express = require('express');
const { pool, wrap, need, HttpError, audit } = require('./core');
const { swallow } = require('./safe');
const r = express.Router();

// Accepte uniquement les dates calendaires réelles (pas seulement le format YYYY-MM-DD).
function validDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

// Protège les agrégations du dashboard contre les périodes inversées ou excessives.
function dashboardRange(fromValue, toValue) {
  const today = new Date().toISOString().slice(0, 10);
  const from = validDay(fromValue) ? fromValue : today;
  let to = validDay(toValue) && toValue >= from ? toValue : from;
  const maxTo = new Date(Date.parse(`${from}T00:00:00.000Z`) + 365 * 86400000).toISOString().slice(0, 10);
  if (to > maxTo) to = maxTo;
  return { from, to };
}

r.get('/dashboard', need('report.view', 'finance.view'), wrap(async (req, res) => {
  const { from, to } = dashboardRange(req.query.from, req.query.to);
  const s = req.sid, q = (sql, p = [s]) => pool.query(sql, p).then(x => x.rows);

  const [sales, fuelClosed, exp, low, cash, open, recv, debt, byMethod, notif, recentSales, recentExp, closedShifts, fuelOpen] = await Promise.all([
    q("SELECT COALESCE(SUM(total),0) AS total, COUNT(*)::int AS n FROM sales WHERE station_id = $1 AND status = 'valide' AND kind = 'produits' AND sold_at >= $2::date AND sold_at < $3::date + 1", [s, from, to]),

    q(`SELECT p.name, SUM(m.liters) AS liters, SUM(m.amount) AS amount
       FROM meter_readings m
       JOIN shifts sh ON sh.id = m.shift_id
       JOIN products p ON p.id = m.product_id
       WHERE sh.station_id = $1
         AND sh.status = 'ferme'
         AND sh.closed_at >= $2::date
         AND sh.closed_at < $3::date + 1
       GROUP BY p.name`, [s, from, to]),

    q('SELECT COALESCE(SUM(amount),0) AS total, COUNT(*)::int AS n FROM expenses WHERE station_id = $1 AND deleted_at IS NULL AND spent_on BETWEEN $2::date AND $3::date', [s, from, to]),

    q('SELECT p.name, st.quantity, p.min_stock FROM products p JOIN stock st ON st.product_id = p.id WHERE p.station_id = $1 AND p.deleted_at IS NULL AND st.quantity <= p.min_stock LIMIT 15'),

    q('SELECT id, name, balance FROM cash_registers WHERE station_id = $1 AND active ORDER BY id'),

    q("SELECT id, number, kind, opened_at FROM shifts WHERE station_id = $1 AND status = 'ouvert' ORDER BY opened_at DESC"),

    q('SELECT COALESCE(SUM(balance),0) AS total FROM customers WHERE station_id = $1 AND deleted_at IS NULL'),

    q('SELECT COALESCE(SUM(balance_due),0) AS total FROM suppliers WHERE station_id = $1 AND deleted_at IS NULL'),

    q(`SELECT p.method, SUM(p.amount) AS amount
       FROM payments p
       LEFT JOIN sales sa ON sa.id = p.sale_id
       WHERE p.station_id = $1
         AND p.paid_at >= $2::date
         AND p.paid_at < $3::date + 1
         AND (sa.id IS NULL OR sa.status = 'valide')
       GROUP BY p.method`, [s, from, to]),

    q("SELECT COUNT(*)::int AS n FROM notifications WHERE station_id = $1 AND read_at IS NULL")
      .catch(swallow('reports:63', [{ n: 0 }])),

    q(`SELECT id, total, sold_at, kind
       FROM sales
       WHERE station_id = $1
         AND status = 'valide'
       ORDER BY sold_at DESC
       LIMIT 8`),

    // CORRECTION : la table expenses possède "category", pas "label"
    q(`SELECT id, amount, category, spent_on
       FROM expenses
       WHERE station_id = $1
         AND deleted_at IS NULL
       ORDER BY spent_on DESC, id DESC
       LIMIT 5`),

    q(`SELECT id, number, kind, closed_at
       FROM shifts
       WHERE station_id = $1
         AND status = 'ferme'
       ORDER BY closed_at DESC
       LIMIT 5`),

    // Carburant vendu pendant un quart encore ouvert : les index finaux ne sont relevés qu'à la clôture,
    // on s'appuie donc sur les ventes carburant déjà enregistrées pour que le tableau de bord soit à jour.
    q(`SELECT p.name, SUM(d.quantity) AS liters, SUM(d.amount) AS amount
       FROM sale_details d
       JOIN sales sa ON sa.id = d.sale_id
       JOIN shifts sh ON sh.id = sa.shift_id
       JOIN products p ON p.id = d.product_id
       WHERE sa.station_id = $1 AND sa.kind = 'carburant' AND sa.status = 'valide' AND sh.status = 'ouvert'
         AND sa.sold_at >= $2::date AND sa.sold_at < $3::date + 1
       GROUP BY p.name`, [s, from, to]),
  ]);

  const fuelMap = new Map();
  for (const x of [...fuelClosed, ...fuelOpen]) {
    const o = fuelMap.get(x.name) || { name: x.name, liters: 0, amount: 0 };
    o.liters += Number(x.liters || 0); o.amount += Number(x.amount || 0); fuelMap.set(x.name, o);
  }
  const fuel = [...fuelMap.values()];
  const fuelTotal = fuel.reduce((a, x) => a + Number(x.amount || 0), 0);
  const productRev = Number(sales[0].total);
  const revenue = productRev + fuelTotal;
  const expenses = Number(exp[0].total);
  const cashBalance = cash.reduce((a, x) => a + Number(x.balance || 0), 0);
  const receivables = Number(recv[0].total);
  const payables = Number(debt[0].total);

  let connectedUsers = null;

  // Visible seulement pour les profils qui gèrent les utilisateurs
  if (req.user.perms.has('user.manage')) {
    connectedUsers = await pool.query(
      "SELECT COUNT(DISTINCT s.user_id)::int AS n FROM user_sessions s JOIN users u ON u.id = s.user_id WHERE s.revoked_at IS NULL AND s.expires_at > now() AND u.deleted_at IS NULL"
    )
      .then(x => x.rows[0].n)
      .catch(swallow('reports:sessions-actives', null));
  }

  // Marge brute et résultat de gestion : même source que le rapport financier et le rapport client (profitability.js).
  // Les coûts d'achat et le résultat sont des données financières : réservés aux profils « finance » (jamais calculés pour les autres).
  let profit = null;
  if (req.user.perms.has('finance.view') || req.user.perms.has('finance.report')) {
    try { profit = await require('./profitability').stationProfit(s, from, to); } catch (_) { profit = null; }
  }

  // Facturation clients (module Facturation) : factures émises / encaissées de la période + situation à ce jour.
  // Même contrôle d'accès que /invoices (contrat) ; null si le module est indisponible. Les paiements de factures
  // alimentent déjà le solde des caisses : ils sont rappelés ici pour que la facturation soit visible sur le tableau de bord.
  let billing = null;
  try {
    await require('./billing').assertBilling(req);
    const [bi, bp, br] = await Promise.all([
      q(`SELECT
           COUNT(*) FILTER (WHERE status IN ('emise','partielle','payee') AND COALESCE(issued_on, created_at::date) BETWEEN $2::date AND $3::date)::int AS issued_n,
           COALESCE(SUM(total_ttc) FILTER (WHERE status IN ('emise','partielle','payee') AND COALESCE(issued_on, created_at::date) BETWEEN $2::date AND $3::date), 0) AS issued_total,
           COUNT(*) FILTER (WHERE status IN ('emise','partielle'))::int AS open_n,
           COALESCE(SUM(total_ttc - amount_paid) FILTER (WHERE status IN ('emise','partielle')), 0) AS due_total,
           COUNT(*) FILTER (WHERE status IN ('emise','partielle') AND due_date < CURRENT_DATE)::int AS overdue_n,
           COALESCE(SUM(total_ttc - amount_paid) FILTER (WHERE status IN ('emise','partielle') AND due_date < CURRENT_DATE), 0) AS overdue_total,
           COUNT(*) FILTER (WHERE status = 'brouillon')::int AS draft_n
         FROM invoices WHERE station_id = $1`, [s, from, to]),
      q('SELECT COALESCE(SUM(amount),0) AS total, COUNT(*)::int AS n FROM invoice_payments WHERE station_id = $1 AND paid_at >= $2::date AND paid_at < $3::date + 1', [s, from, to]),
      // Part des factures libres non portée par une vente (services, factures hors quart) : comptée au CA (les ventes liées le sont déjà)
      q(`SELECT COALESCE(SUM(unlinked_amount),0) AS total FROM invoices WHERE station_id = $1 AND source = 'libre' AND status IN ('emise','partielle','payee')
           AND COALESCE(issued_on, created_at::date) BETWEEN $2::date AND $3::date`, [s, from, to])
    ]);
    const b0 = bi[0] || {};
    billing = {
      issued_count: b0.issued_n || 0, issued_total: Number(b0.issued_total || 0),
      collected_total: Number(bp[0] && bp[0].total || 0), collected_count: (bp[0] && bp[0].n) || 0,
      open_count: b0.open_n || 0, due_total: Number(b0.due_total || 0),
      invoice_revenue: Number(br[0] && br[0].total || 0),
      overdue_count: b0.overdue_n || 0, overdue_total: Number(b0.overdue_total || 0), draft_count: b0.draft_n || 0
    };
  } catch (_) { billing = null; }

  const invoiceRevenue = billing ? billing.invoice_revenue : 0;
  const recent = [];

  // Dernières factures / paiements de factures dans l'activité récente
  if (billing) {
    const [recInv, recInvPay] = await Promise.all([
      q(`SELECT i.id, i.invoice_no, i.total_ttc, i.status, COALESCE(i.issued_on::timestamptz, i.created_at) AS at, c.name AS customer
           FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id
          WHERE i.station_id = $1 AND i.status IN ('emise','partielle','payee') ORDER BY i.id DESC LIMIT 5`).catch(() => []),
      q(`SELECT ip.id, ip.amount, ip.paid_at AS at, i.invoice_no FROM invoice_payments ip JOIN invoices i ON i.id = ip.invoice_id
          WHERE ip.station_id = $1 ORDER BY ip.id DESC LIMIT 5`).catch(() => [])
    ]);
    for (const x of recInv) recent.push({ type: 'invoice', id: x.id, label: 'Facture ' + x.invoice_no + (x.customer ? ' · ' + x.customer : ''), amount: Number(x.total_ttc), at: x.at });
    for (const x of recInvPay) recent.push({ type: 'invoice_payment', id: x.id, label: 'Paiement facture ' + x.invoice_no, amount: Number(x.amount), at: x.at });
  }

  for (const x of recentSales) {
    recent.push({
      type: 'sale',
      id: x.id,
      label: 'Vente ' + (x.kind || 'produits'),
      amount: Number(x.total),
      at: x.sold_at
    });
  }

  for (const x of recentExp) {
    recent.push({
      type: 'expense',
      id: x.id,
      label: x.category || 'Dépense',
      amount: -Number(x.amount),
      at: x.spent_on
    });
  }

  for (const x of closedShifts) {
    recent.push({
      type: 'shift',
      id: x.id,
      label: 'Quart N°' + x.number + ' (' + x.kind + ') clôturé',
      amount: null,
      at: x.closed_at
    });
  }

  recent.sort((a, b) => new Date(b.at) - new Date(a.at));

  // Comparaison 7 derniers jours / 7 jours précédents + alertes automatiques (écart de caisse, écart ou stock anormal)
  const SQ = (sql) => pool.query(sql, [req.sid]).then(x => x.rows).catch(swallow('reports:dashboard-watch', []));
  const [wk] = await SQ(`SELECT COALESCE(SUM(total) FILTER (WHERE sold_at >= date_trunc('day', now()) - interval '6 days'), 0) AS cur,
                                COALESCE(SUM(total) FILTER (WHERE sold_at >= date_trunc('day', now()) - interval '13 days' AND sold_at < date_trunc('day', now()) - interval '6 days'), 0) AS prev
                           FROM sales WHERE station_id = $1 AND status = 'valide' AND sold_at >= date_trunc('day', now()) - interval '13 days'`);
  const wkCur = Number(wk?.cur || 0), wkPrev = Number(wk?.prev || 0);
  const weekCompare = { current: wkCur, previous: wkPrev, delta: wkCur - wkPrev, delta_pct: wkPrev > 0 ? Math.round((wkCur - wkPrev) / wkPrev * 1000) / 10 : null };
  const [gaps, negStock, stockGaps] = await Promise.all([
    SQ(`SELECT number, cash_gap FROM shifts WHERE station_id = $1 AND closed_at IS NOT NULL AND closed_at >= now() - interval '7 days' AND ABS(COALESCE(cash_gap, 0)) > 0.5 ORDER BY closed_at DESC LIMIT 3`),
    SQ(`SELECT pr.name, sk.quantity FROM stock sk JOIN products pr ON pr.id = sk.product_id WHERE pr.station_id = $1 AND sk.quantity < 0 ORDER BY sk.quantity LIMIT 3`),
    SQ(`SELECT pr.name, c.gap, sh.number FROM shift_stock_counts c JOIN shifts sh ON sh.id = c.shift_id JOIN products pr ON pr.id = c.product_id
         WHERE sh.station_id = $1 AND sh.closed_at >= now() - interval '7 days' AND ABS(COALESCE(c.gap, 0)) > 0 ORDER BY sh.closed_at DESC LIMIT 3`)
  ]);
  const watch = [
    ...gaps.map(x => ({ level: 'critical', message: `Écart de caisse au quart ${String(x.number).padStart(6, '0')}`, sub: `${Number(x.cash_gap) > 0 ? '+' : ''}${Number(x.cash_gap)} (7 derniers jours)` })),
    ...stockGaps.map(x => ({ level: 'warning', message: `Écart de stock — ${x.name}`, sub: `${Number(x.gap) > 0 ? '+' : ''}${Number(x.gap)} au quart ${String(x.number).padStart(6, '0')}` })),
    ...negStock.map(x => ({ level: 'critical', message: `Stock négatif — ${x.name}`, sub: `Quantité : ${Number(x.quantity)}` }))
  ];

  res.json({
    week_compare: weekCompare, watch,
    period: { from, to },
    revenue: revenue + invoiceRevenue,
    invoice_revenue: invoiceRevenue,
    fuel_revenue: fuelTotal,
    product_revenue: productRev,
    sales_count: sales[0].n,
    fuel_by_product: fuel,
    expenses,
    expenses_count: exp[0].n,
    net: revenue + invoiceRevenue - expenses,
    // Agrégat marge / profit (base : ventes produits + compteurs des quarts clôturés, moins coûts d'achat, dépenses et charges patronales)
    gross_margin: profit ? profit.gross_margin : null,
    cogs: profit ? profit.cogs : null,
    margin_pct: profit ? profit.margin_pct : null,
    margin_pct_label: profit ? (profit.margin_pct == null ? 'n/d' : profit.margin_pct + ' %') : null,
    operating_result: profit ? profit.operating_result : null,
    operating_pct: profit ? profit.operating_pct : null,
    employer_charges: profit ? profit.employer_charges : null,
    margin_reliable: profit ? profit.reliable : null,
    margin_coverage_pct: profit ? profit.cost_coverage_pct : null,
    low_stock: low,
    cash_balance: cashBalance,
    cash_registers: cash,
    open_shifts: open,
    open_shift: open[0] || null,
    receivables: req.user.perms.has('receivable.view') ? receivables : null,
    payables: req.user.perms.has('debt.view') ? payables : null,
    payments_by_method: byMethod,
    billing,
    unread_alerts: (notif[0] && notif[0].n) || 0,
    connected_users: connectedUsers,
    recent_activity: recent.slice(0, 12),

    profile: {
      login: req.user.login,
      role: req.user.role,
      is_global: !!req.user.is_global,
      station_id: s
    },

    server_time: new Date().toISOString()
  });
}));

r.get('/dashboard/daily', need('report.view', 'finance.view'), wrap(async (req, res) => {
  const requestedDays = Number.parseInt(req.query.days, 10);
  const days = Number.isFinite(requestedDays) ? Math.min(90, Math.max(1, requestedDays)) : 7;
  // Filtre « entre 2 dates » du Tableau de bord : ?from=&to= (jours inclus). Fenêtre affichée : au moins 7 jours (pour lire une tendance),
  // au plus 90 jours (les 90 derniers jours de la période) et jamais au-delà d'aujourd'hui. Sans from/to : N derniers jours (?days=).
  let serFrom = null, serTo = null;
  if (validDay(req.query.from) && validDay(req.query.to) && req.query.from <= req.query.to) {
    const today = new Date().toISOString().slice(0, 10), DAY = 86400000, shift = (d, n) => new Date(Date.parse(`${d}T00:00:00.000Z`) + n * DAY).toISOString().slice(0, 10);
    serTo = req.query.to > today ? today : req.query.to;
    serFrom = req.query.from > serTo ? serTo : req.query.from;
    const len = Math.round((Date.parse(`${serTo}T00:00:00.000Z`) - Date.parse(`${serFrom}T00:00:00.000Z`)) / DAY) + 1;
    if (len > 90) serFrom = shift(serTo, -89); else if (len < 7) serFrom = shift(serTo, -6);
  }
  // Ventes : produits (par date de vente) + carburant des quarts clôturés (compteurs, par date de clôture)
  // + carburant déclaré dans le quart encore ouvert (par date de vente).
  // Stock carburant : niveau de fin de journée reconstitué depuis les mouvements de stock ; pour aujourd'hui,
  // niveau « vivant » = stock comptable − litres déjà vendus dans le quart ouvert (sortie comptabilisée à la clôture).
  const { rows } = await pool.query(
    `WITH fuel_products AS (
       SELECT p.id FROM products p JOIN categories cat ON cat.id = p.category_id
        WHERE p.station_id = $1 AND cat.code = 'CARBURANT' AND p.deleted_at IS NULL
     ),
     cur AS (
       SELECT COALESCE(SUM(st.quantity), 0) AS q FROM stock st WHERE st.station_id = $1 AND st.product_id IN (SELECT id FROM fuel_products)
     ),
     pending AS (
       SELECT COALESCE(SUM(d.quantity), 0) AS q
         FROM sale_details d JOIN sales sa ON sa.id = d.sale_id JOIN shifts sh ON sh.id = sa.shift_id
        WHERE sa.station_id = $1 AND sa.kind = 'carburant' AND sa.status = 'valide' AND sh.status = 'ouvert'
     )
     SELECT to_char(d::date, 'YYYY-MM-DD') AS day,
       COALESCE((SELECT SUM(total) FROM sales WHERE station_id = $1 AND status = 'valide' AND kind = 'produits' AND sold_at::date = d::date), 0) AS product_revenue,
       COALESCE((SELECT SUM(m.amount) FROM meter_readings m JOIN shifts sh ON sh.id = m.shift_id
                  WHERE sh.station_id = $1 AND sh.status = 'ferme' AND sh.closed_at::date = d::date), 0)
       + COALESCE((SELECT SUM(sa.total) FROM sales sa JOIN shifts sh ON sh.id = sa.shift_id
                  WHERE sa.station_id = $1 AND sa.kind = 'carburant' AND sa.status = 'valide' AND sh.status = 'ouvert' AND sa.sold_at::date = d::date), 0) AS fuel_revenue,
       COALESCE((SELECT SUM(m.liters) FROM meter_readings m JOIN shifts sh ON sh.id = m.shift_id
                  WHERE sh.station_id = $1 AND sh.status = 'ferme' AND sh.closed_at::date = d::date), 0)
       + COALESCE((SELECT SUM(dd.quantity) FROM sale_details dd JOIN sales sa ON sa.id = dd.sale_id JOIN shifts sh ON sh.id = sa.shift_id
                  WHERE sa.station_id = $1 AND sa.kind = 'carburant' AND sa.status = 'valide' AND sh.status = 'ouvert' AND sa.sold_at::date = d::date), 0) AS liters,
       CASE WHEN d::date = current_date
            THEN (SELECT q FROM cur) - (SELECT q FROM pending)
            ELSE (SELECT q FROM cur) - COALESCE((SELECT SUM(sm.quantity) FROM stock_movements sm
                   WHERE sm.station_id = $1 AND sm.product_id IN (SELECT id FROM fuel_products) AND sm.created_at::date > d::date), 0)
       END AS stock_liters
     FROM generate_series(COALESCE($2::date, current_date - ($3::int - 1)), COALESCE($4::date, current_date), '1 day') d
     ORDER BY d`,
    [req.sid, serFrom, days, serTo]
  );
  // « revenue » = total (produits + carburant) : compatible avec les anciens écrans.
  res.json(rows.map(x => ({ ...x, revenue: Number(x.product_revenue) + Number(x.fuel_revenue) })));
}));

// Classements de la station sur une période : meilleurs employés, clients, fournisseurs, produits et postes de dépenses.
// Lecture seule, strictement limité à la station courante (req.sid). Une requête qui échoue renvoie « null » (jamais un faux zéro).
r.get('/dashboard/rankings', need('report.view', 'finance.view'), wrap(async (req, res) => {
  const { from, to } = dashboardRange(req.query.from, req.query.to);
  const s = req.sid;
  const lim = Math.min(10, Math.max(1, parseInt(req.query.limit, 10) || 5));
  const run = (sql, params) => pool.query(sql, params).then(x => x.rows).catch(e => { console.warn('[rankings]', e.message); return null; });
  const num = rows => rows && rows.map(x => ({ ...x, amount: Number(x.amount || 0), n: x.n != null ? Number(x.n) : undefined, qty: x.qty != null ? Number(x.qty) : undefined }));
  const canSuppliers = req.user.perms.has('finance.view') || req.user.perms.has('debt.view');
  const salesWin = "sa.station_id = $1 AND sa.status = 'valide' AND sa.sold_at >= $2::date AND sa.sold_at < $3::date + 1";
  const [emps, custs, sups, prods, cats] = await Promise.all([
    run(`SELECT e.id, btrim(concat_ws(' ', e.first_name, e.last_name)) AS name, COUNT(*)::int AS n, COALESCE(SUM(sa.total), 0) AS amount
           FROM sales sa JOIN employees e ON e.id = sa.employee_id
          WHERE ${salesWin}
          GROUP BY e.id, e.first_name, e.last_name ORDER BY amount DESC, name LIMIT ${lim}`, [s, from, to]),
    run(`SELECT c.id, c.name, COUNT(*)::int AS n, COALESCE(SUM(sa.total), 0) AS amount
           FROM sales sa JOIN customers c ON c.id = sa.customer_id
          WHERE ${salesWin}
          GROUP BY c.id, c.name ORDER BY amount DESC, c.name LIMIT ${lim}`, [s, from, to]),
    canSuppliers
      ? run(`SELECT su.id, su.name, COUNT(*)::int AS n, COALESCE(SUM(p.total), 0) AS amount
               FROM purchases p JOIN suppliers su ON su.id = p.supplier_id
              WHERE p.station_id = $1 AND p.status <> 'annule' AND p.ordered_at >= $2::date AND p.ordered_at < $3::date + 1
              GROUP BY su.id, su.name ORDER BY amount DESC, su.name LIMIT ${lim}`, [s, from, to])
      : Promise.resolve(null),
    run(`SELECT pr.id, pr.name, COALESCE(SUM(d.quantity), 0) AS qty, COALESCE(SUM(d.amount), 0) AS amount
           FROM sale_details d JOIN sales sa ON sa.id = d.sale_id JOIN products pr ON pr.id = d.product_id
          WHERE ${salesWin}
          GROUP BY pr.id, pr.name ORDER BY amount DESC, pr.name LIMIT ${lim}`, [s, from, to]),
    run(`SELECT COALESCE(NULLIF(category, ''), 'Autres') AS name, COUNT(*)::int AS n, COALESCE(SUM(amount), 0) AS amount
           FROM expenses WHERE station_id = $1 AND deleted_at IS NULL AND spent_on BETWEEN $2::date AND $3::date
          GROUP BY 1 ORDER BY amount DESC LIMIT ${lim}`, [s, from, to])
  ]);
  res.json({
    period: { from, to },
    top_employees: num(emps), top_customers: num(custs), top_suppliers: num(sups),
    top_products: num(prods), expenses_by_category: num(cats),
    suppliers_hidden: !canSuppliers
  });
}));

// Tableau de bord moderne : niveaux de cuves, dernières ventes, nombre de transactions (lecture seule).
r.get('/dashboard/overview', need('report.view', 'finance.view'), wrap(async (req, res) => {
  const { from, to } = dashboardRange(req.query.from, req.query.to);
  const pfrom = validDay(req.query.pfrom) ? req.query.pfrom : null;
  const pto = validDay(req.query.pto) && pfrom && req.query.pto >= pfrom ? req.query.pto : pfrom;
  const s = req.sid;
  const q = (sql, p) => pool.query(sql, p).then(x => x.rows);
  const countSql = "SELECT COUNT(*)::int AS n FROM sales WHERE station_id = $1 AND status = 'valide' AND sold_at >= $2::date AND sold_at < $3::date + 1";

  let tanks;
  try {
    tanks = await q(
      `SELECT p.id, p.name, p.unit, COALESCE(st.quantity, 0) AS quantity, p.min_stock,
              (SELECT COALESCE(SUM(t.capacity_liters), 0) FROM tanks t
                WHERE t.station_id = $1 AND t.product_id = p.id AND t.deleted_at IS NULL AND t.active) AS capacity
         FROM products p
         JOIN categories cat ON cat.id = p.category_id
         LEFT JOIN stock st ON st.product_id = p.id
        WHERE p.station_id = $1 AND p.deleted_at IS NULL AND p.active AND cat.code = 'CARBURANT'
        ORDER BY p.name`, [s]);
  } catch (_) {
    tanks = await q(
      `SELECT p.id, p.name, p.unit, COALESCE(st.quantity, 0) AS quantity, p.min_stock, 0 AS capacity
         FROM products p
         JOIN categories cat ON cat.id = p.category_id
         LEFT JOIN stock st ON st.product_id = p.id
        WHERE p.station_id = $1 AND p.deleted_at IS NULL AND p.active AND cat.code = 'CARBURANT'
        ORDER BY p.name`, [s]);
  }

  // Niveau réel : la sortie de stock carburant est comptabilisée à la clôture du quart ; on retranche donc
  // les litres déjà vendus dans le quart ouvert pour refléter le niveau actuel des cuves.
  const pend = await q(
    `SELECT d.product_id, COALESCE(SUM(d.quantity), 0) AS liters
       FROM sale_details d JOIN sales sa ON sa.id = d.sale_id JOIN shifts sh ON sh.id = sa.shift_id
      WHERE sa.station_id = $1 AND sa.kind = 'carburant' AND sa.status = 'valide' AND sh.status = 'ouvert'
      GROUP BY d.product_id`, [s]).catch(swallow('reports:agregat-produits', []));
  const pendBy = new Map(pend.map(x => [Number(x.product_id), Number(x.liters)]));
  for (const t of tanks) {
    const pending = pendBy.get(Number(t.id)) || 0;
    t.quantity_book = Number(t.quantity);
    t.pending_liters = pending;
    t.quantity = Math.max(0, Number(t.quantity) - pending);
  }

  const [recent, cur, prev] = await Promise.all([
    q(`SELECT s.id, s.sold_at, s.total, s.kind,
              (SELECT string_agg(x.name, ', ') FROM (
                 SELECT DISTINCT pr.name FROM sale_details d JOIN products pr ON pr.id = d.product_id
                  WHERE d.sale_id = s.id LIMIT 3) x) AS products,
              (SELECT COALESCE(SUM(d.quantity), 0) FROM sale_details d WHERE d.sale_id = s.id) AS quantity,
              (SELECT string_agg(DISTINCT pr.unit, '/') FROM sale_details d JOIN products pr ON pr.id = d.product_id WHERE d.sale_id = s.id) AS units,
              (SELECT string_agg(DISTINCT pm.method, ', ') FROM payments pm WHERE pm.sale_id = s.id) AS methods
         FROM sales s
        WHERE s.station_id = $1 AND s.status = 'valide'
          AND ($4::boolean OR (s.sold_at >= $2::date AND s.sold_at < $3::date + 1))
        ORDER BY s.sold_at DESC, s.id DESC
        LIMIT 6`, [s, from, to, req.query.recent === 'all']),
    q(countSql, [s, from, to]),
    pfrom ? q(countSql, [s, pfrom, pto]) : Promise.resolve([{ n: null }])
  ]);

  res.json({
    period: { from, to },
    tx_count: cur[0].n,
    prev_tx_count: prev[0].n,
    tanks,
    recent_sales: recent
  });
}));

// A3 — configuration Dashboard administrée dans la fiche de chaque client (Super Admin uniquement).
r.get('/admin/clients/:id/dashboard-config', wrap(async (req, res) => {
  if (!req.user.is_global) throw new HttpError(403, 'Réservé au Super Admin.');
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, 'Identifiant client invalide.');
  const { rows: clientRows } = await pool.query('SELECT id, name FROM clients WHERE id = $1', [id]);
  if (!clientRows[0]) throw new HttpError(404, 'Client introuvable.');
  const { rows } = await pool.query('SELECT config, updated_at FROM client_dashboard_configs WHERE client_id = $1', [id]);
  const defaults = require('./admin').KEYS.dashboard_config.def;
  res.json({ client_id: id, client_name: clientRows[0].name, configured: !!rows[0], config: rows[0]?.config || defaults, updated_at: rows[0]?.updated_at || null });
}));

r.put('/admin/clients/:id/dashboard-config', wrap(async (req, res) => {
  if (!req.user.is_global) throw new HttpError(403, 'Réservé au Super Admin.');
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, 'Identifiant client invalide.');
  const { rows: clientRows } = await pool.query('SELECT id FROM clients WHERE id = $1', [id]);
  if (!clientRows[0]) throw new HttpError(404, 'Client introuvable.');
  const parsed = require('./admin').KEYS.dashboard_config.schema.safeParse(req.body?.value);
  if (!parsed.success) throw new HttpError(400, 'Configuration Dashboard invalide.', parsed.error.issues.map(x => x.path.join('.') + ' : ' + x.message));
  const { rows: oldRows } = await pool.query('SELECT config FROM client_dashboard_configs WHERE client_id = $1', [id]);
  await pool.query(`INSERT INTO client_dashboard_configs(client_id, config, updated_by, updated_at)
    VALUES ($1, $2::jsonb, $3, now())
    ON CONFLICT (client_id) DO UPDATE SET config = EXCLUDED.config, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [id, JSON.stringify(parsed.data), req.user.id]);
  await audit(pool, req, 'paramètres', 'Configuration Dashboard du client #' + id, 'client_dashboard_configs', id, oldRows[0]?.config || null, parsed.data);
  res.json({ ok: true, client_id: id });
}));

r.delete('/admin/clients/:id/dashboard-config', wrap(async (req, res) => {
  if (!req.user.is_global) throw new HttpError(403, 'Réservé au Super Admin.');
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, 'Identifiant client invalide.');
  const { rowCount } = await pool.query('DELETE FROM client_dashboard_configs WHERE client_id = $1', [id]);
  await audit(pool, req, 'paramètres', 'Réinitialisation configuration Dashboard du client #' + id, 'client_dashboard_configs', id);
  res.json({ ok: true, client_id: id, reset: rowCount > 0 });
}));

r.get('/dashboard/config', wrap(async (req, res) => {
  const { getSetting } = require('./admin');
  let cfg = null;
  // Compatibilité avec les anciens comptes sans client_id directement renseigné :
  // le rattachement est alors dérivé de leur station courante, jamais d'un paramètre client fourni.
  let clientId = req.user.client_id || null;
  if (!clientId && !req.user.is_global) {
    const { rows: stationRows } = await pool.query('SELECT client_id FROM stations WHERE id = $1', [req.sid]);
    clientId = stationRows[0]?.client_id || null;
  }
  // La configuration du client prime sur l'ancien réglage par station.
  if (clientId) {
    const { rows } = await pool.query('SELECT config FROM client_dashboard_configs WHERE client_id = $1', [clientId]);
    if (rows[0]) cfg = rows[0].config;
  }
  if (!cfg) cfg = await getSetting(req.sid, 'dashboard_config');
  const role = req.user.role || 'EMPLOYE';
  const roleOverride = cfg.by_role && cfg.by_role[role];

  const effective = roleOverride
    ? {
        cards: { ...cfg.cards, ...(roleOverride.cards || {}) },
        charts: { ...cfg.charts, ...(roleOverride.charts || {}) },
        sections: { ...cfg.sections, ...(roleOverride.sections || {}) },
        shortcuts: roleOverride.shortcuts || cfg.shortcuts
      }
    : {
        cards: cfg.cards || {},
        charts: cfg.charts || {},
        sections: cfg.sections || {},
        shortcuts: cfg.shortcuts || []
      };

  // Préférences personnelles : l'utilisateur peut masquer des éléments, jamais en ajouter.
  const mine = await require('./gaps').userDashboardPrefs(req.user.id, req.sid);
  if (mine) for (const g of ['cards', 'charts', 'sections']) for (const [k, v] of Object.entries(mine[g] || {})) if (v === false && effective[g]) effective[g] = { ...effective[g], [k]: false };
  res.json({
    role,
    is_global: !!req.user.is_global,
    config: effective,
    raw: req.user.is_global || req.user.perms.has('settings.edit') ? cfg : undefined
  });
}));

// Centre de pilotage : indicateurs comparables et actions prioritaires, limités à la station autorisée.
r.get('/dashboard/pilotage', need('report.view', 'finance.view'), wrap(async (req, res) => {
  const { from, to } = dashboardRange(req.query.from, req.query.to);
  const stationId = req.sid;
  const days = Math.min(366, Math.max(1, Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000) + 1));
  const prevTo = new Date(Date.parse(from + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
  const prevFrom = new Date(Date.parse(prevTo + 'T00:00:00Z') - (days - 1) * 86400000).toISOString().slice(0, 10);
  const q = (sql, params = [stationId]) => pool.query(sql, params).then(x => x.rows);
  const safe = promise => promise.catch(swallow('reports:tableau-de-bord', []));
  const [salesNow, salesPrev, fuelNow, fuelPrev, expenseNow, expensePrev, openShifts, lowStock, cashGaps, hrAlerts, unread] = await Promise.all([
    q("SELECT COALESCE(SUM(total),0) AS total, COUNT(*)::int AS n FROM sales WHERE station_id=$1 AND status='valide' AND kind='produits' AND sold_at >= $2::date AND sold_at < $3::date + 1", [stationId, from, to]),
    q("SELECT COALESCE(SUM(total),0) AS total FROM sales WHERE station_id=$1 AND status='valide' AND kind='produits' AND sold_at >= $2::date AND sold_at < $3::date + 1", [stationId, prevFrom, prevTo]),
    q("SELECT COALESCE(SUM(m.amount),0) AS total, COALESCE(SUM(m.liters),0) AS liters FROM meter_readings m JOIN shifts sh ON sh.id=m.shift_id WHERE sh.station_id=$1 AND sh.status='ferme' AND sh.closed_at >= $2::date AND sh.closed_at < $3::date + 1", [stationId, from, to]),
    q("SELECT COALESCE(SUM(m.amount),0) AS total FROM meter_readings m JOIN shifts sh ON sh.id=m.shift_id WHERE sh.station_id=$1 AND sh.status='ferme' AND sh.closed_at >= $2::date AND sh.closed_at < $3::date + 1", [stationId, prevFrom, prevTo]),
    q('SELECT COALESCE(SUM(amount),0) AS total, COUNT(*)::int AS n FROM expenses WHERE station_id=$1 AND deleted_at IS NULL AND spent_on BETWEEN $2::date AND $3::date', [stationId, from, to]),
    q('SELECT COALESCE(SUM(amount),0) AS total FROM expenses WHERE station_id=$1 AND deleted_at IS NULL AND spent_on BETWEEN $2::date AND $3::date', [stationId, prevFrom, prevTo]),
    q("SELECT id, number, kind, opened_at FROM shifts WHERE station_id=$1 AND status='ouvert' ORDER BY opened_at", [stationId]),
    q('SELECT p.id, p.name, st.quantity, p.min_stock FROM products p JOIN stock st ON st.product_id=p.id WHERE p.station_id=$1 AND p.deleted_at IS NULL AND st.quantity<=p.min_stock ORDER BY (p.min_stock-st.quantity) DESC LIMIT 20', [stationId]),
    safe(q("SELECT id, status FROM employee_gaps WHERE station_id=$1 AND kind = 'caisse' AND status NOT IN ('cloture','regularise') ORDER BY id DESC LIMIT 30", [stationId])),
    (req.user.perms.has('hr.view') || req.user.perms.has('hr.manage') || req.user.perms.has('hr.employee.view')) ? safe(q("SELECT id, level, kind, message, due_date FROM hr_alerts WHERE station_id=$1 AND status='open' ORDER BY id DESC LIMIT 20", [stationId])) : Promise.resolve([]),
    safe(q('SELECT COUNT(*)::int AS n FROM notifications WHERE station_id=$1 AND read_at IS NULL', [stationId]))
  ]);
  const productSales = Number(salesNow[0]?.total || 0);
  const fuelSales = Number(fuelNow[0]?.total || 0);
  const revenue = productSales + fuelSales;
  const prevRevenue = Number(salesPrev[0]?.total || 0) + Number(fuelPrev[0]?.total || 0);
  const expenses = Number(expenseNow[0]?.total || 0);
  const prevExpenses = Number(expensePrev[0]?.total || 0);
  const changePct = (current, previous) => previous > 0 ? Math.round(((current - previous) / previous) * 10000) / 100 : null;
  const actions = [];
  if (openShifts.length) actions.push({ level: 'warning', code: 'open_shifts', count: openShifts.length, label: `${openShifts.length} quart(s) encore ouvert(s)`, advice: 'Vérifier les quarts en cours et clôturer ceux qui sont terminés.' });
  if (lowStock.length) actions.push({ level: 'warning', code: 'low_stock', count: lowStock.length, label: `${lowStock.length} produit(s) au seuil ou sous le seuil de stock`, advice: 'Contrôler les quantités et préparer les réapprovisionnements nécessaires.' });
  if (cashGaps.length) actions.push({ level: 'critical', code: 'cash_gaps', count: cashGaps.length, label: `${cashGaps.length} écart(s) de caisse à traiter`, advice: 'Examiner les écarts et enregistrer leur résolution selon la procédure.' });
  if (hrAlerts.length) actions.push({ level: 'warning', code: 'hr_alerts', count: hrAlerts.length, label: `${hrAlerts.length} alerte(s) RH ouverte(s)`, advice: 'Consulter les alertes RH accessibles à votre rôle.' });
  if (unread[0]?.n) actions.push({ level: 'info', code: 'notifications', count: Number(unread[0].n), label: `${Number(unread[0].n)} notification(s) non lue(s)`, advice: 'Consulter le centre de notifications.' });
  const canFinance = req.user.perms.has('finance.view');
  res.json({
    period: { from, to, previous_from: prevFrom, previous_to: prevTo, days },
    kpis: {
      revenue: { value: revenue, previous: prevRevenue, change_pct: changePct(revenue, prevRevenue), components: { fuel: fuelSales, products: productSales } },
      expenses: { value: expenses, previous: prevExpenses, change_pct: changePct(expenses, prevExpenses) },
      revenue_minus_expenses: canFinance ? revenue - expenses : null,
      product_sales_count: Number(salesNow[0]?.n || 0), fuel_liters: Number(fuelNow[0]?.liters || 0),
      expense_count: Number(expenseNow[0]?.n || 0), open_shifts: openShifts.length,
      low_stock: lowStock.length, cash_gaps: cashGaps.length, hr_alerts: hrAlerts.length
    },
    actions,
    stock_items: lowStock,
    open_shift_items: openShifts,
    note: 'Le chiffre d’affaires additionne ventes produits validées et montants des compteurs issus des quarts clôturés. « CA moins dépenses » n’est pas un bénéfice comptable.'
  });
}));

r.get('/audit', need('audit.view'), wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT a.*, u.login
     FROM audit_logs a
     LEFT JOIN users u ON u.id = a.user_id
     WHERE a.station_id = $1
       AND ($2::text IS NULL OR a.module = $2)
     ORDER BY a.id DESC
     LIMIT $3 OFFSET $4`,
    [
      req.sid,
      req.query.module || null,
      Math.min(+req.query.limit || 100, 500),
      +req.query.offset || 0
    ]
  );

  res.json(rows);
}));

r.get('/notifications', wrap(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM notifications WHERE station_id = $1 ORDER BY id DESC LIMIT 100',
    [req.sid]
  );

  res.json(rows);
}));

r.post('/notifications/:id/read', wrap(async (req, res) => {
  await pool.query(
    'UPDATE notifications SET read_at = now() WHERE id = $1 AND station_id = $2',
    [req.params.id, req.sid]
  );

  res.json({ ok: true });
}));

module.exports = r;
module.exports._dashboardDateHelpers = { validDay, dashboardRange };