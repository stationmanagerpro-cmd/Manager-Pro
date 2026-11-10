// Fiche produit complète : agrégats et comportement, gestion des prix (historique), achats et commandes en cours,
// historique des mouvements de stock. Lecture isolée par station (req.sid) ; seul POST /products/:id/prices écrit.
// Période : ?period=30d | 3m | 12m (défaut) | all — même logique que les profils client / fournisseur / employé.
const express = require('express');
const { z } = require('zod');
const { pool, tx, HttpError, wrap, body, need, audit, canCost } = require('./core');
const { _internals: PS } = require('./profile_stats');
const docs = require('./docs');
const r = express.Router();

const n2 = x => Math.round(Number(x || 0) * 100) / 100;
const n3 = x => Math.round(Number(x || 0) * 1000) / 1000;
const q = (sql, p) => pool.query(sql, p).then(x => x.rows).catch(e => { console.error('[product_profile]', e.message); return []; });
const idOf = req => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, 'Identifiant produit invalide');
  return id;
};
const daysSince = d => (d ? Math.floor((Date.now() - new Date(d)) / 864e5) : null);

const viewGate = need('stock.adjust', 'price.edit', 'sale.create', 'report.view');
const purchaseGate = need('purchase.manage', 'supplier.view', 'stock.adjust', 'report.view', 'price.edit');
const stockGate = need('stock.adjust', 'report.view', 'price.edit');
// RG-03 : prix d'achat, marges et valeur d'achat → « cost.view » uniquement (administrateur local, gérant, comptable).
// Coûts des lignes d'achat : en plus, les rôles qui passent les achats (purchase.manage / purchase.pay) voient les leurs.
const canPurchaseCost = req => canCost(req) || ['purchase.manage', 'purchase.pay'].some(p => req.user.perms.has(p));

// ---------- Historique des prix : point d'écriture commun (modification de prix, édition produit, réception d'achat) ----------
// À appeler dans la transaction qui modifie products.sell_price / products.buy_price.
async function recordPriceChange(c, { station, product, type, oldPrice, newPrice, by = null, note = null }) {
  if (!['sell', 'buy'].includes(type)) throw new Error('Type de prix inconnu');
  if (oldPrice != null && Number(oldPrice) === Number(newPrice)) return false;
  await c.query(
    `UPDATE price_history SET effective_to = now() WHERE station_id = $1 AND product_id = $2 AND price_type = $3 AND effective_to IS NULL`,
    [station, product, type]);
  await c.query(
    `INSERT INTO price_history(station_id, product_id, price_type, price, old_price, effective_from, created_by, note)
     VALUES ($1,$2,$3,$4,$5,now(),$6,$7)`,
    [station, product, type, newPrice, oldPrice == null ? null : oldPrice, by, note]);
  return true;
}

async function loadProduct(sid, id) {
  const { rows: [p] } = await pool.query(
    `SELECT p.*, cat.code AS category, cat.label AS category_label, COALESCE(st.quantity, 0) AS stock,
            sp.name AS supplier_name
       FROM products p JOIN categories cat ON cat.id = p.category_id
       LEFT JOIN stock st ON st.product_id = p.id
       LEFT JOIN suppliers sp ON sp.id = p.main_supplier_id
      WHERE p.id = $1 AND p.station_id = $2 AND p.deleted_at IS NULL`, [id, sid]);
  if (!p) throw new HttpError(404, 'Produit introuvable');
  return p;
}

// ---------- Profil : identité + agrégats ----------
async function productStats(req, id, P) {
  const sid = req.sid, cost = canCost(req);
  const p = await loadProduct(sid, id);
  const [keys, meta, monthly, flow, tot, rank, weekday, customers, employees, kinds, supplied, lastBuy, open, prices] = await Promise.all([
    P.keys(), P.meta(),
    q(`SELECT ${P.bucket('sa.sold_at')} AS month, SUM(d.quantity) AS qty, SUM(d.amount) AS revenue, SUM(d.quantity * d.unit_cost) AS cost
         FROM sale_details d JOIN sales sa ON sa.id = d.sale_id
        WHERE sa.station_id = $1 AND d.product_id = $2 AND sa.status = 'valide'${P.chartAnd('sa.sold_at')} GROUP BY 1`, [sid, id]),
    q(`SELECT ${P.bucket('m.created_at')} AS month,
              COALESCE(SUM(m.quantity) FILTER (WHERE m.quantity > 0), 0) AS in_qty,
              COALESCE(-SUM(m.quantity) FILTER (WHERE m.quantity < 0), 0) AS out_qty
         FROM stock_movements m WHERE m.station_id = $1 AND m.product_id = $2${P.chartAnd('m.created_at')} GROUP BY 1`, [sid, id]),
    q(`SELECT COALESCE(SUM(d.quantity) FILTER (WHERE ${P.inP('sa.sold_at')}), 0) AS qty,
              COALESCE(SUM(d.amount) FILTER (WHERE ${P.inP('sa.sold_at')}), 0) AS revenue,
              COALESCE(SUM(d.quantity * d.unit_cost) FILTER (WHERE ${P.inP('sa.sold_at')}), 0) AS cost,
              (COUNT(DISTINCT sa.id) FILTER (WHERE ${P.inP('sa.sold_at')}))::int AS tickets,
              MIN(sa.sold_at) AS first_at, MAX(sa.sold_at) AS last_at
         FROM sale_details d JOIN sales sa ON sa.id = d.sale_id
        WHERE sa.station_id = $1 AND d.product_id = $2 AND sa.status = 'valide'`, [sid, id]),
    q(`WITH per AS (
         SELECT d.product_id, SUM(d.amount) AS revenue FROM sale_details d JOIN sales sa ON sa.id = d.sale_id
          WHERE sa.station_id = $1 AND sa.status = 'valide'${P.and('sa.sold_at')} GROUP BY d.product_id)
       SELECT (SELECT COALESCE(SUM(revenue), 0) FROM per) AS total_revenue,
              (SELECT COUNT(*) FROM per)::int AS n_products,
              (SELECT COUNT(*) + 1 FROM per WHERE revenue > COALESCE((SELECT revenue FROM per WHERE product_id = $2), 0))::int AS rank,
              EXISTS (SELECT 1 FROM per WHERE product_id = $2) AS sold`, [sid, id]),
    q(`SELECT EXTRACT(ISODOW FROM sa.sold_at)::int AS dow, SUM(d.quantity) AS qty, SUM(d.amount) AS revenue
         FROM sale_details d JOIN sales sa ON sa.id = d.sale_id
        WHERE sa.station_id = $1 AND d.product_id = $2 AND sa.status = 'valide'${P.and('sa.sold_at')} GROUP BY 1 ORDER BY 1`, [sid, id]),
    q(`SELECT c.id AS id, COALESCE(c.name, 'Vente comptoir') AS name, SUM(d.quantity) AS qty, SUM(d.amount) AS amount
         FROM sale_details d JOIN sales sa ON sa.id = d.sale_id LEFT JOIN customers c ON c.id = sa.customer_id
        WHERE sa.station_id = $1 AND d.product_id = $2 AND sa.status = 'valide'${P.and('sa.sold_at')}
        GROUP BY c.id, 2 ORDER BY 4 DESC LIMIT 6`, [sid, id]),
    q(`SELECT e.id AS id, TRIM(e.first_name || ' ' || e.last_name) AS name, SUM(d.quantity) AS qty, SUM(d.amount) AS amount
         FROM sale_details d JOIN sales sa ON sa.id = d.sale_id JOIN employees e ON e.id = sa.employee_id
        WHERE sa.station_id = $1 AND d.product_id = $2 AND sa.status = 'valide'${P.and('sa.sold_at')}
        GROUP BY e.id, 2 ORDER BY 4 DESC LIMIT 6`, [sid, id]),
    q(`SELECT m.kind, COUNT(*)::int AS n, SUM(m.quantity) AS qty FROM stock_movements m
        WHERE m.station_id = $1 AND m.product_id = $2${P.and('m.created_at')} GROUP BY m.kind ORDER BY 2 DESC`, [sid, id]),
    q(`SELECT s.id AS id, s.name AS supplier, SUM(d.qty_received) AS qty, SUM(d.qty_received * d.unit_cost) AS amount
         FROM purchase_details d JOIN purchases pu ON pu.id = d.purchase_id JOIN suppliers s ON s.id = pu.supplier_id
        WHERE pu.station_id = $1 AND d.product_id = $2 AND pu.status <> 'annule' AND d.qty_received > 0${P.and('pu.ordered_at')}
        GROUP BY s.id, s.name ORDER BY 4 DESC LIMIT 6`, [sid, id]),
    q(`SELECT pu.ordered_at, pu.received_at, d.unit_cost, d.qty_ordered, s.name AS supplier
         FROM purchase_details d JOIN purchases pu ON pu.id = d.purchase_id JOIN suppliers s ON s.id = pu.supplier_id
        WHERE pu.station_id = $1 AND d.product_id = $2 AND pu.status <> 'annule' ORDER BY pu.ordered_at DESC, d.id DESC LIMIT 1`, [sid, id]),
    q(`SELECT COUNT(*)::int AS n, COALESCE(SUM(d.qty_ordered - d.qty_received), 0) AS qty
         FROM purchase_details d JOIN purchases pu ON pu.id = d.purchase_id
        WHERE pu.station_id = $1 AND d.product_id = $2 AND pu.status IN ('commande', 'partiel') AND d.qty_received < d.qty_ordered`, [sid, id]),
    q(`SELECT price_type, price, old_price, effective_from FROM price_history
        WHERE station_id = $1 AND product_id = $2 ORDER BY effective_from DESC, id DESC LIMIT 60`, [sid, id])
  ]);

  const t = tot[0] || {}, rk = rank[0] || {};
  const qty = n3(t.qty), revenue = n2(t.revenue), costTotal = n2(t.cost);
  // Nombre de jours de la période (pour « Tout » : depuis la première vente)
  const from = meta.from ? new Date(meta.from) : (t.first_at ? new Date(t.first_at) : new Date());
  const until = meta.custom && meta.to ? new Date(meta.to) : new Date();
  const days = Math.max(1, Math.round((until.getTime() - from.getTime()) / 864e5) + 1);
  const avgDaily = n3(qty / days);
  const stock = n3(p.stock);
  const sellP = Number(p.sell_price), buyP = Number(p.buy_price);
  const losses = kinds.filter(k => ['perte', 'casse'].includes(k.kind)).reduce((a, k) => a + Math.abs(Number(k.qty)), 0);
  const series = PS.fill(monthly, keys, ['qty', 'revenue', 'cost']).map(m => {
    const fl = flow.find(x => x.month === m.month) || {};
    return { ...m, cost: cost ? m.cost : null, in_qty: n3(fl.in_qty), out_qty: n3(fl.out_qty) };
  });
  const wd = [1, 2, 3, 4, 5, 6, 7].map(d => { const x = weekday.find(w => w.dow === d) || {}; return { dow: d, qty: n3(x.qty), revenue: n2(x.revenue) }; });
  const lb = lastBuy[0] || null;

  return {
    meta,
    product: {
      id: p.id, name: p.name, category: p.category, category_label: p.category_label, unit: p.unit, barcode: p.barcode || null, sku: p.sku || null,
      buy_price: cost ? n2(buyP) : null, sell_price: n2(sellP), tax_rate: Number(p.tax_rate || 0), min_stock: n3(p.min_stock), stock,
      active: p.active !== false, supplier_id: p.main_supplier_id || null, supplier_name: p.supplier_name || null,
      photo_path: p.photo_path || null
    },
    kpis: {
      qty_sold: qty, revenue, tickets: t.tickets || 0, avg_ticket_qty: t.tickets ? n3(qty / t.tickets) : 0,
      avg_daily: avgDaily, days: days,
      days_cover: avgDaily > 0 ? Math.round(stock / avgDaily) : null,
      first_sale_at: t.first_at || null, last_sale_at: t.last_at || null, days_since_last_sale: daysSince(t.last_at),
      share_pct: Number(rk.total_revenue) > 0 ? Math.round(revenue / Number(rk.total_revenue) * 1000) / 10 : 0,
      rank: rk.sold ? rk.rank : null, n_products: rk.n_products || 0,
      stock, stock_value_buy: cost ? n2(stock * buyP) : null, stock_value_sell: n2(stock * sellP),
      low: stock <= Number(p.min_stock), min_stock: n3(p.min_stock),
      margin_unit: cost ? n2(sellP - buyP) : null, margin_pct: cost && sellP > 0 ? Math.round((sellP - buyP) / sellP * 1000) / 10 : null,
      margin_total: cost ? n2(revenue - costTotal) : null,
      margin_total_pct: cost && revenue > 0 ? Math.round((revenue - costTotal) / revenue * 1000) / 10 : null,
      losses_qty: n3(losses),
      open_orders: open[0] ? open[0].n : 0, open_qty: n3(open[0] && open[0].qty),
      last_buy: lb ? { at: lb.ordered_at, received_at: lb.received_at, unit_cost: cost ? n2(lb.unit_cost) : null, qty: n3(lb.qty_ordered), supplier: lb.supplier } : null
    },
    monthly: PS.trimLead(P, series, ['qty', 'revenue', 'in_qty', 'out_qty']),
    weekday: wd,
    top_customers: customers.map(x => ({ id: x.id || null, name: x.name, qty: n3(x.qty), amount: n2(x.amount) })),
    top_employees: employees.map(x => ({ id: x.id || null, name: x.name, qty: n3(x.qty), amount: n2(x.amount) })),
    movements_by_kind: kinds.map(x => ({ kind: x.kind, n: x.n, qty: n3(x.qty) })),
    suppliers: supplied.map(x => ({ id: x.id || null, supplier: x.supplier, qty: n3(x.qty), amount: cost ? n2(x.amount) : null })),
    price_points: prices.reverse().filter(x => cost || x.price_type !== 'buy').map(x => ({ type: x.price_type, price: n2(x.price), at: x.effective_from }))
  };
}

r.get('/products/:id/profile', viewGate, wrap(async (req, res) => res.json(await productStats(req, idOf(req), PS.periodOf(req)))));

// ---------- Gestion des prix ----------
async function pricesData(req, id) {
  const p = await loadProduct(req.sid, id);
  const rows = await q(
    `SELECT h.id, h.price_type, h.price, h.old_price, h.effective_from, h.effective_to, h.note, u.login
       FROM price_history h LEFT JOIN users u ON u.id = h.created_by
      WHERE h.station_id = $1 AND h.product_id = $2 ORDER BY h.effective_from DESC, h.id DESC LIMIT 300`, [req.sid, id]);
  const sell = Number(p.sell_price), buy = Number(p.buy_price), cost = canCost(req);
  return ({
    product: { id: p.id, name: p.name, unit: p.unit, sell_price: n2(sell), buy_price: cost ? n2(buy) : null, tax_rate: Number(p.tax_rate || 0) },
    margin_unit: cost ? n2(sell - buy) : null, margin_pct: cost && sell > 0 ? Math.round((sell - buy) / sell * 1000) / 10 : null,
    can_edit: req.user.perms.has('price.edit'), can_cost: cost,
    history: rows.filter(h => cost || h.price_type !== 'buy').map(h => ({
      id: h.id, type: h.price_type, price: n2(h.price), old_price: h.old_price == null ? null : n2(h.old_price),
      delta: h.old_price == null ? null : n2(Number(h.price) - Number(h.old_price)),
      delta_pct: h.old_price != null && Number(h.old_price) > 0 ? Math.round((Number(h.price) - Number(h.old_price)) / Number(h.old_price) * 1000) / 10 : null,
      from: h.effective_from, to: h.effective_to, note: h.note || null, by: h.login || null
    }))
  });
}
r.get('/products/:id/prices', viewGate, wrap(async (req, res) => res.json(await pricesData(req, idOf(req)))));

r.post('/products/:id/prices', need('price.edit'), body(z.object({
  sell_price: z.number().min(0).max(1e12).optional(),
  buy_price: z.number().min(0).max(1e12).optional(),
  note: z.string().trim().max(300).optional().nullable()
}).strict()), wrap(async (req, res) => {
  const id = idOf(req), b = req.body;
  if (b.sell_price === undefined && b.buy_price === undefined) throw new HttpError(400, 'Indiquez un nouveau prix de vente ou d\'achat');
  if (b.buy_price !== undefined && !canCost(req)) throw new HttpError(403, "Permission refusée : cost.view (le prix d'achat est réservé aux rôles de gestion)");
  const out = await tx(async c => {
    const { rows: [old] } = await c.query('SELECT * FROM products WHERE id = $1 AND station_id = $2 AND deleted_at IS NULL FOR UPDATE', [id, req.sid]);
    if (!old) throw new HttpError(404, 'Produit introuvable');
    const changes = {}, before = {};
    for (const [field, type] of [['sell_price', 'sell'], ['buy_price', 'buy']]) {
      if (b[field] === undefined || Number(b[field]) === Number(old[field])) continue;
      changes[field] = b[field]; before[field] = Number(old[field]);
      await recordPriceChange(c, { station: req.sid, product: id, type, oldPrice: old[field], newPrice: b[field], by: req.user.id, note: b.note || null });
    }
    if (!Object.keys(changes).length) throw new HttpError(400, 'Aucun changement : les prix saisis sont identiques aux prix actuels');
    const keys = Object.keys(changes);
    const { rows: [n] } = await c.query(
      `UPDATE products SET ${keys.map((k, i) => `${k} = $${i + 3}`).join(', ')} WHERE id = $1 AND station_id = $2 RETURNING *`,
      [id, req.sid, ...keys.map(k => changes[k])]);
    await audit(c, req, 'produits', 'Modification de ' + old.name, 'products', id, before, changes);
    return n;
  });
  res.status(201).json({ ok: true, sell_price: n2(out.sell_price), ...(canCost(req) ? { buy_price: n2(out.buy_price) } : {}) });
}));

// ---------- Historique dotation : achats du produit + commandes en cours ----------
async function purchasesData(req, id) {
  await loadProduct(req.sid, id);
  const rows = await q(
    `SELECT d.id AS detail_id, pu.id AS purchase_id, pu.order_no, pu.invoice_no, pu.status, pu.ordered_at, pu.received_at, pu.due_date,
            s.id AS supplier_id, s.name AS supplier, d.qty_ordered, d.qty_received, d.unit_cost
       FROM purchase_details d JOIN purchases pu ON pu.id = d.purchase_id JOIN suppliers s ON s.id = pu.supplier_id
      WHERE pu.station_id = $1 AND d.product_id = $2 ORDER BY pu.ordered_at DESC, d.id DESC LIMIT 500`, [req.sid, id]);
  const lines = rows.map(x => {
    const ordered = n3(x.qty_ordered), received = n3(x.qty_received);
    const open = ['commande', 'partiel'].includes(x.status) && received < ordered;
    return {
      detail_id: x.detail_id, purchase_id: x.purchase_id, order_no: x.order_no, invoice_no: x.invoice_no, status: x.status,
      ordered_at: x.ordered_at, received_at: x.received_at, supplier_id: x.supplier_id, supplier: x.supplier,
      qty_ordered: ordered, qty_received: received, qty_remaining: open ? n3(ordered - received) : 0,
      unit_cost: n2(x.unit_cost), line_total: n2(ordered * Number(x.unit_cost)), received_total: n2(received * Number(x.unit_cost)),
      open, waiting_days: open ? daysSince(x.ordered_at) : null
    };
  });
  const valid = lines.filter(l => l.status !== 'annule');
  const recv = valid.filter(l => l.qty_received > 0);
  const seeCost = canPurchaseCost(req);
  const costs = recv.map(l => l.unit_cost);
  const recvQty = recv.reduce((a, l) => a + l.qty_received, 0);
  return ({
    lines: seeCost ? lines : lines.map(l => ({ ...l, unit_cost: null, line_total: null, received_total: null })),
    summary: {
      orders: new Set(valid.map(l => l.purchase_id)).size,
      qty_ordered: n3(valid.reduce((a, l) => a + l.qty_ordered, 0)), qty_received: n3(recvQty),
      spent: seeCost ? n2(recv.reduce((a, l) => a + l.received_total, 0)) : null,
      avg_cost: seeCost && recvQty > 0 ? n2(recv.reduce((a, l) => a + l.received_total, 0) / recvQty) : null,
      min_cost: seeCost && costs.length ? Math.min(...costs) : null, max_cost: seeCost && costs.length ? Math.max(...costs) : null,
      open_count: lines.filter(l => l.open).length, open_qty: n3(lines.filter(l => l.open).reduce((a, l) => a + l.qty_remaining, 0)),
      truncated: rows.length >= 500
    }
  });
}
r.get('/products/:id/purchases', purchaseGate, wrap(async (req, res) => res.json(await purchasesData(req, idOf(req)))));

// ---------- Historique des stocks ----------
async function stockData(req, id, qs) {
  const p = await loadProduct(req.sid, id);
  const where = [], params = [req.sid, id];
  const KINDS = ['entree', 'sortie', 'vente', 'achat', 'retour', 'perte', 'casse', 'correction', 'transfert'];
  const kind = typeof qs.kind === 'string' && KINDS.includes(qs.kind) ? qs.kind : null;
  const isDay = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  if (kind) { params.push(kind); where.push(`x.kind = $${params.length}`); }
  if (isDay(qs.from)) { params.push(qs.from); where.push(`x.created_at >= $${params.length}::date`); }
  if (isDay(qs.to)) { params.push(qs.to); where.push(`x.created_at < $${params.length}::date + 1`); }
  const W = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const limit = Math.min(Math.max(parseInt(qs.limit, 10) || 200, 1), 500);
  const [rows, kinds] = await Promise.all([
    q(`WITH m AS (
         SELECT m.id, m.kind, m.quantity, m.comment, m.created_at, m.ref_table, m.ref_id, u.login,
                COALESCE((SELECT quantity FROM stock WHERE product_id = $2), 0)
                  - COALESCE(SUM(m.quantity) OVER (ORDER BY m.id DESC ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS balance_after
           FROM stock_movements m LEFT JOIN users u ON u.id = m.created_by
          WHERE m.station_id = $1 AND m.product_id = $2)
       SELECT x.*, pu.order_no, sa.invoice_no
         FROM m x LEFT JOIN purchases pu ON x.ref_table = 'purchases' AND pu.id = x.ref_id
                  LEFT JOIN sales sa ON x.ref_table = 'sales' AND sa.id = x.ref_id
         ${W} ORDER BY x.id DESC LIMIT ${limit}`, params),
    q(`SELECT x.kind, COUNT(*)::int AS n, COALESCE(SUM(x.quantity), 0) AS qty,
              COALESCE(SUM(x.quantity) FILTER (WHERE x.quantity > 0), 0) AS qty_in,
              COALESCE(-SUM(x.quantity) FILTER (WHERE x.quantity < 0), 0) AS qty_out
         FROM stock_movements x WHERE x.station_id = $1 AND x.product_id = $2${where.length ? ' AND ' + where.join(' AND ') : ''}
        GROUP BY x.kind ORDER BY 2 DESC`, params)
  ]);
  return ({
    product: { id: p.id, name: p.name, unit: p.unit, stock: n3(p.stock), min_stock: n3(p.min_stock) },
    rows: rows.map(m => ({
      id: m.id, kind: m.kind, quantity: n3(m.quantity), balance_after: n3(m.balance_after), comment: m.comment || null, at: m.created_at,
      by: m.login || null, ref: m.order_no ? { type: 'purchase', label: m.order_no, id: m.ref_id } : m.invoice_no ? { type: 'sale', label: m.invoice_no, id: m.ref_id } : m.ref_table ? { type: m.ref_table, label: '#' + m.ref_id, id: m.ref_id } : null
    })),
    by_kind: kinds.map(k => ({ kind: k.kind, n: k.n, qty: n3(k.qty), qty_in: n3(k.qty_in), qty_out: n3(k.qty_out) })),
    truncated: rows.length >= limit
  });
}
r.get('/products/:id/stock-history', stockGate, wrap(async (req, res) => res.json(await stockData(req, idOf(req), req.query))));


// ---------- Export PDF : retrace tout sur le produit (ou un seul onglet : ?section=overview|behavior|prices|supply|stock) ----------
const SECTIONS = ['overview', 'behavior', 'prices', 'supply', 'stock'];
const KIND_FR = { entree: 'Entrée', sortie: 'Sortie', vente: 'Vente', achat: 'Achat (réception)', retour: 'Retour', perte: 'Perte', casse: 'Casse', correction: 'Correction', transfert: 'Transfert' };
const PSTAT_FR = { commande: 'Commandé', partiel: 'Partiellement reçu', recu: 'Reçu', facture: 'Facturé', paye: 'Payé', archive: 'Archivé', annule: 'Annulé' };
const DOW_FR = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

function productPdf(b, d) {
  const { s, prices, supply, stock, sections, cost } = d;
  const m = v => (v == null ? '-' : `${docs.cellText(n2(v))} ${b.currency}`);
  const qn = v => (v == null ? '-' : docs.cellText(n3(v)));
  const day = v => (v ? docs.fmtDate(v).slice(0, 10) : '-');
  const bucket = v => { const t = String(v || '').split('-'); return t.length === 3 ? `${t[2]}/${t[1]}/${t[0]}` : t.length === 2 ? `${t[1]}/${t[0]}` : String(v || ''); };
  const kpis = items => ({ type: 'kpis', items: items.filter(i => i.value != null) });
  const table = (title, head, rows, extra) => (rows.length ? [{ type: 'table', title, head, rows, ...extra }] : [{ type: 'text', title, text: 'Aucune donnée.' }]);
  const p = s.product, k = s.kpis;
  const out = [];

  // Identité : toujours en tête, quel que soit l'onglet exporté
  out.push({ type: 'kv', title: 'Identité du produit', rows: [
    ['Produit', p.name], ['Catégorie', p.category_label || p.category], ['Statut', p.active ? 'Actif' : 'Inactif (archivé)'],
    ['Code-barres', p.barcode || '-'], ['Référence (SKU)', p.sku || '-'], ['Unité', p.unit],
    ['Prix de vente', m(p.sell_price)],
    ...(cost ? [["Prix d'achat", m(p.buy_price)], ['Marge unitaire', k.margin_unit != null ? m(k.margin_unit) + (k.margin_pct != null ? ` (${k.margin_pct} %)` : '') : '-']] : []),
    ['Taxe', p.tax_rate ? p.tax_rate + ' %' : 'Aucune'], ['Stock actuel', `${qn(p.stock)} ${p.unit}`], ['Seuil minimum', `${qn(p.min_stock)} ${p.unit}`],
    ['Fournisseur principal', p.supplier_name || '-']
  ] });
  out.push({ type: 'text', text: `Période d'analyse : ${s.meta.label}. Le stock, les prix et les commandes en cours reflètent la situation à la date d'édition.` });

  if (sections.includes('overview')) {
    out.push(kpis([
      { label: 'Quantité vendue', value: `${qn(k.qty_sold)} ${p.unit}`, note: `${k.tickets} vente(s)` },
      { label: "Chiffre d'affaires", value: m(k.revenue), note: k.rank ? `Rang ${k.rank} sur ${k.n_products} - ${k.share_pct} % du CA` : null },
      { label: 'Marge brute', value: k.margin_total != null ? m(k.margin_total) : null, note: k.margin_total_pct != null ? k.margin_total_pct + ' %' : null },
      { label: 'Moyenne par jour', value: `${qn(k.avg_daily)} ${p.unit}` },
      { label: 'Couverture du stock', value: k.days_cover != null ? k.days_cover + ' j' : null },
      { label: 'Valeur du stock (vente)', value: m(k.stock_value_sell) },
      { label: "Valeur du stock (achat)", value: k.stock_value_buy != null ? m(k.stock_value_buy) : null },
      { label: 'Pertes / casse', value: `${qn(k.losses_qty)} ${p.unit}` },
      { label: 'Commandes en cours', value: String(k.open_orders), note: k.open_qty ? `${qn(k.open_qty)} ${p.unit} à recevoir` : null },
      { label: 'Dernière vente', value: k.last_sale_at ? day(k.last_sale_at) : null, note: k.days_since_last_sale != null ? `il y a ${k.days_since_last_sale} j` : null }
    ]));
    out.push(...table('Ventes et flux de stock par période', ['Période', 'Qté vendue', "Chiffre d'affaires", ...(cost ? ['Coût'] : []), 'Entrées', 'Sorties'],
      s.monthly.filter(x => x.qty || x.revenue || x.in_qty || x.out_qty).map(x => [bucket(x.month), qn(x.qty), m(x.revenue), ...(cost ? [m(x.cost)] : []), qn(x.in_qty), qn(x.out_qty)])));
    out.push(...table('Mouvements de stock par type (période)', ['Type', 'Nombre', 'Quantité'], s.movements_by_kind.map(x => [KIND_FR[x.kind] || x.kind, x.n, qn(x.qty)])));
  }
  if (sections.includes('behavior')) {
    out.push(...table('Ventes par jour de la semaine', ['Jour', 'Quantité', "Chiffre d'affaires"], s.weekday.filter(x => x.qty || x.revenue).map(x => [DOW_FR[x.dow - 1], qn(x.qty), m(x.revenue)])));
    out.push(...table('Meilleurs clients', ['Client', 'Quantité', 'Montant'], s.top_customers.map(x => [x.name, qn(x.qty), m(x.amount)])));
    out.push(...table('Ventes par employé', ['Employé', 'Quantité', 'Montant'], s.top_employees.map(x => [x.name, qn(x.qty), m(x.amount)])));
    out.push(...table('Approvisionnement par fournisseur', ['Fournisseur', 'Quantité reçue', ...(cost ? ['Montant'] : [])], s.suppliers.map(x => [x.supplier, qn(x.qty), ...(cost ? [m(x.amount)] : [])])));
  }
  if (sections.includes('prices') && prices) {
    out.push(...table('Historique complet des prix', ['Type', 'Ancien prix', 'Nouveau prix', 'Variation', 'Du', 'Au', 'Auteur', 'Note'],
      prices.history.filter(h => cost || h.type === 'sell').map(h => [h.type === 'sell' ? 'Vente' : 'Achat', h.old_price == null ? '-' : m(h.old_price), m(h.price),
        h.delta == null ? '-' : (h.delta > 0 ? '+' : '') + docs.cellText(h.delta) + (h.delta_pct != null ? ` (${h.delta_pct} %)` : ''), day(h.from), h.to ? day(h.to) : 'En cours', h.by || '-', h.note || ''])));
  }
  if (sections.includes('supply') && supply) {
    const sm = supply.summary;
    out.push(kpis([
      { label: 'Commandes', value: String(sm.orders) }, { label: 'Quantité commandée', value: qn(sm.qty_ordered) }, { label: 'Quantité reçue', value: qn(sm.qty_received) },
      { label: 'Montant reçu', value: m(sm.spent) }, { label: "Coût moyen d'achat", value: sm.avg_cost != null ? m(sm.avg_cost) : null },
      { label: 'Coût min / max', value: sm.min_cost != null ? `${m(sm.min_cost)} / ${m(sm.max_cost)}` : null },
      { label: 'Commandes en cours', value: String(sm.open_count), note: sm.open_qty ? `${qn(sm.open_qty)} à recevoir` : null }
    ]));
    out.push(...table('Historique de dotation (achats du produit)', ['Commande', 'Fournisseur', 'Date', 'Statut', 'Commandé', 'Reçu', 'Reste', 'Coût unitaire', 'Total reçu'],
      supply.lines.map(l => [l.order_no || '#' + l.purchase_id, l.supplier, day(l.ordered_at), PSTAT_FR[l.status] || l.status, qn(l.qty_ordered), qn(l.qty_received), qn(l.qty_remaining), m(l.unit_cost), m(l.received_total)])));
  }
  if (sections.includes('stock') && stock) {
    out.push(...table('Synthèse des mouvements de stock', ['Type', 'Nombre', 'Entrées', 'Sorties', 'Solde'], stock.by_kind.map(x => [KIND_FR[x.kind] || x.kind, x.n, qn(x.qty_in), qn(x.qty_out), qn(x.qty)])));
    out.push(...table('Historique des stocks' + (stock.truncated ? ' (500 derniers mouvements)' : ''), ['Date', 'Type', 'Quantité', 'Stock après', 'Référence', 'Auteur', 'Commentaire'],
      stock.rows.map(r => [docs.fmtDate(r.at), KIND_FR[r.kind] || r.kind, (r.quantity > 0 ? '+' : '') + qn(r.quantity), qn(r.balance_after), r.ref ? r.ref.label : '-', r.by || '-', r.comment || ''])));
  }
  const titles = { overview: "VUE D'ENSEMBLE", behavior: 'COMPORTEMENT', prices: 'GESTION DES PRIX', supply: 'HISTORIQUE DOTATION', stock: 'HISTORIQUE DES STOCKS' };
  const single = sections.length === 1;
  return {
    b, title: single ? 'FICHE PRODUIT - ' + titles[sections[0]] : 'FICHE PRODUIT COMPLETE', subtitle: `${p.name} - ${s.meta.label}`,
    ref: `PRD-${p.id}-${s.meta.period}`, landscape: single ? ['prices', 'supply', 'stock'].includes(sections[0]) : true, sections: out
  };
}

r.get('/products/:id/profile.pdf', viewGate, wrap(async (req, res) => {
  const id = idOf(req), P = PS.periodOf(req), has = (...ps) => ps.some(x => req.user.perms.has(x));
  const allowed = {
    overview: true, behavior: true, prices: true,
    supply: has('purchase.manage', 'supplier.view', 'stock.adjust', 'report.view', 'price.edit'),
    stock: has('stock.adjust', 'report.view', 'price.edit')
  };
  const want = typeof req.query.section === 'string' && req.query.section !== 'all' ? req.query.section : null;
  if (want && !SECTIONS.includes(want)) throw new HttpError(400, 'Section inconnue');
  if (want && !allowed[want]) throw new HttpError(403, "Vous n'avez pas accès à cette section de la fiche produit.");
  const sections = want ? [want] : SECTIONS.filter(x => allowed[x]);
  const [s, prices, supply, stock, b] = await Promise.all([
    productStats(req, id, P),
    sections.includes('prices') ? pricesData(req, id) : null,
    sections.includes('supply') ? purchasesData(req, id) : null,
    sections.includes('stock') ? stockData(req, id, { kind: req.query.kind, from: req.query.from, to: req.query.to, limit: 500 }) : null,
    docs.branding(req.sid)
  ]);
  const pdf = await docs.buildPdf(productPdf(b, { s, prices, supply, stock, sections, cost: canCost(req) }));
  await audit(pool, req, 'produits', `Export PDF de la fiche produit ${s.product.name}${want ? ' (' + want + ')' : ''}`, 'products', id).catch(() => {});
  docs.send(res, 'pdf', pdf, `fiche-produit-${id}${want ? '-' + want : ''}-${P.key}`);
}));

module.exports = r;
module.exports.recordPriceChange = recordPriceChange;
module.exports._internals = { productStats, recordPriceChange, canCost, productPdf, pricesData, purchasesData, stockData };
