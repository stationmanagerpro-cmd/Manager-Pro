// Statistiques agrégées des profils station : client, fournisseur, employé.
// Lecture seule, isolées par station (req.sid). Les montants sensibles suivent les mêmes permissions que les fiches.
// Période : ?period=30d | 3m | 12m (défaut) | all — pilote les courbes et les indicateurs d'activité ;
// les soldes, limites, dettes et échéances restent la situation actuelle. Export PDF : .../stats.pdf?period=...
const express = require('express');
const { pool, HttpError, wrap, need } = require('./core');
const docs = require('./docs');
const r = express.Router();

const n2 = x => Math.round(Number(x || 0) * 100) / 100;

// ---------- Période ----------
// Aucune valeur issue de la requête n'est insérée dans le SQL : la clé est validée par liste blanche,
// les fragments SQL ci-dessous sont des constantes.
const MONTHS_BACK = n => `date_trunc('month', now()) - interval '${n} months'`;
const DAYS_BACK = n => `date_trunc('day', now()) - interval '${n} days'`;
const PERIODS = {
  '30d': { label: '30 derniers jours', gran: 'day', since: DAYS_BACK(29), chart: DAYS_BACK(29) },
  '3m': { label: '3 derniers mois', gran: 'month', since: MONTHS_BACK(2), chart: MONTHS_BACK(2) },
  '12m': { label: '12 derniers mois', gran: 'month', since: MONTHS_BACK(11), chart: MONTHS_BACK(11) },
  all: { label: "Tout l'historique", gran: 'month', since: null, chart: MONTHS_BACK(59) } // courbe limitée à 60 mois
};
// Plage personnalisée : ?period=custom&from=YYYY-MM-DD&to=YYYY-MM-DD (dates validées strictement avant d'entrer dans le SQL)
const MAX_CUSTOM_DAYS = 3660;
function parseDay(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(v + 'T00:00:00Z');
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : v;
}
const frDay = v => v.split('-').reverse().join('/');
function customRange(req) {
  let from = parseDay(req.query && req.query.from), to = parseDay(req.query && req.query.to);
  if (!from && !to) return null;
  const today = new Date().toISOString().slice(0, 10);
  if (!to) to = today;
  if (!from) from = to;
  if (from > to) [from, to] = [to, from];
  if ((new Date(to) - new Date(from)) / 864e5 > MAX_CUSTOM_DAYS) from = new Date(new Date(to).getTime() - MAX_CUSTOM_DAYS * 864e5).toISOString().slice(0, 10);
  return { from, to, days: Math.round((new Date(to) - new Date(from)) / 864e5) + 1 };
}
function periodOf(req) {
  const raw = req.query && req.query.period;
  const cr = raw === 'custom' || (raw === undefined && req.query && (req.query.from || req.query.to)) ? customRange(req) : null;
  if (cr) {
    // from/to ont été validés (AAAA-MM-JJ) : on peut les écrire en littéral dans le SQL
    const gran = cr.days <= 62 ? 'day' : 'month', fmt = gran === 'day' ? 'YYYY-MM-DD' : 'YYYY-MM';
    const lo = `'${cr.from}'::date`, hi = `('${cr.to}'::date + 1)`;
    const rng = col => `${col} >= ${lo} AND ${col} < ${hi}`;
    return {
      key: 'custom', custom: true, label: 'Du ' + frDay(cr.from) + ' au ' + frDay(cr.to), gran, from: cr.from, to: cr.to,
      inP: rng, and: col => ' AND ' + rng(col), chartAnd: col => ' AND ' + rng(col),
      bucket: col => `to_char(date_trunc('${gran}', ${col}), '${fmt}')`,
      async keys() {
        const { rows } = await pool.query(`SELECT to_char(g, '${fmt}') AS k FROM generate_series(date_trunc('${gran}', ${lo}), date_trunc('${gran}', '${cr.to}'::date), interval '1 ${gran}') AS g`);
        return rows.map(x => x.k);
      },
      async meta() { return { period: 'custom', label: 'Du ' + frDay(cr.from) + ' au ' + frDay(cr.to), gran, from: cr.from, to: cr.to, capped: false, custom: true }; }
    };
  }
  const key = typeof raw === 'string' && Object.prototype.hasOwnProperty.call(PERIODS, raw) ? raw : '12m';
  const d = PERIODS[key], fmt = d.gran === 'day' ? 'YYYY-MM-DD' : 'YYYY-MM';
  return {
    key, label: d.label, gran: d.gran,
    inP: col => (d.since ? `${col} >= ${d.since}` : 'TRUE'),            // dans FILTER (WHERE ...)
    and: col => (d.since ? ` AND ${col} >= ${d.since}` : ''),           // restriction des indicateurs
    chartAnd: col => ` AND ${col} >= ${d.chart}`,                       // restriction des courbes
    bucket: col => `to_char(date_trunc('${d.gran}', ${col}), '${fmt}')`,
    async keys() {
      const { rows } = await pool.query(`SELECT to_char(g, '${fmt}') AS k FROM generate_series(date_trunc('${d.gran}', ${d.chart}), date_trunc('${d.gran}', now()), interval '1 ${d.gran}') AS g`);
      return rows.map(x => x.k);
    },
    async meta() {
      const from = d.since ? `to_char((${d.since})::date, 'YYYY-MM-DD')` : 'NULL::text';
      const { rows: [m] } = await pool.query(`SELECT ${from} AS from_date, to_char(CURRENT_DATE, 'YYYY-MM-DD') AS to_date`);
      return { period: key, label: d.label, gran: d.gran, from: m.from_date, to: m.to_date, capped: key === 'all' };
    }
  };
}
const fill = (rows, keys, cols) => {
  const idx = new Map(rows.map(x => [x.month, x]));
  return keys.map(k => { const row = idx.get(k) || {}; const o = { month: k }; cols.forEach(c => { o[c] = n2(row[c]); }); return o; });
};
// « Tout » : on retire les mois vides du début (au moins les 12 derniers restent affichés)
const trimLead = (P, arr, cols) => {
  if (P.key !== 'all') return arr;
  const i = arr.findIndex(m => cols.some(c => m[c]));
  return arr.slice(Math.min(i < 0 ? arr.length : i, Math.max(0, arr.length - 12)));
};
const q = (sql, p) => pool.query(sql, p).then(x => x.rows).catch(e => { console.error('[profile_stats]', e.message); return []; });
const idOf = (req, what) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, 'Identifiant ' + what + ' invalide');
  return id;
};
const daysSince = d => (d ? Math.floor((Date.now() - new Date(d)) / 864e5) : null);


// ---------- Comportement : jours forts, heures, rang, rythme (lecture seule, mêmes filtres de période) ----------
const dowFill = rows => [1, 2, 3, 4, 5, 6, 7].map(d => { const x = rows.find(w => Number(w.dow) === d) || {}; return { dow: d, n: Number(x.n || 0), amount: n2(x.amount) }; });
const hourFill = rows => Array.from({ length: 24 }, (_, h) => { const x = rows.find(w => Number(w.h) === h) || {}; return { h, n: Number(x.n || 0) }; });
const rankOf = r0 => { const x = r0 || {}; const tot = Number(x.total || 0), mine = Number(x.mine || 0); return { rank: x.mine != null ? Number(x.rank) : null, of: Number(x.n || 0), share_pct: tot > 0 ? Math.round(mine / tot * 1000) / 10 : 0 }; };

async function customerBehavior(sid, id, P) {
  const [wd, hr, gap, rk] = await Promise.all([
    q(`SELECT EXTRACT(ISODOW FROM sold_at)::int AS dow, COUNT(*)::int AS n, SUM(total) AS amount FROM sales
        WHERE station_id=$1 AND customer_id=$2 AND status='valide'${P.and('sold_at')} GROUP BY 1`, [sid, id]),
    q(`SELECT EXTRACT(HOUR FROM sold_at)::int AS h, COUNT(*)::int AS n FROM sales
        WHERE station_id=$1 AND customer_id=$2 AND status='valide'${P.and('sold_at')} GROUP BY 1`, [sid, id]),
    q(`SELECT AVG(g) AS avg_gap, MAX(total) AS max_total FROM (
         SELECT total, EXTRACT(EPOCH FROM sold_at - LAG(sold_at) OVER (ORDER BY sold_at)) / 86400 AS g FROM sales
          WHERE station_id=$1 AND customer_id=$2 AND status='valide'${P.and('sold_at')}) x`, [sid, id]),
    q(`WITH per AS (SELECT customer_id, SUM(total) AS t FROM sales WHERE station_id=$1 AND status='valide' AND customer_id IS NOT NULL${P.and('sold_at')} GROUP BY 1)
       SELECT (SELECT COUNT(*) FROM per)::int AS n, (SELECT COUNT(*) + 1 FROM per WHERE t > COALESCE((SELECT t FROM per WHERE customer_id=$2), 0))::int AS rank,
              (SELECT t FROM per WHERE customer_id=$2) AS mine, (SELECT COALESCE(SUM(t), 0) FROM per) AS total`, [sid, id])
  ]);
  const g = gap[0] || {};
  return { by_weekday: dowFill(wd), by_hour: hourFill(hr), avg_gap_days: g.avg_gap == null ? null : Math.round(Number(g.avg_gap) * 10) / 10, max_total: n2(g.max_total), ...rankOf(rk[0]) };
}

async function supplierBehavior(sid, id, P) {
  const [wd, lead, prods, rk] = await Promise.all([
    q(`SELECT EXTRACT(ISODOW FROM ordered_at)::int AS dow, COUNT(*)::int AS n, SUM(total) AS amount FROM purchases
        WHERE station_id=$1 AND supplier_id=$2 AND status <> 'annule'${P.and('ordered_at')} GROUP BY 1`, [sid, id]),
    q(`SELECT AVG(EXTRACT(EPOCH FROM received_at - ordered_at) / 86400) AS avg_lead, MIN(EXTRACT(EPOCH FROM received_at - ordered_at) / 86400) AS min_lead,
              MAX(EXTRACT(EPOCH FROM received_at - ordered_at) / 86400) AS max_lead, COUNT(*) FILTER (WHERE received_at IS NOT NULL)::int AS received
         FROM purchases WHERE station_id=$1 AND supplier_id=$2 AND status <> 'annule'${P.and('ordered_at')}`, [sid, id]),
    q(`SELECT COUNT(DISTINCT d.product_id)::int AS n FROM purchase_details d JOIN purchases pu ON pu.id = d.purchase_id
        WHERE pu.station_id=$1 AND pu.supplier_id=$2 AND pu.status <> 'annule'${P.and('pu.ordered_at')}`, [sid, id]),
    q(`WITH per AS (SELECT supplier_id, SUM(total) AS t FROM purchases WHERE station_id=$1 AND status <> 'annule'${P.and('ordered_at')} GROUP BY 1)
       SELECT (SELECT COUNT(*) FROM per)::int AS n, (SELECT COUNT(*) + 1 FROM per WHERE t > COALESCE((SELECT t FROM per WHERE supplier_id=$2), 0))::int AS rank,
              (SELECT t FROM per WHERE supplier_id=$2) AS mine, (SELECT COALESCE(SUM(t), 0) FROM per) AS total`, [sid, id])
  ]);
  const l = lead[0] || {}, r1 = v => (v == null ? null : Math.round(Number(v) * 10) / 10);
  return { by_weekday: dowFill(wd), lead_avg_days: r1(l.avg_lead), lead_min_days: r1(l.min_lead), lead_max_days: r1(l.max_lead), received_orders: l.received || 0, distinct_products: (prods[0] && prods[0].n) || 0, ...rankOf(rk[0]) };
}

async function employeeBehavior(sid, id, P) {
  const [wd, hr, best, rk] = await Promise.all([
    q(`SELECT EXTRACT(ISODOW FROM sold_at)::int AS dow, COUNT(*)::int AS n, SUM(total) AS amount FROM sales
        WHERE station_id=$1 AND employee_id=$2 AND status='valide'${P.and('sold_at')} GROUP BY 1`, [sid, id]),
    q(`SELECT EXTRACT(HOUR FROM sold_at)::int AS h, COUNT(*)::int AS n FROM sales
        WHERE station_id=$1 AND employee_id=$2 AND status='valide'${P.and('sold_at')} GROUP BY 1`, [sid, id]),
    q(`SELECT to_char(sold_at::date, 'YYYY-MM-DD') AS day, SUM(total) AS amount, COUNT(*)::int AS n FROM sales
        WHERE station_id=$1 AND employee_id=$2 AND status='valide'${P.and('sold_at')} GROUP BY 1 ORDER BY 2 DESC LIMIT 1`, [sid, id]),
    q(`WITH per AS (SELECT employee_id, SUM(total) AS t FROM sales WHERE station_id=$1 AND status='valide' AND employee_id IS NOT NULL${P.and('sold_at')} GROUP BY 1)
       SELECT (SELECT COUNT(*) FROM per)::int AS n, (SELECT COUNT(*) + 1 FROM per WHERE t > COALESCE((SELECT t FROM per WHERE employee_id=$2), 0))::int AS rank,
              (SELECT t FROM per WHERE employee_id=$2) AS mine, (SELECT COALESCE(SUM(t), 0) FROM per) AS total`, [sid, id])
  ]);
  const b = best[0] || null;
  return { by_weekday: dowFill(wd), by_hour: hourFill(hr), best_day: b ? { day: b.day, amount: n2(b.amount), n: b.n } : null, ...rankOf(rk[0]) };
}

// ---------- Client ----------
async function customerStats(req, id, P) {
  const sid = req.sid;
  const { rows: [c] } = await pool.query('SELECT id, name, balance, credit_limit, active FROM customers WHERE id=$1 AND station_id=$2 AND deleted_at IS NULL', [id, sid]);
  if (!c) throw new HttpError(404, 'Client introuvable');
  const canR = req.user.perms.has('receivable.view');
  const [keys, meta, monthly, repaid, tot, methods, products, repTot, invoices, invAgg, invMonthly] = await Promise.all([
    P.keys(), P.meta(),
    q(`SELECT ${P.bucket('sold_at')} AS month, SUM(total) AS sales, COUNT(*)::int AS orders
         FROM sales WHERE station_id=$1 AND customer_id=$2 AND status='valide'${P.chartAnd('sold_at')} GROUP BY 1`, [sid, id]),
    q(`SELECT ${P.bucket('cp.paid_at')} AS month, SUM(cp.amount) AS repaid
         FROM customer_payments cp WHERE cp.customer_id=$1${P.chartAnd('cp.paid_at')} GROUP BY 1`, [id]),
    q(`SELECT COALESCE(SUM(total) FILTER (WHERE ${P.inP('sold_at')}),0) AS total, (COUNT(*) FILTER (WHERE ${P.inP('sold_at')}))::int AS n,
              MIN(sold_at) AS first_at, MAX(sold_at) AS last_at
         FROM sales WHERE station_id=$1 AND customer_id=$2 AND status='valide'`, [sid, id]),
    q(`SELECT p.method, SUM(p.amount) AS amount FROM payments p JOIN sales s ON s.id=p.sale_id
        WHERE s.station_id=$1 AND s.customer_id=$2 AND s.status='valide'${P.and('s.sold_at')} GROUP BY p.method ORDER BY 2 DESC`, [sid, id]),
    q(`SELECT pr.id AS product_id, pr.name AS product, SUM(d.amount) AS amount, SUM(d.quantity) AS quantity
         FROM sale_details d JOIN sales s ON s.id=d.sale_id JOIN products pr ON pr.id=d.product_id
        WHERE s.station_id=$1 AND s.customer_id=$2 AND s.status='valide'${P.and('s.sold_at')} GROUP BY pr.id, pr.name ORDER BY 3 DESC LIMIT 6`, [sid, id]),
    q(`SELECT COALESCE(SUM(amount),0) AS repaid, COALESCE(SUM(amount) FILTER (WHERE ${P.inP('paid_at')}),0) AS repaid_period
         FROM customer_payments WHERE customer_id=$1`, [id]),
    q(`SELECT status, COUNT(*)::int AS n, COALESCE(SUM(total_ttc),0) AS total, COALESCE(SUM(amount_paid),0) AS paid
         FROM invoices WHERE station_id=$1 AND customer_id=$2 AND status <> 'annulee'${P.and('COALESCE(issued_on, created_at::date)')} GROUP BY status`, [sid, id]),
    // Facturation : montants facturés / encaissés sur la période, reste à régler (situation actuelle, toutes périodes)
    q(`SELECT
         COALESCE(SUM(i.total_ttc) FILTER (WHERE i.status IN ('emise','partielle','payee') AND ${P.inP('COALESCE(i.issued_on, i.created_at::date)')}), 0) AS invoiced_period,
         COALESCE(SUM(i.total_ttc) FILTER (WHERE i.status IN ('emise','partielle','payee')), 0) AS invoiced_total,
         COALESCE((SELECT SUM(ip.amount) FROM invoice_payments ip JOIN invoices i2 ON i2.id = ip.invoice_id
                    WHERE i2.station_id=$1 AND i2.customer_id=$2 AND ${P.inP('ip.paid_at')}), 0) AS collected_period,
         COALESCE((SELECT SUM(ip.amount) FROM invoice_payments ip JOIN invoices i2 ON i2.id = ip.invoice_id
                    WHERE i2.station_id=$1 AND i2.customer_id=$2), 0) AS collected_total,
         COALESCE(SUM(i.total_ttc - i.amount_paid) FILTER (WHERE i.status IN ('emise','partielle')), 0) AS due,
         COUNT(*) FILTER (WHERE i.status IN ('emise','partielle'))::int AS open_n,
         COUNT(*) FILTER (WHERE i.status IN ('emise','partielle') AND i.due_date < CURRENT_DATE)::int AS overdue_n,
         MAX(COALESCE(i.issued_on, i.created_at::date)) FILTER (WHERE i.status <> 'annulee') AS last_invoice_on
       FROM invoices i WHERE i.station_id=$1 AND i.customer_id=$2`, [sid, id]),
    q(`SELECT ${P.bucket('COALESCE(i.issued_on, i.created_at::date)')} AS month, SUM(i.total_ttc) AS invoiced
         FROM invoices i WHERE i.station_id=$1 AND i.customer_id=$2 AND i.status IN ('emise','partielle','payee')${P.chartAnd('COALESCE(i.issued_on, i.created_at::date)')} GROUP BY 1`, [sid, id])
  ]);
  const ia = invAgg[0] || {};
  const t = tot[0] || { total: 0, n: 0 };
  const behavior = await customerBehavior(sid, id, P);
  const bal = Number(c.balance || 0), lim = Number(c.credit_limit || 0);
  const series = fill(monthly, keys, ['sales', 'orders']).map(m => {
    const rp = repaid.find(x => x.month === m.month), iv = invMonthly.find(x => x.month === m.month);
    return { ...m, repaid: canR ? n2(rp && rp.repaid) : null, invoiced: canR ? n2(iv && iv.invoiced) : null };
  });
  return {
    meta, behavior,
    customer: { id: c.id, name: c.name, active: c.active !== false },
    kpis: {
      total_sales: n2(t.total), orders: t.n, avg_basket: t.n ? n2(t.total / t.n) : 0,
      first_at: t.first_at || null, last_at: t.last_at || null, days_since_last: daysSince(t.last_at),
      balance: canR ? n2(bal) : null, credit_limit: canR ? n2(lim) : null,
      credit_use_pct: canR && lim > 0 ? Math.round(bal / lim * 100) : null,
      repaid_total: canR ? n2(repTot[0] && repTot[0].repaid) : null,
      repaid_period: canR ? n2(repTot[0] && repTot[0].repaid_period) : null,
      // Facturation (module Facturation) : mêmes droits que les montants de la fiche (receivable.view)
      invoiced_period: canR ? n2(ia.invoiced_period) : null, invoiced_total: canR ? n2(ia.invoiced_total) : null,
      invoice_collected_period: canR ? n2(ia.collected_period) : null, invoice_collected_total: canR ? n2(ia.collected_total) : null,
      invoice_due: canR ? n2(ia.due) : null, invoice_open_n: ia.open_n || 0, invoice_overdue_n: ia.overdue_n || 0,
      last_invoice_on: ia.last_invoice_on || null
    },
    monthly: trimLead(P, series, ['sales', 'orders', 'repaid', 'invoiced']),
    by_method: methods.map(x => ({ method: x.method, amount: n2(x.amount) })),
    top_products: products.map(x => ({ product_id: x.product_id || null, product: x.product, amount: n2(x.amount), quantity: Number(x.quantity) })),
    invoices: invoices.map(x => ({ status: x.status, n: x.n, total: canR ? n2(x.total) : null, paid: canR ? n2(x.paid) : null }))
  };
}

// ---------- Fournisseur ----------
async function supplierStats(req, id, P) {
  const sid = req.sid;
  const { rows: [s] } = await pool.query('SELECT id, name, balance_due, payment_terms_days, active FROM suppliers WHERE id=$1 AND station_id=$2 AND deleted_at IS NULL', [id, sid]);
  if (!s) throw new HttpError(404, 'Fournisseur introuvable');
  const Pm = req.user.perms;
  const canFin = Pm.has('debt.view') || Pm.has('purchase.pay') || Pm.has('finance.view'), canDebt = Pm.has('debt.view');
  const none = Promise.resolve([]);
  const [keys, meta, monthly, paid, tot, status, products, payTot, late] = await Promise.all([
    P.keys(), P.meta(),
    q(`SELECT ${P.bucket('ordered_at')} AS month, SUM(total) AS purchases, COUNT(*)::int AS orders
         FROM purchases WHERE station_id=$1 AND supplier_id=$2 AND status <> 'annule'${P.chartAnd('ordered_at')} GROUP BY 1`, [sid, id]),
    canFin ? q(`SELECT ${P.bucket('sp.paid_at')} AS month, SUM(sp.amount) AS paid
         FROM supplier_payments sp JOIN purchases pu ON pu.id=sp.purchase_id
        WHERE sp.supplier_id=$1 AND pu.station_id=$2${P.chartAnd('sp.paid_at')} GROUP BY 1`, [id, sid]) : none,
    q(`SELECT COALESCE(SUM(total) FILTER (WHERE ${P.inP('ordered_at')}),0) AS total, (COUNT(*) FILTER (WHERE ${P.inP('ordered_at')}))::int AS n,
              MAX(ordered_at) AS last_at, MIN(ordered_at) AS first_at, COALESCE(SUM(invoice_total),0) AS invoiced
         FROM purchases WHERE station_id=$1 AND supplier_id=$2 AND status <> 'annule'`, [sid, id]),
    q(`SELECT status, COUNT(*)::int AS n, COALESCE(SUM(total),0) AS total FROM purchases
        WHERE station_id=$1 AND supplier_id=$2${P.and('ordered_at')} GROUP BY status ORDER BY 2 DESC`, [sid, id]),
    q(`SELECT pr.id AS product_id, pr.name AS product, SUM(d.qty_ordered * d.unit_cost) AS amount, SUM(d.qty_ordered) AS quantity
         FROM purchase_details d JOIN purchases pu ON pu.id=d.purchase_id JOIN products pr ON pr.id=d.product_id
        WHERE pu.station_id=$1 AND pu.supplier_id=$2 AND pu.status <> 'annule'${P.and('pu.ordered_at')} GROUP BY pr.id, pr.name ORDER BY 3 DESC LIMIT 6`, [sid, id]),
    canFin ? q(`SELECT COALESCE(SUM(sp.amount),0) AS paid, COALESCE(SUM(sp.amount) FILTER (WHERE ${P.inP('sp.paid_at')}),0) AS paid_period
         FROM supplier_payments sp JOIN purchases pu ON pu.id=sp.purchase_id WHERE sp.supplier_id=$1 AND pu.station_id=$2`, [id, sid]) : none,
    canFin ? q(`SELECT COUNT(*)::int AS n, COALESCE(SUM(invoice_total - paid),0) AS amount FROM purchases
        WHERE station_id=$1 AND supplier_id=$2 AND status NOT IN ('annule','paye') AND due_date < CURRENT_DATE AND COALESCE(invoice_total,0) - paid > 0`, [sid, id]) : none
  ]);
  const t = tot[0] || { total: 0, n: 0, invoiced: 0 };
  const behavior = await supplierBehavior(sid, id, P);
  const paidTotal = canFin ? n2(payTot[0] && payTot[0].paid) : null;
  const series = fill(monthly, keys, ['purchases', 'orders']).map(m => { const p = paid.find(x => x.month === m.month); return { ...m, paid: canFin ? n2(p && p.paid) : null }; });
  return {
    meta, behavior,
    supplier: { id: s.id, name: s.name, active: s.active !== false },
    kpis: {
      purchases_total: n2(t.total), orders: t.n, avg_order: t.n ? n2(t.total / t.n) : 0,
      first_at: t.first_at || null, last_at: t.last_at || null, days_since_last: daysSince(t.last_at),
      balance_due: canDebt ? n2(s.balance_due) : null,
      paid_total: paidTotal,
      paid_period: canFin ? n2(payTot[0] && payTot[0].paid_period) : null,
      invoiced_total: canFin ? n2(t.invoiced) : null,
      settle_pct: canFin && Number(t.invoiced) > 0 ? Math.min(100, Math.round(paidTotal / Number(t.invoiced) * 100)) : null,
      overdue_count: canFin ? (late[0] ? late[0].n : 0) : null, overdue_amount: canFin ? n2(late[0] && late[0].amount) : null,
      payment_terms_days: s.payment_terms_days
    },
    monthly: trimLead(P, series, ['purchases', 'orders', 'paid']),
    by_status: status.map(x => ({ status: x.status, n: x.n, total: n2(x.total) })),
    top_products: products.map(x => ({ product_id: x.product_id || null, product: x.product, amount: n2(x.amount), quantity: Number(x.quantity) }))
  };
}

// ---------- Employé ----------
async function employeeStats(req, id, P) {
  const sid = req.sid;
  const { rows: [e] } = await pool.query('SELECT id, user_id, hired_on, status, first_name, last_name, matricule, position FROM employees WHERE id=$1 AND station_id=$2 AND deleted_at IS NULL', [id, sid]);
  if (!e) throw new HttpError(404, 'Employé introuvable');
  const Pm = req.user.perms, self = e.user_id === req.user.id;
  if (!(self || ['hr.view', 'hr.manage', 'hr.payroll', 'hr.debts', 'hr.gaps'].some(p => Pm.has(p)))) throw new HttpError(403, "Vous n'avez pas accès à cette fiche");
  const canPay = self || Pm.has('hr.payroll') || Pm.has('hr.manage');
  const canDebt = self || Pm.has('hr.debts') || Pm.has('hr.payroll') || Pm.has('hr.manage') || Pm.has('hr.view');
  const none = Promise.resolve([]);
  const [keys, meta, rev, shifts, tot, shiftTot, trend, gaps, products, debts, adv, slips] = await Promise.all([
    P.keys(), P.meta(),
    q(`SELECT ${P.bucket('sa.sold_at')} AS month, SUM(d.amount) AS revenue, COUNT(DISTINCT sa.id)::int AS operations
         FROM sales sa JOIN sale_details d ON d.sale_id = sa.id
        WHERE sa.station_id=$1 AND sa.employee_id=$2 AND sa.status='valide'${P.chartAnd('sa.sold_at')} GROUP BY 1`, [sid, id]),
    q(`SELECT ${P.bucket('sh.opened_at')} AS month, COUNT(DISTINCT sh.id)::int AS shifts
         FROM shift_employees se JOIN shifts sh ON sh.id = se.shift_id
        WHERE sh.station_id=$1 AND se.employee_id=$2${P.chartAnd('sh.opened_at')} GROUP BY 1`, [sid, id]),
    q(`SELECT COALESCE(SUM(d.amount),0) AS revenue, COUNT(DISTINCT sa.id)::int AS operations
         FROM sales sa JOIN sale_details d ON d.sale_id = sa.id
        WHERE sa.station_id=$1 AND sa.employee_id=$2 AND sa.status='valide'${P.and('sa.sold_at')}`, [sid, id]),
    q(`SELECT COUNT(DISTINCT sh.id)::int AS shifts
         FROM shift_employees se JOIN shifts sh ON sh.id = se.shift_id
        WHERE sh.station_id=$1 AND se.employee_id=$2${P.and('sh.opened_at')}`, [sid, id]),
    q(`SELECT COALESCE(SUM(d.amount) FILTER (WHERE sa.sold_at >= date_trunc('month', now())),0) AS cur,
              COALESCE(SUM(d.amount) FILTER (WHERE sa.sold_at < date_trunc('month', now())),0) AS prev
         FROM sales sa JOIN sale_details d ON d.sale_id = sa.id
        WHERE sa.station_id=$1 AND sa.employee_id=$2 AND sa.status='valide' AND sa.sold_at >= date_trunc('month', now()) - interval '1 month'`, [sid, id]),
    q(`SELECT status, kind, COUNT(*)::int AS n, COALESCE(SUM(amount),0) AS amount FROM employee_gaps
        WHERE station_id=$1 AND employee_id=$2${P.and('created_at')} GROUP BY status, kind`, [sid, id]),
    q(`SELECT pr.id AS product_id, pr.name AS product, SUM(d.amount) AS amount, SUM(d.quantity) AS quantity
         FROM sales sa JOIN sale_details d ON d.sale_id = sa.id JOIN products pr ON pr.id = d.product_id
        WHERE sa.station_id=$1 AND sa.employee_id=$2 AND sa.status='valide'${P.and('sa.sold_at')}
        GROUP BY pr.id, pr.name ORDER BY 3 DESC LIMIT 6`, [sid, id]),
    canDebt ? q(`SELECT COALESCE(SUM(d.amount),0) AS initial,
                        COALESCE(SUM((SELECT COALESCE(SUM(p.amount),0) FROM employee_debt_payments p WHERE p.debt_id = d.id)),0) AS paid
                   FROM employee_debts d WHERE d.station_id=$1 AND d.employee_id=$2 AND d.status <> 'annule'`, [sid, id]) : none,
    canDebt ? q(`SELECT COALESCE(SUM(amount - deducted),0) AS outstanding FROM salary_advances WHERE station_id=$1 AND employee_id=$2 AND status='en_cours'`, [sid, id]) : none,
    canPay ? q(`SELECT to_char(month, 'YYYY-MM') AS month, gross, total_deductions, net_pay, status FROM payslips
                 WHERE station_id=$1 AND employee_id=$2 AND status <> 'brouillon' ORDER BY month DESC LIMIT 6`, [sid, id]) : none
  ]);
  const series = fill(rev, keys, ['revenue', 'operations']).map(m => { const s = shifts.find(x => x.month === m.month); return { ...m, shifts: s ? s.shifts : 0 }; });
  const revenue = n2(tot[0] && tot[0].revenue), operations = (tot[0] && tot[0].operations) || 0, nShifts = (shiftTot[0] && shiftTot[0].shifts) || 0;
  const cur = Number(trend[0] && trend[0].cur || 0), prev = Number(trend[0] && trend[0].prev || 0);
  const gapsTotal = gaps.reduce((a, g) => a + Number(g.amount), 0), gapsCount = gaps.reduce((a, g) => a + g.n, 0);
  const d0 = debts[0] || { initial: 0, paid: 0 };
  const behavior = await employeeBehavior(sid, id, P);
  return {
    meta, behavior,
    employee: {
      id: e.id, name: `${e.first_name} ${e.last_name}`.trim(), matricule: e.matricule, position: e.position,
      hired_on: e.hired_on, status: e.status,
      tenure_months: e.hired_on ? Math.max(0, Math.floor((Date.now() - new Date(e.hired_on)) / (30.4375 * 864e5))) : null
    },
    kpis: {
      revenue, shifts: nShifts, avg_per_shift: nShifts ? n2(revenue / nShifts) : 0, operations,
      month_variation_pct: prev > 0 ? Math.round((cur - prev) / prev * 100) : null,
      gaps_count: gapsCount, gaps_amount: n2(gapsTotal),
      debt_balance: canDebt ? n2(Number(d0.initial) - Number(d0.paid)) : null,
      debt_initial: canDebt ? n2(d0.initial) : null,
      advances_outstanding: canDebt ? n2(adv[0] && adv[0].outstanding) : null,
      last_net: canPay && slips[0] ? n2(slips[0].net_pay) : null
    },
    monthly: trimLead(P, series, ['revenue', 'operations', 'shifts']),
    gaps_by_status: Object.values(gaps.reduce((m, g) => { (m[g.status] = m[g.status] || { status: g.status, n: 0, amount: 0 }); m[g.status].n += g.n; m[g.status].amount += Number(g.amount); return m; }, {})).map(x => ({ ...x, amount: n2(x.amount) })),
    top_products: products.map(x => ({ product_id: x.product_id || null, product: x.product, amount: n2(x.amount), quantity: Number(x.quantity) })),
    payslips: canPay ? slips.reverse().map(x => ({ month: x.month, gross: n2(x.gross), deductions: n2(x.total_deductions), net: n2(x.net_pay), status: x.status })) : null
  };
}

// ---------- Export PDF de la vue globale ----------
const MN = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const bucketLabel = k => { const p = String(k).split('-'); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : `${MN[(+p[1] || 1) - 1]} ${p[0]}`; };
const METH = { especes: 'Espèces', carte: 'Carte', mobile_money: 'Mobile money', credit: 'Crédit', autre: 'Autre' };
const PSTAT = { commande: 'Commandé', partiel: 'Partiel', recu: 'Reçu', facture: 'Facturé', paye: 'Payé', archive: 'Archivé', annule: 'Annulé' };
const ISTAT = { brouillon: 'Brouillon', emise: 'Émise', partielle: 'Partielle', payee: 'Payée', annulee: 'Annulée' };
const GSTAT = { en_attente: 'En attente', accepte: 'Accepté', conteste: 'Contesté', regularise: 'Régularisé', cloture: 'Clôturé' };

function pdfKit(b, s) {
  const m = v => `${docs.cellText(n2(v))} ${b.currency}`;
  const date = d => (d ? docs.fmtDate(d).slice(0, 10) : '-');
  const opt = (v, fn) => (v == null ? null : fn(v));
  const kpis = items => ({ type: 'kpis', items: items.filter(i => i.value != null) });
  const table = (title, head, rows, extra) => (rows.length ? [{ type: 'table', title, head, rows, ...extra }] : []);
  const range = s.meta.from ? `Du ${docs.cellText(s.meta.from)} au ${docs.cellText(s.meta.to)}` : `Jusqu'au ${docs.cellText(s.meta.to)}`;
  const note = { type: 'text', text: `Période : ${s.meta.label} (${range}). Les soldes, limites, dettes et échéances reflètent la situation à la date d'édition.` };
  const activity = (title, head, rows) => rows.length ? table(title, head, rows) : [{ type: 'text', title, text: 'Aucune activité sur la période.' }];
  return { m, date, opt, kpis, table, note, activity };
}

function customerPdf(b, s) {
  const { m, date, opt, kpis, table, note, activity } = pdfKit(b, s), k = s.kpis, hasR = k.balance != null;
  const day = s.meta.gran === 'day';
  return {
    b, title: 'PROFIL CLIENT - VUE GLOBALE', subtitle: `${s.customer.name} - ${s.meta.label}`, ref: `PRC-${s.customer.id}-${s.meta.period}`, landscape: false,
    sections: [
      { type: 'kv', title: 'Client', rows: [['Nom', s.customer.name], ['Statut', s.customer.active ? 'Actif' : 'Inactif (archivé)'], ['Premier achat', date(k.first_at)], ['Dernier achat', date(k.last_at)]] },
      note,
      kpis([
        { label: "Chiffre d'affaires", value: m(k.total_sales), note: `${k.orders} achat(s)` },
        { label: 'Panier moyen', value: m(k.avg_basket) },
        { label: 'Solde dû (actuel)', value: opt(k.balance, m) },
        { label: 'Limite de crédit', value: opt(k.credit_limit, v => (v ? m(v) : 'Aucune')) },
        { label: 'Utilisation du crédit', value: opt(k.credit_use_pct, v => v + ' %') },
        { label: 'Remboursements (période)', value: opt(k.repaid_period, m) }
      ]),
      ...activity(day ? 'Achats par jour' : 'Achats par mois', [day ? 'Jour' : 'Mois', 'Achats', 'Nombre', ...(hasR ? ['Remboursements'] : [])],
        s.monthly.filter(x => x.sales || x.orders || x.repaid).map(x => [bucketLabel(x.month), m(x.sales), x.orders, ...(hasR ? [m(x.repaid)] : [])])),
      ...table('Répartition des paiements', ['Mode', 'Montant'], s.by_method.map(x => [METH[x.method] || x.method, m(x.amount)])),
      ...table('Produits les plus achetés', ['Produit', 'Quantité', 'Montant'], s.top_products.map(x => [x.product, x.quantity, m(x.amount)])),
      ...table('Factures par état', ['État', 'Nombre', ...(hasR ? ['Total TTC', 'Encaissé'] : [])], s.invoices.map(x => [ISTAT[x.status] || x.status, x.n, ...(hasR ? [m(x.total), m(x.paid)] : [])]))
    ]
  };
}

function supplierPdf(b, s) {
  const { m, date, opt, kpis, table, note, activity } = pdfKit(b, s), k = s.kpis, fin = k.paid_total != null;
  const day = s.meta.gran === 'day';
  return {
    b, title: 'PROFIL FOURNISSEUR - VUE GLOBALE', subtitle: `${s.supplier.name} - ${s.meta.label}`, ref: `PRF-${s.supplier.id}-${s.meta.period}`, landscape: false,
    sections: [
      { type: 'kv', title: 'Fournisseur', rows: [['Nom', s.supplier.name], ['Statut', s.supplier.active ? 'Actif' : 'Inactif (archivé)'], ['Délai de paiement', k.payment_terms_days != null ? k.payment_terms_days + ' jours' : '-'], ['Première commande', date(k.first_at)], ['Dernière commande', date(k.last_at)]] },
      note,
      kpis([
        { label: 'Achats', value: m(k.purchases_total), note: `${k.orders} commande(s)` },
        { label: 'Commande moyenne', value: m(k.avg_order) },
        { label: 'Dette actuelle', value: opt(k.balance_due, m) },
        { label: 'Payé (période)', value: opt(k.paid_period, m) },
        { label: 'Total facturé (cumul)', value: opt(k.invoiced_total, m) },
        { label: 'Taux de règlement (cumul)', value: opt(k.settle_pct, v => v + ' %') },
        { label: 'Échéances dépassées', value: k.overdue_count != null ? `${k.overdue_count} - ${m(k.overdue_amount)}` : null }
      ]),
      ...activity(day ? 'Achats par jour' : 'Achats par mois', [day ? 'Jour' : 'Mois', 'Achats', 'Nombre', ...(fin ? ['Paiements'] : [])],
        s.monthly.filter(x => x.purchases || x.orders || x.paid).map(x => [bucketLabel(x.month), m(x.purchases), x.orders, ...(fin ? [m(x.paid)] : [])])),
      ...table('Commandes par statut', ['Statut', 'Nombre', 'Montant'], s.by_status.map(x => [PSTAT[x.status] || x.status, x.n, m(x.total)])),
      ...table('Produits les plus commandés', ['Produit', 'Quantité', 'Montant'], s.top_products.map(x => [x.product, x.quantity, m(x.amount)]))
    ]
  };
}

function employeePdf(b, s) {
  const { m, date, opt, kpis, table, note, activity } = pdfKit(b, s), k = s.kpis, e = s.employee;
  const day = s.meta.gran === 'day';
  return {
    b, title: 'PROFIL EMPLOYE - VUE GLOBALE', subtitle: `${e.name} - ${s.meta.label}`, ref: `PRE-${e.matricule || e.id}-${s.meta.period}`, landscape: false,
    sections: [
      { type: 'kv', title: 'Employé', rows: [['Nom', e.name], ['Matricule', e.matricule || '-'], ['Fonction', e.position || '-'], ['Statut', e.status || '-'], ["Date d'embauche", date(e.hired_on)]] },
      note,
      kpis([
        { label: "CA attribué", value: m(k.revenue), note: `${k.operations} opération(s)` },
        { label: 'Quarts travaillés', value: String(k.shifts) },
        { label: 'Moyenne par quart', value: m(k.avg_per_shift) },
        { label: 'Écarts (période)', value: String(k.gaps_count), note: m(k.gaps_amount) },
        { label: 'Dettes à rembourser', value: opt(k.debt_balance, m) },
        { label: 'Avances à déduire', value: opt(k.advances_outstanding, m) },
        { label: 'Dernier net payé', value: opt(k.last_net, m) }
      ]),
      ...activity(day ? 'Activité par jour' : 'Activité par mois', [day ? 'Jour' : 'Mois', "CA attribué", 'Opérations', 'Quarts'],
        s.monthly.filter(x => x.revenue || x.operations || x.shifts).map(x => [bucketLabel(x.month), m(x.revenue), x.operations, x.shifts])),
      ...table('Écarts par statut', ['Statut', 'Nombre', 'Montant'], s.gaps_by_status.map(x => [GSTAT[x.status] || x.status, x.n, m(x.amount)])),
      ...table('Ventes par produit', ['Produit', 'Quantité', 'Montant'], s.top_products.map(x => [x.product, x.quantity, m(x.amount)])),
      ...(s.payslips ? table('Derniers bulletins', ['Mois', 'Brut', 'Retenues', 'Net'], s.payslips.map(x => [bucketLabel(x.month), m(x.gross), m(x.deductions), m(x.net)])) : [])
    ]
  };
}

const sendPdf = async (req, res, s, build, name) => {
  const b = await docs.branding(req.sid);
  docs.send(res, 'pdf', await docs.buildPdf(build(b, s)), name);
};

const customerGate = need('customer.view', 'sale.create');
const supplierGate = need('supplier.view', 'purchase.manage', 'purchase.pay', 'stock.adjust');

r.get('/customers/:id/stats', customerGate, wrap(async (req, res) => res.json(await customerStats(req, idOf(req, 'client'), periodOf(req)))));
r.get('/customers/:id/stats.pdf', customerGate, wrap(async (req, res) => {
  const P = periodOf(req), s = await customerStats(req, idOf(req, 'client'), P);
  await sendPdf(req, res, s, customerPdf, `profil-client-${s.customer.id}-${P.key}`);
}));
r.get('/suppliers/:id/stats', supplierGate, wrap(async (req, res) => res.json(await supplierStats(req, idOf(req, 'fournisseur'), periodOf(req)))));
r.get('/suppliers/:id/stats.pdf', supplierGate, wrap(async (req, res) => {
  const P = periodOf(req), s = await supplierStats(req, idOf(req, 'fournisseur'), P);
  await sendPdf(req, res, s, supplierPdf, `profil-fournisseur-${s.supplier.id}-${P.key}`);
}));
// Employé : les droits (fiche personnelle ou RH) sont vérifiés dans employeeStats
r.get('/hr/employees/:id/stats', wrap(async (req, res) => res.json(await employeeStats(req, idOf(req, 'employé'), periodOf(req)))));
r.get('/hr/employees/:id/stats.pdf', wrap(async (req, res) => {
  const P = periodOf(req), s = await employeeStats(req, idOf(req, 'employé'), P);
  await sendPdf(req, res, s, employeePdf, `profil-employe-${s.employee.matricule || s.employee.id}-${P.key}`);
}));

module.exports = r;
module.exports._internals = { periodOf, fill, trimLead, customerStats, supplierStats, employeeStats, customerPdf, supplierPdf, employeePdf };
