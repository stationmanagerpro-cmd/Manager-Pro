// Priorité 9 — Hub d'exports PDF / Excel (données stabilisées P3–P8)
const express = require('express');
const { swallow } = require('./safe');
const { pool, wrap, need, HttpError, fl, audit } = require('./core');
const docs = require('./docs');

const r = express.Router();
const { totalsRow } = require('./report_totals');
const csvCell = require('./csv_safe');
const ymd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);

const KINDS = {
  customers: { label: 'Clients', perms: ['export.customers'] },
  suppliers: { label: 'Fournisseurs', perms: ['export.suppliers'] },
  products: { label: 'Produits', perms: ['price.edit', 'stock.adjust', 'report.view'] },
  stock: { label: 'Stocks', perms: ['stock.adjust', 'report.view'] },
  sales: { label: 'Ventes', perms: ['sale.create', 'report.view', 'finance.view'] },
  sales_lines: { label: 'Ventes par produit', perms: ['sale.create', 'report.view', 'finance.view'] },
  expenses: { label: 'Dépenses', perms: ['expense.create', 'finance.view', 'report.view'] },
  cash: { label: 'Caisse', perms: ['cash.manage', 'finance.view'] },
  pumps: { label: 'Pompes et compteurs', perms: ['settings.edit', 'shift.open', 'report.view'] },
  shifts: { label: 'Quarts', perms: ['shift.open', 'shift.close', 'report.view'] },
  financial_events: { label: 'Journal financier', perms: ['finance.view', 'cash.manage', 'money.manage'] },
  payments: { label: 'Paiements (compta)', perms: ['finance.view', 'report.view', 'cash.manage'] },
  eod_lines: { label: 'Fin de journée (lignes)', perms: ['report.view', 'finance.view'] }
};

function needAny(perms) {
  return need(...perms);
}

const allowed = (req, meta) => meta.perms.some(p => req.user.perms.has(p)) || req.user.is_global;
// Liste des exports : uniquement ceux que l'utilisateur est autorisé à générer

const exportPreference = async (userId, kind) => {
  const { rows: [r] } = await pool.query(
    'SELECT columns FROM export_column_preferences WHERE user_id=$1 AND export_type=$2', [userId, kind]
  ).catch(swallow('exports:37', { rows: [] }));
  return Array.isArray(r?.columns) ? r.columns : null;
};

r.get('/exports/:kind/preferences', wrap(async (req, res) => {
  if (!KINDS[req.params.kind]) throw new HttpError(400, 'Type d’export inconnu');
  res.json({ kind: req.params.kind, columns: await exportPreference(req.user.id, req.params.kind) });
}));

r.put('/exports/:kind/preferences', wrap(async (req, res) => {
  const meta = KINDS[req.params.kind];
  if (!meta || !allowed(req, meta)) throw new HttpError(403, 'Permission refusée pour cet export');
  const cols = Array.isArray(req.body?.columns) ? req.body.columns.map(String) : [];
  if (!cols.length) throw new HttpError(400, 'Au moins une colonne doit être conservée');
  const { rows: [existing] } = await pool.query(
    `SELECT columns FROM export_column_preferences WHERE user_id=$1 AND export_type=$2`,
    [req.user.id, req.params.kind]
  ).catch(swallow('exports:54', { rows: [] }));
  // La liste réelle des colonnes est vérifiée au moment de l'export : jamais de colonne arbitraire SQL.
  await pool.query(
    `INSERT INTO export_column_preferences(user_id, export_type, columns)
     VALUES ($1,$2,$3::jsonb)
     ON CONFLICT(user_id, export_type) DO UPDATE SET columns=EXCLUDED.columns, updated_at=now()`,
    [req.user.id, req.params.kind, JSON.stringify(cols)]
  );
  await audit(pool, req, 'exports', `Préférences de colonnes ${req.params.kind} modifiées`, 'export_column_preferences', req.user.id,
    existing?.columns || null, cols);
  res.json({ kind: req.params.kind, columns: cols });
}));

r.get('/exports/kinds', wrap(async (req, res) => {
  res.json(Object.entries(KINDS).filter(([, v]) => allowed(req, v)).map(([key, v]) => ({ key, label: v.label })));
}));

// Retire des colonnes (et réindexe les colonnes de total) : sert à masquer dettes / créances sans permission
function dropCols(data, idx) {
  const keep = data.head.map((_, i) => i).filter(i => !idx.includes(i)), remap = Object.fromEntries(keep.map((o, n) => [o, n]));
  return { ...data, head: keep.map(i => data.head[i]), rows: data.rows.map(r => keep.map(i => r[i])), sumCols: (data.sumCols || []).filter(i => i in remap).map(i => remap[i]) };
}

async function loadDataset(kind, sid, from, to, req) {
  const flt = { q: String(req.query.q || '').trim().slice(0, 60), kind: String(req.query.kind || '').trim(), active: String(req.query.active || '') };
  switch (kind) {
    case 'customers': {
      const { rows } = await pool.query(
        `SELECT name, kind, phone, email, company, credit_limit, balance, loyalty_tier, credit_blocked
         FROM customers WHERE station_id=$1 AND deleted_at IS NULL
           AND ($2::text = '' OR name ILIKE '%' || $2 || '%' OR company ILIKE '%' || $2 || '%' OR phone ILIKE '%' || $2 || '%')
           AND ($3::text = '' OR kind = $3::text)
           AND ($4::text = '' OR active = ($4::text = 'true'))
         ORDER BY name`, [sid, flt.q, flt.kind, flt.active === 'true' || flt.active === 'false' ? flt.active : '']);
      const d = {
        head: ['Nom', 'Type', 'Tél', 'E-mail', 'Société', 'Limite', 'Solde', 'Fidélité', 'Bloqué'],
        rows: rows.map(x => [x.name, x.kind, x.phone, x.email, x.company, +x.credit_limit, +x.balance, x.loyalty_tier, x.credit_blocked ? 'Oui' : 'Non']),
        sumCols: [5, 6],
        filters: [flt.q && 'Recherche : ' + flt.q, flt.kind && 'Type : ' + flt.kind].filter(Boolean), count_label: 'client(s)'
      };
      return req.user.perms.has('receivable.view') || req.user.is_global ? d : dropCols(d, [6]);   // créances masquées sans receivable.view
    }
    case 'suppliers': {
      const { rows } = await pool.query(
        `SELECT name, company, phone, email, contact, balance_due, payment_terms_days, active
         FROM suppliers WHERE station_id=$1 AND deleted_at IS NULL
           AND ($2::text = '' OR name ILIKE '%' || $2 || '%' OR company ILIKE '%' || $2 || '%' OR phone ILIKE '%' || $2 || '%')
           AND ($3::text = '' OR active = ($3::text = 'true'))
         ORDER BY name`, [sid, flt.q, flt.active === 'true' || flt.active === 'false' ? flt.active : '']);
      const d = {
        head: ['Nom', 'Société', 'Tél', 'E-mail', 'Contact', 'Dette', 'Délai (j)', 'Actif'],
        rows: rows.map(x => [x.name, x.company, x.phone, x.email, x.contact, +x.balance_due, x.payment_terms_days, x.active ? 'Oui' : 'Non']),
        sumCols: [5],
        filters: [flt.q && 'Recherche : ' + flt.q, flt.active === 'true' && 'Actifs uniquement', flt.active === 'false' && 'Inactifs uniquement'].filter(Boolean), count_label: 'fournisseur(s)'
      };
      return req.user.perms.has('debt.view') || req.user.is_global ? d : dropCols(d, [5]);   // dettes masquées sans debt.view
    }
    case 'products': {
      const { rows } = await pool.query(
        `SELECT p.name, p.sku, p.barcode, cat.code AS category, cat.label AS category_label, p.unit, p.min_stock, p.buy_price, p.sell_price,
                COALESCE(st.quantity,0) AS qty
         FROM products p JOIN categories cat ON cat.id=p.category_id
         LEFT JOIN stock st ON st.product_id=p.id
         WHERE p.station_id=$1 AND p.deleted_at IS NULL
           AND ($2::text = '' OR p.active = ($2::text = 'true'))
         ORDER BY p.name`, [sid, flt.active === 'true' || flt.active === 'false' ? flt.active : '']);
      const q = flt.q.toLowerCase(), catF = String(req.query.category || '').trim(), stF = String(req.query.stock || '').trim();
      const state = x => (+x.qty <= 0 ? 'out' : (+x.min_stock > 0 && +x.qty <= +x.min_stock ? 'low' : 'ok'));   // mêmes règles que l'écran Produits
      const list = rows.filter(x =>
        (!catF || x.category === catF) && (!stF || state(x) === stF) &&
        (!q || [x.name, x.sku, x.barcode, x.category, x.category_label].join(' ').toLowerCase().includes(q)));
      const pct = x => (+x.sell_price > 0 ? Math.round((+x.sell_price - +x.buy_price) / +x.sell_price * 10000) / 100 : null);
      const dprod = {
        head: ['Produit', 'Référence', 'Code-barres', 'Catégorie', 'Unité', 'Coût', 'Prix de vente', 'Marge %', 'Stock', 'Seuil'],
        rows: list.map(x => [x.name, x.sku || '', x.barcode || '', x.category_label || x.category, x.unit, +x.buy_price, +x.sell_price, pct(x), +x.qty, +x.min_stock]),
        sumCols: [],
        filters: [flt.q && 'Recherche : ' + flt.q, catF && 'Catégorie : ' + catF,
          stF === 'low' && 'Stock faible', stF === 'out' && 'Rupture', stF === 'ok' && 'En stock',
          flt.active === 'false' && 'Produits inactifs'].filter(Boolean),
        count_label: 'produit(s)'
      };
      return req.user.perms.has('cost.view') ? dprod : dropCols(dprod, [5, 7]);   // RG-03 : coût et marge % masqués sans cost.view
    }
    case 'stock': {
      const { rows } = await pool.query(
        `SELECT p.name, cat.code AS category, p.unit, COALESCE(st.quantity,0) AS qty, p.min_stock, p.buy_price, p.sell_price,
                COALESCE(st.quantity,0)*p.buy_price AS val_buy, COALESCE(st.quantity,0)*p.sell_price AS val_sell
         FROM products p JOIN categories cat ON cat.id=p.category_id
         LEFT JOIN stock st ON st.product_id=p.id
         WHERE p.station_id=$1 AND p.deleted_at IS NULL ORDER BY p.name`, [sid]);
      const dstock = {
        // Produit affiché "Nom (Catégorie)" + colonne catégorie séparée pour filtres
        head: ['Produit', 'Catégorie', 'Unité', 'Qté', 'Min', 'Prix achat', 'Prix vente', 'Val. achat', 'Val. vente'],
        rows: rows.map(x => [
          x.category ? `${x.name} (${x.category})` : x.name,
          x.category, x.unit, +x.qty, +x.min_stock, +x.buy_price, +x.sell_price, +x.val_buy, +x.val_sell
        ]),
        sumCols: [3, 7, 8]
      };
      return req.user.perms.has('cost.view') ? dstock : dropCols(dstock, [5, 7]);   // RG-03 : prix et valeur d'achat masqués sans cost.view
    }
    case 'sales': {
      const { rows } = await pool.query(
        `SELECT s.id, s.invoice_no, s.sold_at, s.kind, s.total, s.status, COALESCE(c.name,'') AS customer
         FROM sales s LEFT JOIN customers c ON c.id=s.customer_id
         WHERE s.station_id=$1 AND s.sold_at >= $2::date AND s.sold_at < $3::date + 1
         ORDER BY s.id`, [sid, from, to]);
      return {
        head: ['ID', 'Facture', 'Date', 'Type', 'Client', 'Total', 'Statut'],
        rows: rows.map(x => [x.id, x.invoice_no, docs.fmtDate(x.sold_at), x.kind, x.customer, +x.total, x.status]),
        sumCols: [5]
      };
    }
    case 'sales_lines': {
      // Lignes de vente avec nom de produit (catégorie entre parenthèses) — exigence client
      const { rows } = await pool.query(
        `SELECT s.invoice_no, s.sold_at, s.kind, s.status,
                COALESCE(c.name,'') AS customer,
                p.name AS product_name, cat.code AS category,
                d.quantity, d.unit_price, d.amount
         FROM sale_details d
         JOIN sales s ON s.id = d.sale_id
         JOIN products p ON p.id = d.product_id
         LEFT JOIN categories cat ON cat.id = p.category_id
         LEFT JOIN customers c ON c.id = s.customer_id
         WHERE s.station_id = $1 AND s.sold_at >= $2::date AND s.sold_at < $3::date + 1
           AND s.status = 'valide'
         ORDER BY s.sold_at, s.id, d.id`, [sid, from, to]);
      return {
        head: ['Facture', 'Date', 'Type', 'Client', 'Produit', 'Qté', 'Prix unit.', 'Montant'],
        rows: rows.map(x => [
          x.invoice_no,
          docs.fmtDate(x.sold_at),
          x.kind,
          x.customer,
          x.category ? `${x.product_name} (${x.category})` : x.product_name,
          +x.quantity,
          +x.unit_price,
          +x.amount
        ]),
        sumCols: [5, 7]
      };
    }
    case 'expenses': {
      const { rows } = await pool.query(
        `SELECT spent_on, category, amount, method, beneficiary, comment
         FROM expenses WHERE station_id=$1 AND deleted_at IS NULL
           AND spent_on BETWEEN $2::date AND $3::date ORDER BY spent_on, id`, [sid, from, to]);
      return {
        head: ['Date', 'Catégorie', 'Montant', 'Mode', 'Bénéficiaire', 'Commentaire'],
        rows: rows.map(x => [docs.fmtDate(x.spent_on), x.category, +x.amount, x.method, x.beneficiary, x.comment]),
        sumCols: [2]
      };
    }
    case 'cash': {
      const { rows } = await pool.query(
        `SELECT m.created_at, r.name AS register, m.kind, m.label, m.amount
         FROM cash_movements m JOIN cash_registers r ON r.id=m.cash_register_id
         WHERE r.station_id=$1 AND m.created_at >= $2::date AND m.created_at < $3::date + 1
         ORDER BY m.id`, [sid, from, to]);
      return {
        head: ['Date', 'Caisse', 'Type', 'Libellé', 'Montant'],
        rows: rows.map(x => [docs.fmtDate(x.created_at), x.register, x.kind, x.label, +x.amount]),
        sumCols: [4]
      };
    }
    case 'pumps': {
      const { rows } = await pool.query(
        `SELECT pu.number, pu.name, pu.status, pc.counter_number, pr.name AS product, pc.current_index
         FROM pumps pu
         LEFT JOIN pump_counters pc ON pc.pump_id=pu.id
         LEFT JOIN products pr ON pr.id=pc.product_id
         WHERE pu.station_id=$1 AND pu.deleted_at IS NULL
         ORDER BY pu.number, pc.counter_number`, [sid]);
      return {
        head: ['N° pompe', 'Nom', 'Statut', 'Compteur', 'Produit', 'Index'],
        rows: rows.map(x => [x.number, x.name, x.status, x.counter_number, x.product, x.current_index != null ? +x.current_index : '']),
        sumCols: []
      };
    }
    case 'shifts': {
      const { rows } = await pool.query(
        `SELECT number, kind, status, opened_at, closed_at, opening_cash, theoretical_cash, counted_cash, cash_gap
         FROM shifts WHERE station_id=$1
           AND opened_at >= $2::date AND opened_at < $3::date + 1
         ORDER BY id DESC`, [sid, from, to]);
      return {
        head: ['N°', 'Type', 'Statut', 'Ouvert', 'Fermé', 'Ouverture', 'Théorique', 'Compté', 'Écart'],
        rows: rows.map(x => [x.number, x.kind, x.status, docs.fmtDate(x.opened_at), x.closed_at ? docs.fmtDate(x.closed_at) : '',
          +x.opening_cash || 0, +x.theoretical_cash || 0, +x.counted_cash || 0, +x.cash_gap || 0]),
        sumCols: [8]
      };
    }
    case 'financial_events': {
      const { rows } = await pool.query(
        `SELECT event_at, event_type, direction, amount, method, label
         FROM financial_events WHERE station_id=$1
           AND event_at >= $2::date AND event_at < $3::date + 1
         ORDER BY event_at DESC, id DESC`, [sid, from, to]).catch(swallow('exports:250', { rows: [] }));
      return {
        head: ['Date', 'Type', 'Sens', 'Montant', 'Mode', 'Libellé'],
        rows: rows.map(x => [docs.fmtDate(x.event_at), x.event_type, x.direction, +x.amount, x.method, x.label]),
        sumCols: [3]
      };
    }

    case 'payments': {
      const { rows } = await pool.query(
        `SELECT p.paid_at, p.method, p.amount,
                COALESCE(s.invoice_no,'') AS invoice_no, COALESCE(c.name,'') AS customer
         FROM payments p
         LEFT JOIN sales s ON s.id = p.sale_id
         LEFT JOIN customers c ON c.id = s.customer_id
         WHERE p.station_id=$1 AND p.paid_at >= $2::date AND p.paid_at < $3::date + 1
           AND (s.id IS NULL OR s.status = 'valide')
         ORDER BY p.paid_at, p.id`, [sid, from, to]);
      return {
        head: ['Date', 'Mode', 'Montant', 'Facture', 'Client'],
        rows: rows.map(x => [docs.fmtDate(x.paid_at), x.method, +x.amount, x.invoice_no, x.customer]),
        sumCols: [2]
      };
    }
    case 'eod_lines': {
      const { rows: sales } = await pool.query(
        `SELECT 'vente' AS type, s.sold_at AS at, s.kind, s.total AS amount, COALESCE(s.invoice_no,'') AS ref, s.status
         FROM sales s WHERE s.station_id=$1 AND s.sold_at::date = $2::date
         UNION ALL
         SELECT 'depense', e.spent_on::timestamp, e.category, e.amount, COALESCE(e.label,''), 'valide'
         FROM expenses e WHERE e.station_id=$1 AND e.deleted_at IS NULL AND e.spent_on = $2::date
         ORDER BY 2`, [sid, from]).catch(swallow('exports:281', { rows: [] }));
      return {
        head: ['Type', 'Date', 'Catégorie', 'Montant', 'Réf.', 'Statut'],
        rows: (sales || []).map(x => [x.type, docs.fmtDate(x.at), x.kind, +x.amount, x.ref, x.status]),
        sumCols: [3]
      };
    }
    default:
      throw new HttpError(400, 'Type d\'export inconnu');
  }
}

r.get('/exports/:kind', wrap(async (req, res) => {
  const kind = req.params.kind;
  const meta = KINDS[kind];
  if (!meta) throw new HttpError(400, 'Type inconnu. GET /exports/kinds pour la liste.');
  // permission
  if (!allowed(req, meta)) throw new HttpError(403, 'Permission refusée pour cet export');

  const fmt = (req.query.format || 'xlsx').toLowerCase();
  if (!['pdf', 'xlsx', 'json', 'csv'].includes(fmt)) throw new HttpError(400, 'format=pdf|xlsx|json|csv');

  const to = ymd(req.query.to) ? req.query.to : new Date().toISOString().slice(0, 10);
  const from = ymd(req.query.from) ? req.query.from : to.slice(0, 8) + '01';

  let data = await loadDataset(kind, req.sid, from, to, req);
  const pref = await exportPreference(req.user.id, kind);
  if (pref) {
    const wanted = new Set(pref);
    const keep = data.head.map((h, i) => wanted.has(h) ? i : -1).filter(i => i >= 0);
    if (!keep.length) throw new HttpError(400, 'La préférence ne laisse aucune colonne autorisée');
    const remap = Object.fromEntries(keep.map((o, n) => [o, n]));
    data = {
      ...data,
      head: keep.map(i => data.head[i]),
      rows: data.rows.map(row => keep.map(i => row[i])),
      sumCols: (data.sumCols || []).filter(i => i in remap).map(i => remap[i])
    };
  }
  await audit(pool, req, 'exports', `Export ${meta.label} (${fmt}) : ${data.rows.length} ligne(s)`, null);   // traçabilité des sorties de données
  const b = await docs.branding(req.sid);
  // Listes sans période (clients, fournisseurs) : total d'éléments et filtres appliqués ; sinon période + nombre de lignes
  const subtitle = data.count_label
    ? `Total : ${data.rows.length} ${data.count_label}` + (data.filters?.length ? ' · Filtres : ' + data.filters.join(', ') : '')
    : `${from} → ${to} · ${data.rows.length} ligne(s)`;
  const ref = `EXP-${kind}-${to.replace(/-/g, '')}`;

  if (fmt === 'json') return res.json({ kind, label: meta.label, from, to, ...data });

  if (fmt === 'csv') {
    const sep = ';';
    const lines = [data.head.map(csvCell).join(sep)];
    for (const row of data.rows) lines.push(row.map(csvCell).join(sep));
    const csvTotal = totalsRow(data.head, data.rows, data.sumCols);   // règle : total en bas, calculé sur les lignes exportées
    if (csvTotal && data.rows.length) lines.push(csvTotal.map(csvCell).join(sep));
    const buf = Buffer.from('\ufeff' + lines.join('\n'), 'utf8'); // BOM Excel FR
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${kind}-${to}.csv"`);
    return res.send(buf);
  }



  if (fmt === 'xlsx') {
    const buf = await docs.buildXlsx({
      b, title: meta.label, subtitle, ref,
      sheets: [{ name: meta.label.slice(0, 31), head: data.head, rows: data.rows, sumCols: data.sumCols }]
    });
    return docs.send(res, 'xlsx', buf, `${kind}-${to}`);
  }

  const buf = await docs.buildPdf({
    b, title: meta.label.toUpperCase(), subtitle, ref,
    sections: [{ type: 'table', title: meta.label, head: data.head, rows: data.rows, sumCols: data.sumCols }],
    landscape: data.head.length > 6,
    signatures: [{ label: 'Responsable' }]
  });
  docs.send(res, 'pdf', buf, `${kind}-${to}`);
}));

module.exports = r;
// Réutilisés par l'archivage mensuel (src/monthly_archive.js) : mêmes jeux de données et mêmes droits que le hub d'exports.
module.exports.loadDataset = loadDataset;
module.exports.KINDS = KINDS;
module.exports.allowed = allowed;
