// Saisie des ventes de carburant pendant le quart : par index de compteur, en litres ou en montant.
// Ces ventes sont des DÉCLARATIONS contrôlées à la clôture contre les compteurs (aucun mouvement de stock ici : le stock carburant sort à la clôture).
const express = require('express');
const { z } = require('zod');
const { pool, tx, fl, f3, HttpError, wrap, body, need, audit, cashMove, defaultReg, payMethod, assertLinkedMethod, accountMove, ledger, setting, recordFinancialEvent } = require('./core');
const { resolveFuelSaleEmployee, SaleAttributionError } = require('./shift_sales_check');
const { fleetCheck, fleetRecordUse, fleetGuard } = require('./fleet');
const { resolveOfflineSale } = require('./offline_sale_logic');
const r = express.Router();

const sameId = (a, b) => (a == null ? null : Number(a)) === (b == null ? null : Number(b));
const sameMoney = (a, b) => Math.abs(Number(a || 0) - Number(b || 0)) < 0.005;
function samePayments(a, b) {
  const norm = xs => xs.map(x => ({ method: String(x.method), amount: Number(x.amount), reference: x.reference || null }))
    .sort((x, y) => `${x.method}|${x.reference || ''}|${x.amount}`.localeCompare(`${y.method}|${y.reference || ''}|${y.amount}`));
  const aa = norm(a), bb = norm(b);
  return aa.length === bb.length && aa.every((x, i) => x.method === bb[i].method && x.reference === bb[i].reference && sameMoney(x.amount, bb[i].amount));
}

async function expected(c, shiftId, counterId) {
  const { rows: [m] } = await c.query('SELECT index_start FROM meter_readings WHERE shift_id = $1 AND counter_id = $2', [shiftId, counterId]);
  if (!m) return null;
  const { rows: [l] } = await c.query("SELECT MAX(d.index_new) AS i FROM sale_details d JOIN sales sa ON sa.id = d.sale_id WHERE sa.shift_id = $1 AND d.counter_id = $2 AND sa.status = 'valide'", [shiftId, counterId]);
  return l.i ?? m.index_start;
}

// Aide à la saisie : ancien index attendu, produit et prix applicable
r.get('/sales/fuel/expected', need('sale.create'), wrap(async (req, res) => {
  const { rows: [sh] } = await pool.query("SELECT id FROM shifts WHERE station_id = $1 AND status = 'ouvert'", [req.sid]);
  if (!sh) throw new HttpError(409, 'Aucun quart ouvert');
  const { rows: [k] } = await pool.query('SELECT m.counter_id, p.name AS product, p.sell_price AS price, pu.name AS pump FROM meter_readings m JOIN products p ON p.id = m.product_id JOIN pumps pu ON pu.id = m.pump_id WHERE m.shift_id = $1 AND m.counter_id = $2', [sh.id, +req.query.counter_id]);
  if (!k) throw new HttpError(404, "Ce compteur n'est pas relevé dans le quart ouvert");
  res.json({ ...k, expected_old_index: await expected(pool, sh.id, k.counter_id), amount_entry_allowed: await setting(pool, req.sid, 'fuel_amount_entry_allowed', true) });
}));

const schema = z.object({
  mode: z.enum(['index', 'litres', 'montant']), counter_id: z.number().int(),
  index_old: z.number().min(0).optional(), index_new: z.number().min(0).optional(), liters: z.number().positive().optional(), amount: z.number().positive().optional(),
  payments: z.array(z.object({ method: z.string().min(1), amount: z.number().positive(), reference: z.string().optional() })).optional(),
  customer_id: z.number().int().optional(), employee_id: z.number().int().optional(), confirm: z.boolean().default(false),
  client_ref: z.string().trim().min(1).max(128).optional().nullable(),
  // Vente saisie hors ligne (CORR-043) : heure réelle sur l'appareil, contrôlée par resolveOfflineSale.
  offline_at: z.string().datetime({ offset: true }).optional(),
  // Carte flotte (CORR-040) : plafonds et restrictions contrôlés dans la transaction ; vente facturée au titulaire de la carte (crédit).
  fleet_card: z.object({ number: z.string().trim().min(1).max(40), pin: z.string().max(12).optional(), odometer_km: z.number().min(0).optional() }).optional(),
});

r.post('/sales/fuel', need('sale.create'), body(schema), wrap(async (req, res) => {
  const b = req.body;
  const clientRef = b.client_ref || null;
  const out = await fleetGuard(tx(async c => {
    // Même clé de reprise pour la vente carburant : une répétition ne doit jamais doubler les paiements.
    if (clientRef) {
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [`station:${req.sid}`, `sale:${clientRef}`]);
      const { rows: [prior] } = await c.query('SELECT * FROM sales WHERE station_id = $1 AND client_ref = $2', [req.sid, clientRef]);
      if (prior) {
        const [{ rows: [detail] }, { rows: paymentRows }] = await Promise.all([
          c.query('SELECT product_id, quantity, counter_id, index_old, index_new, unit_price FROM sale_details WHERE sale_id = $1 LIMIT 1', [prior.id]),
          c.query('SELECT method, amount, reference FROM payments WHERE sale_id = $1 ORDER BY method', [prior.id]),
        ]);
        const sameMode = prior.kind === 'carburant' && prior.input_mode === b.mode && sameId(prior.customer_id, b.customer_id) &&
          detail && sameId(detail.counter_id, b.counter_id) &&
          (b.mode === 'index' ? sameMoney(detail.index_new, b.index_new) && (b.index_old == null || sameMoney(detail.index_old, b.index_old)) :
           b.mode === 'litres' ? sameMoney(detail.quantity, b.liters) : sameMoney(prior.total, b.amount));
        const requestedPayments = b.payments?.length ? b.payments : [{ method: 'especes', amount: Number(prior.total) }];
        if (!sameMode || !samePayments(paymentRows, requestedPayments))
          throw new HttpError(409, 'Cette référence de requête est déjà utilisée pour une autre vente carburant. Générez une nouvelle référence.');
        return { ...prior, _idempotent_replay: true };
      }
    }
    const { rows: [sh] } = await c.query("SELECT * FROM shifts WHERE station_id = $1 AND status = 'ouvert' FOR SHARE", [req.sid]);
    if (!sh) throw new HttpError(409, 'Aucun quart ouvert : impossible de vendre');
    // Alignement sold_at sur la date du quart si celui-ci est antérieur (exports / périodes).
    const opened = sh.opened_at ? new Date(sh.opened_at) : null;
    const today = new Date().toISOString().slice(0, 10);
    const shiftDay = opened ? opened.toISOString().slice(0, 10) : (sh.shift_date ? String(sh.shift_date).slice(0, 10) : today);
    let soldAt = (shiftDay < today && opened && !Number.isNaN(opened.getTime())) ? opened.toISOString() : null;
    if (b.offline_at) {
      const off = resolveOfflineSale({ offlineAt: b.offline_at, nowMs: Date.now(), shiftOpenedAt: sh.opened_at });
      if (!off.ok) throw new HttpError(409, off.reason, { offline_rejected: true });
      soldAt = off.soldAt;
    }
    const { rows: [k] } = await c.query(
      `SELECT m.product_id, m.pump_id, pu.name AS pump_name, p.sell_price, p.buy_price, p.name FROM meter_readings m JOIN products p ON p.id = m.product_id
        JOIN pumps pu ON pu.id = m.pump_id WHERE m.shift_id = $1 AND m.counter_id = $2 AND pu.station_id = $3`, [sh.id, b.counter_id, req.sid]);
    if (!k) throw new HttpError(400, "Compteur inconnu ou non relevé à l'ouverture du quart");
    // Employé : la POMPE affectée à l'ouverture du quart fait foi (un employé ne peut pas vendre au nom d'un autre sur sa pompe).
    // Pompe sans responsable : repli historique sur l'employé demandé, puis sur l'employé lié à l'utilisateur connecté.
    const { rows: ownerRows } = await c.query(
      `SELECT se.employee_id FROM shift_employees se WHERE se.shift_id = $1 AND se.pump_id = $2
       UNION SELECT sep.employee_id FROM shift_employee_pumps sep WHERE sep.shift_id = $1 AND sep.pump_id = $2`, [sh.id, k.pump_id]);
    const { rows: [userEmp] } = await c.query('SELECT id FROM employees WHERE user_id = $1 AND station_id = $2 AND deleted_at IS NULL', [req.user.id, req.sid]);
    const nameIds = [...new Set([...ownerRows.map(x => Number(x.employee_id)), ...(b.employee_id ? [Number(b.employee_id)] : [])])];
    const { rows: nameRows } = nameIds.length ? await c.query(
      `SELECT id, TRIM(COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')) AS name FROM employees WHERE id = ANY($1) AND station_id = $2`, [nameIds, req.sid]) : { rows: [] };
    let emp;
    try {
      emp = resolveFuelSaleEmployee({ owners: ownerRows.map(x => x.employee_id), bodyEmpId: b.employee_id, userEmpId: userEmp?.id, pumpName: k.pump_name, names: new Map(nameRows.map(x => [Number(x.id), x.name])) });
    } catch (e) { if (e instanceof SaleAttributionError) throw new HttpError(e.status, e.message); throw e; }
    if (!emp || !(await c.query('SELECT 1 FROM employees WHERE id = $1 AND station_id = $2 AND deleted_at IS NULL', [emp, req.sid])).rowCount)
      throw new HttpError(400, 'Employé requis pour enregistrer la vente');

    // Vérifier que l'employé est bien affecté à cette pompe sur le quart (si des affectations existent)
    const { rows: assigned } = await c.query(
      `SELECT 1 FROM shift_employees WHERE shift_id = $1 AND employee_id = $2 AND (pump_id IS NULL OR pump_id = $3)
       UNION
       SELECT 1 FROM shift_employee_pumps WHERE shift_id = $1 AND employee_id = $2 AND pump_id = $3
       LIMIT 1`,
      [sh.id, emp, k.pump_id]
    );
    const { rowCount: onShift } = await c.query(
      `SELECT 1 FROM shift_employees WHERE shift_id = $1 AND employee_id = $2`, [sh.id, emp]
    );
    if (onShift && !assigned.length) {
      // Affectations présentes pour d'autres pompes uniquement
      const { rowCount: hasAnyPump } = await c.query(
        `SELECT 1 FROM shift_employees WHERE shift_id = $1 AND pump_id IS NOT NULL
         UNION SELECT 1 FROM shift_employee_pumps WHERE shift_id = $1 LIMIT 1`, [sh.id]
      );
      if (hasAnyPump)
        throw new HttpError(409, 'Cet employé n’est pas affecté à la pompe sélectionnée pour ce quart.');
    }

    const price = k.sell_price, warnings = []; let liters, amount, io = null, inw = null;
    const exp = await expected(c, sh.id, b.counter_id);
    if (b.mode === 'index') {
      if (b.index_new == null) throw new HttpError(400, 'Le nouvel index est obligatoire');
      io = b.index_old ?? exp; inw = b.index_new;
      if (inw <= io) throw new HttpError(400, "Le nouvel index doit être supérieur à l'ancien index");
      if (Math.abs(io - exp) > 0.0005) warnings.push(`L'ancien index saisi (${io}) diffère du dernier index connu (${exp})`);
      liters = f3(inw - io); amount = fl(liters * price);
    } else if (b.mode === 'litres') {
      if (!b.liters) throw new HttpError(400, 'La quantité en litres est obligatoire');
      liters = f3(b.liters); amount = fl(liters * price);
      // Progression d'index théorique liée au compteur / pompe (comme mode index)
      io = exp; inw = f3(exp + liters);
    } else {
      if (!(await setting(c, req.sid, 'fuel_amount_entry_allowed', true))) throw new HttpError(403, 'La saisie par chiffre d\'affaires est désactivée dans les paramètres');
      if (!b.amount) throw new HttpError(400, 'Le montant est obligatoire');
      amount = fl(b.amount); liters = f3(amount / price);
      const back = fl(liters * price);
      if (Math.abs(back - amount) > 0.25) warnings.push(`Arrondi : ${amount} correspond à ${liters} L × ${price} = ${back}`);
      io = exp; inw = f3(exp + liters);
    }
    // Pas de stock, pas de vente : le stock carburant ne sort qu'à la clôture du quart, on retranche donc
    // les litres déjà déclarés pendant ce quart pour le même produit avant de comparer au stock en cuve.
    const { rows: [fst] } = await c.query('SELECT quantity FROM stock WHERE product_id = $1 AND station_id = $2 FOR UPDATE', [k.product_id, req.sid]);
    const { rows: [dcl] } = await c.query(
      "SELECT COALESCE(SUM(d.quantity), 0) AS liters FROM sale_details d JOIN sales sa ON sa.id = d.sale_id WHERE sa.shift_id = $1 AND sa.kind = 'carburant' AND sa.status = 'valide' AND d.product_id = $2", [sh.id, k.product_id]);
    const available = f3(Number(fst?.quantity || 0) - Number(dcl.liters || 0));
    if (liters > available + 0.0005)
      throw new HttpError(409, `Stock insuffisant : ${k.name} (disponible ${Math.max(available, 0)} L, demandé ${liters} L). Enregistrez d'abord une réception de carburant.`);
    if (liters > 1000) warnings.push(`Volume inhabituel pour une seule vente : ${liters} L`);
    // Carte flotte : contrôlée AVANT la demande de confirmation ; le client et le moyen de paiement (crédit) découlent de la carte.
    let fleet = null;
    if (b.fleet_card) {
      fleet = await fleetCheck(c, { sid: req.sid, number: b.fleet_card.number, pin: b.fleet_card.pin, productId: k.product_id, liters, amount, odometer: b.fleet_card.odometer_km, userId: req.user.id });
      if (b.customer_id && Number(b.customer_id) !== Number(fleet.card.customer_id)) throw new HttpError(400, 'Le client choisi ne correspond pas au titulaire de la carte');
      b.customer_id = fleet.card.customer_id;
    }
    if (warnings.length && !b.confirm) throw new HttpError(409, 'Confirmation requise', warnings);

    const pays = fleet ? [{ method: fleet.creditMethod, amount }] : b.payments?.length ? b.payments : [{ method: 'especes', amount }];
    const paid = fl(pays.reduce((a, x) => a + x.amount, 0));
    if (paid !== amount) throw new HttpError(400, `Le total des paiements (${paid}) doit égaler le montant de la vente (${amount})`);
    const { rows: [sale] } = await c.query(
      `INSERT INTO sales(station_id, shift_id, employee_id, pump_id, customer_id, total, kind, input_mode, client_ref, sold_at)
       VALUES ($1,$2,$3,$4,$5,$6,'carburant',$7,$8,COALESCE($9::timestamptz, now())) RETURNING id, sold_at`,
      [req.sid, sh.id, emp, k.pump_id, b.customer_id || null, amount, b.mode, clientRef, soldAt]);
    await c.query('INSERT INTO sale_details(sale_id, product_id, quantity, unit_price, unit_cost, amount, counter_id, index_old, index_new) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [sale.id, k.product_id, liters, price, k.buy_price, amount, b.counter_id, io, inw]);
    for (const p of pays) {
      const pm = await payMethod(c, req.sid, p.method);
      if (pm.kind === 'credit') {
        // Dette client : réservée à ceux qui en ont la permission (administrateur local, gérant, ou employé autorisé)
        if (!fleet && !req.user.perms.has('sale.credit')) throw new HttpError(403, "Vente à crédit non autorisée : la permission « Vendre à crédit » doit être accordée par le gérant ou l'administrateur local.");
        if (!b.customer_id) throw new HttpError(400, 'Client requis pour une vente à crédit');
        const { rows: [cu] } = await c.query('SELECT * FROM customers WHERE id = $1 AND station_id = $2 FOR UPDATE', [b.customer_id, req.sid]);
        if (!cu) throw new HttpError(400, 'Client inconnu');
        if (cu.credit_blocked) throw new HttpError(409, 'Crédit bloqué pour ' + cu.name);
        if (cu.credit_limit > 0 && Number(cu.balance) + p.amount > Number(cu.credit_limit)) throw new HttpError(409, 'Limite de crédit dépassée pour ' + cu.name);
        await c.query('UPDATE customers SET balance = balance + $2 WHERE id = $1 AND station_id = $3', [cu.id, p.amount, req.sid]);
        await ledger(c, { customer: cu.id, station: req.sid, kind: 'credit', amount: p.amount, ref: ['sales', sale.id], by: req.user.id });
      } else if (pm.kind === 'especes') {
        await cashMove(c, { reg: await defaultReg(c, req.sid), shift: sh.id, kind: 'encaissement', amount: p.amount, label: 'Vente carburant N° ' + sale.id, ref: ['sales', sale.id], by: req.user.id });
      } else {
        await assertLinkedMethod(c, req.sid, p.method);
        const accId = await accountMove(c, { station: req.sid, method: p.method, amount: p.amount, label: 'Vente carburant N° ' + sale.id, ref: ['sales', sale.id], shift: sh.id, by: req.user.id });
        if (accId == null) throw new HttpError(409, 'Aucun compte rattaché au moyen de paiement « ' + p.method + ' ».');
      }
      await c.query(
        `INSERT INTO payments(station_id, sale_id, shift_id, method, amount, reference, created_by, paid_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8::timestamptz, now()))`,
        [req.sid, sale.id, sh.id, p.method, p.amount, p.reference || null, req.user.id, soldAt]);
      try {
        await recordFinancialEvent(c, {
          station: req.sid, event_type: 'VENTE',
          direction: 'in', amount: Math.abs(p.amount),
          label: 'Vente carburant N° ' + sale.id, method: p.method,
          shift: sh.id, customer_id: b.customer_id || null,
          ref: ['sales', sale.id], by: req.user.id
        });
      } catch (e) { if (e.code !== '42P01') throw e; }
    }
    if (fleet) await fleetRecordUse(c, fleet, { saleId: sale.id, productId: k.product_id, liters, amount, odometer: b.fleet_card.odometer_km, userId: req.user.id });
    const { rows: [done] } = await c.query('UPDATE sales SET invoice_no = $2 WHERE id = $1 AND station_id = $3 RETURNING *', [sale.id, `${req.sid}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${sale.id}`, req.sid]);
    await audit(c, req, 'ventes', `Vente carburant N° ${sale.id} (${b.mode}) : ${liters} L`, 'sales', sale.id, null, { mode: b.mode, litres: liters, montant: amount, avertissements: warnings });
    return { ...done, liters, amount, warnings, ...(fleet ? { fleet_card: { id: fleet.card.id, label: fleet.card.label, remaining: fleet.evaluation.remaining } } : {}) };
  }));
  const replay = Boolean(out?._idempotent_replay);
  if (replay) delete out._idempotent_replay;
  if (!replay) await require('./employee_actions').afterSale(req, out.id);
  res.status(replay ? 200 : 201).json(out);
}));

module.exports = r;
