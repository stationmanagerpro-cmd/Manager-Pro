// Fournisseurs et achats : commande → réception (entrée en stock) → facture → paiement → archivage.
const express = require('express');
const { z } = require('zod');
const { pool, tx, fl, f3, HttpError, wrap, body, need, audit, stockMove, settle } = require('./core');
const { sendSystemAlert } = require('./messaging');
const { applySupplierCredits } = require('./credits');
const { recordPriceChange } = require('./product_profile');
const r = express.Router();
const VIEW = ['purchase.manage', 'purchase.pay', 'finance.view', 'stock.adjust'];
const maskDebt = (req, rows) => req.user.perms.has('debt.view') ? rows : rows.map(x => ({ ...x, balance_due: null }));   // dettes visibles uniquement avec debt.view

function canonicalPayload(operation, payload) {
  if (operation === 'receive') return payload.lines.map(x => ({ detail_id: Number(x.detail_id), quantity: Number(x.quantity) }))
    .sort((a, b) => a.detail_id - b.detail_id);
  return { amount: Number(payload.amount), method: String(payload.method) };
}
async function replayPurchaseOperation(c, req, operation, clientRef, purchaseId, payload) {
  if (!clientRef) return null;
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
    [`station:${req.sid}`, `purchase:${operation}:${clientRef}`]);
  const { rows: [prior] } = await c.query(
    'SELECT purchase_id, request_payload, result FROM purchase_operation_requests WHERE station_id = $1 AND operation = $2 AND client_ref = $3',
    [req.sid, operation, clientRef]);
  if (!prior) return null;
  const expected = canonicalPayload(operation, payload);
  const recorded = typeof prior.request_payload === 'string' ? JSON.parse(prior.request_payload) : prior.request_payload;
  if (Number(prior.purchase_id) !== Number(purchaseId) || JSON.stringify(recorded) !== JSON.stringify(expected))
    throw new HttpError(409, 'Cette référence est déjà utilisée pour une autre opération fournisseur. Générez une nouvelle référence.');
  const result = typeof prior.result === 'string' ? JSON.parse(prior.result) : prior.result;
  return { ...result, _idempotent_replay: true };
}
async function recordPurchaseOperation(c, req, operation, clientRef, purchaseId, payload, result) {
  if (!clientRef) return;
  await c.query(
    'INSERT INTO purchase_operation_requests(station_id, purchase_id, operation, client_ref, request_payload, result, created_by) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)',
    [req.sid, purchaseId, operation, clientRef, JSON.stringify(canonicalPayload(operation, payload)), JSON.stringify(result), req.user.id]);
}

r.get('/suppliers', need('supplier.view', 'purchase.manage', 'purchase.pay'), wrap(async (req, res) => {
  const inactive = req.query.inactive === '1' || req.query.inactive === 'true';
  const { rows } = await pool.query('SELECT * FROM suppliers WHERE station_id = $1 AND deleted_at IS NULL AND COALESCE(active, TRUE) = $2 ORDER BY name', [req.sid, !inactive]);
  res.json(maskDebt(req, rows));
}));
r.post('/suppliers', need('supplier.edit'), body(z.object({
  name: z.string().min(1), company: z.string().optional().nullable(), phone: z.string().optional().nullable(),
  email: z.string().optional().nullable(), address: z.string().optional().nullable(),
  contact: z.string().optional().nullable(), tax_id: z.string().optional().nullable(),
  notes: z.string().optional().nullable(), payment_terms_days: z.number().int().min(0).optional(),
  bank_info: z.string().optional().nullable()
})), wrap(async (req, res) => {
  const b = req.body;
  const { rows: [s] } = await pool.query(
    `INSERT INTO suppliers(station_id, name, company, phone, email, address, contact, tax_id, notes, payment_terms_days, bank_info)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [req.sid, b.name, b.company || null, b.phone || null, b.email || null, b.address || null, b.contact || null, b.tax_id || null,
     b.notes || null, b.payment_terms_days ?? 30, b.bank_info || null]);
  await audit(pool, req, 'fournisseurs', 'Création de ' + b.name, 'suppliers', s.id, null, b);
  res.status(201).json(s);
}));

r.get('/purchases', need(...VIEW), wrap(async (req, res) => {
  const status = req.query.status || null;
  const supplierId = req.query.supplier_id ? Number(req.query.supplier_id) : null;
  const from = req.query.from || null;
  const to = req.query.to || null;
  const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 500);
  const { rows } = await pool.query(
    `SELECT pu.*, s.name AS supplier FROM purchases pu
       JOIN suppliers s ON s.id = pu.supplier_id
      WHERE pu.station_id = $1 AND pu.flow <> 'bc'
        AND ($2::text IS NULL OR pu.status = $2)
        AND ($3::bigint IS NULL OR pu.supplier_id = $3)
        AND ($4::date IS NULL OR pu.ordered_at::date >= $4)
        AND ($5::date IS NULL OR pu.ordered_at::date <= $5)
      ORDER BY pu.id DESC
      LIMIT $6`,
    [req.sid, status, Number.isFinite(supplierId) ? supplierId : null, from, to, limit]
  );
  res.json(rows);
}));
r.get('/purchases/:id', need(...VIEW), wrap(async (req, res) => {
  const { rows: [p] } = await pool.query('SELECT pu.*, s.name AS supplier FROM purchases pu JOIN suppliers s ON s.id = pu.supplier_id WHERE pu.id = $1 AND pu.station_id = $2', [req.params.id, req.sid]);
  if (!p) throw new HttpError(404, 'Achat introuvable');
  const [d, pay] = await Promise.all([
    pool.query('SELECT d.*, pr.name AS product FROM purchase_details d JOIN products pr ON pr.id = d.product_id WHERE d.purchase_id = $1 ORDER BY d.id', [p.id]),
    pool.query('SELECT * FROM supplier_payments WHERE purchase_id = $1 ORDER BY id', [p.id]),
  ]);
  res.json({ ...p, details: d.rows, payments: pay.rows });
}));

// Verrouille l'achat et vérifie son statut
async function lock(c, req, allowed) {
  const { rows: [p] } = await c.query('SELECT * FROM purchases WHERE id = $1 AND station_id = $2 FOR UPDATE', [req.params.id, req.sid]);
  if (!p) throw new HttpError(404, 'Achat introuvable');
  if (p.flow === 'bc') throw new HttpError(409, 'Ce document est un bon de commande : utilisez le module Exploitation › Bon de commande.');
  if (!allowed.includes(p.status)) throw new HttpError(409, `Action impossible : l'achat est au statut « ${p.status} »`);
  return p;
}

// 1. COMMANDE
r.post('/purchases', need('purchase.manage'), body(z.object({
  supplier_id: z.number().int(),
  items: z.array(z.object({
    product_id: z.number().int(),
    quantity: z.number().positive(),
    unit_cost: z.number().positive(),
    tax_rate: z.number().min(0).max(100).optional().default(0)
  })).min(1),
})), wrap(async (req, res) => {
  const b = req.body;
  const p = await tx(async c => {
    const { rows: [sup] } = await c.query('SELECT name, COALESCE(active, TRUE) AS active FROM suppliers WHERE id = $1 AND station_id = $2 AND deleted_at IS NULL', [b.supplier_id, req.sid]);
    if (!sup) throw new HttpError(400, 'Fournisseur inconnu');
    // Un fournisseur archivé ne reçoit plus de nouveau bon de commande (les commandes déjà passées restent réceptionnables et payables).
    if (sup.active === false) throw new HttpError(409, 'Fournisseur inactif (archivé) : réactivez ' + sup.name + ' avant de passer une commande.');
    const total = fl(b.items.reduce((a, i) => a + i.quantity * i.unit_cost, 0));
    const { rows: [p] } = await c.query("INSERT INTO purchases(station_id, supplier_id, status, total, created_by) VALUES ($1,$2,'commande',$3,$4) RETURNING *", [req.sid, b.supplier_id, total, req.user.id]);
    for (const i of b.items) {
      const tax = i.tax_rate != null ? Number(i.tax_rate) : 0;
      const { rowCount: ok } = await c.query(
        'INSERT INTO purchase_details(purchase_id, product_id, qty_ordered, unit_cost, tax_rate) SELECT $1, id, $3, $4, $6 FROM products WHERE id = $2 AND station_id = $5 AND active',
        [p.id, i.product_id, i.quantity, i.unit_cost, req.sid, tax]
      );
      if (!ok) {
        const { rows: [ex] } = await c.query('SELECT name FROM products WHERE id = $1 AND station_id = $2', [i.product_id, req.sid]);
        if (ex) throw new HttpError(409, 'Produit inactif (archivé) : réactivez ' + ex.name + ' avant de le commander.');
        throw new HttpError(400, 'Produit inconnu : ' + i.product_id);
      }
    }
    const { rows: [u] } = await c.query('UPDATE purchases SET order_no = $2 WHERE id = $1 AND station_id = $3 RETURNING *', [p.id, `BC-${req.sid}-${String(p.id).padStart(5, '0')}`, req.sid]);
    await audit(c, req, 'achats', 'Commande ' + u.order_no, 'purchases', p.id, null, { total });
    return u;
  });
  res.status(201).json(p);
}));

// 2. RÉCEPTION (totale ou partielle) → entrée en stock
r.post('/purchases/:id/receive', need('purchase.manage'), body(z.object({
  lines: z.array(z.object({ detail_id: z.number().int(), quantity: z.number().positive() })).min(1),
  client_ref: z.string().trim().min(1).max(128).optional().nullable(),
})), wrap(async (req, res) => {
  const clientRef = req.body.client_ref || null;
  const out = await tx(async c => {
    const replay = await replayPurchaseOperation(c, req, 'receive', clientRef, req.params.id, req.body);
    if (replay) return replay;
    const p = await lock(c, req, ['commande', 'partiel']);
    for (const l of req.body.lines) {
      const { rows: [d] } = await c.query('SELECT * FROM purchase_details WHERE id = $1 AND purchase_id = $2 FOR UPDATE', [l.detail_id, p.id]);
      if (!d) throw new HttpError(400, 'Ligne inconnue : ' + l.detail_id);
      if (f3(d.qty_received + l.quantity) > d.qty_ordered) throw new HttpError(409, 'Quantité reçue supérieure à la quantité commandée');
      await c.query('UPDATE purchase_details SET qty_received = qty_received + $2 WHERE id = $1', [d.id, l.quantity]);
      await stockMove(c, { station: req.sid, product: d.product_id, kind: 'achat', qty: l.quantity, ref: ['purchases', p.id], comment: 'Réception ' + p.order_no, by: req.user.id });
      const { rows: [prev] } = await c.query('SELECT buy_price FROM products WHERE id = $1', [d.product_id]);
      await c.query('UPDATE products SET buy_price = $2 WHERE id = $1 AND station_id = $3', [d.product_id, d.unit_cost, req.sid]); // dernier coût d'achat
      if (prev) await recordPriceChange(c, { station: req.sid, product: d.product_id, type: 'buy', oldPrice: prev.buy_price, newPrice: d.unit_cost, by: req.user.id, note: 'Réception ' + p.order_no });
    }
    const { rows: [left] } = await c.query('SELECT COUNT(*)::int AS n FROM purchase_details WHERE purchase_id = $1 AND qty_received < qty_ordered', [p.id]);
    const status = left.n ? 'partiel' : 'recu';
    const { rows: [u] } = await c.query('UPDATE purchases SET status = $2, received_at = now() WHERE id = $1 AND station_id = $3 RETURNING *', [p.id, status, req.sid]);
    await audit(c, req, 'achats', `Réception ${p.order_no} (${status})`, 'purchases', p.id, { statut: p.status }, { statut: status });
    await recordPurchaseOperation(c, req, 'receive', clientRef, p.id, req.body, u);
    return u;
  });
  const replayed = Boolean(out?._idempotent_replay);
  if (replayed) delete out._idempotent_replay;
  res.json(out);
}));

// 3. FACTURE fournisseur : crée la dette
r.post('/purchases/:id/invoice', need('purchase.manage'), body(z.object({
  invoice_no: z.string().min(1), invoice_date: z.string().optional(), due_date: z.string().optional(), invoice_total: z.number().positive().optional(),
})), wrap(async (req, res) => {
  const b = req.body;
  const out = await tx(async c => {
    const p = await lock(c, req, ['recu']);
    const { rows: [v] } = await c.query('SELECT COALESCE(SUM(qty_received * unit_cost), 0) AS v FROM purchase_details WHERE purchase_id = $1', [p.id]);
    const total = fl(b.invoice_total ?? v.v);
    const { rows: [u] } = await c.query(
      `UPDATE purchases SET status = 'facture', invoice_no = $2, invoice_date = COALESCE($3::date, CURRENT_DATE), due_date = $4::date, invoice_total = $5 WHERE id = $1 AND station_id = $6 RETURNING *`,
      [p.id, b.invoice_no, b.invoice_date || null, b.due_date || null, total, req.sid]);
    await c.query('UPDATE suppliers SET balance_due = balance_due + $2 WHERE id = $1 AND station_id = $3', [p.supplier_id, total, req.sid]);
    if (Math.abs(total - fl(v.v)) > 0.01)
      await c.query("INSERT INTO notifications(station_id, level, kind, message, ref_table, ref_id) VALUES ($1,'warning','facture_ecart',$2,'purchases',$3)",
        [req.sid, `Facture ${b.invoice_no} : ${total} facturé pour ${fl(v.v)} reçu (${p.order_no})`, p.id]);
    await applySupplierCredits(c, { station: req.sid, supplierId: p.supplier_id, by: req.user.id });   // avoirs ouverts imputés d'office
    await audit(c, req, 'achats', `Facture ${b.invoice_no} sur ${p.order_no}`, 'purchases', p.id, { statut: p.status }, { statut: 'facture', montant: total });
    const { rows: [u2] } = await c.query('SELECT * FROM purchases WHERE id = $1', [p.id]);   // état après imputation éventuelle d'avoirs
    return { ...u2, _alert_expected_total: fl(v.v), _alert_order_no: p.order_no };
  });
  const expectedTotal = Number(out._alert_expected_total || 0);
  const variance = Math.abs(Number(out.invoice_total || 0) - expectedTotal);
  const orderNo = out._alert_order_no;
  delete out._alert_expected_total; delete out._alert_order_no;
  if (variance > 0.01) {
    try {
      const { rows: [actor] } = await pool.query('SELECT client_id FROM users WHERE id = $1 AND deleted_at IS NULL', [req.user.id]);
      if (actor?.client_id) await sendSystemAlert({
        clientId: actor.client_id, actorUserId: req.user.id, employeeUserId: null,
        kind: 'purchase_variance',
        body: `Incohérence de facture fournisseur ${out.invoice_no} (commande ${orderNo}) : facture ${out.invoice_total} FCFA, montant attendu ${expectedTotal} FCFA, écart ${variance} FCFA.`,
        refTable: 'purchases', refId: out.id, stationId: req.sid,
        metricValue: variance, metricUnit: 'XOF', metricPercent: variance / Math.max(1, Math.abs(expectedTotal)) * 100
      });
    } catch (alertError) { console.warn('[alertes] Facture enregistrée mais écart non notifié:', alertError.message); }
  }
  res.json(out);
}));

// 4. PAIEMENT (partiel possible) : réduit la dette ; les espèces sortent de la caisse
r.post('/purchases/:id/pay', need('purchase.pay'), body(z.object({
  amount: z.number().positive(), method: z.string().min(1),
  client_ref: z.string().trim().min(1).max(128).optional().nullable(),
})), wrap(async (req, res) => {
  const b = req.body;
  const clientRef = b.client_ref || null;
  const out = await tx(async c => {
    const replay = await replayPurchaseOperation(c, req, 'pay', clientRef, req.params.id, b);
    if (replay) return replay;
    const p = await lock(c, req, ['facture']);
    const remaining = fl(p.invoice_total - p.paid);
    if (b.amount > remaining) throw new HttpError(400, `Montant supérieur au reste à payer (${remaining})`);
    await c.query('INSERT INTO supplier_payments(supplier_id, purchase_id, amount, method, created_by) VALUES ($1,$2,$3,$4,$5)', [p.supplier_id, p.id, b.amount, b.method, req.user.id]);
    await c.query('UPDATE suppliers SET balance_due = balance_due - $2 WHERE id = $1 AND station_id = $3', [p.supplier_id, b.amount, req.sid]);
    const paid = fl(p.paid + b.amount), status = paid >= p.invoice_total ? 'paye' : 'facture';
    const { rows: [u] } = await c.query('UPDATE purchases SET paid = $2, status = $3 WHERE id = $1 AND station_id = $4 RETURNING *', [p.id, paid, status, req.sid]);
    const { rows: [sh] } = await c.query("SELECT id FROM shifts WHERE station_id = $1 AND status = 'ouvert'", [req.sid]);
    await settle(c, { station: req.sid, method: b.method, amount: -b.amount, label: 'Paiement fournisseur ' + p.order_no, ref: ['purchases', p.id], shift: sh?.id, by: req.user.id, event_type: 'PAIEMENT_FOURNISSEUR', supplier_id: p.supplier_id });
    await audit(c, req, 'achats', `Paiement de ${b.amount} sur ${p.order_no}`, 'purchases', p.id, { paye: p.paid }, { paye: paid, statut: status });
    await recordPurchaseOperation(c, req, 'pay', clientRef, p.id, b, u);
    return u;
  });
  const replayed = Boolean(out?._idempotent_replay);
  if (replayed) delete out._idempotent_replay;
  res.json(out);
}));

// 5. ARCHIVAGE d'un achat soldé
r.post('/purchases/:id/archive', need('purchase.manage'), wrap(async (req, res) => {
  const out = await tx(async c => {
    const p = await lock(c, req, ['paye']);
    const { rows: [u] } = await c.query("UPDATE purchases SET status = 'archive', archived_at = now() WHERE id = $1 AND station_id = $2 RETURNING *", [p.id, req.sid]);
    await audit(c, req, 'achats', 'Archivage de ' + p.order_no, 'purchases', p.id, { statut: 'paye' }, { statut: 'archive' });
    return u;
  });
  res.json(out);
}));

// Annulation : seulement avant toute réception
r.post('/purchases/:id/cancel', need('purchase.manage'), body(z.object({ reason: z.string().min(3) })), wrap(async (req, res) => {
  const out = await tx(async c => {
    const p = await lock(c, req, ['commande']);
    const { rows: [rc] } = await c.query('SELECT COALESCE(SUM(qty_received), 0) AS q FROM purchase_details WHERE purchase_id = $1', [p.id]);
    if (rc.q > 0) throw new HttpError(409, 'Des articles sont déjà reçus : annulation impossible');
    const { rows: [u] } = await c.query("UPDATE purchases SET status = 'annule', cancel_reason = $2 WHERE id = $1 AND station_id = $3 RETURNING *", [p.id, req.body.reason, req.sid]);
    await audit(c, req, 'achats', 'Annulation de ' + p.order_no, 'purchases', p.id, { statut: 'commande' }, { statut: 'annule', motif: req.body.reason });
    return u;
  });
  res.json(out);
}));

module.exports = r;
