'use strict';
/** Facturation clients — module station (gratuit, isolation station_id). */
const express = require('express');
const { swallow } = require('./safe');
const { z } = require('zod');
const { pool, tx, HttpError, wrap, body, need, audit, settle, ledger, payMethod, assertLinkedMethod, fl, f3, stockMove, recordFinancialEvent } = require('./core');
const { resolveFuelSaleEmployee, SaleAttributionError } = require('./shift_sales_check');
const { loadContractForUser, featureOn } = require('./contracts');
const docs = require('./docs');

const r = express.Router();
const VIEW = ['sale.create', 'finance.view', 'report.view', 'customer.view', 'customer.edit'];
const EDIT = ['sale.create', 'customer.edit', 'finance.view'];

async function assertBilling(req) {
  if (req.user.is_global) throw new HttpError(403, 'La facturation station est réservée aux comptes clients.');
  const contract = await loadContractForUser(req.user.id, false).catch(swallow('billing:15', null));
  if (contract && contract.suspended) throw new HttpError(403, 'Contrat suspendu.');
  if (contract && contract.features && contract.features.can_use_billing === false) {
    throw new HttpError(403, 'La facturation n’est pas incluse dans votre contrat.', { code: 'FEATURE_DISABLED', feature: 'can_use_billing' });
  }
}

function lineSchema() {
  return z.object({
    product_id: z.number().int().positive().nullable().optional(),
    description: z.string().min(1).max(500),
    quantity: z.number().positive(),
    unit_price: z.number().min(0)
  });
}

async function nextInvoiceNo(c, stationId) {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const { rows: [row] } = await c.query(
    `SELECT COUNT(*)::int AS n FROM invoices WHERE station_id=$1 AND invoice_no LIKE $2`,
    [stationId, `FAC-${day}-%`]
  );
  const n = (row?.n || 0) + 1;
  return `FAC-${day}-${String(n).padStart(4, '0')}`;
}

function totals(lines, taxRate) {
  const total_ht = lines.reduce((a, l) => a + Number(l.quantity) * Number(l.unit_price), 0);
  const rate = Number(taxRate) || 0;
  const total_tax = Math.round(total_ht * rate) / 100;
  const total_ttc = total_ht + total_tax;
  return {
    total_ht: Math.round(total_ht * 100) / 100,
    total_tax: Math.round(total_tax * 100) / 100,
    total_ttc: Math.round(total_ttc * 100) / 100
  };
}

async function loadInvoice(c, id, stationId) {
  const { rows: [inv] } = await c.query(
    `SELECT i.*, c.name AS customer_name, c.phone AS customer_phone, c.address AS customer_address,
            pu.name AS pump_name, sh.number AS shift_number,
            NULLIF(TRIM(COALESCE(e.first_name,'') || ' ' || COALESCE(e.last_name,'')), '') AS employee_name,
            ub.login AS ordered_by_login
       FROM invoices i
       LEFT JOIN customers c ON c.id = i.customer_id
       LEFT JOIN pumps pu ON pu.id = i.pump_id
       LEFT JOIN shifts sh ON sh.id = i.shift_id
       LEFT JOIN employees e ON e.id = i.employee_id
       LEFT JOIN users ub ON ub.id = i.ordered_by
      WHERE i.id=$1 AND i.station_id=$2`, [id, stationId]
  );
  if (!inv) throw new HttpError(404, 'Facture introuvable');
  const { rows: lines } = await c.query(
    `SELECT * FROM invoice_lines WHERE invoice_id=$1 ORDER BY id`, [id]
  );
  const { rows: payments } = await c.query(
    `SELECT * FROM invoice_payments WHERE invoice_id=$1 ORDER BY paid_at, id`, [id]
  );
  return { ...inv, lines, payments };
}

r.get('/invoices', need(...VIEW), wrap(async (req, res) => {
  await assertBilling(req);
  const limit = Math.min(+req.query.limit || 50, 1000);
  const status = req.query.status;
  const params = [req.sid];
  let where = 'i.station_id=$1';
  if (status) { params.push(status); where += ` AND i.status=$${params.length}`; }
  // Recherche libre (n° de facture ou nom du client) et état de règlement (calculé : payé / TTC)
  const qtxt = String(req.query.q || '').trim().slice(0, 80);
  if (qtxt) { params.push('%' + qtxt.replace(/[\\%_]/g, m => '\\' + m) + '%'); where += ` AND (i.invoice_no ILIKE $${params.length} OR c.name ILIKE $${params.length})`; }
  const PAYSQL = {
    non_regle: 'COALESCE(i.amount_paid,0) <= 0 AND i.total_ttc > 0',
    partiel: 'i.amount_paid > 0 AND i.amount_paid < i.total_ttc',
    solde: 'i.total_ttc > 0 AND i.amount_paid >= i.total_ttc'
  };
  if (PAYSQL[req.query.payment]) where += ' AND ' + PAYSQL[req.query.payment];
  if (req.query.customer_id) { params.push(+req.query.customer_id); where += ` AND i.customer_id=$${params.length}`; }
  if (req.query.from) { params.push(req.query.from); where += ` AND COALESCE(i.issued_on, i.created_at::date) >= $${params.length}::date`; }
  if (req.query.to) { params.push(req.query.to); where += ` AND COALESCE(i.issued_on, i.created_at::date) <= $${params.length}::date`; }
  params.push(limit);
  const { rows } = await pool.query(
    `SELECT i.id, i.invoice_no, i.status, i.issued_on, i.due_date, i.total_ttc, i.amount_paid,
            i.customer_id, c.name AS customer_name, i.sale_id, i.created_at
       FROM invoices i
       LEFT JOIN customers c ON c.id = i.customer_id
      WHERE ${where}
      ORDER BY i.id DESC
      LIMIT $${params.length}`, params
  );
  res.json(rows);
}));

r.get('/invoices/:id', need(...VIEW), wrap(async (req, res) => {
  await assertBilling(req);
  const inv = await loadInvoice(pool, +req.params.id, req.sid);
  res.json(inv);
}));

r.post('/invoices', need(...EDIT), body(z.object({
  customer_id: z.number().int().positive().nullable().optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  tax_rate: z.number().min(0).max(100).optional(),
  notes: z.string().max(2000).optional(),
  lines: z.array(lineSchema()).min(1)
})), wrap(async (req, res) => {
  await assertBilling(req);
  const b = req.body;
  const tax_rate = b.tax_rate != null ? b.tax_rate : 0;
  const t = totals(b.lines, tax_rate);
  const inv = await tx(async c => {
    if (b.customer_id) {
      const { rows: [cu] } = await c.query(
        `SELECT id FROM customers WHERE id=$1 AND station_id=$2 AND deleted_at IS NULL`, [b.customer_id, req.sid]
      );
      if (!cu) throw new HttpError(400, 'Client introuvable');
    }
    const no = await nextInvoiceNo(c, req.sid);
    const { rows: [row] } = await c.query(
      `INSERT INTO invoices(station_id, customer_id, invoice_no, status, due_date, tax_rate,
        total_ht, total_tax, total_ttc, notes, created_by)
       VALUES ($1,$2,$3,'brouillon',$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.sid, b.customer_id || null, no, b.due_date || null, tax_rate,
        t.total_ht, t.total_tax, t.total_ttc, b.notes || null, req.user.id]
    );
    for (const l of b.lines) {
      const amount = Math.round(Number(l.quantity) * Number(l.unit_price) * 100) / 100;
      await c.query(
        `INSERT INTO invoice_lines(invoice_id, product_id, description, quantity, unit_price, amount)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [row.id, l.product_id || null, l.description, l.quantity, l.unit_price, amount]
      );
    }
    await audit(c, req, 'facturation', `Brouillon facture ${no}`, 'invoices', row.id, null, { total_ttc: t.total_ttc });
    return loadInvoice(c, row.id, req.sid);
  });
  res.status(201).json(inv);
}));

r.patch('/invoices/:id', need(...EDIT), body(z.object({
  customer_id: z.number().int().positive().nullable().optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  tax_rate: z.number().min(0).max(100).optional(),
  notes: z.string().max(2000).nullable().optional(),
  lines: z.array(lineSchema()).min(1).optional()
}).strict()), wrap(async (req, res) => {
  await assertBilling(req);
  const id = +req.params.id;
  const inv = await tx(async c => {
    const cur = await loadInvoice(c, id, req.sid);
    if (cur.status !== 'brouillon') throw new HttpError(409, 'Seuls les brouillons sont modifiables.');
    const b = req.body;
    if (b.customer_id) {   // CORR-028 : le client doit appartenir à la station (comme à la création)
      const { rows: [cu] } = await c.query(
        `SELECT id FROM customers WHERE id=$1 AND station_id=$2 AND deleted_at IS NULL`, [b.customer_id, req.sid]
      );
      if (!cu) throw new HttpError(400, 'Client introuvable');
    }
    let tax_rate = b.tax_rate != null ? b.tax_rate : Number(cur.tax_rate);
    let lines = cur.lines;
    if (b.lines) {
      await c.query(`DELETE FROM invoice_lines WHERE invoice_id=$1`, [id]);
      for (const l of b.lines) {
        const amount = Math.round(Number(l.quantity) * Number(l.unit_price) * 100) / 100;
        await c.query(
          `INSERT INTO invoice_lines(invoice_id, product_id, description, quantity, unit_price, amount)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [id, l.product_id || null, l.description, l.quantity, l.unit_price, amount]
        );
      }
      lines = b.lines;
    }
    const t = totals(lines.map(l => ({
      quantity: l.quantity,
      unit_price: l.unit_price
    })), tax_rate);
    await c.query(
      `UPDATE invoices SET
         customer_id = COALESCE($2, customer_id),
         due_date = CASE WHEN $3::text = '__clear' THEN NULL WHEN $3::text IS NULL THEN due_date ELSE $3::date END,
         tax_rate = $4, total_ht=$5, total_tax=$6, total_ttc=$7,
         notes = COALESCE($8, notes), updated_at=now()
       WHERE id=$1 AND station_id=$9`,
      [id, b.customer_id !== undefined ? b.customer_id : null,
        b.due_date === null ? '__clear' : (b.due_date || null),
        tax_rate, t.total_ht, t.total_tax, t.total_ttc,
        b.notes !== undefined ? b.notes : null, req.sid]
    );
    // Fix due_date update logic - simpler:
    if (b.due_date !== undefined) {
      await c.query(`UPDATE invoices SET due_date=$2 WHERE id=$1 AND station_id=$3`, [id, b.due_date, req.sid]);
    }
    if (b.customer_id !== undefined) {
      await c.query(`UPDATE invoices SET customer_id=$2 WHERE id=$1 AND station_id=$3`, [id, b.customer_id, req.sid]);
    }
    await audit(c, req, 'facturation', `Modification brouillon facture ${cur.invoice_no}`, 'invoices', id);
    return loadInvoice(c, id, req.sid);
  });
  res.json(inv);
}));

/** Produits de l'état des lignes (catégorie carburant ou non) — station-scopé. */
async function lineProducts(c, lines, sid) {
  const pids = [...new Set(lines.filter(l => l.product_id).map(l => Number(l.product_id)))];
  const { rows } = pids.length ? await c.query(
    `SELECT p.id, p.name, p.buy_price, cat.code AS cat FROM products p JOIN categories cat ON cat.id = p.category_id
      WHERE p.id = ANY($1) AND p.station_id = $2 AND p.deleted_at IS NULL`, [pids, sid]) : { rows: [] };
  const map = new Map(rows.map(p => [Number(p.id), p]));
  for (const id of pids) if (!map.has(id)) throw new HttpError(400, 'Produit de la facture introuvable ou supprimé (#' + id + ').');
  return map;
}

/** Contexte de validation pour l'écran : quart ouvert ? lignes carburant ? pompes proposées. */
r.get('/invoices/:id/issue-context', need(...EDIT), wrap(async (req, res) => {
  await assertBilling(req);
  const inv = await loadInvoice(pool, +req.params.id, req.sid);
  const prods = await lineProducts(pool, inv.lines, req.sid);
  const fuelIds = [...new Set(inv.lines.filter(l => l.product_id && prods.get(Number(l.product_id)).cat === 'CARBURANT').map(l => Number(l.product_id)))];
  const { rows: [sh] } = await pool.query("SELECT id, number FROM shifts WHERE station_id = $1 AND status = 'ouvert' ORDER BY opened_at DESC LIMIT 1", [req.sid]);
  let pumps = [];
  if (fuelIds.length) {
    ({ rows: pumps } = await pool.query(
      `SELECT pu.id, pu.name, array_agg(DISTINCT pr.name ORDER BY pr.name) AS products
         FROM pumps pu JOIN pump_counters pc ON pc.pump_id = pu.id JOIN products pr ON pr.id = pc.product_id
        WHERE pu.station_id = $1 AND pu.deleted_at IS NULL AND pu.status = 'active' AND pc.product_id = ANY($2)
        GROUP BY pu.id, pu.name ORDER BY pu.name`, [req.sid, fuelIds]));
  }
  const { rows: [me] } = await pool.query('SELECT id FROM employees WHERE user_id = $1 AND station_id = $2 AND deleted_at IS NULL', [req.user.id, req.sid]);
  res.json({ shift_open: !!sh, shift: sh || null, has_fuel: fuelIds.length > 0, needs_pump: fuelIds.length > 0, pumps, has_employee: !!me, customer_id: inv.customer_id || null });
}));

/**
 * Validation (émission) d'une facture libre :
 *  - client obligatoire (la facture est une créance : solde client + grand livre) ;
 *  - quart ouvert  → la facture est rattachée au quart ; les lignes produits deviennent une vente à crédit (CA, stock, employé),
 *                    les lignes carburant une vente carburant déclarée sur la pompe choisie (index du compteur avancé des litres) ;
 *  - quart fermé   → confirmation explicite (no_shift_ack) : pas de quart ni d'employé, la facture est attribuée à l'utilisateur
 *                    (commanditaire) ; le stock sort directement et le montant est compté au CA par la facture ;
 *  - pompe obligatoire dès qu'une ligne est du carburant.
 */
r.post('/invoices/:id/issue', need(...EDIT), body(z.object({
  pump_id: z.number().int().positive().nullable().optional(),
  employee_id: z.number().int().positive().nullable().optional(),
  no_shift_ack: z.boolean().optional()
}).strict()), wrap(async (req, res) => {
  await assertBilling(req);
  const id = +req.params.id, b = req.body;
  const inv = await tx(async c => {
    const cur = await loadInvoice(c, id, req.sid);
    if (cur.status !== 'brouillon') throw new HttpError(409, 'Seuls les brouillons peuvent être émis.');
    if (!cur.lines.length) throw new HttpError(400, 'Facture sans lignes.');
    if (!cur.customer_id) throw new HttpError(400, 'Choisissez un client avant de valider la facture : elle constitue une créance suivie sur sa fiche.', { code: 'CUSTOMER_REQUIRED' });
    const rate = Number(cur.tax_rate) || 0, total = Number(cur.total_ttc);

    const prods = await lineProducts(c, cur.lines, req.sid);
    const isFuel = l => l.product_id && prods.get(Number(l.product_id)).cat === 'CARBURANT';
    const fuelLines = cur.lines.filter(isFuel);
    const stockLines = cur.lines.filter(l => l.product_id && !isFuel(l));

    // TTC par ligne, l'arrondi résiduel est reporté sur la dernière ligne pour que Σ lignes = total TTC de la facture
    const ttc = cur.lines.map(l => fl(Number(l.amount) * (1 + rate / 100)));
    if (ttc.length) ttc[ttc.length - 1] = fl(ttc[ttc.length - 1] + (total - ttc.reduce((a, x) => a + x, 0)));
    const ttcOf = new Map(cur.lines.map((l, i) => [l.id, ttc[i]]));

    // Client : mêmes garde-fous qu'une vente à crédit
    const { rows: [cu] } = await c.query('SELECT * FROM customers WHERE id = $1 AND station_id = $2 AND deleted_at IS NULL FOR UPDATE', [cur.customer_id, req.sid]);
    if (!cu) throw new HttpError(400, 'Client introuvable');
    if (cu.active === false) throw new HttpError(409, 'Client inactif (archivé) : réactivez ' + cu.name + ' avant de valider la facture.');
    if (cu.credit_blocked) throw new HttpError(409, 'Crédit bloqué pour ' + cu.name + ' — régularisez le compte ou débloquez le client.');
    if (Number(cu.credit_limit) > 0 && Number(cu.balance) + total > Number(cu.credit_limit)) {
      throw new HttpError(409, 'Limite de crédit dépassée pour ' + cu.name + ' (solde ' + Number(cu.balance).toLocaleString('fr-FR') + ' + ' + total.toLocaleString('fr-FR') + ' > plafond ' + Number(cu.credit_limit).toLocaleString('fr-FR') + ')');
    }

    // Quart
    const { rows: [sh] } = await c.query("SELECT * FROM shifts WHERE station_id = $1 AND status = 'ouvert' ORDER BY opened_at DESC LIMIT 1 FOR SHARE", [req.sid]);
    if (!sh && !b.no_shift_ack) {
      throw new HttpError(409, 'Aucun quart n’est ouvert. La facture ne sera liée ni à un employé ni à un quart ; si vous continuez, elle vous sera attribuée comme commanditaire.', { code: 'NO_OPEN_SHIFT' });
    }

    // Pompe : obligatoire pour le carburant ; chaque produit carburant doit être distribué par cette pompe
    let pump = null; const counterOf = new Map();
    if (fuelLines.length) {
      if (!b.pump_id) throw new HttpError(409, 'Indiquez la pompe avec laquelle le carburant a été servi : la sélection de la pompe est obligatoire pour valider cette facture.', { code: 'PUMP_REQUIRED' });
      ({ rows: [pump] } = await c.query("SELECT id, name FROM pumps WHERE id = $1 AND station_id = $2 AND deleted_at IS NULL AND status = 'active'", [b.pump_id, req.sid]));
      if (!pump) throw new HttpError(400, 'Pompe introuvable ou inactive.');
      for (const l of fuelLines) {
        const pid = Number(l.product_id);
        if (counterOf.has(pid)) continue;
        const { rows: [k] } = sh
          ? await c.query('SELECT counter_id FROM meter_readings WHERE shift_id = $1 AND pump_id = $2 AND product_id = $3 ORDER BY counter_id LIMIT 1', [sh.id, pump.id, pid])
          : await c.query('SELECT id AS counter_id FROM pump_counters WHERE pump_id = $1 AND product_id = $2 ORDER BY id LIMIT 1', [pump.id, pid]);
        if (!k) throw new HttpError(400, `La pompe « ${pump.name} » ne distribue pas ${prods.get(pid).name}${sh ? ' sur ce quart' : ''}.`);
        counterOf.set(pid, k.counter_id);
      }
    }

    // Stock disponible (produits : stock ; carburant : stock cuve moins litres déjà déclarés sur le quart ouvert)
    const needQty = new Map();
    for (const l of cur.lines) if (l.product_id) needQty.set(Number(l.product_id), (needQty.get(Number(l.product_id)) || 0) + Number(l.quantity));
    for (const [pid, qty] of needQty) {
      const p = prods.get(pid);
      const { rows: [st] } = await c.query('SELECT quantity FROM stock WHERE product_id = $1 AND station_id = $2 FOR UPDATE', [pid, req.sid]);
      let avail = Number(st?.quantity || 0);
      if (p.cat === 'CARBURANT' && sh) {
        const { rows: [dcl] } = await c.query("SELECT COALESCE(SUM(d.quantity), 0) AS l FROM sale_details d JOIN sales sa ON sa.id = d.sale_id WHERE sa.shift_id = $1 AND sa.kind = 'carburant' AND sa.status = 'valide' AND d.product_id = $2", [sh.id, pid]);
        avail = f3(avail - Number(dcl.l));
      }
      if (qty > avail + 0.0005) throw new HttpError(409, `Stock insuffisant : ${p.name} (disponible ${Math.max(avail, 0)}, demandé ${qty}).`);
    }

    const { rows: [userEmp] } = await c.query('SELECT id FROM employees WHERE user_id = $1 AND station_id = $2 AND deleted_at IS NULL', [req.user.id, req.sid]);
    let employee = null, shiftId = null, saleId = null, fuelSaleId = null, linkedTotal = 0, attribution = 'commanditaire';

    if (sh) {
      shiftId = sh.id; attribution = 'quart';
      const { rows: [crm] } = await c.query("SELECT code FROM payment_methods WHERE station_id = $1 AND kind = 'credit' AND active ORDER BY code LIMIT 1", [req.sid]);
      if (!crm && (stockLines.length || fuelLines.length)) throw new HttpError(409, 'Aucun moyen de paiement « crédit » actif : impossible de rattacher la facture au quart.');
      const opened = sh.opened_at ? new Date(sh.opened_at) : null, today = new Date().toISOString().slice(0, 10);
      const soldAt = opened && !Number.isNaN(opened.getTime()) && opened.toISOString().slice(0, 10) < today ? opened.toISOString() : null;
      const empOk = async eid => eid && (await c.query('SELECT 1 FROM employees WHERE id = $1 AND station_id = $2 AND deleted_at IS NULL', [eid, req.sid])).rowCount > 0;

      const mkSale = async (kind, emp, pumpId, details) => {
        const sum = fl(details.reduce((a, d) => a + d.amount, 0));
        const { rows: [sale] } = await c.query(
          `INSERT INTO sales(station_id, shift_id, employee_id, pump_id, customer_id, total, kind, input_mode, sold_at)
           VALUES ($1,$2,$3,$4,$5,0,$6,$7,COALESCE($8::timestamptz, now())) RETURNING id`,
          [req.sid, sh.id, emp, pumpId, cur.customer_id, kind, kind === 'carburant' ? 'litres' : null, soldAt]);
        for (const d of details) {
          if (kind === 'carburant') {
            const cid = counterOf.get(d.product);
            const { rows: [m] } = await c.query('SELECT index_start FROM meter_readings WHERE shift_id = $1 AND counter_id = $2', [sh.id, cid]);
            const { rows: [l] } = await c.query("SELECT MAX(x.index_new) AS i FROM sale_details x JOIN sales sa ON sa.id = x.sale_id WHERE sa.shift_id = $1 AND x.counter_id = $2 AND sa.status = 'valide'", [sh.id, cid]);
            const io = Number(l.i ?? m.index_start), inw = f3(io + d.qty);
            await c.query('INSERT INTO sale_details(sale_id, product_id, quantity, unit_price, unit_cost, tax_rate, amount, counter_id, index_old, index_new) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
              [sale.id, d.product, d.qty, d.unit, d.cost, rate, d.amount, cid, io, inw]);
          } else {
            await c.query('INSERT INTO sale_details(sale_id, product_id, quantity, unit_price, unit_cost, tax_rate, amount) VALUES ($1,$2,$3,$4,$5,$6,$7)',
              [sale.id, d.product, d.qty, d.unit, d.cost, rate, d.amount]);
            await stockMove(c, { station: req.sid, product: d.product, kind: 'vente', qty: -d.qty, shift: sh.id, ref: ['sales', sale.id], comment: 'Facture ' + cur.invoice_no, by: req.user.id });
          }
        }
        await c.query('UPDATE sales SET total = $2, invoice_no = $3 WHERE id = $1 AND station_id = $4',
          [sale.id, sum, `${req.sid}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${sale.id}`, req.sid]);
        await c.query(`INSERT INTO payments(station_id, sale_id, shift_id, method, amount, reference, created_by, paid_at) VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8::timestamptz, now()))`,
          [req.sid, sale.id, sh.id, crm.code, sum, 'Facture ' + cur.invoice_no, req.user.id, soldAt]);
        try {
          await recordFinancialEvent(c, { station: req.sid, event_type: 'VENTE', direction: 'in', amount: sum, label: 'Facture ' + cur.invoice_no, method: crm.code, shift: sh.id, customer_id: cur.customer_id, ref: ['sales', sale.id], by: req.user.id });
        } catch (e) { if (e.code !== '42P01') throw e; }
        await c.query('UPDATE customers SET balance = balance + $2 WHERE id = $1 AND station_id = $3', [cu.id, sum, req.sid]);
        await ledger(c, { customer: cu.id, station: req.sid, kind: 'credit', amount: sum, ref: ['sales', sale.id], by: req.user.id });
        linkedTotal = fl(linkedTotal + sum);
        return sale.id;
      };
      const detail = l => { const q = Number(l.quantity), a = ttcOf.get(l.id), p = prods.get(Number(l.product_id)); return { product: Number(l.product_id), qty: q, amount: a, unit: fl(a / q), cost: Number(p.buy_price) || 0 }; };

      if (stockLines.length) {
        employee = Number(b.employee_id) || userEmp?.id || null;
        if (!(await empOk(employee))) throw new HttpError(409, 'Aucun employé n’est associé à votre compte : choisissez l’employé responsable de la vente.', { code: 'EMPLOYEE_REQUIRED' });
        saleId = await mkSale('produits', employee, null, stockLines.map(detail));
      }
      if (fuelLines.length) {
        // Le responsable de la pompe (affectation d'ouverture) fait foi, comme pour une vente carburant classique
        const { rows: owners } = await c.query(
          `SELECT se.employee_id FROM shift_employees se WHERE se.shift_id = $1 AND se.pump_id = $2
           UNION SELECT sep.employee_id FROM shift_employee_pumps sep WHERE sep.shift_id = $1 AND sep.pump_id = $2`, [sh.id, pump.id]);
        const ids = [...new Set([...owners.map(x => Number(x.employee_id)), ...(b.employee_id ? [Number(b.employee_id)] : [])])];
        const { rows: names } = ids.length ? await c.query(`SELECT id, TRIM(COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')) AS name FROM employees WHERE id = ANY($1) AND station_id = $2`, [ids, req.sid]) : { rows: [] };
        let fe;
        try { fe = resolveFuelSaleEmployee({ owners: owners.map(x => x.employee_id), bodyEmpId: b.employee_id, userEmpId: userEmp?.id, pumpName: pump.name, names: new Map(names.map(x => [Number(x.id), x.name])) }); }
        catch (e) { if (e instanceof SaleAttributionError) throw new HttpError(e.status, e.message); throw e; }
        if (!(await empOk(fe))) throw new HttpError(409, 'Aucun employé responsable pour la pompe « ' + pump.name + ' » : choisissez l’employé.', { code: 'EMPLOYEE_REQUIRED' });
        fuelSaleId = await mkSale('carburant', fe, pump.id, fuelLines.map(detail));
        employee = employee || fe;
      }
      employee = employee || userEmp?.id || null;
    } else {
      // Pas de quart ouvert : la facture est attribuée à l'utilisateur (commanditaire) ; le stock sort immédiatement
      employee = userEmp?.id || null;
      for (const l of [...stockLines, ...fuelLines]) {
        await stockMove(c, { station: req.sid, product: Number(l.product_id), kind: 'vente', qty: -Number(l.quantity), shift: null, ref: ['invoices', id], comment: 'Facture ' + cur.invoice_no + (isFuel(l) && pump ? ' (pompe ' + pump.name + ')' : ''), by: req.user.id });
      }
    }

    // Part non portée par une vente (lignes libres, ou toute la facture hors quart) : comptée au CA via la facture et à la créance du client
    const unlinked = fl(total - linkedTotal);
    if (unlinked > 0.009) {
      await c.query('UPDATE customers SET balance = balance + $2 WHERE id = $1 AND station_id = $3', [cu.id, unlinked, req.sid]);
      await ledger(c, { customer: cu.id, station: req.sid, kind: 'credit', amount: unlinked, ref: ['invoices', id], by: req.user.id });
    }
    await c.query(
      `UPDATE invoices SET status='emise', issued_on=COALESCE(issued_on, CURRENT_DATE), updated_at=now(),
              source = COALESCE(source, 'libre'), shift_id=$3, employee_id=$4, ordered_by=$5, pump_id=$6,
              sale_id=$7, fuel_sale_id=$8, unlinked_amount=$9, attribution=$10
        WHERE id=$1 AND station_id=$2`,
      [id, req.sid, shiftId, employee, req.user.id, pump ? pump.id : null, saleId, fuelSaleId, unlinked > 0.009 ? unlinked : 0, attribution]);
    await audit(c, req, 'facturation', `Émission facture ${cur.invoice_no} (${sh ? 'quart n°' + sh.number : 'hors quart, commanditaire'}${pump ? ', pompe ' + pump.name : ''})`, 'invoices', id, null,
      { shift_id: shiftId, employee_id: employee, attribution, pump_id: pump ? pump.id : null, sale_id: saleId, fuel_sale_id: fuelSaleId, unlinked_amount: unlinked });
    return loadInvoice(c, id, req.sid);
  });
  res.json(inv);
}));

r.post('/invoices/:id/pay', need(...EDIT), body(z.object({
  amount: z.number().positive(),
  method: z.string().min(1).max(40),
  reference: z.string().max(120).optional()
})), wrap(async (req, res) => {
  await assertBilling(req);
  const id = +req.params.id;
  const inv = await tx(async c => {
    const cur = await loadInvoice(c, id, req.sid);
    if (!['emise', 'partielle'].includes(cur.status)) {
      throw new HttpError(409, 'Paiement possible uniquement sur facture émise ou partielle.');
    }
    const remaining = Number(cur.total_ttc) - Number(cur.amount_paid);
    if (req.body.amount > remaining + 0.009) {
      throw new HttpError(400, `Montant supérieur au reste à payer (${remaining}).`);
    }
    // Imputation financière : l'argent encaissé entre réellement en caisse / sur le compte du moyen de paiement,
    // et, pour une facture issue d'une vente à crédit, la créance du client baisse (solde + grand livre).
    const pm = await assertLinkedMethod(c, req.sid, req.body.method);
    if (pm.kind === 'credit') throw new HttpError(400, 'Le crédit ne peut pas servir à régler une facture.');
    let customer = null;
    if (cur.sale_id || cur.source === 'fleet' || cur.source === 'libre') {
      if (!cur.customer_id) throw new HttpError(409, 'Facture issue d’une vente sans client : aucun paiement à imputer.');
      ({ rows: [customer] } = await c.query('SELECT id, name, balance FROM customers WHERE id=$1 AND station_id=$2 FOR UPDATE', [cur.customer_id, req.sid]));
      if (!customer) throw new HttpError(404, 'Client introuvable');
      if (req.body.amount > Number(customer.balance) + 0.009) {
        throw new HttpError(409, `Montant supérieur à la dette actuelle du client (${customer.balance}) : la créance est peut-être déjà réglée.`);
      }
    }
    await c.query(
      `INSERT INTO invoice_payments(invoice_id, station_id, amount, method, reference, created_by, account_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, req.sid, req.body.amount, req.body.method, req.body.reference || null, req.user.id, pm.account_id || null]
    );
    const paid = Number(cur.amount_paid) + req.body.amount;
    const status = paid >= Number(cur.total_ttc) - 0.009 ? 'payee' : 'partielle';
    await c.query(
      `UPDATE invoices SET amount_paid=$2, status=$3, updated_at=now() WHERE id=$1 AND station_id=$4`,
      [id, Math.round(paid * 100) / 100, status, req.sid]
    );
    const { rows: [sh] } = await c.query("SELECT id FROM shifts WHERE station_id = $1 AND status = 'ouvert'", [req.sid]);
    await settle(c, { station: req.sid, method: req.body.method, amount: req.body.amount, label: 'Paiement facture ' + cur.invoice_no,
      ref: ['invoices', id], shift: sh?.id, by: req.user.id, event_type: 'PAIEMENT_CLIENT', customer_id: cur.customer_id || null });
    if (customer) {
      await c.query('UPDATE customers SET balance = balance - $2 WHERE id=$1 AND station_id=$3', [customer.id, req.body.amount, req.sid]);
      await ledger(c, { customer: customer.id, station: req.sid, kind: 'paiement', amount: -req.body.amount, ref: ['invoices', id], by: req.user.id });
    }
    await audit(c, req, 'facturation', `Paiement ${req.body.amount} sur ${cur.invoice_no}`, 'invoices', id);
    return loadInvoice(c, id, req.sid);
  });
  res.json(inv);
}));

r.post('/invoices/:id/cancel', need(...EDIT), body(z.object({
  reason: z.string().min(3).max(500)
})), wrap(async (req, res) => {
  await assertBilling(req);
  const id = +req.params.id;
  const inv = await tx(async c => {
    const cur = await loadInvoice(c, id, req.sid);
    if (cur.status === 'annulee') throw new HttpError(409, 'Déjà annulée.');
    if (cur.status === 'payee') throw new HttpError(409, 'Impossible d’annuler une facture payée.');
    if (Number(cur.amount_paid) > 0) throw new HttpError(409, 'Des paiements existent : annulation refusée.');
    // Facture libre émise : on défait ce que l'émission a fait (ventes liées, stock, créance du client)
    if (cur.source === 'libre' && ['emise', 'partielle'].includes(cur.status)) {
      for (const sid of [cur.sale_id, cur.fuel_sale_id].filter(Boolean)) {
        const { rows: [sa] } = await c.query(`SELECT sa.id, sa.kind, sa.status, sa.shift_id, sh.status AS shift_status FROM sales sa JOIN shifts sh ON sh.id = sa.shift_id WHERE sa.id = $1 AND sa.station_id = $2 FOR UPDATE OF sa`, [sid, req.sid]);
        if (sa && sa.status === 'valide') {
          if (sa.shift_status !== 'ouvert') throw new HttpError(409, 'Quart clôturé : la vente liée à cette facture est verrouillée, l’annulation est impossible.');
          await c.query("UPDATE sales SET status = 'annule', cancelled_by = $2, cancel_reason = $3 WHERE id = $1 AND station_id = $4", [sa.id, req.user.id, 'Annulation facture ' + cur.invoice_no, req.sid]);
          if (sa.kind === 'produits') {
            const { rows: det } = await c.query('SELECT product_id, quantity FROM sale_details WHERE sale_id = $1', [sa.id]);
            for (const d of det) await stockMove(c, { station: req.sid, product: d.product_id, kind: 'retour', qty: d.quantity, shift: sa.shift_id, ref: ['sales', sa.id], comment: 'Annulation facture ' + cur.invoice_no, by: req.user.id });
          }
        }
      }
      if (!cur.shift_id) {
        for (const l of cur.lines) if (l.product_id) await stockMove(c, { station: req.sid, product: Number(l.product_id), kind: 'retour', qty: Number(l.quantity), ref: ['invoices', id], comment: 'Annulation facture ' + cur.invoice_no, by: req.user.id });
      }
      await c.query('UPDATE customers SET balance = balance - $2 WHERE id = $1 AND station_id = $3', [cur.customer_id, cur.total_ttc, req.sid]);
      await ledger(c, { customer: cur.customer_id, station: req.sid, kind: 'annulation', amount: -Number(cur.total_ttc), ref: ['invoices', id], by: req.user.id });
    }
    // Facture flotte annulée : les prises redeviennent facturables (le mois peut être refacturé).
    if (cur.source === 'fleet') await c.query('UPDATE fleet_card_events SET invoice_id = NULL WHERE invoice_id = $1 AND station_id = $2', [id, req.sid]);
    await c.query(
      `UPDATE invoices SET status='annulee', notes = COALESCE(notes,'') || $2, updated_at=now()
       WHERE id=$1 AND station_id=$3`, [id, '\n[Annulation] ' + req.body.reason, req.sid]
    );
    await audit(c, req, 'facturation', `Annulation facture ${cur.invoice_no}`, 'invoices', id, null, { reason: req.body.reason });
    return loadInvoice(c, id, req.sid);
  });
  res.json(inv);
}));

/** Créer une facture à partir d'une vente validée. */
r.post('/invoices/from-sale/:saleId', need(...EDIT), wrap(async (req, res) => {
  await assertBilling(req);
  const saleId = +req.params.saleId;
  const inv = await tx(async c => {
    const { rows: [sale] } = await c.query(
      `SELECT * FROM sales WHERE id=$1 AND station_id=$2 AND status='valide'`, [saleId, req.sid]
    );
    if (!sale) throw new HttpError(404, 'Vente validée introuvable');
    const { rows: existing } = await c.query(
      `SELECT id FROM invoices WHERE station_id=$1 AND sale_id=$2 AND status <> 'annulee'`, [req.sid, saleId]
    );
    if (existing.length) throw new HttpError(409, 'Une facture existe déjà pour cette vente.');
    // Vente carburant par carte flotte déjà portée par une facture mensuelle : pas de double facturation.
    const { rows: fleetInv } = await c.query(
      `SELECT i.invoice_no FROM fleet_card_events e JOIN invoices i ON i.id = e.invoice_id
        WHERE e.sale_id=$1 AND e.station_id=$2 AND i.status <> 'annulee' LIMIT 1`, [saleId, req.sid]
    );
    if (fleetInv.length) throw new HttpError(409, `Cette vente est déjà facturée dans la facture flotte ${fleetInv[0].invoice_no}.`);

    const { rows: details } = await c.query(
      `SELECT d.quantity, d.unit_price, d.amount, p.name AS product_name
         FROM sale_details d
         JOIN products p ON p.id = d.product_id
        WHERE d.sale_id=$1`, [saleId]
    );
    if (!details.length) throw new HttpError(400, 'Vente sans lignes.');

    const no = await nextInvoiceNo(c, req.sid);
    const total = Number(sale.total) || details.reduce((a, d) => a + Number(d.amount), 0);
    // Part vendue à crédit = seule part restant à encaisser ; le reste a déjà été encaissé à la vente (pas de double encaissement).
    const { rows: [cp] } = await c.query(
      `SELECT COALESCE(SUM(p.amount),0) AS v FROM payments p
         LEFT JOIN payment_methods pm ON pm.station_id=$2 AND pm.code=p.method
        WHERE p.sale_id=$1 AND COALESCE(pm.kind, CASE WHEN p.method='credit' THEN 'credit' ELSE 'autre' END)='credit'`, [saleId, req.sid]);
    const creditPart = Math.min(total, Number(cp.v));
    const alreadyPaid = fl(total - creditPart);
    const invStatus = creditPart <= 0.009 ? 'payee' : alreadyPaid > 0.009 ? 'partielle' : 'emise';
    const { rows: [row] } = await c.query(
      `INSERT INTO invoices(station_id, customer_id, sale_id, invoice_no, status, issued_on,
        tax_rate, total_ht, total_tax, total_ttc, amount_paid, notes, created_by)
       VALUES ($1,$2,$3,$4,$9,CURRENT_DATE,0,$5,0,$5,$6,$7,$8) RETURNING *`,
      [req.sid, sale.customer_id || null, saleId, no, total,
        alreadyPaid, `Issue de la vente ${sale.invoice_no || saleId}`, req.user.id, invStatus]
    );
    for (const d of details) {
      await c.query(
        `INSERT INTO invoice_lines(invoice_id, description, quantity, unit_price, amount)
         VALUES ($1,$2,$3,$4,$5)`,
        [row.id, d.product_name, d.quantity, d.unit_price, d.amount]
      );
    }
    await audit(c, req, 'facturation', `Facture ${no} depuis vente ${saleId}`, 'invoices', row.id);
    return loadInvoice(c, row.id, req.sid);
  });
  res.status(201).json(inv);
}));

/** Rendu PDF d'une facture client (partagé avec l'archivage mensuel : src/monthly_archive.js). */
async function buildInvoicePdf(b, inv) {
  const head = ['Désignation', 'Qté', 'P.U.', 'Montant'];
  const rows = inv.lines.map(l => [l.description, Number(l.quantity), Number(l.unit_price), Number(l.amount)]);
  return docs.buildPdf({
    b,
    title: 'FACTURE',
    subtitle: `${inv.invoice_no} — ${inv.status.toUpperCase()}` +
      (inv.customer_name ? ` — ${inv.customer_name}` : '') +
      (inv.attribution === 'quart' ? ` — Quart n°${inv.shift_number}${inv.employee_name ? ' · ' + inv.employee_name : ''}` : '') +
      (inv.attribution === 'commanditaire' ? ` — Hors quart · commanditaire : ${inv.ordered_by_login || ''}` : '') +
      (inv.pump_name ? ` — Pompe ${inv.pump_name}` : ''),
    ref: inv.invoice_no,
    sections: [
      { type: 'table', title: 'Lignes', head, rows, sumCols: [3] },
      {
        type: 'table',
        title: 'Totaux',
        head: ['Libellé', 'Montant'],
        rows: [
          ['Total HT', Number(inv.total_ht)],
          ['Taxe (' + inv.tax_rate + ' %)', Number(inv.total_tax)],
          ['Total TTC', Number(inv.total_ttc)],
          ['Payé', Number(inv.amount_paid)],
          ['Reste', Number(inv.total_ttc) - Number(inv.amount_paid)]
        ],
        sumCols: []
      }
    ],
    signatures: [{ label: 'Client' }, { label: 'Station' }]
  });
}

r.get('/invoices/:id/pdf', need(...VIEW), wrap(async (req, res) => {
  await assertBilling(req);
  const inv = await loadInvoice(pool, +req.params.id, req.sid);
  const b = await docs.branding(req.sid);
  docs.send(res, 'pdf', await buildInvoicePdf(b, inv), inv.invoice_no);
}));

module.exports = r;
module.exports.buildInvoicePdf = buildInvoicePdf;
module.exports.assertBilling = assertBilling;
module.exports.nextInvoiceNo = nextInvoiceNo;
