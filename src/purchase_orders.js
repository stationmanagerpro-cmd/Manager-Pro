// Exploitation › Bon de commande.
// Même circuit que la facturation (brouillon → validé → suivi), avec réceptions partielles/successives
// et règlement OBLIGATOIREMENT choisi à chaque réception (différé = dette fournisseur, immédiat = sortie de trésorerie).
// Les bons sont stockés dans `purchases` (flow = 'bc') : stock, fournisseurs, trésorerie, dettes et comptabilité
// lisent donc les mêmes tables sans double comptage (réception = qty_received ; dette = invoice_total ; règlement = supplier_payments).
const express = require('express');
const { z } = require('zod');
const { pool, tx, fl, f3, HttpError, wrap, body, need, audit, stockMove, settle } = require('./core');
const { swallow } = require('./safe');
const { recordPriceChange } = require('./product_profile');
const r = express.Router();
const VIEW = ['purchase.manage', 'purchase.pay', 'finance.view', 'stock.adjust'];
const STATUS_LABEL = { brouillon: 'Brouillon', valide: 'Validé', partiel: 'Partiellement réceptionné', recu: 'Réceptionné', annule: 'Annulé' };
const PAY_LABEL = { aucun: '—', non_regle: 'Non réglé', partiel: 'Partiellement réglé', a_jour: 'Réglé à date', solde: 'Soldé' };

// Statut de réception (colonne purchases.status) → statut métier ; statut de règlement dérivé des montants.
const recvStatus = s => s === 'commande' ? 'valide' : s;
function payStatus(p) {
  if (p.status === 'brouillon' || p.status === 'annule') return 'aucun';
  const value = Number(p.invoice_total || 0), paid = Number(p.paid || 0);
  if (value <= 0) return 'aucun';
  if (paid <= 0) return 'non_regle';
  if (fl(value - paid) > 0) return 'partiel';
  return p.status === 'recu' ? 'solde' : 'a_jour';
}
function decorate(p) {
  const received_value = fl(Number(p.invoice_total || 0));
  const paid = fl(Number(p.paid || 0));
  return {
    ...p,
    total: Number(p.total), paid, received_value,
    remaining_to_pay: fl(received_value - paid),
    reception_status: recvStatus(p.status), reception_label: STATUS_LABEL[recvStatus(p.status)] || p.status,
    payment_status: payStatus(p), payment_label: PAY_LABEL[payStatus(p)]
  };
}

const ITEMS = z.array(z.object({
  product_id: z.number().int(),
  quantity: z.number().positive(),
  unit_cost: z.number().positive(),
  tax_rate: z.number().min(0).max(100).optional().default(0)
})).min(1).max(100);

async function lockBc(c, req, allowed) {
  const { rows: [p] } = await c.query("SELECT * FROM purchases WHERE id = $1 AND station_id = $2 AND flow = 'bc' FOR UPDATE", [req.params.id, req.sid]);
  if (!p) throw new HttpError(404, 'Bon de commande introuvable');
  if (!allowed.includes(p.status)) {
    throw new HttpError(409, `Action impossible : le bon est « ${STATUS_LABEL[recvStatus(p.status)] || p.status} »`);
  }
  return p;
}
async function insertItems(c, req, purchaseId, items) {
  for (const i of items) {
    const { rowCount: ok } = await c.query(
      'INSERT INTO purchase_details(purchase_id, product_id, qty_ordered, unit_cost, tax_rate) SELECT $1, id, $3, $4, $6 FROM products WHERE id = $2 AND station_id = $5 AND active',
      [purchaseId, i.product_id, i.quantity, i.unit_cost, req.sid, i.tax_rate || 0]);
    if (!ok) {
      const { rows: [ex] } = await c.query('SELECT name FROM products WHERE id = $1 AND station_id = $2', [i.product_id, req.sid]);
      if (ex) throw new HttpError(409, 'Produit inactif (archivé) : réactivez ' + ex.name + ' avant de le commander.');
      throw new HttpError(400, 'Produit inconnu : ' + i.product_id);
    }
  }
}
const sumItems = items => fl(items.reduce((a, i) => a + i.quantity * i.unit_cost, 0));

async function loadDetail(q, sid, id) {
  const { rows: [p] } = await q.query(
    `SELECT pu.*, s.name AS supplier, s.phone AS supplier_phone, cu.login AS created_by_login, vu.login AS validated_by_login
       FROM purchases pu JOIN suppliers s ON s.id = pu.supplier_id
       LEFT JOIN users cu ON cu.id = pu.created_by LEFT JOIN users vu ON vu.id = pu.validated_by
      WHERE pu.id = $1 AND pu.station_id = $2 AND pu.flow = 'bc'`, [id, sid]);
  if (!p) throw new HttpError(404, 'Bon de commande introuvable');
  const [d, rc, rl, pay, att] = await Promise.all([
    q.query(`SELECT d.id, d.product_id, pr.name AS product, pr.unit, d.qty_ordered, d.qty_received, d.unit_cost, d.tax_rate,
                    d.qty_ordered - d.qty_received AS qty_remaining
               FROM purchase_details d JOIN products pr ON pr.id = d.product_id WHERE d.purchase_id = $1 ORDER BY d.id`, [p.id]),
    q.query(`SELECT rc.*, u.login AS user_login FROM purchase_receipts rc LEFT JOIN users u ON u.id = rc.received_by
              WHERE rc.purchase_id = $1 ORDER BY rc.id`, [p.id]),
    q.query(`SELECT l.*, pr.name AS product FROM purchase_receipt_lines l JOIN products pr ON pr.id = l.product_id
              WHERE l.receipt_id IN (SELECT id FROM purchase_receipts WHERE purchase_id = $1) ORDER BY l.id`, [p.id]),
    q.query(`SELECT sp.*, u.login AS user_login FROM supplier_payments sp LEFT JOIN users u ON u.id = sp.created_by
              WHERE sp.purchase_id = $1 ORDER BY sp.id`, [p.id]),
    q.query(`SELECT a.id, a.filename, a.mime, a.size, a.receipt_id, a.note, a.created_at, u.login AS user_login FROM purchase_attachments a
               LEFT JOIN users u ON u.id = a.created_by WHERE a.purchase_id = $1 ORDER BY a.id`, [p.id]).catch(swallow('purchase_orders:attachments', { rows: [] }))
  ]);
  const lines = d.rows.map(x => ({
    ...x, qty_ordered: Number(x.qty_ordered), qty_received: Number(x.qty_received), qty_remaining: Number(x.qty_remaining),
    unit_cost: Number(x.unit_cost), amount_ordered: fl(x.qty_ordered * x.unit_cost),
    amount_received: fl(x.qty_received * x.unit_cost), amount_remaining: fl(x.qty_remaining * x.unit_cost)
  }));
  const receipts = rc.rows.map(x => ({
    ...x, value_received: Number(x.value_received), amount_paid: Number(x.amount_paid),
    lines: rl.rows.filter(l => Number(l.receipt_id) === Number(x.id)).map(l => ({ ...l, quantity: Number(l.quantity), unit_cost: Number(l.unit_cost) }))
  }));
  const po = decorate(p);
  return {
    ...po, lines, receipts, attachments: att.rows, payments: pay.rows.map(x => ({ ...x, amount: Number(x.amount) })),
    totals: {
      qty_ordered: f3(lines.reduce((a, x) => a + x.qty_ordered, 0)),
      qty_received: f3(lines.reduce((a, x) => a + x.qty_received, 0)),
      qty_remaining: f3(lines.reduce((a, x) => a + x.qty_remaining, 0)),
      amount_committed: po.total, amount_received: po.received_value, amount_paid: po.paid,
      amount_remaining_to_pay: po.remaining_to_pay,
      amount_remaining_to_receive: fl(lines.reduce((a, x) => a + x.amount_remaining, 0))
    }
  };
}

// ---------- Consultation ----------
r.get('/purchase-orders', need(...VIEW), wrap(async (req, res) => {
  const q = String(req.query.q || '').trim() || null;
  const status = req.query.status || null;     // brouillon | valide | partiel | recu | annule
  const pay = req.query.pay || null;           // non_regle | partiel | solde | a_jour
  const supplierId = req.query.supplier_id ? Number(req.query.supplier_id) : null;
  const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 500);
  const dbStatus = status === 'valide' ? 'commande' : status;
  const { rows } = await pool.query(
    `SELECT pu.*, s.name AS supplier,
            (SELECT COALESCE(SUM(qty_ordered),0) FROM purchase_details WHERE purchase_id = pu.id) AS qty_ordered,
            (SELECT COALESCE(SUM(qty_received),0) FROM purchase_details WHERE purchase_id = pu.id) AS qty_received
       FROM purchases pu JOIN suppliers s ON s.id = pu.supplier_id
      WHERE pu.station_id = $1 AND pu.flow = 'bc'
        AND ($2::text IS NULL OR pu.status = $2)
        AND ($3::bigint IS NULL OR pu.supplier_id = $3)
        AND ($4::date IS NULL OR pu.ordered_at::date >= $4)
        AND ($5::date IS NULL OR pu.ordered_at::date <= $5)
        AND ($6::text IS NULL OR pu.order_no ILIKE '%' || $6 || '%' OR s.name ILIKE '%' || $6 || '%')
      ORDER BY pu.id DESC LIMIT $7`,
    [req.sid, dbStatus, Number.isFinite(supplierId) ? supplierId : null, req.query.from || null, req.query.to || null, q, limit]);
  let out = rows.map(x => ({ ...decorate(x), qty_ordered: Number(x.qty_ordered), qty_received: Number(x.qty_received) }));
  if (pay) out = out.filter(x => x.payment_status === pay);
  res.json(out);
}));
r.get('/purchase-orders/:id', need(...VIEW), wrap(async (req, res) => {
  res.json(await loadDetail(pool, req.sid, req.params.id));
}));

// ---------- Création / modification / validation / annulation ----------
r.post('/purchase-orders', need('purchase.manage'), body(z.object({
  supplier_id: z.number().int(), items: ITEMS,
  notes: z.string().max(2000).optional().nullable(), expected_date: z.string().optional().nullable(),
  validate: z.boolean().optional()
})), wrap(async (req, res) => {
  const b = req.body;
  const out = await tx(async c => {
    const { rows: [sup] } = await c.query('SELECT name, COALESCE(active, TRUE) AS active FROM suppliers WHERE id = $1 AND station_id = $2 AND deleted_at IS NULL', [b.supplier_id, req.sid]);
    if (!sup) throw new HttpError(400, 'Fournisseur inconnu');
    if (sup.active === false) throw new HttpError(409, 'Fournisseur inactif (archivé) : réactivez ' + sup.name + ' avant de passer une commande.');
    const total = sumItems(b.items);
    const status = b.validate ? 'commande' : 'brouillon';
    const { rows: [p] } = await c.query(
      `INSERT INTO purchases(station_id, supplier_id, status, total, created_by, flow, notes, expected_date, validated_at, validated_by)
       VALUES ($1,$2,$3,$4,$5,'bc',$6,$7::date, $8, $9) RETURNING id`,
      [req.sid, b.supplier_id, status, total, req.user.id, b.notes || null, b.expected_date || null, b.validate ? new Date() : null, b.validate ? req.user.id : null]);
    await insertItems(c, req, p.id, b.items);
    const orderNo = `BC-${req.sid}-${String(p.id).padStart(5, '0')}`;
    await c.query('UPDATE purchases SET order_no = $2 WHERE id = $1', [p.id, orderNo]);
    await audit(c, req, 'achats', `Bon de commande ${orderNo} (${status === 'commande' ? 'validé' : 'brouillon'})`, 'purchases', p.id, null, { total, fournisseur: sup.name });
    return loadDetail(c, req.sid, p.id);
  });
  res.status(201).json(out);
}));

r.put('/purchase-orders/:id', need('purchase.manage'), body(z.object({
  supplier_id: z.number().int().optional(), items: ITEMS,
  notes: z.string().max(2000).optional().nullable(), expected_date: z.string().optional().nullable()
})), wrap(async (req, res) => {
  const b = req.body;
  const out = await tx(async c => {
    const p = await lockBc(c, req, ['brouillon', 'commande']);
    const { rows: [rc] } = await c.query('SELECT COUNT(*)::int AS n FROM purchase_receipts WHERE purchase_id = $1', [p.id]);
    if (rc.n > 0) throw new HttpError(409, 'Des réceptions existent déjà : le bon ne peut plus être modifié.');
    const supplierId = b.supplier_id || p.supplier_id;
    const { rows: [sup] } = await c.query('SELECT COALESCE(active, TRUE) AS active, name FROM suppliers WHERE id = $1 AND station_id = $2 AND deleted_at IS NULL', [supplierId, req.sid]);
    if (!sup) throw new HttpError(400, 'Fournisseur inconnu');
    if (sup.active === false && Number(supplierId) !== Number(p.supplier_id)) throw new HttpError(409, 'Fournisseur inactif (archivé).');
    await c.query('DELETE FROM purchase_details WHERE purchase_id = $1', [p.id]);
    await insertItems(c, req, p.id, b.items);
    const total = sumItems(b.items);
    await c.query('UPDATE purchases SET supplier_id = $2, total = $3, notes = $4, expected_date = $5::date, updated_at = now() WHERE id = $1',
      [p.id, supplierId, total, b.notes ?? p.notes, b.expected_date || null]);
    await audit(c, req, 'achats', 'Modification du bon ' + p.order_no, 'purchases', p.id, { total: Number(p.total) }, { total });
    return loadDetail(c, req.sid, p.id);
  });
  res.json(out);
}));

r.post('/purchase-orders/:id/validate', need('purchase.manage'), wrap(async (req, res) => {
  const out = await tx(async c => {
    const p = await lockBc(c, req, ['brouillon']);
    await c.query("UPDATE purchases SET status = 'commande', validated_at = now(), validated_by = $2, updated_at = now() WHERE id = $1", [p.id, req.user.id]);
    await audit(c, req, 'achats', 'Validation du bon ' + p.order_no, 'purchases', p.id, { statut: 'brouillon' }, { statut: 'valide' });
    return loadDetail(c, req.sid, p.id);
  });
  res.json(out);
}));

r.post('/purchase-orders/:id/cancel', need('purchase.manage'), body(z.object({ reason: z.string().min(3) })), wrap(async (req, res) => {
  const out = await tx(async c => {
    const p = await lockBc(c, req, ['brouillon', 'commande']);
    const { rows: [rc] } = await c.query('SELECT COUNT(*)::int AS n FROM purchase_receipts WHERE purchase_id = $1', [p.id]);
    if (rc.n > 0) throw new HttpError(409, 'Des marchandises sont déjà reçues : annulation impossible.');
    await c.query("UPDATE purchases SET status = 'annule', cancel_reason = $2, updated_at = now() WHERE id = $1", [p.id, req.body.reason]);
    await audit(c, req, 'achats', 'Annulation du bon ' + p.order_no, 'purchases', p.id, { statut: recvStatus(p.status) }, { statut: 'annule', motif: req.body.reason });
    return loadDetail(c, req.sid, p.id);
  });
  res.json(out);
}));

// ---------- Réception (stock + situation financière dans la même transaction) ----------
r.post('/purchase-orders/:id/receive', need('purchase.manage'), body(z.object({
  lines: z.array(z.object({ detail_id: z.number().int(), quantity: z.number().min(0) })).min(1),
  payment_mode: z.enum(['differe', 'immediat'], { errorMap: () => ({ message: 'Choisissez le mode de règlement (différé ou immédiat) avant de valider la réception.' }) }),
  method: z.string().trim().min(1).optional().nullable(),
  amount: z.number().positive().optional().nullable(),
  note: z.string().max(1000).optional().nullable(),
  client_ref: z.string().trim().min(1).max(128).optional().nullable()
})), wrap(async (req, res) => {
  const b = req.body;
  if (b.payment_mode !== 'differe' && b.payment_mode !== 'immediat') throw new HttpError(400, 'Choisissez le mode de règlement (différé ou immédiat) avant de valider la réception.');
  const lines = b.lines.filter(l => l.quantity > 0);
  if (!lines.length) throw new HttpError(400, 'Saisissez au moins une quantité réellement reçue.');
  if (new Set(lines.map(l => Number(l.detail_id))).size !== lines.length) throw new HttpError(400, 'Ligne dupliquée dans la réception.');
  if (b.payment_mode === 'immediat') {
    if (!b.method) throw new HttpError(400, 'Règlement immédiat : sélectionnez le compte / mode de paiement utilisé.');
    if (!req.user.perms.has('purchase.pay')) throw new HttpError(403, 'Le règlement immédiat nécessite la permission de payer les fournisseurs.');
  }
  const out = await tx(async c => {
    if (b.client_ref) {
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [`station:${req.sid}`, `bcrecv:${b.client_ref}`]);
      const { rows: [prior] } = await c.query('SELECT purchase_id FROM purchase_receipts WHERE station_id = $1 AND client_ref = $2', [req.sid, b.client_ref]);
      if (prior) {
        if (Number(prior.purchase_id) !== Number(req.params.id)) throw new HttpError(409, 'Cette référence est déjà utilisée pour une autre opération.');
        return { ...(await loadDetail(c, req.sid, req.params.id)), _idempotent_replay: true };
      }
    }
    const p = await lockBc(c, req, ['commande', 'partiel']);
    let value = 0;
    const done = [];
    for (const l of lines) {
      const { rows: [d] } = await c.query('SELECT * FROM purchase_details WHERE id = $1 AND purchase_id = $2 FOR UPDATE', [l.detail_id, p.id]);
      if (!d) throw new HttpError(400, 'Ligne inconnue : ' + l.detail_id);
      const left = f3(Number(d.qty_ordered) - Number(d.qty_received));
      if (l.quantity > left) throw new HttpError(409, `Quantité reçue supérieure au reste à recevoir (${left}).`);
      value += fl(l.quantity * Number(d.unit_cost));
      done.push({ d, qty: l.quantity });
    }
    value = fl(value);
    let paidNow = 0;
    if (b.payment_mode === 'immediat') {
      paidNow = fl(b.amount ?? value);
      if (paidNow > value) throw new HttpError(400, `Le règlement immédiat (${paidNow}) dépasse la valeur reçue (${value}).`);
    }
    const { rows: [rc] } = await c.query(
      `INSERT INTO purchase_receipts(station_id, purchase_id, received_by, value_received, payment_mode, payment_method, amount_paid, note, client_ref)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [req.sid, p.id, req.user.id, value, b.payment_mode, b.payment_mode === 'immediat' ? b.method : null, paidNow, b.note || null, b.client_ref || null]);
    await c.query('UPDATE purchase_receipts SET receipt_no = $2 WHERE id = $1', [rc.id, `BR-${req.sid}-${String(rc.id).padStart(5, '0')}`]);
    for (const { d, qty } of done) {
      await c.query('UPDATE purchase_details SET qty_received = qty_received + $2 WHERE id = $1', [d.id, qty]);
      await c.query('INSERT INTO purchase_receipt_lines(receipt_id, detail_id, product_id, quantity, unit_cost) VALUES ($1,$2,$3,$4,$5)', [rc.id, d.id, d.product_id, qty, d.unit_cost]);
      await stockMove(c, { station: req.sid, product: d.product_id, kind: 'achat', qty, ref: ['purchases', p.id], comment: 'Réception ' + p.order_no, by: req.user.id });
      const { rows: [prev] } = await c.query('SELECT buy_price FROM products WHERE id = $1', [d.product_id]);
      await c.query('UPDATE products SET buy_price = $2 WHERE id = $1 AND station_id = $3', [d.product_id, d.unit_cost, req.sid]);
      if (prev) await recordPriceChange(c, { station: req.sid, product: d.product_id, type: 'buy', oldPrice: prev.buy_price, newPrice: d.unit_cost, by: req.user.id, note: 'Réception ' + p.order_no });
    }
    const { rows: [left] } = await c.query('SELECT COUNT(*)::int AS n FROM purchase_details WHERE purchase_id = $1 AND qty_received < qty_ordered', [p.id]);
    const status = left.n ? 'partiel' : 'recu';
    // La valeur reçue devient la dette (invoice_total cumule les réceptions : la compta ne la poste qu'une fois).
    await c.query(
      `UPDATE purchases SET status = $2, received_at = now(), invoice_total = COALESCE(invoice_total, 0) + $3,
              invoice_date = CURRENT_DATE, invoice_no = COALESCE(invoice_no, order_no),
              due_date = COALESCE(due_date, CURRENT_DATE + COALESCE((SELECT payment_terms_days FROM suppliers WHERE id = $5), 30)),
              updated_at = now()
        WHERE id = $1 AND station_id = $4`, [p.id, status, value, req.sid, p.supplier_id]);
    await c.query('UPDATE suppliers SET balance_due = balance_due + $2 WHERE id = $1 AND station_id = $3', [p.supplier_id, value, req.sid]);
    if (paidNow > 0) await payOut(c, req, p, paidNow, b.method, rc.id, null);
    await audit(c, req, 'achats', `Réception ${p.order_no} (${status}) — ${b.payment_mode === 'immediat' ? 'réglée' : 'à crédit'}`, 'purchases', p.id,
      { statut: recvStatus(p.status) }, { statut: recvStatus(status), valeur: value, regle: paidNow });
    return loadDetail(c, req.sid, p.id);
  });
  const replay = Boolean(out._idempotent_replay); delete out._idempotent_replay;
  res.status(replay ? 200 : 201).json(out);
}));

// Sortie de trésorerie + réduction de la dette (une seule écriture par règlement)
async function payOut(c, req, p, amount, method, receiptId, clientRef) {
  await c.query('INSERT INTO supplier_payments(supplier_id, purchase_id, receipt_id, amount, method, created_by, client_ref) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [p.supplier_id, p.id, receiptId, amount, method, req.user.id, clientRef]);
  await c.query('UPDATE suppliers SET balance_due = balance_due - $2 WHERE id = $1 AND station_id = $3', [p.supplier_id, amount, req.sid]);
  await c.query('UPDATE purchases SET paid = paid + $2 WHERE id = $1 AND station_id = $3', [p.id, amount, req.sid]);
  const { rows: [sh] } = await c.query("SELECT id FROM shifts WHERE station_id = $1 AND status = 'ouvert'", [req.sid]);
  await settle(c, { station: req.sid, method, amount: -amount, label: 'Paiement fournisseur ' + p.order_no, ref: ['purchases', p.id],
    shift: sh?.id, by: req.user.id, event_type: 'PAIEMENT_FOURNISSEUR', supplier_id: p.supplier_id });
}

// ---------- Règlement ultérieur d'une dette ----------
r.post('/purchase-orders/:id/pay', need('purchase.pay'), body(z.object({
  amount: z.number().positive(),
  method: z.string({ required_error: 'Sélectionnez un mode de paiement.' }).trim().min(1, 'Sélectionnez un mode de paiement.'),
  client_ref: z.string().trim().min(1).max(128).optional().nullable()
})), wrap(async (req, res) => {
  const b = req.body;
  if (!b.method || !String(b.method).trim()) throw new HttpError(400, 'Aucun règlement sans mode de paiement : sélectionnez un compte / mode de paiement.');
  const out = await tx(async c => {
    if (b.client_ref) {
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [`station:${req.sid}`, `bcpay:${b.client_ref}`]);
      const { rows: [prior] } = await c.query('SELECT purchase_id FROM supplier_payments WHERE client_ref = $1 AND supplier_id IN (SELECT id FROM suppliers WHERE station_id = $2)', [b.client_ref, req.sid]);
      if (prior) {
        if (Number(prior.purchase_id) !== Number(req.params.id)) throw new HttpError(409, 'Cette référence est déjà utilisée pour une autre opération.');
        return { ...(await loadDetail(c, req.sid, req.params.id)), _idempotent_replay: true };
      }
    }
    const p = await lockBc(c, req, ['commande', 'partiel', 'recu']);
    const remaining = fl(Number(p.invoice_total || 0) - Number(p.paid));
    if (remaining <= 0) throw new HttpError(409, 'Rien à régler : la valeur reçue est déjà entièrement payée.');
    if (b.amount > remaining) throw new HttpError(400, `Montant supérieur au reste dû sur les quantités reçues (${remaining}).`);
    await payOut(c, req, p, b.amount, b.method, null, b.client_ref || null);
    await audit(c, req, 'achats', `Règlement de ${b.amount} sur ${p.order_no}`, 'purchases', p.id, { paye: Number(p.paid) }, { paye: fl(Number(p.paid) + b.amount) });
    return loadDetail(c, req.sid, p.id);
  });
  const replay = Boolean(out._idempotent_replay); delete out._idempotent_replay;
  res.status(replay ? 200 : 201).json(out);
}));


// ---------- Pièces jointes : photo du bon de livraison / de la facture fournisseur ----------
const MAX_ATTACH = 1.5 * 1024 * 1024, MAX_PER_PO = 12;
r.post('/purchase-orders/:id/attachments', need('purchase.manage'), body(z.object({
  filename: z.string().trim().min(1).max(120),
  mime: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  data: z.string().min(8).max(2200000),
  receipt_id: z.number().int().optional().nullable(),
  note: z.string().max(300).optional().nullable()
})), wrap(async (req, res) => {
  const b = req.body;
  const bytes = Buffer.from(b.data.replace(/^data:[^,]+,/, ''), 'base64');
  if (!bytes.length) throw new HttpError(400, 'Fichier vide');
  if (bytes.length > MAX_ATTACH) throw new HttpError(413, 'Fichier trop volumineux (1,5 Mo maximum) : réduisez la photo.');
  const magic = bytes.subarray(0, 4).toString('hex');
  const okMagic = (b.mime === 'image/jpeg' && magic.startsWith('ffd8ff')) || (b.mime === 'image/png' && magic === '89504e47') ||
    (b.mime === 'image/webp' && bytes.subarray(0, 4).toString() === 'RIFF') || (b.mime === 'application/pdf' && bytes.subarray(0, 4).toString() === '%PDF');
  if (!okMagic) throw new HttpError(400, 'Le contenu du fichier ne correspond pas à son type.');
  const out = await tx(async c => {
    const { rows: [p] } = await c.query("SELECT id, status FROM purchases WHERE id = $1 AND station_id = $2 AND flow = 'bc' FOR UPDATE", [req.params.id, req.sid]);
    if (!p) throw new HttpError(404, 'Bon de commande introuvable');
    if (p.status === 'annule') throw new HttpError(409, 'Bon annulé : pièce jointe impossible.');
    const { rows: [n] } = await c.query('SELECT COUNT(*)::int AS n FROM purchase_attachments WHERE purchase_id = $1', [p.id]);
    if (n.n >= MAX_PER_PO) throw new HttpError(409, `Maximum ${MAX_PER_PO} pièces jointes par bon.`);
    if (b.receipt_id) {
      const { rows: [rc] } = await c.query('SELECT 1 FROM purchase_receipts WHERE id = $1 AND purchase_id = $2', [b.receipt_id, p.id]);
      if (!rc) throw new HttpError(400, 'Réception inconnue pour ce bon.');
    }
    const name = b.filename.replace(/[^\w.\- ]+/g, '_');
    await c.query('INSERT INTO purchase_attachments(station_id, purchase_id, receipt_id, filename, mime, size, data, note, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [req.sid, p.id, b.receipt_id || null, name, b.mime, bytes.length, bytes, b.note || null, req.user.id]);
    await audit(c, req, 'achats', 'Pièce jointe ajoutée au bon ' + p.id, 'purchases', p.id, null, { fichier: name, taille: bytes.length });
    return loadDetail(c, req.sid, p.id);
  });
  res.status(201).json(out);
}));
r.get('/purchase-orders/:id/attachments/:aid', need(...VIEW), wrap(async (req, res) => {
  const { rows: [a] } = await pool.query(
    "SELECT a.filename, a.mime, a.data FROM purchase_attachments a JOIN purchases p ON p.id = a.purchase_id WHERE a.id = $1 AND a.purchase_id = $2 AND p.station_id = $3 AND p.flow = 'bc'",
    [req.params.aid, req.params.id, req.sid]);
  if (!a) throw new HttpError(404, 'Pièce jointe introuvable');
  res.set('Content-Type', a.mime).set('Content-Disposition', `inline; filename="${a.filename.replace(/[^\w.-]/g, '_')}"`).set('X-Content-Type-Options', 'nosniff').send(a.data);
}));

r._internals = { decorate, payStatus };
module.exports = r;
