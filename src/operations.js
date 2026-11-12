// Ventes, dépenses, caisse, stock, encaissement des créances clients.
const express = require('express');
const { swallow } = require('./safe');
const { z } = require('zod');
const { pool, tx, fl, HttpError, wrap, body, need, audit, cashMove, stockMove, defaultReg, payMethod, assertLinkedMethod, accountMove, settle, ledger, recordFinancialEvent, canCost, maskCost } = require('./core');
const { assertNotLocked } = require('./premium');
const r = express.Router();

/** Moyens de paiement utilisables à la vente : espèces, crédit, ou liés à un compte actif */
r.get('/payment-methods/linked', need('sale.create', 'purchase.pay', 'finance.view'), wrap(async (req, res) => {
  // ?all=1 : tous les moyens actifs avec l'indicateur « linked » (l'écran de vente affiche les moyens non rattachés en grisé
  // au lieu de les faire disparaître : Orange Money, Wave…). Sans ce paramètre : comportement historique (moyens utilisables seulement).
  if (req.query.all === '1') {
    const { rows } = await pool.query(
      `SELECT pm.code, pm.label, pm.kind, pm.account_id,
              (pm.kind IN ('especes', 'credit') OR (pm.account_id IS NOT NULL AND EXISTS (
                 SELECT 1 FROM money_accounts a WHERE a.id = pm.account_id AND a.station_id = $1 AND a.active = true))) AS linked
         FROM payment_methods pm WHERE pm.station_id = $1 AND pm.active
        ORDER BY CASE pm.kind WHEN 'especes' THEN 0 WHEN 'mobile_money' THEN 1 WHEN 'carte' THEN 2 WHEN 'banque' THEN 3 WHEN 'credit' THEN 4 ELSE 5 END, pm.label`, [req.sid]);
    return res.json(rows);
  }
  const { rows } = await pool.query(
    `SELECT pm.code, pm.label, pm.kind, pm.account_id
       FROM payment_methods pm
      WHERE pm.station_id = $1
        AND (
          pm.kind IN ('especes', 'credit')
          OR (pm.account_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM money_accounts a WHERE a.id = pm.account_id AND a.station_id = $1 AND a.active = true
          ))
        )
      ORDER BY CASE pm.kind WHEN 'especes' THEN 0 WHEN 'mobile_money' THEN 1 WHEN 'carte' THEN 2 WHEN 'banque' THEN 3 WHEN 'credit' THEN 4 ELSE 5 END, pm.label`,
    [req.sid]
  );
  res.json(rows);
}));


// Une clé idempotente ne doit pas permettre de faire passer une requête différente
// pour une opération déjà enregistrée. Les montants sont comparés à la précision métier.
const sameId = (a, b) => (a == null ? null : Number(a)) === (b == null ? null : Number(b));
const sameMoney = (a, b) => Math.abs(Number(a || 0) - Number(b || 0)) < 0.005;
function aggregateItems(items) {
  const m = new Map();
  for (const x of items) m.set(Number(x.product_id), (m.get(Number(x.product_id)) || 0) + Number(x.quantity));
  return [...m.entries()].sort((a, b) => a[0] - b[0]);
}
function sameItems(a, b) {
  const aa = aggregateItems(a), bb = aggregateItems(b);
  return aa.length === bb.length && aa.every((x, i) => x[0] === bb[i][0] && Math.abs(x[1] - bb[i][1]) < 0.0005);
}
function normalizePayments(items) {
  return items.map(x => ({ method: String(x.method), amount: Number(x.amount), reference: x.reference || null }))
    .sort((a, b) => `${a.method}|${a.reference || ''}|${a.amount}`.localeCompare(`${b.method}|${b.reference || ''}|${b.amount}`));
}
function samePayments(a, b) {
  const aa = normalizePayments(a), bb = normalizePayments(b);
  return aa.length === bb.length && aa.every((x, i) => x.method === bb[i].method && x.reference === bb[i].reference && sameMoney(x.amount, bb[i].amount));
}

/** Si le quart ouvert a une date antérieure, aligne sold_at / spent_on sur cette date
 *  pour que exports et rapports par période restent cohérents. Sinon null → défaut SQL (now). */
function businessStampFromShift(sh) {
  if (!sh) return { soldAt: null, spentOn: null, backdated: false };
  const opened = sh.opened_at ? new Date(sh.opened_at) : null;
  const today = new Date().toISOString().slice(0, 10);
  const shiftDay = opened
    ? opened.toISOString().slice(0, 10)
    : (sh.shift_date ? String(sh.shift_date).slice(0, 10) : today);
  const backdated = !!(shiftDay && shiftDay < today);
  return {
    soldAt: backdated && opened && !Number.isNaN(opened.getTime()) ? opened.toISOString() : null,
    spentOn: backdated ? shiftDay : null,
    backdated,
  };
}

const saleSchema = z.object({
  items: z.array(z.object({ product_id: z.number().int(), quantity: z.number().positive() })).min(1),
  payments: z.array(z.object({ method: z.string().min(1), amount: z.number().positive(), reference: z.string().optional() })).min(1),
  customer_id: z.number().int().optional(),
  loyalty: z.object({ phone: z.string().max(30).optional().nullable(), plate: z.string().max(20).optional().nullable(), name: z.string().trim().max(120).optional().nullable() }).optional(),
  employee_id: z.number().int().optional(),
  pump_id: z.number().int().optional(),
  // Clé stable fournie par le client pour rendre les reprises réseau idempotentes.
  client_ref: z.string().trim().min(1).max(128).optional().nullable(),
});

// VENTE de produits (le carburant se calcule par les compteurs à la clôture).
// Les prix viennent toujours de la base, jamais du client.
r.post('/sales', need('sale.create'), body(saleSchema), wrap(async (req, res) => {
  await assertNotLocked(req.sid);
  const b = req.body;
  const clientRef = b.client_ref || null;
  const out = await tx(async c => {
    // Sérialise les requêtes partageant la même clé, y compris lors de deux retries simultanés.
    if (clientRef) {
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [`station:${req.sid}`, `sale:${clientRef}`]);
      const { rows: [prior] } = await c.query('SELECT * FROM sales WHERE station_id = $1 AND client_ref = $2', [req.sid, clientRef]);
      if (prior) {
        const [{ rows: detailRows }, { rows: paymentRows }] = await Promise.all([
          c.query('SELECT product_id, quantity FROM sale_details WHERE sale_id = $1 ORDER BY product_id', [prior.id]),
          c.query('SELECT method, amount, reference FROM payments WHERE sale_id = $1 ORDER BY method', [prior.id]),
        ]);
        const sameRequest = (prior.kind || 'produits') === 'produits' && sameId(prior.customer_id, b.customer_id) &&
          sameId(prior.pump_id, b.pump_id) && sameItems(detailRows, b.items) && samePayments(paymentRows, b.payments);
        if (!sameRequest) throw new HttpError(409, 'Cette référence de requête est déjà utilisée pour une autre vente. Générez une nouvelle référence.');
        return { ...prior, _idempotent_replay: true };
      }
    }
    const { rows: [sh] } = await c.query("SELECT * FROM shifts WHERE station_id = $1 AND status = 'ouvert' FOR SHARE", [req.sid]);
    if (!sh) throw new HttpError(409, 'Aucun quart ouvert : impossible de vendre');
    const stamp = businessStampFromShift(sh);
    let emp = b.employee_id;
    if (!emp) { const { rows: [e] } = await c.query('SELECT id FROM employees WHERE user_id = $1 AND station_id = $2', [req.user.id, req.sid]); emp = e?.id; }
    const { rowCount } = emp ? await c.query('SELECT 1 FROM employees WHERE id = $1 AND station_id = $2', [emp, req.sid]) : { rowCount: 0 };
    if (!rowCount) throw new HttpError(400, 'Employé requis pour enregistrer la vente');

    const { rows: [sale] } = await c.query(
      `INSERT INTO sales(station_id, shift_id, employee_id, pump_id, customer_id, total, client_ref, sold_at)
       VALUES ($1,$2,$3,$4,$5,0,$6,COALESCE($7::timestamptz, now())) RETURNING id, sold_at`,
      [req.sid, sh.id, emp, b.pump_id || null, b.customer_id || null, clientRef, stamp.soldAt]);
    let total = 0;
    for (const it of b.items) {
      const { rows: [p] } = await c.query(
        `SELECT p.*, cat.code AS cat FROM products p JOIN categories cat ON cat.id = p.category_id WHERE p.id = $1 AND p.station_id = $2 AND p.active AND p.deleted_at IS NULL`, [it.product_id, req.sid]);
      if (!p) throw new HttpError(400, 'Produit inconnu ou inactif : ' + it.product_id);
      if (p.cat === 'CARBURANT') throw new HttpError(400, 'Le carburant se calcule par les compteurs à la clôture du quart');
      const { rows: [st] } = await c.query('SELECT quantity FROM stock WHERE product_id = $1 FOR UPDATE', [p.id]);
      if (!st || st.quantity < it.quantity) throw new HttpError(409, 'Stock insuffisant : ' + p.name);
      const amount = fl(it.quantity * p.sell_price); total = fl(total + amount);
      await c.query('INSERT INTO sale_details(sale_id, product_id, quantity, unit_price, unit_cost, tax_rate, amount) VALUES ($1,$2,$3,$4,$5,$6,$7)', [sale.id, p.id, it.quantity, p.sell_price, p.buy_price, p.tax_rate, amount]);
      await stockMove(c, { station: req.sid, product: p.id, kind: 'vente', qty: -it.quantity, shift: sh.id, ref: ['sales', sale.id], by: req.user.id });
    }
    const paid = fl(b.payments.reduce((a, x) => a + x.amount, 0));
    if (paid !== total) throw new HttpError(400, `Le total des paiements (${paid}) doit égaler le total de la vente (${total})`);
    const reg = await defaultReg(c, req.sid);
    for (const p of b.payments) {
      const pm = await payMethod(c, req.sid, p.method);
      if (pm.kind === 'credit') {
        // Dette client : réservée à ceux qui en ont la permission (administrateur local, gérant, ou employé autorisé)
        if (!req.user.perms.has('sale.credit')) throw new HttpError(403, "Vente à crédit non autorisée : la permission « Vendre à crédit » doit être accordée par le gérant ou l'administrateur local.");
        if (!b.customer_id) throw new HttpError(400, 'Client requis pour une vente à crédit');
        const { rows: [cu] } = await c.query('SELECT * FROM customers WHERE id = $1 AND station_id = $2 FOR UPDATE', [b.customer_id, req.sid]);
        if (!cu) throw new HttpError(400, 'Client inconnu');
        if (cu.active === false) throw new HttpError(409, 'Client inactif (archivé) : réactivez ' + cu.name + ' avant une vente à crédit.');
        if (cu.credit_blocked) throw new HttpError(409, 'Crédit bloqué pour ' + cu.name + ' — régularisez le compte ou débloquez le client.');
        if (cu.credit_limit > 0 && Number(cu.balance) + p.amount > Number(cu.credit_limit)) {
          throw new HttpError(409, 'Limite de crédit dépassée pour ' + cu.name + ' (solde ' + Number(cu.balance).toLocaleString('fr-FR') + ' + ' + p.amount.toLocaleString('fr-FR') + ' > plafond ' + Number(cu.credit_limit).toLocaleString('fr-FR') + ')');
        }
        await c.query('UPDATE customers SET balance = balance + $2 WHERE id = $1 AND station_id = $3', [cu.id, p.amount, req.sid]);
        await ledger(c, { customer: cu.id, station: req.sid, kind: 'credit', amount: p.amount, ref: ['sales', sale.id], by: req.user.id });
      } else if (pm.kind === 'especes') {
        await cashMove(c, { reg, shift: sh.id, kind: 'encaissement', amount: p.amount, label: 'Vente N° ' + sale.id, ref: ['sales', sale.id], by: req.user.id });
      } else {
        // P5 : refuser un moyen non lié à un compte actif (évite vente MM/banque sans money_movements)
        await assertLinkedMethod(c, req.sid, p.method);
        const accId = await accountMove(c, { station: req.sid, method: p.method, amount: p.amount, label: 'Vente N° ' + sale.id, ref: ['sales', sale.id], shift: sh.id, by: req.user.id });
        if (accId == null) throw new HttpError(409, 'Aucun compte rattaché au moyen de paiement « ' + p.method + ' ».');
      }
      await c.query(
        `INSERT INTO payments(station_id, sale_id, shift_id, method, amount, reference, created_by, paid_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8::timestamptz, now()))`,
        [req.sid, sale.id, sh.id, p.method, p.amount, p.reference || null, req.user.id, stamp.soldAt]);
      // P2 : journal métier pour les ventes (aligné sur dépenses / règlements)
      try {
        await recordFinancialEvent(c, {
          station: req.sid, event_type: 'VENTE',
          direction: 'in', amount: Math.abs(p.amount),
          label: 'Vente N° ' + sale.id, method: p.method,
          shift: sh.id, customer_id: b.customer_id || null,
          ref: ['sales', sale.id], by: req.user.id
        });
      } catch (e) { if (e.code !== '42P01') throw e; }
    }
    const { rows: [done] } = await c.query(
      `UPDATE sales SET total = $2, invoice_no = $3 WHERE id = $1 AND station_id = $4 RETURNING *`, [sale.id, total, `${req.sid}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${sale.id}`, req.sid]);
    await audit(c, req, 'ventes',
      stamp.backdated
        ? ('Vente N° ' + sale.id + ' (date quart ' + (stamp.soldAt || '').slice(0, 10) + ')')
        : ('Vente N° ' + sale.id),
      'sales', sale.id, null, { total, sold_at: stamp.soldAt || done.sold_at, backdated: stamp.backdated });
    return done;
  });
  const replay = Boolean(out?._idempotent_replay);
  if (replay) delete out._idempotent_replay;
  if (!replay) await require('./employee_actions').afterSale(req, out.id);
  if (!replay && req.body.loyalty) out.loyalty = await require('./market').afterSale(req, out.id, req.body.loyalty);   // points de fidélité (jamais bloquant)   // dette client / vente faite au nom d'un employé : journal + messagerie
  res.status(replay ? 200 : 201).json(out);
}));

// ANNULATION d'une vente : uniquement pendant que le quart est ouvert, avec motif obligatoire
r.post('/sales/:id/cancel', need('sale.delete'), body(z.object({ reason: z.string().min(3) })), wrap(async (req, res) => {
  await assertNotLocked(req.sid);
  await tx(async c => {
    const { rows: [s] } = await c.query(
      `SELECT sa.*, sh.status AS shift_status, sh.cash_register_id FROM sales sa JOIN shifts sh ON sh.id = sa.shift_id WHERE sa.id = $1 AND sa.station_id = $2 FOR UPDATE OF sa`, [req.params.id, req.sid]);
    if (!s) throw new HttpError(404, 'Vente introuvable');
    if (s.status !== 'valide') throw new HttpError(409, 'Vente déjà annulée');
    if (s.shift_status !== 'ouvert') throw new HttpError(409, 'Quart clôturé : la vente est verrouillée');
    await c.query("UPDATE sales SET status = 'annule', cancelled_by = $2, cancel_reason = $3 WHERE id = $1 AND station_id = $4", [s.id, req.user.id, req.body.reason, req.sid]);
    const { rows: det } = await c.query('SELECT product_id, quantity FROM sale_details WHERE sale_id = $1', [s.id]);
    if (s.kind === 'produits') for (const d of det) await stockMove(c, { station: req.sid, product: d.product_id, kind: 'retour', qty: d.quantity, shift: s.shift_id, ref: ['sales', s.id], comment: 'Annulation', by: req.user.id });
    const { rows: pays } = await c.query('SELECT method, amount FROM payments WHERE sale_id = $1', [s.id]);
    for (const p of pays) {
      const { rows: [pm] } = await c.query('SELECT kind FROM payment_methods WHERE station_id = $1 AND code = $2', [req.sid, p.method]);
      const k = pm?.kind || (p.method === 'especes' ? 'especes' : p.method === 'credit' ? 'credit' : 'autre');
      if (k === 'especes') await cashMove(c, { reg: s.cash_register_id, shift: s.shift_id, kind: 'decaissement', amount: -p.amount, label: 'Annulation vente N° ' + s.id, ref: ['sales', s.id], by: req.user.id });
      else if (k === 'credit') { await c.query('UPDATE customers SET balance = balance - $2 WHERE id = $1 AND station_id = $3', [s.customer_id, p.amount, req.sid]); await ledger(c, { customer: s.customer_id, station: req.sid, kind: 'annulation', amount: -p.amount, ref: ['sales', s.id], by: req.user.id }); }
      else await accountMove(c, { station: req.sid, method: p.method, amount: -p.amount, label: 'Annulation vente N° ' + s.id, ref: ['sales', s.id], shift: s.shift_id, by: req.user.id });
    }
    await audit(c, req, 'ventes', 'Annulation de la vente N° ' + s.id, 'sales', s.id, { statut: 'valide', total: s.total }, { statut: 'annule', motif: req.body.reason });
  });
  res.json({ ok: true });
}));

r.get('/sales', wrap(async (req, res) => {
  // Filtre optionnel par période (jours de début et de fin inclus) — utilisé par l'écran Ventes et son export PDF.
  const from = String(req.query.from || ''), to = String(req.query.to || ''), hasRange = !!(from || to);
  if (hasRange) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new HttpError(400, 'Période invalide : renseignez la date de début et la date de fin.');
    if (from > to) throw new HttpError(400, 'La date de début ne peut pas être postérieure à la date de fin.');
  }
  const { rows } = hasRange
    ? await pool.query(
      `SELECT id, invoice_no, shift_id, employee_id, customer_id, sold_at, total, status, kind, input_mode FROM sales WHERE station_id = $1 AND sold_at::date BETWEEN $2::date AND $3::date ORDER BY id DESC LIMIT $4`,
      [req.sid, from, to, Math.min(+req.query.limit || 1000, 2000)])
    : await pool.query(
      `SELECT id, invoice_no, shift_id, employee_id, customer_id, sold_at, total, status, kind, input_mode FROM sales WHERE station_id = $1 ORDER BY id DESC LIMIT $2`, [req.sid, Math.min(+req.query.limit || 50, 200)]);
  res.json(rows);
}));

// DÉPENSES
r.post('/expenses', need('expense.create'), body(z.object({
  category: z.string().min(1), amount: z.number().positive(), method: z.string().min(1),
  beneficiary: z.string().optional(), receipt_url: z.string().optional(), comment: z.string().optional(),
  client_ref: z.string().trim().min(1).max(128).optional().nullable(),
})), wrap(async (req, res) => {
  await assertNotLocked(req.sid);
  const b = req.body;
  const clientRef = b.client_ref || null;
  const e = await tx(async c => {
    if (clientRef) {
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [`station:${req.sid}`, `expense:${clientRef}`]);
      const { rows: [prior] } = await c.query('SELECT * FROM expenses WHERE station_id = $1 AND client_ref = $2', [req.sid, clientRef]);
      if (prior) {
        const sameRequest = prior.category === b.category && sameMoney(prior.amount, b.amount) && prior.method === b.method &&
          (prior.beneficiary || null) === (b.beneficiary || null) && (prior.receipt_url || null) === (b.receipt_url || null) &&
          (prior.comment || null) === (b.comment || null);
        if (!sameRequest) throw new HttpError(409, 'Cette référence de requête est déjà utilisée pour une autre dépense. Générez une nouvelle référence.');
        return { ...prior, _idempotent_replay: true };
      }
    }
    const { rows: [sh] } = await c.query("SELECT id, opened_at, shift_date FROM shifts WHERE station_id = $1 AND status = 'ouvert'", [req.sid]);
    const stamp = businessStampFromShift(sh);
    const { rows: [e] } = await c.query(
      `INSERT INTO expenses(station_id, shift_id, category, amount, method, beneficiary, receipt_url, comment, created_by, client_ref, spent_on)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11::date, CURRENT_DATE)) RETURNING *`,
      [req.sid, sh?.id || null, b.category, b.amount, b.method, b.beneficiary || null, b.receipt_url || null, b.comment || null, req.user.id, clientRef, stamp.spentOn]);
    await settle(c, { station: req.sid, method: b.method, amount: -b.amount, label: 'Dépense : ' + b.category, ref: ['expenses', e.id], shift: sh?.id, by: req.user.id, event_type: 'DEPENSE', description: b.comment || b.category });
    await audit(c, req, 'dépenses',
      stamp.backdated
        ? `Dépense ${b.category} : ${b.amount} (date quart ${stamp.spentOn})`
        : `Dépense ${b.category} : ${b.amount}`,
      'expenses', e.id, null, { ...b, spent_on: e.spent_on, backdated: stamp.backdated });
    return e;
  });
  const replay = Boolean(e?._idempotent_replay);
  if (replay) delete e._idempotent_replay;
  res.status(replay ? 200 : 201).json(e);
}));

// CAISSE
r.get('/cash/registers', need('cash.manage', 'finance.view', 'shift.open'), wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT id, name, balance FROM cash_registers WHERE station_id = $1 AND active ORDER BY id', [req.sid]);
  res.json(rows);
}));
r.get('/cash/movements', need('cash.manage', 'finance.view'), wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT m.* FROM cash_movements m JOIN cash_registers r ON r.id = m.cash_register_id WHERE r.station_id = $1 ORDER BY m.id DESC LIMIT $2`, [req.sid, Math.min(+req.query.limit || 100, 500)]);
  res.json(rows);
}));
r.post('/cash/movements', need('cash.manage'), body(z.object({
  kind: z.enum(['encaissement', 'decaissement', 'depot_bancaire', 'retrait']),
  amount: z.number().positive(),
  label: z.string().min(2),
  cash_register_id: z.number().int().optional(),
  // P1 : obligatoire pour depot_bancaire (caisse → compte) et retrait (compte → caisse)
  account_id: z.number().int().optional(),
})), wrap(async (req, res) => {
  const b = req.body;
  if ((b.kind === 'depot_bancaire' || b.kind === 'retrait') && !b.account_id) {
    throw new HttpError(400, b.kind === 'depot_bancaire'
      ? 'Remise en banque : indiquez account_id (compte destinataire) ou utilisez POST /money/deposit.'
      : 'Retrait vers caisse : indiquez account_id (compte source).');
  }
  const bal = await tx(async c => {
    const reg = b.cash_register_id || await defaultReg(c, req.sid);
    const { rowCount } = await c.query('SELECT 1 FROM cash_registers WHERE id = $1 AND station_id = $2', [reg, req.sid]);
    if (!rowCount) throw new HttpError(400, 'Caisse inconnue');
    const { rows: [sh] } = await c.query("SELECT id FROM shifts WHERE station_id = $1 AND status = 'ouvert'", [req.sid]);
    let accountId = null;
    if (b.account_id) {
      const { rows: [acc] } = await c.query(
        'SELECT id FROM money_accounts WHERE id = $1 AND station_id = $2 AND active', [b.account_id, req.sid]);
      if (!acc) throw new HttpError(400, 'Compte bancaire / mobile money inconnu ou inactif');
      accountId = acc.id;
    }
    // Caisse : dépôt et retrait sortent de la caisse ; encaissement entre ; decaissement sort
    const cashAmount = (b.kind === 'encaissement') ? b.amount : -b.amount;
    const balance = await cashMove(c, { reg, shift: sh?.id, kind: b.kind, amount: cashAmount, label: b.label, by: req.user.id });
    // P1 : miroir sur le compte pour dépôt (crédit compte) et retrait (débit compte)
    if (accountId && b.kind === 'depot_bancaire') {
      await c.query(
        `INSERT INTO money_movements(account_id, station_id, kind, amount, label, shift_id, created_by)
         VALUES ($1,$2,'depot',$3,$4,$5,$6)`,
        [accountId, req.sid, b.amount, b.label, sh?.id || null, req.user.id]);
    } else if (accountId && b.kind === 'retrait') {
      await c.query(
        `INSERT INTO money_movements(account_id, station_id, kind, amount, label, shift_id, created_by)
         VALUES ($1,$2,'retrait',$3,$4,$5,$6)`,
        [accountId, req.sid, -b.amount, b.label, sh?.id || null, req.user.id]);
    }
    const eventType = b.kind === 'encaissement' ? 'AUTRE' : (b.kind === 'depot_bancaire' || b.kind === 'retrait' ? 'TRANSFERT' : 'AUTRE');
    try {
      await recordFinancialEvent(c, {
        station: req.sid, event_type: eventType,
        direction: cashAmount >= 0 ? 'in' : 'out', amount: Math.abs(cashAmount),
        label: b.label, method: 'especes', account_id: accountId, cash_register_id: reg, shift: sh?.id,
        ref: ['cash_movements', null], by: req.user.id, meta: { kind: b.kind, account_id: accountId }
      });
    } catch (e) { if (e.code !== '42P01') throw e; }
    await audit(c, req, 'caisse', `${b.kind} : ${b.amount}`, 'cash_registers', reg, null, b);
    return balance;
  });
  res.status(201).json({ balance: bal });
}));

/** Vue consolidée Caisse (Priorité 5) */
r.get('/cash/overview', need('cash.manage', 'finance.view'), wrap(async (req, res) => {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : new Date().toISOString().slice(0, 10);
  const s = req.sid;
  const q = (sql, p) => pool.query(sql, p).then(x => x.rows).catch(swallow('operations:319', []));

  const [registers, accounts, recv, payables, expensesToday, gaps, eventsToday, methods] = await Promise.all([
    q('SELECT id, name, balance FROM cash_registers WHERE station_id=$1 AND active ORDER BY id', [s]),
    q(`SELECT a.id, a.kind, a.name, a.provider,
        a.opening_balance + COALESCE((SELECT SUM(m.amount) FROM money_movements m WHERE m.account_id=a.id),0) AS balance
       FROM money_accounts a WHERE a.station_id=$1 AND a.active ORDER BY a.kind, a.name`, [s]),
    q('SELECT COALESCE(SUM(balance),0) AS total, COUNT(*) FILTER (WHERE balance>0)::int AS n FROM customers WHERE station_id=$1 AND deleted_at IS NULL', [s]),
    q('SELECT COALESCE(SUM(balance_due),0) AS total, COUNT(*) FILTER (WHERE balance_due>0)::int AS n FROM suppliers WHERE station_id=$1 AND deleted_at IS NULL', [s]),
    q(`SELECT category, SUM(amount) AS total, COUNT(*)::int AS n FROM expenses
       WHERE station_id=$1 AND deleted_at IS NULL AND spent_on=$2::date GROUP BY category ORDER BY total DESC`, [s, day]),
    q(`SELECT COUNT(*)::int AS n, COALESCE(SUM(ABS(amount)),0) AS total FROM employee_gaps
       WHERE station_id=$1 AND kind = 'caisse' AND status NOT IN ('cloture','regularise')`, [s]),
    q(`SELECT event_type, direction, COALESCE(SUM(amount),0) AS total, COUNT(*)::int AS n
       FROM financial_events WHERE station_id=$1 AND event_at::date=$2::date
       GROUP BY event_type, direction ORDER BY event_type`, [s, day]),
    q('SELECT code, label, kind FROM payment_methods WHERE station_id=$1 AND active ORDER BY label', [s])
  ]);

  const cashTotal = registers.reduce((a, x) => a + Number(x.balance || 0), 0);
  const accountsByKind = {};
  for (const a of accounts) {
    accountsByKind[a.kind] = (accountsByKind[a.kind] || 0) + Number(a.balance || 0);
  }
  const mmTotal = accountsByKind['mobile_money'] || 0;
  const bankTotal = accountsByKind['banque'] || 0;
  const otherAcc = Object.entries(accountsByKind).filter(([k]) => !['mobile_money','banque'].includes(k))
    .reduce((a, [, v]) => a + v, 0);
  const liquidity = cashTotal + mmTotal + bankTotal + otherAcc;
  const receivables = Number(recv[0]?.total || 0);
  const debts = Number(payables[0]?.total || 0);
  const expTotal = expensesToday.reduce((a, x) => a + Number(x.total || 0), 0);

  res.json({
    date: day,
    liquidity: {
      cash: cashTotal,
      mobile_money: mmTotal,
      bank: bankTotal,
      other_accounts: otherAcc,
      total: liquidity,
      note: 'Liquidités = caisses + comptes actifs (hors créances).'
    },
    registers,
    accounts,
    receivables: { total: receivables, count: recv[0]?.n || 0 },
    payables: { total: debts, count: payables[0]?.n || 0 },
    net_position: liquidity + receivables - debts,
    expenses_today: { total: expTotal, by_category: expensesToday },
    gaps: { open_count: gaps[0]?.n || 0, amount: Number(gaps[0]?.total || 0) },
    events_today: eventsToday,
    payment_methods: methods
  });
}));


// STOCK
// RG-07 / ANO-08 : quantité bornée (|q| ≤ 1 000 000, 3 décimales au plus) et motif obligatoire (3 caractères minimum) pour tout
// mouvement manuel ; hors bornes ou sans motif → 400 (et non plus une erreur 500 de dépassement NUMERIC(14,3)).
const STOCK_QTY_MAX = 1000000;
const MOVEMENT_REASONS = ['entree', 'retour', 'perte', 'casse', 'correction'];
r.post('/stock/movements', need('stock.adjust'), body(z.object({
  product_id: z.number().int().positive(),
  kind: z.enum(MOVEMENT_REASONS),
  quantity: z.number().finite().min(-STOCK_QTY_MAX, 'Quantité hors limites (1 000 000 maximum)').max(STOCK_QTY_MAX, 'Quantité hors limites (1 000 000 maximum)')
    .refine(q => Math.abs(q * 1000 - Math.round(q * 1000)) < 1e-6, 'Quantité : 3 décimales au maximum'),
  comment: z.string({ required_error: 'Motif obligatoire (3 caractères minimum)', invalid_type_error: 'Motif obligatoire (3 caractères minimum)' })
    .trim().min(3, 'Motif obligatoire (3 caractères minimum)').max(300, 'Motif trop long (300 caractères maximum)'),
}).strict()), wrap(async (req, res) => {
  const b = req.body;
  if (!b.quantity) throw new HttpError(400, 'Quantité nulle');
  await tx(async c => {
    const { rowCount } = await c.query('SELECT 1 FROM products WHERE id = $1 AND station_id = $2', [b.product_id, req.sid]);
    if (!rowCount) throw new HttpError(400, 'Produit inconnu');
    const qty = ['perte', 'casse'].includes(b.kind) ? -Math.abs(b.quantity) : b.kind === 'correction' ? b.quantity : Math.abs(b.quantity);
    await stockMove(c, { station: req.sid, product: b.product_id, kind: b.kind, qty, comment: b.comment, by: req.user.id });
    await audit(c, req, 'stock', `${b.kind} : ${qty}`, 'products', b.product_id, null, b);
  });
  res.status(201).json({ ok: true });
}));

// CRÉANCES : encaissement d'un paiement client
/** Priorité 6 — Vue stock consolidée */
r.get('/stock/overview', need('stock.adjust', 'report.view', 'sale.create'), wrap(async (req, res) => {
  const s = req.sid;
  const { rows: products } = await pool.query(
    `SELECT p.id, p.name, p.unit, p.buy_price, p.sell_price, p.min_stock, p.active,
            COALESCE(st.quantity, 0) AS quantity,
            cat.code AS category
     FROM products p
     JOIN categories cat ON cat.id = p.category_id
     LEFT JOIN stock st ON st.product_id = p.id
     WHERE p.station_id = $1 AND p.deleted_at IS NULL
     ORDER BY p.name`, [s]
  );
  const low = products.filter(p => Number(p.quantity) <= Number(p.min_stock));
  const valueBuy = products.reduce((a, p) => a + Number(p.quantity) * Number(p.buy_price), 0);
  const valueSell = products.reduce((a, p) => a + Number(p.quantity) * Number(p.sell_price), 0);
  const { rows: recent } = await pool.query(
    `SELECT m.id, m.kind, m.quantity, m.comment, m.created_at, p.name AS product, u.login
     FROM stock_movements m
     JOIN products p ON p.id = m.product_id
     LEFT JOIN users u ON u.id = m.created_by
     WHERE m.station_id = $1
     ORDER BY m.id DESC LIMIT 40`, [s]
  );
  const byKind = {};
  for (const m of recent) {
    byKind[m.kind] = (byKind[m.kind] || 0) + 1;
  }
  res.json({
    products_count: products.length,
    low_stock: maskCost(req, low),   // RG-03 : prix d'achat et valeur d'achat réservés à « cost.view »
    low_count: low.length,
    ...(canCost(req) ? { stock_value_buy: valueBuy } : {}),
    stock_value_sell: valueSell,
    recent_movements: recent,
    movements_by_kind_sample: byKind,
    note: canCost(req) ? 'Valorisation = quantité × prix (achat / vente).' : 'Valorisation = quantité × prix de vente.'
  });
}));

r.get('/stock/movements', need('stock.adjust', 'report.view'), wrap(async (req, res) => {
  const params = [req.sid];
  const where = ['m.station_id = $1'];
  if (req.query.product_id) { params.push(+req.query.product_id); where.push(`m.product_id = $${params.length}`); }
  if (req.query.kind) { params.push(req.query.kind); where.push(`m.kind = $${params.length}`); }
  if (req.query.from) { params.push(req.query.from); where.push(`m.created_at >= $${params.length}::date`); }
  if (req.query.to) { params.push(req.query.to); where.push(`m.created_at < $${params.length}::date + 1`); }
  params.push(Math.min(+req.query.limit || 100, 500));
  const { rows } = await pool.query(
    `SELECT m.*, p.name AS product, u.login
     FROM stock_movements m
     JOIN products p ON p.id = m.product_id
     LEFT JOIN users u ON u.id = m.created_by
     WHERE ${where.join(' AND ')}
     ORDER BY m.id DESC LIMIT $${params.length}`, params
  );
  res.json(rows);
}));

r.get('/pumps/status', need('settings.edit', 'shift.open', 'report.view'), wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT pu.id AS pump_id, pu.number, pu.name AS pump_name, pu.status, pu.location,
            pc.id AS counter_id, pc.counter_number, pc.current_index, pr.id AS product_id, pr.name AS product,
            (SELECT m.index_end FROM meter_readings m
             JOIN shifts sh ON sh.id = m.shift_id
             WHERE m.counter_id = pc.id AND sh.status = 'ferme'
             ORDER BY m.id DESC LIMIT 1) AS last_closed_index,
            (SELECT sh.closed_at FROM meter_readings m
             JOIN shifts sh ON sh.id = m.shift_id
             WHERE m.counter_id = pc.id AND sh.status = 'ferme'
             ORDER BY m.id DESC LIMIT 1) AS last_closed_at
     FROM pumps pu
     LEFT JOIN pump_counters pc ON pc.pump_id = pu.id
     LEFT JOIN products pr ON pr.id = pc.product_id
     WHERE pu.station_id = $1 AND pu.deleted_at IS NULL
     ORDER BY pu.number, pc.counter_number`, [req.sid]
  );
  const pumps = {};
  for (const r of rows) {
    if (!pumps[r.pump_id]) {
      pumps[r.pump_id] = {
        id: r.pump_id, number: r.number, name: r.pump_name, status: r.status, location: r.location, counters: []
      };
    }
    if (r.counter_id) {
      pumps[r.pump_id].counters.push({
        id: r.counter_id, counter_number: r.counter_number, current_index: r.current_index,
        product_id: r.product_id, product: r.product,
        last_closed_index: r.last_closed_index, last_closed_at: r.last_closed_at
      });
    }
  }
  res.json({ pumps: Object.values(pumps), note: 'Index courant vs dernier index de clôture.' });
}));


r.post('/customers/:id/payments', need('cash.manage', 'sale.create'), body(z.object({ amount: z.number().positive(), method: z.string().min(1), sale_id: z.number().int().optional() })), wrap(async (req, res) => {
  const b = req.body;
  const bal = await tx(async c => {
    const { rows: [cu] } = await c.query('SELECT * FROM customers WHERE id = $1 AND station_id = $2 FOR UPDATE', [req.params.id, req.sid]);
    if (!cu) throw new HttpError(404, 'Client introuvable');
    if (b.amount > cu.balance) throw new HttpError(400, `Montant supérieur à la dette (${cu.balance})`);
    const pmLinked = await assertLinkedMethod(c, req.sid, b.method);
    await c.query('INSERT INTO customer_payments(customer_id, sale_id, amount, method, created_by, account_id) VALUES ($1,$2,$3,$4,$5,$6)', [cu.id, b.sale_id || null, b.amount, b.method, req.user.id, pmLinked.account_id || null]);
    const { rows: [n] } = await c.query('UPDATE customers SET balance = balance - $2 WHERE id = $1 AND station_id = $3 RETURNING balance', [cu.id, b.amount, req.sid]);
    const { rows: [sh] } = await c.query("SELECT id FROM shifts WHERE station_id = $1 AND status = 'ouvert'", [req.sid]);
    const pm = await settle(c, { station: req.sid, method: b.method, amount: b.amount, label: 'Paiement client ' + cu.name, ref: ['customers', cu.id], shift: sh?.id, by: req.user.id, event_type: 'PAIEMENT_CLIENT', customer_id: cu.id });
    if (pm.kind === 'credit') throw new HttpError(400, 'Le crédit ne peut pas servir à régler une dette');
    await ledger(c, { customer: cu.id, station: req.sid, kind: 'paiement', amount: -b.amount, ref: ['customers', cu.id], by: req.user.id });
    await audit(c, req, 'clients', `Paiement de ${cu.name} : ${b.amount}`, 'customers', cu.id, { solde: cu.balance }, { solde: n.balance });
    return n.balance;
  });
  res.status(201).json({ balance: bal });
}));

module.exports = r;
