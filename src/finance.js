// Finance : comptes bancaires et mobile money, moyens de paiement, situation financière de la station, contrôles de cohérence, validations, exports PDF / Excel.
const express = require('express');
const { swallow } = require('./safe');
const { z } = require('zod');
const { pool, tx, fl, f3, HttpError, wrap, body, need, audit, cashMove, defaultReg, recordFinancialEvent, settle } = require('./core');
const { getSetting } = require('./admin');
const docs = require('./docs');
const { individualMessage } = require('./shift_message');
const r = express.Router();
const VIEW = ['finance.report', 'money.manage', 'finance.view'];
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const today = () => iso(new Date());
const num = x => (x == null ? 0 : +x);
// PostgreSQL refuse un paramètre dont le type ne peut pas être déduit : les paramètres non référencés par une requête sont consommés dans une CTE inutilisée
const pq = (sql, params) => {
  const miss = []; for (let k = 1; k <= params.length; k++) if (!new RegExp('\\$' + k + '(?!\\d)').test(sql)) miss.push(`$${k}::text AS u${k}`);
  return pool.query(miss.length ? `WITH _u AS (SELECT ${miss.join(', ')}) ${sql}` : sql, params).then(x => x.rows);
};

// ---------- Comptes bancaires / mobile money ----------
const ACC = `SELECT a.id, a.kind, a.name, a.provider, a.account_ref, a.opening_balance, to_char(a.opening_date,'YYYY-MM-DD') AS opening_date, a.active,
   a.opening_balance + COALESCE((SELECT SUM(m.amount) FROM money_movements m WHERE m.account_id = a.id), 0) AS balance FROM money_accounts a`;
r.get('/money/accounts', need(...VIEW), wrap(async (req, res) => res.json((await pool.query(`${ACC} WHERE a.station_id = $1 ORDER BY a.kind, a.name`, [req.sid])).rows)));
r.post('/money/accounts', need('money.manage'), body(z.object({ kind: z.enum(['banque', 'mobile_money']), name: z.string().min(2), provider: z.string().optional(), account_ref: z.string().optional(), opening_balance: z.number().default(0), opening_date: ymd.optional() })), wrap(async (req, res) => {
  const b = req.body;
  const { rows: [a] } = await pool.query('INSERT INTO money_accounts(station_id, kind, name, provider, account_ref, opening_balance, opening_date) VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7::date, CURRENT_DATE)) RETURNING id', [req.sid, b.kind, b.name, b.provider || null, b.account_ref || null, b.opening_balance, b.opening_date || null]);
  await audit(pool, req, 'finance', 'Création du compte ' + b.name, 'money_accounts', a.id, null, b);
  res.status(201).json(a);
}));
const SIGN = { encaissement: 1, depot: 1, virement_recu: 1, remboursement: 1, transfert_entrant: 1, virement_emis: -1, frais: -1, retrait: -1, transfert_sortant: -1 };
r.post('/money/movements', need('money.manage'), body(z.object({ account_id: z.number().int(), kind: z.enum(['encaissement', 'depot', 'virement_recu', 'virement_emis', 'frais', 'retrait', 'remboursement', 'transfert_entrant', 'transfert_sortant', 'autre']), direction: z.enum(['entree', 'sortie']).optional(), amount: z.number().positive(), label: z.string().min(2), reference: z.string().optional(), moved_on: ymd.optional() })), wrap(async (req, res) => {
  const b = req.body, sign = SIGN[b.kind] ?? (b.direction === 'sortie' ? -1 : b.direction === 'entree' ? 1 : 0);
  if (!sign) throw new HttpError(400, "Indiquez la direction (entree ou sortie) pour un mouvement « autre »");
  const { rows: [a] } = await pool.query('SELECT id FROM money_accounts WHERE id = $1 AND station_id = $2', [b.account_id, req.sid]);
  if (!a) throw new HttpError(400, 'Compte inconnu');
  const { rows: [m] } = await pool.query('INSERT INTO money_movements(account_id, station_id, kind, amount, label, reference, moved_on, created_by) VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7::date, CURRENT_DATE),$8) RETURNING id', [b.account_id, req.sid, b.kind, sign * b.amount, b.label, b.reference || null, b.moved_on || null, req.user.id]);
  await audit(pool, req, 'finance', `${b.kind} ${sign * b.amount} sur le compte ${b.account_id}`, 'money_movements', m.id, null, b);
  res.status(201).json(m);
}));
// Remise en banque : sortie de caisse et entrée sur le compte, dans une seule transaction
r.post('/money/deposit', need('money.manage'), body(z.object({ account_id: z.number().int(), amount: z.number().positive(), label: z.string().default('Remise en banque') })), wrap(async (req, res) => {
  const b = req.body;
  await tx(async c => {
    const { rows: [a] } = await c.query('SELECT id FROM money_accounts WHERE id = $1 AND station_id = $2', [b.account_id, req.sid]);
    if (!a) throw new HttpError(400, 'Compte inconnu');
    const { rows: [sh] } = await c.query("SELECT id FROM shifts WHERE station_id = $1 AND status = 'ouvert'", [req.sid]);
    await cashMove(c, { reg: await defaultReg(c, req.sid), shift: sh?.id, kind: 'depot_bancaire', amount: -b.amount, label: b.label, by: req.user.id });
    await c.query("INSERT INTO money_movements(account_id, station_id, kind, amount, label, shift_id, created_by) VALUES ($1,$2,'depot',$3,$4,$5,$6)", [b.account_id, req.sid, b.amount, b.label, sh?.id || null, req.user.id]);
    await audit(c, req, 'finance', `Remise en banque de ${b.amount}`, 'money_accounts', b.account_id, null, b);
  });
  res.status(201).json({ ok: true });
}));

// P3 — Transfert atomique entre deux comptes banque / mobile money (liquidités globales inchangées)
r.post('/money/transfer', need('money.manage'), body(z.object({
  from_account_id: z.number().int(),
  to_account_id: z.number().int(),
  amount: z.number().positive(),
  label: z.string().min(2).default('Transfert interne'),
  moved_on: ymd.optional(),
})), wrap(async (req, res) => {
  const b = req.body;
  if (b.from_account_id === b.to_account_id) throw new HttpError(400, 'Les comptes source et destination doivent être distincts');
  const out = await tx(async c => {
    const { rows: accs } = await c.query(
      'SELECT id, name FROM money_accounts WHERE station_id = $1 AND active AND id = ANY($2::bigint[])',
      [req.sid, [b.from_account_id, b.to_account_id]]);
    if (accs.length !== 2) throw new HttpError(400, 'Compte source ou destination inconnu / inactif');
    const fromName = accs.find(a => a.id === b.from_account_id)?.name || String(b.from_account_id);
    const toName = accs.find(a => a.id === b.to_account_id)?.name || String(b.to_account_id);
    const { rows: [sh] } = await c.query("SELECT id FROM shifts WHERE station_id = $1 AND status = 'ouvert'", [req.sid]);
    const movedOn = b.moved_on || null;
    const labelOut = `${b.label} → ${toName}`;
    const labelIn = `${b.label} ← ${fromName}`;
    const { rows: [mOut] } = await c.query(
      `INSERT INTO money_movements(account_id, station_id, kind, amount, label, moved_on, shift_id, created_by)
       VALUES ($1,$2,'transfert_sortant',$3,$4,COALESCE($5::date, CURRENT_DATE),$6,$7) RETURNING id`,
      [b.from_account_id, req.sid, -b.amount, labelOut, movedOn, sh?.id || null, req.user.id]);
    const { rows: [mIn] } = await c.query(
      `INSERT INTO money_movements(account_id, station_id, kind, amount, label, moved_on, shift_id, created_by, reference)
       VALUES ($1,$2,'transfert_entrant',$3,$4,COALESCE($5::date, CURRENT_DATE),$6,$7,$8) RETURNING id`,
      [b.to_account_id, req.sid, b.amount, labelIn, movedOn, sh?.id || null, req.user.id, 'xfer:' + mOut.id]);
    await c.query('UPDATE money_movements SET reference = $2 WHERE id = $1 AND station_id = $3', [mOut.id, 'xfer:' + mIn.id, req.sid]);
    try {
      await recordFinancialEvent(c, {
        station: req.sid, event_type: 'TRANSFERT', direction: 'neutral', amount: b.amount,
        label: b.label, account_id: b.from_account_id, shift: sh?.id,
        ref: ['money_movements', mOut.id], by: req.user.id,
        meta: { from: b.from_account_id, to: b.to_account_id, m_out: mOut.id, m_in: mIn.id }
      });
    } catch (e) { if (e.code !== '42P01') throw e; }
    await audit(c, req, 'finance', `Transfert ${b.amount} de ${fromName} vers ${toName}`, 'money_accounts', b.from_account_id, null, b);
    return { out_id: mOut.id, in_id: mIn.id };
  });
  res.status(201).json({ ok: true, ...out });
}));

// P7 — Contrôle d'intégrité soldes caisse vs historique des mouvements
r.get('/finance/integrity/cash', need('finance.view', 'money.manage'), wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT r.id, r.name, r.balance AS stored_balance,
            COALESCE((SELECT SUM(m.amount) FROM cash_movements m WHERE m.cash_register_id = r.id), 0) AS movements_sum,
            r.balance - COALESCE((SELECT SUM(m.amount) FROM cash_movements m WHERE m.cash_register_id = r.id), 0) AS gap
     FROM cash_registers r
     WHERE r.station_id = $1 AND r.active
     ORDER BY r.id`, [req.sid]);
  const issues = rows.filter(x => Math.abs(Number(x.gap)) > 0.01);
  res.json({
    ok: issues.length === 0,
    registers: rows,
    issues,
    note: 'gap = stored_balance - SUM(cash_movements). Un écart non nul indique une désynchronisation (restauration partielle ou écriture hors cashMove).'
  });
}));

// Historique récent pour l'écran Finances (listes sous les comptes)
r.get('/money/recent', need(...VIEW), wrap(async (req, res) => {
  const lim = Math.min(Math.max(parseInt(req.query.limit, 10) || 15, 1), 50);
  const s = req.sid;
  const [statements, deposits, transfers, movements] = await Promise.all([
    pool.query(
      `SELECT s.id, to_char(s.statement_date,'YYYY-MM-DD') AS statement_date, s.balance, s.note,
              a.name AS account_name, a.kind AS account_kind,
              to_char(s.created_at,'YYYY-MM-DD HH24:MI') AS created_at, u.login
       FROM bank_statements s
       JOIN money_accounts a ON a.id = s.account_id
       LEFT JOIN users u ON u.id = s.created_by
       WHERE a.station_id = $1
       ORDER BY s.statement_date DESC, s.id DESC LIMIT $2`, [s, lim]),
    pool.query(
      `SELECT m.id, to_char(m.moved_on,'YYYY-MM-DD') AS moved_on, m.amount, m.label, m.reference,
              a.name AS account_name, to_char(m.created_at,'YYYY-MM-DD HH24:MI') AS created_at, u.login
       FROM money_movements m
       JOIN money_accounts a ON a.id = m.account_id
       LEFT JOIN users u ON u.id = m.created_by
       WHERE m.station_id = $1 AND m.kind = 'depot'
       ORDER BY m.created_at DESC, m.id DESC LIMIT $2`, [s, lim]),
    pool.query(
      `SELECT m.id, to_char(m.moved_on,'YYYY-MM-DD') AS moved_on, m.kind, m.amount, m.label, m.reference,
              a.name AS account_name, to_char(m.created_at,'YYYY-MM-DD HH24:MI') AS created_at, u.login
       FROM money_movements m
       JOIN money_accounts a ON a.id = m.account_id
       LEFT JOIN users u ON u.id = m.created_by
       WHERE m.station_id = $1 AND m.kind IN ('transfert_sortant','transfert_entrant')
       ORDER BY m.created_at DESC, m.id DESC LIMIT $2`, [s, lim]),
    pool.query(
      `SELECT m.id, to_char(m.moved_on,'YYYY-MM-DD') AS moved_on, m.kind, m.amount, m.label, m.reference,
              a.name AS account_name, to_char(m.created_at,'YYYY-MM-DD HH24:MI') AS created_at, u.login
       FROM money_movements m
       JOIN money_accounts a ON a.id = m.account_id
       LEFT JOIN users u ON u.id = m.created_by
       WHERE m.station_id = $1
       ORDER BY m.created_at DESC, m.id DESC LIMIT $2`, [s, lim])
  ]);
  res.json({
    statements: statements.rows,
    deposits: deposits.rows,
    transfers: transfers.rows,
    movements: movements.rows
  });
}));

r.get('/money/accounts/:id/movements', need(...VIEW), wrap(async (req, res) => {
  const { rows } = await pool.query("SELECT m.id, to_char(m.moved_on,'YYYY-MM-DD') AS moved_on, m.kind, m.amount, m.label, m.reference, u.login FROM money_movements m LEFT JOIN users u ON u.id = m.created_by WHERE m.account_id = $1 AND m.station_id = $2 ORDER BY m.moved_on DESC, m.id DESC LIMIT 200", [req.params.id, req.sid]);
  res.json(rows);
}));
r.post('/money/statements', need('money.manage'), body(z.object({ account_id: z.number().int(), statement_date: ymd, balance: z.number(), note: z.string().optional() })), wrap(async (req, res) => {
  const b = req.body;
  const { rows: [a] } = await pool.query('SELECT id FROM money_accounts WHERE id = $1 AND station_id = $2', [b.account_id, req.sid]);
  if (!a) throw new HttpError(400, 'Compte inconnu');
  await pool.query('INSERT INTO bank_statements(account_id, statement_date, balance, note, created_by) VALUES ($1,$2,$3,$4,$5)', [b.account_id, b.statement_date, b.balance, b.note || null, req.user.id]);
  await audit(pool, req, 'finance', `Relevé du ${b.statement_date} : ${b.balance}`, 'bank_statements', b.account_id, null, b);
  res.status(201).json({ ok: true });
}));
// Moyens de paiement : rattachement à un compte, activation
r.post('/money/methods', need('money.manage'), body(z.object({ code: z.string().regex(/^[a-z0-9_]{2,30}$/), label: z.string().min(2), kind: z.enum(['especes', 'banque', 'mobile_money', 'carte', 'credit', 'autre']), account_id: z.number().int().nullable().optional() })), wrap(async (req, res) => {
  const b = req.body;
  await pool.query('INSERT INTO payment_methods(station_id, code, label, kind, account_id) VALUES ($1,$2,$3,$4,$5)', [req.sid, b.code, b.label, b.kind, b.account_id || null]);
  await audit(pool, req, 'finance', 'Moyen de paiement ajouté : ' + b.label, 'payment_methods', null, null, b);
  res.status(201).json({ ok: true });
}));
r.put('/money/methods/:code', need('money.manage'), body(z.object({ label: z.string().min(2), account_id: z.number().int().nullable(), active: z.boolean() }).partial().strict()), wrap(async (req, res) => {
  const keys = Object.keys(req.body); if (!keys.length) throw new HttpError(400, 'Aucun champ');
  if (req.body.account_id && !(await pool.query('SELECT 1 FROM money_accounts WHERE id = $1 AND station_id = $2', [req.body.account_id, req.sid])).rowCount) throw new HttpError(400, 'Compte inconnu');
  const { rows: [old] } = await pool.query('SELECT label, account_id, active FROM payment_methods WHERE station_id = $1 AND code = $2', [req.sid, req.params.code]);
  if (!old) throw new HttpError(404, 'Moyen de paiement inconnu');
  if (req.params.code === 'especes' && (req.body.active === false)) throw new HttpError(409, "Le paiement en espèces ne peut pas être désactivé");
  await pool.query(`UPDATE payment_methods SET ${keys.map((k, i) => `${k} = $${i + 3}`).join(', ')} WHERE station_id = $1 AND code = $2`, [req.sid, req.params.code, ...keys.map(k => req.body[k])]);
  await audit(pool, req, 'finance', 'Moyen de paiement modifié : ' + req.params.code, 'payment_methods', null, old, req.body);
  res.json({ ok: true });
}));

// ---------- Situation financière de la station ----------
const AGE = ['0-30 j', '31-60 j', '61-90 j', '+ de 90 j'];
async function situation(station, from, to, f = {}) {
  const Q = (sql, params = []) => pq(sql, [station, from, to, ...params]);
  const RS = 'sa.sold_at >= $2::date AND sa.sold_at < $3::date + 1', RC = 'sh.closed_at >= $2::date AND sh.closed_at < $3::date + 1';
  // filtres optionnels (ventes) : paramètres $4 et suivants
  const sx = [], mx = [], p = []; const add = v => { p.push(v); return '$' + (p.length + 3); };
  if (f.shift_id) { sx.push(`sa.shift_id = ${add(f.shift_id)}`); mx.push(`sh.id = ${p.length ? '$' + (p.length + 3) : ''}`); }
  const shiftIdx = f.shift_id ? p.length : 0;
  if (f.employee_id) sx.push(`sa.employee_id = ${add(f.employee_id)}`);
  if (f.pump_id) { sx.push(`sa.pump_id = ${add(f.pump_id)}`); mx.push(`m.pump_id = $${p.length + 3}`); }
  if (f.product_id) { sx.push(`d.product_id = ${add(f.product_id)}`); mx.push(`m.product_id = $${p.length + 3}`); }
  const pmx = f.method ? `AND p.method = ${add(f.method)}` : '';
  const S = sx.length ? ' AND ' + sx.join(' AND ') : '', M = mx.length ? ' AND ' + mx.join(' AND ') : '', noMeter = !!f.employee_id;
  const QF = (sql, extra = []) => pq(sql, [station, from, to, ...p, ...extra]);
  const notes = []; if (noMeter) notes.push("Filtre employé : seules les ventes saisies par cet employé sont comptées (les compteurs de pompes ne sont pas attribuables à un employé) ; le chiffre d'affaires peut donc être inférieur au total de la station.");
  const to1 = "($3::date + 1)";

  // ===== Ventes =====
  const prodSales = await QF(`SELECT p.name, 'Ventes saisies' AS source, SUM(d.quantity) AS qty, ROUND(AVG(d.unit_price),2) AS price, SUM(d.amount) AS amount, SUM(d.quantity * d.unit_cost) AS cost
     FROM sales sa JOIN sale_details d ON d.sale_id = sa.id JOIN products p ON p.id = d.product_id WHERE sa.station_id = $1 AND sa.kind = 'produits' AND sa.status = 'valide' AND ${RS}${S} GROUP BY p.name`);
  const fuelMeter = noMeter ? await QF(`SELECT p.name, 'Ventes saisies (carburant)' AS source, SUM(d.quantity) AS qty, ROUND(AVG(d.unit_price),2) AS price, SUM(d.amount) AS amount, SUM(d.quantity * d.unit_cost) AS cost, 0 AS nocost
     FROM sales sa JOIN sale_details d ON d.sale_id = sa.id JOIN products p ON p.id = d.product_id WHERE sa.station_id = $1 AND sa.kind = 'carburant' AND sa.status = 'valide' AND ${RS}${S} GROUP BY p.name`) : await QF(`SELECT p.name, 'Compteurs' AS source, SUM(m.liters) AS qty, ROUND(AVG(m.unit_price),2) AS price, SUM(m.amount) AS amount, SUM(m.liters * m.unit_cost) AS cost, COUNT(*) FILTER (WHERE m.unit_cost IS NULL OR m.unit_cost = 0)::int AS nocost
     FROM meter_readings m JOIN shifts sh ON sh.id = m.shift_id JOIN products p ON p.id = m.product_id WHERE sh.station_id = $1 AND sh.status = 'ferme' AND ${RC}${M} GROUP BY p.name`);
  const byPump = noMeter ? [] : await QF(`SELECT pu.name, p.name AS product, SUM(m.liters) AS liters, SUM(m.amount) AS amount FROM meter_readings m JOIN shifts sh ON sh.id = m.shift_id JOIN pumps pu ON pu.id = m.pump_id JOIN products p ON p.id = m.product_id
     WHERE sh.station_id = $1 AND sh.status = 'ferme' AND ${RC}${M} GROUP BY pu.name, pu.number, p.name ORDER BY pu.number, p.name`);
  const byEmp = await QF(`SELECT e.last_name || ' ' || e.first_name AS employee, COUNT(DISTINCT sa.id)::int AS ops, SUM(d.quantity) AS qty, SUM(d.amount) AS amount FROM sales sa JOIN sale_details d ON d.sale_id = sa.id JOIN employees e ON e.id = sa.employee_id
     WHERE sa.station_id = $1 AND sa.status = 'valide' AND ${RS}${S} GROUP BY 1 ORDER BY 4 DESC`);
  const byShift = noMeter ? [] : await QF(`SELECT sh.number, sh.kind, sh.closed_at,
       COALESCE((SELECT SUM(m.amount) FROM meter_readings m WHERE m.shift_id = sh.id${M.replace(/sh\.id = \$\d+/, 'TRUE')}), 0) AS fuel,
       COALESCE((SELECT SUM(sa.total) FROM sales sa WHERE sa.shift_id = sh.id AND sa.kind = 'produits' AND sa.status = 'valide'), 0) AS products
     FROM shifts sh WHERE sh.station_id = $1 AND sh.status = 'ferme' AND ${RC}${f.shift_id ? ` AND sh.id = $${shiftIdx + 3}` : ''} ORDER BY sh.opened_at, sh.number`);
  const byMethod = await QF(`SELECT COALESCE(pm.label, p.method) AS label, COALESCE(pm.kind, 'autre') AS kind, SUM(p.amount) AS amount FROM payments p LEFT JOIN sales sa ON sa.id = p.sale_id
     LEFT JOIN payment_methods pm ON pm.station_id = p.station_id AND pm.code = p.method WHERE p.station_id = $1 AND p.paid_at >= $2::date AND p.paid_at < ${to1} AND (sa.id IS NULL OR sa.status = 'valide') ${pmx} GROUP BY 1, 2 ORDER BY 3 DESC`);
  const [cancel] = await Q("SELECT COUNT(*)::int AS n, COALESCE(SUM(total),0) AS amount FROM sales sa WHERE sa.station_id = $1 AND sa.status = 'annule' AND sa.sold_at >= $2::date AND sa.sold_at < $3::date + 1");
  const revenueOf = async (a, b) => { const x = await pool.query(`SELECT (SELECT COALESCE(SUM(total),0) FROM sales WHERE station_id = $1 AND kind = 'produits' AND status = 'valide' AND sold_at >= $2::date AND sold_at < $3::date + 1)
      + (SELECT COALESCE(SUM(m.amount),0) FROM meter_readings m JOIN shifts sh ON sh.id = m.shift_id WHERE sh.station_id = $1 AND sh.status = 'ferme' AND sh.closed_at >= $2::date AND sh.closed_at < $3::date + 1) AS v`, [station, a, b]); return x.rows[0].v; };
  const days = Math.round((new Date(to) - new Date(from)) / 864e5) + 1, pTo = iso(new Date(new Date(from) - 864e5)), pFrom = iso(new Date(new Date(from) - days * 864e5));
  const caProducts = prodSales.reduce((a, x) => a + num(x.amount), 0), caFuel = fuelMeter.reduce((a, x) => a + num(x.amount), 0), ca = fl(caProducts + caFuel), prevCa = await revenueOf(pFrom, pTo);
  const creditSales = byMethod.filter(x => x.kind === 'credit').reduce((a, x) => a + x.amount, 0), cashIn = byMethod.filter(x => x.kind !== 'credit').reduce((a, x) => a + x.amount, 0);

  // ===== Caisses =====
  const shiftsCash = await Q(`SELECT sh.number, sh.status, sh.opened_at, sh.opening_cash,
      COALESCE((SELECT SUM(amount) FROM cash_movements m WHERE m.shift_id = sh.id AND m.amount > 0 AND m.kind NOT IN ('ouverture','ecart_cloture')),0) AS enc,
      COALESCE((SELECT -SUM(amount) FROM cash_movements m WHERE m.shift_id = sh.id AND m.amount < 0 AND m.kind NOT IN ('ouverture','ecart_cloture','depot_bancaire','retrait')),0) AS dec,
      COALESCE((SELECT SUM(e.amount) FROM expenses e WHERE e.shift_id = sh.id AND e.method = 'especes' AND e.deleted_at IS NULL),0) AS exp_cash,
      COALESCE((SELECT -SUM(amount) FROM cash_movements m WHERE m.shift_id = sh.id AND m.kind = 'depot_bancaire'),0) AS deposits,
      COALESCE((SELECT -SUM(amount) FROM cash_movements m WHERE m.shift_id = sh.id AND m.kind = 'retrait'),0) AS withdrawals,
      sh.theoretical_cash, sh.counted_cash, sh.cash_gap, sh.gap_justification
    FROM shifts sh WHERE sh.station_id = $1 AND sh.opened_at >= $2::date AND sh.opened_at < ${to1} ORDER BY sh.opened_at, sh.number`);
  const registers = await Q(`SELECT cr.name, COALESCE(SUM(m.amount) FILTER (WHERE m.created_at < $2::date),0) AS opening,
      COALESCE(SUM(m.amount) FILTER (WHERE m.created_at >= $2::date AND m.created_at < ${to1} AND m.amount > 0),0) AS inflow,
      COALESCE(-SUM(m.amount) FILTER (WHERE m.created_at >= $2::date AND m.created_at < ${to1} AND m.amount < 0),0) AS outflow,
      COALESCE(SUM(m.amount) FILTER (WHERE m.created_at < ${to1}),0) AS closing FROM cash_registers cr LEFT JOIN cash_movements m ON m.cash_register_id = cr.id WHERE cr.station_id = $1 GROUP BY cr.id, cr.name ORDER BY cr.id`);

  // ===== Banques et mobile money =====
  const accounts = await Q(`SELECT a.id, a.kind, a.name, a.provider, a.account_ref, a.opening_balance,
      a.opening_balance + COALESCE(SUM(m.amount) FILTER (WHERE m.moved_on < $2::date),0) AS start_bal,
      COALESCE(SUM(m.amount) FILTER (WHERE m.moved_on BETWEEN $2::date AND $3::date AND m.kind IN ('encaissement','depot')),0) AS deposits,
      COALESCE(SUM(m.amount) FILTER (WHERE m.moved_on BETWEEN $2::date AND $3::date AND m.kind = 'virement_recu'),0) AS transfers_in,
      COALESCE(-SUM(m.amount) FILTER (WHERE m.moved_on BETWEEN $2::date AND $3::date AND m.kind = 'virement_emis'),0) AS transfers_out,
      COALESCE(-SUM(m.amount) FILTER (WHERE m.moved_on BETWEEN $2::date AND $3::date AND m.kind = 'frais'),0) AS fees,
      COALESCE(-SUM(m.amount) FILTER (WHERE m.moved_on BETWEEN $2::date AND $3::date AND m.kind = 'retrait'),0) AS withdrawals,
      COALESCE(SUM(m.amount) FILTER (WHERE m.moved_on BETWEEN $2::date AND $3::date AND m.kind IN ('remboursement','transfert_entrant','transfert_sortant','autre')),0) AS other,
      a.opening_balance + COALESCE(SUM(m.amount) FILTER (WHERE m.moved_on <= $3::date),0) AS end_bal
    FROM money_accounts a LEFT JOIN money_movements m ON m.account_id = a.id WHERE a.station_id = $1 AND a.active GROUP BY a.id ORDER BY a.kind, a.name`);
  const stmts = await Q("SELECT DISTINCT ON (s.account_id) s.account_id, to_char(s.statement_date,'YYYY-MM-DD') AS d, s.balance FROM bank_statements s JOIN money_accounts a ON a.id = s.account_id WHERE a.station_id = $1 AND s.statement_date <= $3::date ORDER BY s.account_id, s.statement_date DESC, s.id DESC");
  for (const a of accounts) {
    const s = stmts.find(x => x.account_id === a.id); a.statement = s || null;
    if (s) { const [t] = await pool.query('SELECT $2::numeric + COALESCE(SUM(amount),0) AS v FROM money_movements WHERE account_id = $1 AND moved_on <= $3::date', [a.id, a.opening_balance, s.d]).then(x => x.rows); a.statement_gap = fl(s.balance - t.v); a.theoretical_at_statement = t.v; }
  }
  const unmapped = await Q(`SELECT COALESCE(pm.label, p.method) AS label, SUM(p.amount) AS amount FROM payments p LEFT JOIN sales sa ON sa.id = p.sale_id JOIN payment_methods pm ON pm.station_id = p.station_id AND pm.code = p.method
     WHERE p.station_id = $1 AND p.paid_at >= $2::date AND p.paid_at < ${to1} AND (sa.id IS NULL OR sa.status = 'valide') AND pm.kind NOT IN ('especes','credit') AND pm.account_id IS NULL GROUP BY 1`);

  // ===== Dettes des employés, avances =====
  const debts = await Q(`SELECT d.id, e.last_name || ' ' || e.first_name AS employee, d.amount, d.status, to_char(d.debt_date,'YYYY-MM-DD') AS debt_date,
      COALESCE((SELECT SUM(p.amount) FROM employee_debt_payments p WHERE p.debt_id = d.id AND p.paid_at < ${to1}),0) AS paid,
      COALESCE((SELECT SUM(p.amount) FROM employee_debt_payments p WHERE p.debt_id = d.id AND p.paid_at >= $2::date AND p.paid_at < ${to1}),0) AS paid_period,
      COALESCE((SELECT SUM(p.amount) FROM employee_debt_payments p WHERE p.debt_id = d.id AND p.source = 'salaire' AND p.paid_at < ${to1}),0) AS via_salary
    FROM employee_debts d JOIN employees e ON e.id = d.employee_id WHERE d.station_id = $1 AND d.status <> 'annule' AND d.debt_date <= $3::date ORDER BY e.last_name, d.id`);
  const dEmp = {}; for (const d of debts) { const o = dEmp[d.employee] ??= { employee: d.employee, n: 0, initial: 0, paid_period: 0, paid: 0, via_salary: 0, contested: 0, settled: 0, partial: 0, unpaid: 0 };
    o.n++; o.initial += d.amount; o.paid_period += d.paid_period; o.paid += d.paid; o.via_salary += d.via_salary; if (d.status === 'conteste') o.contested++; if (d.paid >= d.amount) o.settled++; else if (d.paid > 0) o.partial++; else o.unpaid++; }
  const advances = await Q(`SELECT e.last_name || ' ' || e.first_name AS employee, SUM(a.amount) AS amount,
      COALESCE(SUM((SELECT SUM(l.amount) FROM payslip_advance_lines l JOIN payslips s ON s.id = l.payslip_id WHERE l.advance_id = a.id AND s.validated_at < ${to1})),0) AS deducted
    FROM salary_advances a JOIN employees e ON e.id = a.employee_id WHERE a.station_id = $1 AND a.status <> 'annule' AND a.advance_date <= $3::date GROUP BY 1 ORDER BY 1`);

  // ===== Créances clients (grand livre, vieillissement FIFO) =====
  const led = await Q('SELECT l.customer_id, c.name, l.kind, l.amount, l.occurred_at FROM customer_ledger l JOIN customers c ON c.id = l.customer_id WHERE l.station_id = $1 AND l.occurred_at < ($3::date + 1) ORDER BY l.customer_id, l.occurred_at, l.id');
  const endT = new Date(to + 'T23:59:59').getTime(), cl = {};
  for (const l of led) {
    const o = cl[l.customer_id] ??= { name: l.name, q: [], granted: 0, collected: 0 }, inP = l.occurred_at >= new Date(from + 'T00:00:00') && l.occurred_at < new Date(endT + 1000);
    if (l.amount > 0) { o.q.push({ t: l.occurred_at.getTime(), v: l.amount }); if (inP && l.kind === 'credit') o.granted += l.amount; }
    else { let rem = -l.amount; if (inP && l.kind === 'paiement') o.collected += rem; for (const e of o.q) { const t = Math.min(e.v, rem); e.v -= t; rem -= t; if (rem <= 0) break; } }
  }
  const recv = Object.values(cl).map(o => { const b = [0, 0, 0, 0]; for (const e of o.q) if (e.v > 0.001) { const age = (endT - e.t) / 864e5; b[age <= 30 ? 0 : age <= 60 ? 1 : age <= 90 ? 2 : 3] += e.v; } return { name: o.name, granted: fl(o.granted), collected: fl(o.collected), balance: fl(b.reduce((a, x) => a + x, 0)), buckets: b.map(fl) }; }).filter(x => x.balance > 0 || x.granted > 0 || x.collected > 0).sort((a, b) => b.balance - a.balance);

  // ===== Dettes fournisseurs =====
  const supp = await Q(`SELECT s.name, pu.order_no, pu.invoice_no, to_char(pu.invoice_date,'YYYY-MM-DD') AS invoice_date, to_char(pu.due_date,'YYYY-MM-DD') AS due_date, pu.invoice_total,
      COALESCE((SELECT SUM(sp.amount) FROM supplier_payments sp WHERE sp.purchase_id = pu.id AND sp.paid_at < ${to1}),0) AS paid
    FROM purchases pu JOIN suppliers s ON s.id = pu.supplier_id WHERE pu.station_id = $1 AND pu.invoice_total IS NOT NULL AND pu.invoice_date <= $3::date ORDER BY s.name, pu.invoice_date`);

  // ===== Dépenses, charges, résultat =====
  const expenses = await Q("SELECT to_char(e.spent_on,'YYYY-MM-DD') AS d, e.category, e.amount, COALESCE(pm.label, e.method) AS method, COALESCE(e.beneficiary,'') AS beneficiary, COALESCE(e.comment,'') AS comment, (e.receipt_url IS NOT NULL) AS has_receipt, COALESCE(u.login,'') AS login FROM expenses e LEFT JOIN users u ON u.id = e.created_by LEFT JOIN payment_methods pm ON pm.station_id = e.station_id AND pm.code = e.method WHERE e.station_id = $1 AND e.deleted_at IS NULL AND e.spent_on BETWEEN $2::date AND $3::date ORDER BY e.spent_on, e.id");
  const byCat = {}; for (const e of expenses) byCat[e.category] = (byCat[e.category] || 0) + e.amount;
  const expTotal = fl(expenses.reduce((a, e) => a + e.amount, 0)), taxes = fl(byCat['Impôts et taxes'] || 0);
  const nocostProducts = prodSales.filter(x => !x.cost).length, nocostFuel = fuelMeter.reduce((a, x) => a + (x.nocost || 0), 0);
  const reliable = nocostProducts === 0 && nocostFuel === 0 && (prodSales.length + fuelMeter.length) > 0;
  const cogs = fl(prodSales.reduce((a, x) => a + num(x.cost), 0) + fuelMeter.reduce((a, x) => a + num(x.cost), 0));
  const complete = await getSetting(station, 'accounting_complete').catch(swallow('finance:300', false));
  const grossMargin = reliable ? fl(ca - cogs) : null, operating = reliable ? fl(grossMargin - expTotal) : null;
  const result = { revenue: ca, cogs: reliable ? cogs : null, gross_margin: grossMargin, expenses: expTotal, taxes, operating_result: operating, result_before_tax: operating == null ? null : fl(operating + taxes),
    net_result: (reliable && complete) ? operating : null, reliable,
    notes: [...(reliable ? [] : ["Marge brute non déterminable de façon fiable : coût d'achat absent ou nul sur " + (nocostProducts + nocostFuel) + " ligne(s), ou aucune vente sur la période."]),
      ...(complete ? [] : ["Résultat net non établi : les catégories de charges, amortissements et impôts ne sont pas déclarés complets (paramètre « comptabilité complète »). Ce document présente des indicateurs de gestion, pas un résultat comptable certifié."]),
      "Les achats de marchandises (entrées en stock) ne sont pas traités comme des charges : le coût des produits vendus provient des coûts d'achat enregistrés. Les investissements ne sont pas modélisés."] };

  // ===== Stocks à la date =====
  const stock = await Q(`SELECT p.id, p.name, cat.code AS cat, p.buy_price, p.sell_price, p.min_stock,
      COALESCE(SUM(m.quantity) FILTER (WHERE m.created_at < $2::date),0) AS opening,
      COALESCE(SUM(m.quantity) FILTER (WHERE m.created_at >= $2::date AND m.created_at < ${to1} AND m.kind IN ('achat','entree')),0) AS purchases,
      COALESCE(-SUM(m.quantity) FILTER (WHERE m.created_at >= $2::date AND m.created_at < ${to1} AND m.kind = 'vente'),0) AS sold,
      COALESCE(SUM(m.quantity) FILTER (WHERE m.created_at >= $2::date AND m.created_at < ${to1} AND m.kind = 'transfert'),0) AS transfers,
      COALESCE(SUM(m.quantity) FILTER (WHERE m.created_at >= $2::date AND m.created_at < ${to1} AND m.kind IN ('perte','casse','correction','retour')),0) AS adjustments,
      COALESCE(SUM(m.quantity) FILTER (WHERE m.created_at < ${to1}),0) AS closing
    FROM products p JOIN categories cat ON cat.id = p.category_id LEFT JOIN stock_movements m ON m.product_id = p.id WHERE p.station_id = $1 AND p.deleted_at IS NULL GROUP BY p.id, cat.code ORDER BY cat.code, p.name`);
  const phys = await Q(`SELECT DISTINCT ON (c.product_id) c.product_id, c.physical, c.gap, sh.number, sh.gap_justification FROM shift_stock_counts c JOIN shifts sh ON sh.id = c.shift_id
     WHERE sh.station_id = $1 AND sh.status = 'ferme' AND sh.closed_at < ${to1} AND c.physical IS NOT NULL ORDER BY c.product_id, sh.closed_at DESC`);
  for (const s of stock) { const x = phys.find(y => y.product_id === s.id); s.physical = x ? x.physical : null; s.phys_gap = x ? x.gap : null; s.value = fl(s.closing * s.buy_price); s.alert = s.closing <= 0 ? 'Rupture' : s.closing <= s.min_stock ? 'Stock faible' : ''; }

  // ===== Personnel en service =====
  const at = f.at ? new Date(f.at) : null;
  const staff = await QF(`SELECT e.last_name || ' ' || e.first_name AS employee, e.position, sh.number, sh.kind, sh.opened_at, sh.closed_at, sh.status, u.login AS manager, pu.name AS pump,
      COALESCE((SELECT SUM(total) FROM sales WHERE shift_id = sh.id AND employee_id = e.id AND status = 'valide'),0) AS revenue,
      COALESCE((SELECT SUM(g.amount) FROM employee_gaps g WHERE g.shift_id = sh.id AND g.employee_id = e.id AND g.kind <> 'stock'),0) AS gap
    FROM shift_employees se JOIN shifts sh ON sh.id = se.shift_id JOIN employees e ON e.id = se.employee_id JOIN users u ON u.id = sh.manager_id LEFT JOIN pumps pu ON pu.id = se.pump_id
    WHERE sh.station_id = $1 AND sh.opened_at < ${to1} AND COALESCE(sh.closed_at, now()) >= $2::date ${at ? `AND sh.opened_at <= $${p.length + 4} AND COALESCE(sh.closed_at, now()) >= $${p.length + 4}` : ''} ORDER BY sh.number, e.last_name`, at ? [at] : []);
  const [reg] = await Q("SELECT COUNT(*) FILTER (WHERE status = 'actif')::int AS active, COUNT(*)::int AS total FROM employees WHERE station_id = $1 AND deleted_at IS NULL");

  return { period: { from, to, previous: { from: pFrom, to: pTo } }, filters: f, notes,
    sales: { ca, ca_products: fl(caProducts), ca_fuel: fl(caFuel), previous_ca: prevCa, variation_pct: prevCa ? fl((ca - prevCa) / prevCa * 100) : null, cashed: fl(cashIn), credit_sales: fl(creditSales), cancellations: cancel, by_product: [...prodSales, ...fuelMeter], by_pump: byPump, by_employee: byEmp, by_shift: byShift, by_method: byMethod },
    cash: { shifts: shiftsCash, registers }, accounts, unmapped, debts_employees: { list: Object.values(dEmp), total_initial: fl(debts.reduce((a, d) => a + d.amount, 0)), total_paid: fl(debts.reduce((a, d) => a + d.paid, 0)), balance: fl(debts.reduce((a, d) => a + d.amount - d.paid, 0)), items: debts }, advances,
    receivables: { list: recv, total: fl(recv.reduce((a, x) => a + x.balance, 0)) }, suppliers: supp, expenses: { list: expenses, by_category: byCat, total: expTotal }, result, stock, staff, employees: reg };
}

// ---------- Contrôles de cohérence entre modules ----------
async function controls(station, from, to) {
  const out = [], push = (key, label, expected, actual, refs = [], action = '', modules = '') => { const diff = fl(actual - expected); out.push({ key, label, modules, status: Math.abs(diff) < 0.01 ? 'ok' : 'ecart', expected: fl(expected), actual: fl(actual), diff, refs, action, date: to }); };
  const Q = (sql, p = []) => pq(sql, [station, from, to, ...p]);
  const sh = await Q(`SELECT sh.id, sh.number, COALESCE((SELECT SUM(m.amount) FROM meter_readings m WHERE m.shift_id = sh.id),0) + COALESCE((SELECT SUM(sa.total) FROM sales sa WHERE sa.shift_id = sh.id AND sa.kind = 'produits' AND sa.status = 'valide'),0) AS sold,
      COALESCE((SELECT SUM(p.amount) FROM payments p LEFT JOIN sales sa ON sa.id = p.sale_id WHERE p.shift_id = sh.id AND (sa.id IS NULL OR sa.status = 'valide')),0) AS paid
    FROM shifts sh WHERE sh.station_id = $1 AND sh.status = 'ferme' AND sh.closed_at >= $2::date AND sh.closed_at < $3::date + 1 ORDER BY sh.opened_at, sh.number`);
  for (const s of sh) push('ventes_encaissements', `Quart ${s.number} : ventes (compteurs + produits) et encaissements`, s.sold, s.paid, ['quart ' + s.number], "Vérifier les paiements saisis et les litres déclarés de ce quart", 'Ventes / Caisse');
  if (!sh.length) out.push({ key: 'ventes_encaissements', label: 'Ventes et encaissements des quarts clôturés', modules: 'Ventes / Caisse', status: 'info', note: 'Aucun quart clôturé sur la période', date: to });
  for (const x of await Q("SELECT cr.id, cr.name, cr.balance, COALESCE((SELECT SUM(amount) FROM cash_movements WHERE cash_register_id = cr.id),0) AS s FROM cash_registers cr WHERE cr.station_id = $1")) push('caisse_integrite', `Caisse « ${x.name} » : solde enregistré et somme des mouvements`, x.s, x.balance, ['caisse ' + x.id], 'Contrôler les mouvements de caisse', 'Caisses');
  const sg = await Q("SELECT p.name, st.quantity AS q, COALESCE((SELECT SUM(quantity) FROM stock_movements WHERE product_id = p.id),0) AS s FROM products p JOIN stock st ON st.product_id = p.id WHERE p.station_id = $1 AND p.deleted_at IS NULL");
  for (const x of sg) push('stock_integrite', `Stock « ${x.name} » : stock enregistré et somme des mouvements`, x.s, x.q, [x.name], 'Contrôler les mouvements de stock', 'Stocks');
  for (const x of await Q("SELECT c.name, c.balance, COALESCE((SELECT SUM(amount) FROM customer_ledger WHERE customer_id = c.id),0) AS s FROM customers c WHERE c.station_id = $1 AND c.deleted_at IS NULL")) push('clients_integrite', `Client « ${x.name} » : solde et grand livre`, x.s, x.balance, [x.name], 'Contrôler les ventes à crédit et règlements', 'Clients / Ventes');
  for (const x of await Q("SELECT s.name, s.balance_due, COALESCE((SELECT SUM(invoice_total) FROM purchases WHERE supplier_id = s.id AND invoice_total IS NOT NULL),0) - COALESCE((SELECT SUM(amount) FROM supplier_payments WHERE supplier_id = s.id),0) AS s FROM suppliers s WHERE s.station_id = $1 AND s.deleted_at IS NULL")) push('fournisseurs_integrite', `Fournisseur « ${x.name} » : dette et factures moins paiements`, x.s, x.balance_due, [x.name], 'Contrôler factures et paiements', 'Fournisseurs');
  for (const x of await Q("SELECT d.id, d.status, d.amount - COALESCE((SELECT SUM(amount) FROM employee_debt_payments WHERE debt_id = d.id),0) AS bal FROM employee_debts d WHERE d.station_id = $1 AND d.status IN ('solde','en_cours')")) {
    if ((x.status === 'solde' && Math.abs(x.bal) > 0.01) || (x.status === 'en_cours' && x.bal <= 0.01)) push('dettes_integrite', `Dette ${x.id} : statut « ${x.status} » incohérent avec le solde`, 0, x.bal, ['dette ' + x.id], 'Vérifier les remboursements', 'RH / Dettes');
  }
  for (const x of await Q("SELECT a.id, a.deducted, COALESCE((SELECT SUM(amount) FROM payslip_advance_lines WHERE advance_id = a.id),0) AS s FROM salary_advances a WHERE a.station_id = $1 AND a.status <> 'annule'")) if (Math.abs(x.deducted - x.s) > 0.01) push('avances_paie', `Avance ${x.id} : montant déduit et lignes de bulletins`, x.s, x.deducted, ['avance ' + x.id], 'Vérifier les bulletins validés', 'RH / Paie');
  for (const a of await Q("SELECT a.name FROM money_accounts a WHERE a.station_id = $1 AND a.active AND NOT EXISTS (SELECT 1 FROM bank_statements s WHERE s.account_id = a.id AND s.statement_date >= $3::date - 31)")) out.push({ key: 'rapprochement', label: `Compte « ${a.name} » : aucun relevé saisi depuis plus de 30 jours`, modules: 'Banques', status: 'info', action: 'Saisir un relevé et rapprocher', date: to });
  const [gp] = await Q("SELECT COUNT(*)::int AS n FROM employee_gaps WHERE station_id = $1 AND status = 'en_attente'");
  if (gp.n) out.push({ key: 'ecarts_attente', label: `${gp.n} écart(s) de caisse ou de stock en attente de traitement`, modules: 'RH / Quarts', status: 'info', action: "Attribuer et statuer sur les écarts", date: to });
  const [op] = await Q("SELECT number FROM shifts WHERE station_id = $1 AND status = 'ouvert' AND opened_at < now() - interval '24 hours'");
  if (op) out.push({ key: 'quart_ouvert', label: `Quart ${op.number} ouvert depuis plus de 24 h`, modules: 'Quarts', status: 'ecart', action: 'Clôturer le quart', date: to });
  return out;
}

// ---------- Sections de rapport (utilisées par le JSON, le PDF et l'Excel) ----------
const KINDS = { consolide: 'Rapport consolidé de la station', global: 'Rapport financier global', ventes: 'Ventes et encaissements', caisses: 'Caisses', comptes: 'Comptes bancaires', mobile: 'Mobile Money', creances: 'Créances clients', dettes_employes: 'Dettes des employés', dettes_fournisseurs: 'Dettes fournisseurs', depenses: 'Dépenses et charges', stocks: 'Stocks et écarts', rh: 'Personnel en service', resultat: 'Résultat de gestion' };
const ND = 'Non déterminé';
function kpis(d, cur) {
  const sum = k => fl(d.accounts.filter(a => a.kind === k).reduce((s, a) => s + a.end_bal, 0));
  const cashNow = fl(d.cash.registers.reduce((a, x) => a + x.closing, 0)), stockValue = fl(d.stock.reduce((a, s) => a + s.value, 0));
  const gapCash = fl(d.cash.shifts.reduce((a, s) => a + num(s.cash_gap), 0)), onDuty = new Set(d.staff.filter(s => s.status === 'ouvert').map(s => s.employee)).size;
  return [
    { label: "Chiffre d'affaires", value: d.sales.ca, note: `Ventes produits + compteurs - ${d.period.from} au ${d.period.to}` },
    { label: 'Marge brute', value: d.result.gross_margin ?? ND, note: d.result.reliable ? 'Calculée sur coûts d\'achat' : 'Coûts d\'achat insuffisants' },
    { label: 'Dépenses et charges', value: d.expenses.total, note: 'Dépenses enregistrées' },
    { label: 'Résultat de gestion', value: d.result.operating_result ?? ND, note: 'Indicateur, non certifié' },
    { label: 'Solde de caisse', value: cashNow, note: 'À la date de fin' },
    { label: 'Soldes bancaires', value: sum('banque'), note: 'Théorique (mouvements saisis)' },
    { label: 'Soldes Mobile Money', value: sum('mobile_money'), note: 'Théorique (mouvements saisis)' },
    { label: 'Créances clients', value: d.receivables.total, note: 'Grand livre à la date' },
    { label: 'Dettes fournisseurs', value: fl(d.suppliers.reduce((a, s) => a + s.invoice_total - s.paid, 0)), note: 'Factures moins paiements' },
    { label: 'Dettes des employés', value: d.debts_employees.balance, note: 'Soldes à la date' },
    { label: 'Avances à déduire', value: fl(d.advances.reduce((a, x) => a + x.amount - x.deducted, 0)), note: 'À la date' },
    { label: 'Valeur des stocks', value: stockValue, note: 'Dernier prix d\'achat' },
    { label: 'Écarts de caisse (période)', value: gapCash, note: 'Somme des écarts de quart' },
    { label: 'Employés en service', value: onDuty, note: `${d.employees.active} actifs enregistrés` },
  ];
}
function alertsOf(d, ctl) {
  const a = []; for (const s of d.stock) if (s.alert) a.push(`${s.alert} : ${s.name} (${fl(s.closing)})`);
  for (const c of d.receivables.list) if (c.buckets[3] > 0) a.push(`Créance de plus de 90 jours : ${c.name} (${c.buckets[3]})`);
  for (const s of d.suppliers) if (s.invoice_total - s.paid > 0.01 && s.due_date && s.due_date < d.period.to) a.push(`Facture fournisseur échue : ${s.name} ${s.invoice_no} (reste ${fl(s.invoice_total - s.paid)})`);
  for (const x of ctl.filter(c => c.status !== 'ok')) a.push(x.label);
  return a;
}
function sectionsFor(kind, d, level, cur, ctl) {
  const m = v => v ?? ND;
  const T = {
    synthese: () => ({ type: 'kpis', title: 'Synthèse', items: kpis(d, cur) }),
    ventes: () => [
      { type: 'kv', title: "Chiffre d'affaires, encaissements et créances", rows: [["Chiffre d'affaires net", d.sales.ca], ['dont carburant (compteurs)', d.sales.ca_fuel], ['dont produits', d.sales.ca_products], ['Encaissements (hors crédit)', d.sales.cashed], ['Ventes à crédit (créances nées)', d.sales.credit_sales], ['Annulations (nombre / montant)', `${d.sales.cancellations.n} / ${d.sales.cancellations.amount}`], ['Période précédente', `${d.period.previous.from} au ${d.period.previous.to} : ${d.sales.previous_ca}`], ['Variation', d.sales.variation_pct == null ? 'Non calculable (période précédente sans vente)' : d.sales.variation_pct + ' %']] },
      { type: 'table', title: 'Ventes par produit', head: ['Produit', 'Source', 'Quantité', 'Prix unitaire moyen', 'Montant'], rows: d.sales.by_product.map(x => [x.name, x.source, x.qty, x.price, x.amount]), sumCols: [4], totals: ['Total', '', '', '', fl(d.sales.ca)] },
      { type: 'table', title: 'Moyens de paiement', head: ['Moyen', 'Nature', 'Montant'], rows: d.sales.by_method.map(x => [x.label, x.kind, x.amount]), sumCols: [2] },
      ...(level === 'detail' ? [
        { type: 'table', title: 'Ventes par pompe (compteurs)', head: ['Pompe', 'Produit', 'Litres', 'Montant'], rows: d.sales.by_pump.map(x => [x.name, x.product, x.liters, x.amount]), sumCols: [2, 3] },
        { type: 'table', title: 'Ventes par employé (ventes saisies)', head: ['Employé', 'Opérations', 'Quantité', 'Montant'], rows: d.sales.by_employee.map(x => [x.employee, x.ops, x.qty, x.amount]), sumCols: [1, 3] },
        { type: 'table', title: 'Ventes par quart', head: ['Quart', 'Type', 'Fermé le', 'Carburant', 'Produits', 'Total'], rows: d.sales.by_shift.map(x => [x.number, x.kind, x.closed_at, x.fuel, x.products, fl(x.fuel + x.products)]), sumCols: [3, 4, 5] }] : [])],
    caisses: () => [
      { type: 'table', title: 'Caisses : soldes à la période', head: ['Caisse', "Solde d'ouverture", 'Entrées', 'Sorties', 'Solde de clôture'], rows: d.cash.registers.map(x => [x.name, x.opening, x.inflow, x.outflow, x.closing]), sumCols: [1, 2, 3, 4] },
      { type: 'table', title: 'Détail par quart', head: ['Quart', 'Statut', 'Ouverture', 'Encaissements', 'Décaissements', 'dont dépenses espèces', 'Remises en banque', 'Retraits', 'Solde théorique', 'Solde compté', 'Écart', 'Justification'],
        rows: d.cash.shifts.map(x => [x.number, x.status === 'ferme' ? 'Validé (clôturé)' : 'En cours', x.opening_cash, x.enc, x.dec, x.exp_cash, x.deposits, x.withdrawals, x.theoretical_cash ?? 'n/d', x.counted_cash ?? 'n/d', x.cash_gap ?? 'n/d', x.gap_justification || '']), sumCols: [2, 3, 4, 5, 6, 7],
        notes: ['n/d : quart non clôturé, valeur non disponible (non remplacée par zéro).'] }],
    comptes: () => accountSections(d, 'banque', 'Comptes bancaires'),
    mobile: () => accountSections(d, 'mobile_money', 'Portefeuilles Mobile Money'),
    creances: () => [
      { type: 'table', title: 'Créances clients à la date', head: ['Client', 'Crédits accordés (période)', 'Encaissé (période)', 'Solde dû', ...AGE], rows: d.receivables.list.map(x => [x.name, x.granted, x.collected, x.balance, ...x.buckets]), sumCols: [1, 2, 3, 4, 5, 6, 7],
        notes: ['Ancienneté calculée par imputation des règlements sur les crédits les plus anciens.'] }],
    dettes_employes: () => [
      { type: 'kv', title: 'Synthèse des dettes des employés', rows: [['Employés concernés', d.debts_employees.list.length], ['Dettes initiales', d.debts_employees.total_initial], ['Remboursé à la date', d.debts_employees.total_paid], ['Solde restant', d.debts_employees.balance]] },
      { type: 'table', title: 'Détail par employé', head: ['Employé', 'Dettes', 'Dette initiale', 'Remboursé (période)', 'Remboursé (cumul)', 'dont retenues sur salaire', 'Solde', 'Soldées', 'Partielles', 'Non réglées', 'Contestées'],
        rows: d.debts_employees.list.map(x => [x.employee, x.n, x.initial, x.paid_period, x.paid, x.via_salary, fl(x.initial - x.paid), x.settled, x.partial, x.unpaid, x.contested]), sumCols: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], notes: ['Un remboursement par retenue sur salaire n\'est compté qu\'une seule fois (dans la dette), jamais en plus dans la paie.'] },
      { type: 'table', title: 'Avances sur salaire', head: ['Employé', 'Avances versées', 'Déjà déduites', 'Reste à déduire'], rows: d.advances.map(x => [x.employee, x.amount, x.deducted, fl(x.amount - x.deducted)]), sumCols: [1, 2, 3] }],
    dettes_fournisseurs: () => [
      { type: 'table', title: 'Factures fournisseurs à la date', head: ['Fournisseur', 'Commande', 'Facture', 'Date', 'Échéance', 'Montant', 'Payé', 'Reste dû', 'Retard (jours)'],
        rows: d.suppliers.map(x => [x.name, x.order_no, x.invoice_no, x.invoice_date, x.due_date || 'n/d', x.invoice_total, x.paid, fl(x.invoice_total - x.paid), x.due_date && x.invoice_total - x.paid > 0.01 && x.due_date < d.period.to ? Math.round((new Date(d.period.to) - new Date(x.due_date)) / 864e5) : 0]), sumCols: [5, 6, 7] }],
    depenses: () => [
      { type: 'table', title: 'Charges par catégorie', head: ['Catégorie', 'Montant'], rows: Object.entries(d.expenses.by_category).map(([k, v]) => [k, v]), sumCols: [1] },
      { type: 'table', title: 'Détail des dépenses', head: ['Date', 'Catégorie', 'Montant', 'Moyen de paiement', 'Bénéficiaire', 'Commentaire', 'Justificatif', 'Saisi par'], rows: d.expenses.list.map(x => [x.d, x.category, x.amount, x.method, x.beneficiary, x.comment, x.has_receipt ? 'Oui' : 'Non', x.login]), sumCols: [2],
        notes: ["État de validation : les dépenses sont enregistrées par l'utilisateur indiqué ; il n'existe pas de circuit de validation séparé dans cette version."] }],
    stocks: () => {
      const g = names => d.stock.filter(s => names.includes(s.cat));
      const row = s => [s.name, s.cat, s.opening, s.purchases, s.sold, s.transfers, s.adjustments, s.closing, s.physical ?? 'non inventorié', s.phys_gap ?? 'n/d', s.buy_price, s.sell_price, s.value, s.min_stock, s.alert];
      const H = ['Produit', 'Catégorie', 'Stock initial', 'Approvisionnements', 'Quantités vendues', 'Transferts', 'Pertes et corrections', 'Stock théorique final', 'Stock physique', 'Écart', "Prix d'achat", 'Prix de vente', 'Valeur', 'Seuil', 'Alerte'];
      const sec = (title, names) => ({ type: 'table', title, head: H, rows: g(names).map(row), sumCols: [12] });
      return [sec('Carburants', ['CARBURANT']), sec('Huiles et lubrifiants', ['LUBRIFIANT', 'HUILE']), sec('Autres marchandises', ['ACCESSOIRES', 'BOUTIQUE', 'AUTRES']),
        { type: 'text', text: "Carburants : les litres vendus proviennent des compteurs de pompes (sorties de stock à la clôture des quarts) ; les approvisionnements sont les livraisons réceptionnées. Stock physique : dernier inventaire saisi à une clôture avant la date." }];
    },
    rh: () => [
      { type: 'kv', title: 'Personnel', rows: [['Employés actifs enregistrés', d.employees.active], ['Employés enregistrés', d.employees.total], ['Employés affectés à un quart sur la période', new Set(d.staff.map(s => s.employee)).size], ['Actuellement en service', new Set(d.staff.filter(s => s.status === 'ouvert').map(s => s.employee)).size]] },
      { type: 'table', title: 'Affectations et activité', head: ['Employé', 'Fonction', 'Quart', 'Type', 'Début', 'Fin', 'Statut', 'Responsable', 'Pompe', "Chiffre d'affaires saisi", 'Écarts attribués'],
        rows: d.staff.map(x => [x.employee, x.position, x.number, x.kind, x.opened_at, x.closed_at || '', x.status === 'ouvert' ? 'En service' : 'Quart clôturé', x.manager, x.pump || '', x.revenue, x.gap]), sumCols: [9],
        notes: ["Distinction : « en service » = quart ouvert ; « quart clôturé » = a terminé. Les employés planifiés mais jamais affectés ne figurent pas ici (pas de planning dans cette version)."] }],
    resultat: () => [
      { type: 'kv', title: 'Résultat de gestion', rows: [['Produits (chiffre d\'affaires net)', d.result.revenue], ['Coût des produits vendus', m(d.result.cogs)], ['Marge brute', m(d.result.gross_margin)], ['Charges d\'exploitation (dépenses enregistrées)', d.result.expenses], ['RÉSULTAT AVANT CHARGES D\'EXPLOITATION (marge brute)', m(d.result.gross_margin)], ['RÉSULTAT APRÈS CHARGES D\'EXPLOITATION', m(d.result.operating_result)], ['dont impôts et taxes enregistrés', d.result.taxes], ['Résultat avant impôts', m(d.result.result_before_tax)], ['Résultat net', m(d.result.net_result)]] },
      { type: 'text', title: 'Notes et limites', text: d.result.notes.join('\n') }],
    controles: () => ({ type: 'table', title: 'Contrôles et réconciliations', head: ['Contrôle', 'Modules', 'Attendu', 'Constaté', 'Écart', 'Statut', 'Action recommandée'], rows: ctl.map(c => [c.label, c.modules || '', c.expected ?? '', c.actual ?? '', c.diff ?? '', c.status === 'ok' ? 'Conforme' : c.status === 'ecart' ? 'ÉCART' : 'À traiter', c.action || c.note || '']),
      notes: ['Aucune anomalie financière n\'est corrigée automatiquement : toute correction passe par une opération autorisée et tracée.'] }),
  };
  const accountSections = (d, kind, title) => {
    const acc = d.accounts.filter(a => a.kind === kind); const out = [];
    out.push({ type: 'table', title, head: ['Compte', 'Fournisseur / banque', 'Solde début', 'Encaissements et dépôts', 'Virements reçus', 'Virements émis', 'Frais', 'Retraits', 'Autres', 'Solde théorique fin', 'Dernier relevé', 'Solde du relevé', 'Écart de rapprochement'],
      rows: acc.map(a => [a.name, a.provider || a.account_ref || '', a.start_bal, a.deposits, a.transfers_in, a.transfers_out, a.fees, a.withdrawals, a.other, a.end_bal, a.statement ? a.statement.d : 'aucun', a.statement ? a.statement.balance : 'n/d', a.statement ? a.statement_gap : 'non rapproché']), sumCols: [2, 3, 4, 5, 6, 7, 8, 9],
      notes: ['Solde théorique = solde d\'ouverture + mouvements enregistrés dans le logiciel ; il est distinct du solde confirmé par un relevé. Ces soldes ne sont pas mélangés avec la caisse physique.'] });
    const um = d.unmapped.filter(u => kind === 'banque' ? /banque|virement|carte/i.test(u.label) : /mobile|orange|wave/i.test(u.label));
    if (um.length) out.push({ type: 'table', title: 'Encaissements non rattachés à un compte', head: ['Moyen de paiement', 'Montant'], rows: um.map(u => [u.label, u.amount]), notes: ["Rattachez ces moyens de paiement à un compte (Paramètres, Finances) pour qu'ils alimentent son solde."] });
    return out;
  };
  const pick = {
    consolide: ['synthese', 'ventes', 'caisses', 'comptes', 'mobile', 'creances', 'dettes_employes', 'dettes_fournisseurs', 'depenses', 'resultat', 'stocks', 'rh', 'controles'],
    global: ['synthese', 'resultat', 'controles'], ventes: ['ventes'], caisses: ['caisses'], comptes: ['comptes'], mobile: ['mobile'], creances: ['creances'], dettes_employes: ['dettes_employes'],
    dettes_fournisseurs: ['dettes_fournisseurs'], depenses: ['depenses'], stocks: ['stocks'], rh: ['rh'], resultat: ['resultat'],
  }[kind];
  return pick.flatMap(k => [].concat(T[k]())).map(s => ({ ...s, sheet: s.title || 'Synthèse' }));
}
const SIGNERS = { consolide: ['Préparé par', 'Vérifié par', 'Approuvé par'], global: ['Préparé par', 'Vérifié par', 'Approuvé par'], caisses: ['Caissier', 'Chef de quart', 'Gérant'], rh: ['Responsable RH', 'Gérant', 'Administrateur'] };
const ST = { prepare: 'Préparé', verifie: 'Vérifié', approuve: 'Approuvé', conteste: 'Contesté' };

function parse(req) {
  const day = /^\d{4}-\d{2}-\d{2}$/, date = day.test(req.query.date) ? req.query.date : null;
  const from = date || (day.test(req.query.from) ? req.query.from : today().slice(0, 8) + '01'), to = date || (day.test(req.query.to) ? req.query.to : today());
  if (from > to) throw new HttpError(400, 'La date de début est postérieure à la date de fin');
  const f = {}; for (const k of ['shift_id', 'employee_id', 'pump_id', 'product_id']) if (req.query[k]) f[k] = +req.query[k]; if (req.query.method) f.method = String(req.query.method); if (req.query.at) f.at = req.query.at;
  return { from, to, f };
}
r.get('/finance/situation', need(...VIEW), wrap(async (req, res) => {
  const { from, to, f } = parse(req), d = await situation(req.sid, from, to, f), ctl = await controls(req.sid, from, to), b = await docs.branding(req.sid);
  res.json({ ...d, kpis: kpis(d, b.currency), alerts: alertsOf(d, ctl), controls_summary: { ok: ctl.filter(c => c.status === 'ok').length, ecart: ctl.filter(c => c.status === 'ecart').length, info: ctl.filter(c => c.status === 'info').length } });
}));
r.get('/finance/controls', need(...VIEW), wrap(async (req, res) => { const { from, to } = parse(req); res.json(await controls(req.sid, from, to)); }));
r.get('/finance/kinds', need(...VIEW), wrap(async (req, res) => res.json(Object.entries(KINDS).map(([key, label]) => ({ key, label })))));
r.get('/finance/report', need('finance.report'), wrap(async (req, res) => {
  const kind = req.query.kind || 'consolide', fmt = req.query.format || 'pdf', level = req.query.level === 'summary' ? 'summary' : 'detail';
  if (!KINDS[kind]) throw new HttpError(400, 'Type de rapport inconnu'); if (!['pdf', 'xlsx', 'json'].includes(fmt)) throw new HttpError(400, 'Format : pdf, xlsx ou json');
  const { from, to, f } = parse(req), d = await situation(req.sid, from, to, f), ctl = await controls(req.sid, from, to), b = await docs.branding(req.sid);
  let sections = sectionsFor(kind, d, level, b.currency, ctl);
  if (req.query.modules) { const want = String(req.query.modules).split(','); sections = sections.filter(s => want.some(w => (s.title || 'Synthèse').toLowerCase().includes(w.toLowerCase()))); }
  const ref = `${kind.toUpperCase().slice(0, 4)}-${to.replace(/-/g, '')}-${req.sid}`, sub = from === to ? `Situation au ${to}` : `Période du ${from} au ${to}`;
  const notes = [...d.notes]; if (Object.keys(f).length) notes.push('Filtres appliqués : ' + Object.entries(f).map(([k, v]) => `${k} = ${v}`).join(', '));
  if (fmt === 'json') return res.json({ kind, title: KINDS[kind], period: d.period, sections, notes });
  const { rows: vals } = await pool.query('SELECT v.role_label, v.status, v.created_at, u.login FROM report_validations v JOIN users u ON u.id = v.user_id WHERE v.station_id = $1 AND v.report_key = $2 AND v.period_from = $3 AND v.period_to = $4 ORDER BY v.id', [req.sid, kind, from, to]);
  const labels = SIGNERS[kind] || ['Préparé par', 'Vérifié par', 'Approuvé par'];
  const signatures = labels.map(l => { const v = [...vals].reverse().find(x => x.role_label === l); return v ? { label: l, name: v.login, status: ST[v.status], date: v.created_at } : { label: l }; });
  if (fmt === 'pdf') {
    const buf = await docs.buildPdf({ b, title: KINDS[kind].toUpperCase(), subtitle: sub, ref, sections: [...sections.map(s => s.type === 'table' ? { ...s, rows: s.rows } : s), ...(notes.length ? [{ type: 'text', title: 'Notes', text: notes.join('\n') }] : [])], signatures, landscape: kind !== 'global' });
    return docs.send(res, 'pdf', buf, `${kind}-${to}`);
  }
  const sheets = []; const kv = sections.filter(s => s.type === 'kpis' || s.type === 'kv' || s.type === 'text');
  if (kv.length) sheets.push({ name: 'Synthèse', head: ['Indicateur', 'Valeur', 'Note'], rows: kv.flatMap(s => s.type === 'kpis' ? s.items.map(i => [i.label, i.value, i.note || '']) : s.type === 'kv' ? [[s.title || '', '', ''], ...s.rows.map(([a, c]) => [a, c, ''])] : [[s.title || 'Notes', s.text, '']]), notes });
  for (const s of sections.filter(s => s.type === 'table')) sheets.push({ name: s.title, head: s.head, rows: s.rows, sumCols: s.sumCols, notes: s.notes });
  sheets.push({ name: 'Contrôles', head: ['Contrôle', 'Modules', 'Attendu', 'Constaté', 'Écart', 'Statut'], rows: ctl.map(c => [c.label, c.modules || '', c.expected ?? '', c.actual ?? '', c.diff ?? '', c.status]) });
  docs.send(res, 'xlsx', await docs.buildXlsx({ b, title: KINDS[kind], subtitle: sub, ref, sheets }), `${kind}-${to}`);
}));

// ---------- Validations électroniques (identité authentifiée, date, action) ----------
r.post('/finance/validations', need('finance.report'), body(z.object({ report_key: z.string(), from: ymd, to: ymd, role_label: z.string().min(2), status: z.enum(['prepare', 'verifie', 'approuve', 'conteste']), comment: z.string().optional() })), wrap(async (req, res) => {
  const b = req.body;
  if (!KINDS[b.report_key]) throw new HttpError(400, 'Type de rapport inconnu');
  if (b.status === 'conteste' && !b.comment) throw new HttpError(400, 'Un motif est obligatoire pour contester');
  const { rows: [v] } = await pool.query('INSERT INTO report_validations(station_id, report_key, period_from, period_to, role_label, status, user_id, comment) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id', [req.sid, b.report_key, b.from, b.to, b.role_label, b.status, req.user.id, b.comment || null]);
  await audit(pool, req, 'rapports', `${ST[b.status]} : ${KINDS[b.report_key]} (${b.from} au ${b.to})`, 'report_validations', v.id, null, b);
  res.status(201).json(v);
}));
r.get('/finance/validations', need(...VIEW), wrap(async (req, res) => {
  const { rows } = await pool.query("SELECT v.id, v.report_key, to_char(v.period_from,'YYYY-MM-DD') AS period_from, to_char(v.period_to,'YYYY-MM-DD') AS period_to, v.role_label, v.status, v.comment, v.created_at, u.login FROM report_validations v JOIN users u ON u.id = v.user_id WHERE v.station_id = $1 ORDER BY v.id DESC LIMIT 100", [req.sid]);
  res.json(rows);
}));

// ---------- Rapport de quart en PDF (instantané figé à la clôture) et rapport d'audit ----------
async function shiftReport(sid, shiftId, opts = {}) {
  const { rows: [s] } = await pool.query('SELECT sh.*, u.login AS manager, cb.login AS closer FROM shifts sh JOIN users u ON u.id = sh.manager_id LEFT JOIN users cb ON cb.id = sh.closed_by WHERE sh.id = $1 AND sh.station_id = $2', [shiftId, sid]);
  if (!s) throw new HttpError(404, 'Quart introuvable');
  const { rows: [rp] } = await pool.query("SELECT content FROM reports WHERE shift_id = $1 AND kind = 'quart' ORDER BY id DESC LIMIT 1", [s.id]);
  if (!rp) throw new HttpError(409, "Le quart n'est pas clôturé : aucun rapport");
  const c = rp.content, b = await docs.branding(sid), m = v => `${docs.cellText(fl(v))} ${b.currency}`;
  const emps = (await pool.query('SELECT e.first_name || \' \' || e.last_name AS n FROM shift_employees se JOIN employees e ON e.id = se.employee_id WHERE se.shift_id = $1', [s.id])).rows.map(x => x.n).join(', ');
  // Rapports récents : situation propre à chaque employé. Anciens rapports (sans « employees ») : rapport unique comme avant.
  const shared = Array.isArray(c.employees) && c.employees.length > 0;
  const mine = shared && opts.employeeId != null ? c.employees.find(x => Number(x.employee_id) === Number(opts.employeeId)) : null;
  if (shared && opts.employeeId != null && !mine) throw new HttpError(404, "Cet employé n'a aucune situation sur ce quart");
  const stockTxt = stockGapText;
  // Rapports clôturés avant cette version : produits vendus relus depuis les ventes du quart
  if (!Array.isArray(c.shop_sales)) {
    c.shop_sales = (await pool.query(`SELECT pr.id AS product_id, pr.name AS product, pr.unit, SUM(d.quantity) AS quantity, SUM(d.amount) AS amount FROM sale_details d JOIN sales sa ON sa.id = d.sale_id JOIN products pr ON pr.id = d.product_id WHERE sa.shift_id = $1 AND sa.status = 'valide' AND sa.kind = 'produits' GROUP BY pr.id, pr.name, pr.unit ORDER BY pr.name`, [s.id])).rows.map(x => ({ product: x.product, unit: x.unit, quantity: Number(x.quantity), amount: fl(x.amount) }));
  }
  // Stock des produits vendus pour les quarts clôturés avant l'inventaire détaillé : stock de début/fin reconstitué depuis les mouvements
  if (!Array.isArray(c.stock) || !c.stock.length) {
    const { rows: st } = await pool.query(
      `SELECT pr.name AS product, COALESCE(sk.quantity, 0) AS current,
              COALESCE(SUM(m.quantity) FILTER (WHERE m.created_at > $3), 0) AS after,
              COALESCE(SUM(m.quantity) FILTER (WHERE m.created_at >= $2 AND m.created_at <= $3), 0) AS during
         FROM products pr LEFT JOIN stock sk ON sk.product_id = pr.id
         LEFT JOIN stock_movements m ON m.product_id = pr.id AND m.station_id = pr.station_id
        WHERE pr.station_id = $4 AND pr.id IN (SELECT d.product_id FROM sale_details d JOIN sales sa ON sa.id = d.sale_id WHERE sa.shift_id = $1 AND sa.status = 'valide' AND sa.kind = 'produits')
        GROUP BY pr.id, pr.name, sk.quantity ORDER BY pr.name`, [s.id, s.opened_at, s.closed_at || new Date(), sid]).catch(swallow('finance:shift-stock-reconstitue', { rows: [] }));
    c.stock = st.map(x => { const closing = f3(Number(x.current) - Number(x.after)); return { product: x.product, opening: f3(closing - Number(x.during)), theoretical: closing, physical: null, gap: null }; });
    c.stock_reconstituted = c.stock.length > 0;
  }
  // Récapitulatif des ventes par employé (carburant + produits, ventes validées du quart)
  if (!Array.isArray(c.sales_by_employee)) {
    const { rows: se } = await pool.query(
      `SELECT COALESCE(e.last_name || ' ' || e.first_name, 'Non attribué') AS employee, COUNT(*)::int AS ops,
              COALESCE(SUM(sa.total) FILTER (WHERE sa.kind = 'produits'), 0) AS shop, COALESCE(SUM(sa.total) FILTER (WHERE sa.kind <> 'produits'), 0) AS fuel, COALESCE(SUM(sa.total), 0) AS total
         FROM sales sa LEFT JOIN employees e ON e.id = sa.employee_id WHERE sa.shift_id = $1 AND sa.status = 'valide' GROUP BY 1 ORDER BY 1`, [s.id]).catch(swallow('finance:shift-ventes-employe', { rows: [] }));
    c.sales_by_employee = se.map(x => ({ employee: x.employee, ops: x.ops, shop: fl(x.shop), fuel: fl(x.fuel), total: fl(x.total) }));
  }
  const fuelRows = (c.counters || []).filter(x => Number(x.liters) !== 0 || Number(x.amount) !== 0);
  if (mine) {
    // Version individuelle : uniquement SES pompes, SES ventes, SES écarts et SES anomalies (rien sur les collègues)
    const myCounters = (c.counters || []).filter(x => (mine.pumps || []).includes(x.pump));
    const nc = mine.non_cash || {};
    const myAnoms = (c.anomalies || []).filter(a => a.employee_id != null && Number(a.employee_id) === Number(mine.employee_id));
    const mySections = [
      { type: 'kv', title: 'Quart', rows: [['Numéro', String(s.number).padStart(6, '0')], ['Type', s.kind], ['Ouverture', docs.fmtDate(s.opened_at)], ['Fermeture', docs.fmtDate(s.closed_at)], ['Responsable', s.manager], ['Employé', mine.name], ['Vos pompes', (mine.pumps || []).join(', ') || 'aucune']] },
      { type: 'table', title: 'Compteurs de vos pompes', head: ['Pompe', 'Compteur', 'Produit', 'Index initial', 'Index final', 'Litres', 'Prix', 'Montant'], rows: myCounters.length ? myCounters.map(x => [x.pump, x.counter, x.product, x.index_start, x.index_end, x.liters, x.unit_price, x.amount]) : [['Aucune pompe', '', '', '', '', '', '', '']] },
      { type: 'table', title: 'Votre situation financière sur ce quart', head: ['Poste', 'Montant'], rows: [
        ['Carburant de vos pompes (compteurs)', m(mine.fuel_amount)], ['  dont déclaré à la saisie', m(mine.declared_fuel)], ['  dont non déclaré (compté en espèces)', m(mine.undeclared)],
        ['Paiements non espèces de vos pompes', `mobile money ${docs.cellText(fl(nc.mobile_money))} · carte ${docs.cellText(fl(nc.card))} · crédit ${docs.cellText(fl(nc.credit))}`],
        ['Espèces de vos ventes saisies', m(mine.cash_declared)],
        ['Espèces attendues de vous', mine.expected_cash == null ? 'n/d' : m(mine.expected_cash)], ['Espèces remises', mine.counted_cash == null ? 'n/d' : m(mine.counted_cash)],
        ['Écart de caisse', mine.cash_gap == null ? 'n/d' : m(mine.cash_gap)], ['Écarts de stock qui vous sont imputés', stockTxt(mine.stock_gaps)]] },
      { type: 'table', title: 'Vos anomalies', head: ['Description', 'Montant'], rows: myAnoms.length ? myAnoms.map(a => [a.description + reportedTxt(a).replace("l'employé lui-même", 'vous-même'), a.amount == null ? '' : a.kind === 'ecart_stock' ? `${docs.cellText(fl(a.amount))} (quantité)` : m(a.amount)]) : [['Aucune', '']] },
      { type: 'kv', title: 'Information', rows: [['Portée de ce document', "Cet état ne concerne que vous. Un écart n'est jamais retenu automatiquement : le gérant décide après vous avoir entendu."]] }];
    const bufMine = await docs.buildPdf({ b, title: 'SITUATION INDIVIDUELLE - QUART', subtitle: `Quart ${String(s.number).padStart(6, '0')} (${s.kind}) - ${mine.name}`, ref: `QRT-${String(s.number).padStart(6, '0')}-E${mine.employee_id}`, sections: mySections, landscape: false,
      signatures: [{ label: 'Employé', name: mine.name }, { label: 'Responsable du quart', name: s.manager, status: 'Clôturé', date: s.closed_at }, { label: 'Gérant' }] });
    return { buf: bufMine, s, c, b, emps, personal: mine };
  }
  const sections = [
    { type: 'kv', title: 'Quart', rows: [['Numéro', String(s.number).padStart(6, '0')], ['Type', s.kind], ['Ouverture', docs.fmtDate(s.opened_at)], ['Fermeture', docs.fmtDate(s.closed_at)], ['Responsable', s.manager], ['Employés affectés', emps || 'n/d']] },
    { type: 'table', title: 'Compteurs et litres vendus (carburant)', head: ['Pompe', 'Compteur', 'Produit', 'Index initial', 'Index final', 'Litres', 'Prix', 'Montant'], rows: (fuelRows.length ? fuelRows : [{ pump: 'Aucune vente de carburant sur ce quart', counter: '', product: '', index_start: '', index_end: '', liters: 0, unit_price: '', amount: 0 }]).map(x => [x.pump, x.counter, x.product, x.index_start, x.index_end, x.liters, x.unit_price, x.amount]), totals: ['Total carburant', '', '', '', '', c.counters.reduce((a, x) => a + x.liters, 0), '', c.fuel_total] },
    { type: 'table', title: 'Produits vendus (boutique)', head: ['Produit', 'Quantité', 'Montant'], rows: c.shop_sales.length ? c.shop_sales.map(x => [x.product, `${docs.cellText(x.quantity)}${x.unit ? ' ' + x.unit : ''}`, x.amount]) : [['Aucun produit vendu sur ce quart', '', 0]], totals: ['Total produits', '', c.shop_sales.reduce((a, x) => a + x.amount, 0)] },
    { type: 'table', title: 'Ventes et moyens de paiement', head: ['Poste', 'Montant'], rows: [['Carburant (compteurs)', m(c.fuel_total)], ...(c.fuel_declared ? [['  dont déclaré à la saisie', m(c.fuel_declared.total)], ['  dont non déclaré (compté en espèces)', m(c.fuel_declared.undeclared)]] : []), ['Autres produits', m(c.other_sales.total)], ...c.other_sales.by_method.map(x => ['  ' + x.method, m(x.amount)]), ['Carburant en espèces', m(c.fuel_payments.especes)], ['Carburant mobile money', m(c.fuel_payments.mobile_money)], ['Carburant carte', m(c.fuel_payments.carte)], ['Carburant crédit', m(c.fuel_payments.credit)], ...(c.fuel_payments.autres ? [['Carburant autres moyens (déclarés)', m(c.fuel_payments.autres)]] : [])] },
    { type: 'table', title: 'Caisse', head: ['Initiale', 'Théorique', 'Comptée', 'Écart'], rows: [[c.cash.opening, c.cash.theoretical, c.cash.counted, c.cash.gap]] },
    { type: 'table', title: 'Stock', head: ['Produit', 'Stock début', 'Théorique fin', 'Physique', 'Écart'], rows: c.stock.map(x => [x.product, x.opening ?? '', x.theoretical, x.physical ?? 'non inventorié', x.gap ?? 'n/d']),
      ...(c.stock_reconstituted ? { notes: ['Quart clôturé sans inventaire détaillé : stocks de début et de fin reconstitués à partir des mouvements de stock.'] } : {}) },
    { type: 'table', title: 'Récapitulatif des ventes par employé', head: ['Employé', 'Opérations', 'Carburant', 'Produits', 'Total'], rows: c.sales_by_employee.length ? c.sales_by_employee.map(x => [x.employee, x.ops, x.fuel, x.shop, x.total]) : [['Aucune vente', 0, 0, 0, 0]],
      ...(c.sales_by_employee.length ? { totals: ['Total', c.sales_by_employee.reduce((a, x) => a + x.ops, 0), c.sales_by_employee.reduce((a, x) => a + x.fuel, 0), c.sales_by_employee.reduce((a, x) => a + x.shop, 0), c.sales_by_employee.reduce((a, x) => a + x.total, 0)] } : {}) },
    ...(shared ? [{ type: 'table', title: 'Situation par employé (chacun pour ses pompes, ses ventes et ses espèces remises)', head: ['Employé', 'Pompes', 'Litres', 'Compteurs', 'Espèces attendues', 'Espèces remises', 'Écart de caisse', 'Écarts de stock'],
      rows: [...c.employees.map(e => [e.name, (e.pumps || []).join(', ') || '-', e.fuel_liters, m(e.fuel_amount), e.expected_cash == null ? 'n/d' : m(e.expected_cash), e.counted_cash == null ? 'n/d' : m(e.counted_cash), e.cash_gap == null ? 'n/d' : m(e.cash_gap), stockTxt(e.stock_gaps)]),
        ...(c.unassigned && ((c.unassigned.cash_gap && Math.abs(c.unassigned.cash_gap) > 0.004) || (c.unassigned.stock_gaps || []).length) ? [['Non attribué à un employé', '-', '', '', '', '', c.unassigned.cash_gap ? m(c.unassigned.cash_gap) : '-', stockTxt(c.unassigned.stock_gaps)]] : [])] }] : []),
    shared
      ? { type: 'table', title: 'Anomalies détectées (avec l\'employé à l\'origine)', head: ['Employé à l\'origine', 'Description'], rows: c.anomalies.length ? c.anomalies.map(a => [a.employee || 'Ensemble du quart', String(a.description || '').replace(/\s+/g, ' ').trim() + reportedTxt(a)]) : [['', 'Aucune']] }
      : { type: 'table', title: 'Anomalies détectées', head: ['Description'], rows: c.anomalies.length ? c.anomalies.map(a => [a.description]) : [['Aucune']] },
    { type: 'kv', title: 'Justification et observations', rows: [['Justification des écarts', s.gap_justification || '-'], ['Observations', s.observations || '-']] }];
  const buf = await docs.buildPdf({ b, title: 'RAPPORT DE QUART', subtitle: `Quart ${String(s.number).padStart(6, '0')} (${s.kind})`, ref: `QRT-${String(s.number).padStart(6, '0')}`, sections, landscape: false,
    signatures: [{ label: 'Employé / pompiste', name: emps.split(',')[0] || undefined }, { label: 'Responsable du quart', name: s.manager, status: 'Clôturé', date: s.closed_at }, { label: 'Gérant' }] });
  return { buf, s, c, b, emps };
}
r.get('/shifts/:id/report.pdf', wrap(async (req, res) => {
  const { buf, s } = await shiftReport(req.sid, req.params.id);
  docs.send(res, 'pdf', buf, `quart-${s.number}`);
}));


// ---------- Partage du rapport de quart clôturé : e-mail (PDF joint) et message WhatsApp préparé ----------
const SHARE_PERMS = ['shift.close', 'report.view'];
const EMAIL_RE = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/;
const cleanEmail = v => { const e = String(v || '').trim().toLowerCase(); return EMAIL_RE.test(e) && e.length <= 254 ? e : null; };
/** Numéro WhatsApp : chiffres uniquement, indicatif pays obligatoire (au moins 10 chiffres), « 00 » ou « + » initial retiré. */
const waNumber = v => { let d = String(v || '').replace(/[^\d+]/g, ''); if (d.startsWith('+')) d = d.slice(1); else if (d.startsWith('00')) d = d.slice(2); d = d.replace(/\D/g, ''); if (d.length === 8) d = '223' + d; return d.length >= 10 && d.length <= 15 ? d : null; };

async function shareContext(sid, shiftId) {
  const { rows: [s] } = await pool.query(
    `SELECT sh.id, sh.number, sh.kind, sh.opened_at, sh.closed_at, sh.closed_by, sh.gap_justification, sh.observations, u.login AS manager, cb.login AS closer_login
       FROM shifts sh JOIN users u ON u.id = sh.manager_id LEFT JOIN users cb ON cb.id = sh.closed_by
      WHERE sh.id = $1 AND sh.station_id = $2`, [shiftId, sid]);
  if (!s) throw new HttpError(404, 'Quart introuvable');
  const { rows: [rp] } = await pool.query("SELECT content FROM reports WHERE shift_id = $1 AND kind = 'quart' ORDER BY id DESC LIMIT 1", [s.id]);
  if (!rp) throw new HttpError(409, "Le quart n'est pas clôturé : aucun rapport");
  const { rows: [st] } = await pool.query('SELECT name, email, phone FROM stations WHERE id = $1', [sid]);
  // Employés concernés : affectés au quart OU ayant des ventes valides sur ce quart (station courante uniquement)
  const { rows: emps } = await pool.query(
    `SELECT e.id, e.first_name || ' ' || e.last_name AS name, e.email, e.phone
       FROM employees e
      WHERE e.station_id = $2 AND e.deleted_at IS NULL
        AND (EXISTS (SELECT 1 FROM shift_employees se WHERE se.shift_id = $1 AND se.employee_id = e.id)
          OR EXISTS (SELECT 1 FROM sales sa WHERE sa.shift_id = $1 AND sa.employee_id = e.id AND sa.status = 'valide'))
      ORDER BY e.last_name, e.first_name`, [s.id, sid]);
  let closer = null;
  if (s.closed_by) {
    const { rows: [ce] } = await pool.query(
      `SELECT e.id, e.first_name || ' ' || e.last_name AS name, e.email, e.phone FROM employees e WHERE e.user_id = $1 AND e.station_id = $2`, [s.closed_by, sid]);
    closer = { name: ce?.name || s.closer_login || 'n/d', login: s.closer_login || null, email: ce?.email || null, phone: ce?.phone || null };
  }
  return { s, c: rp.content, st: st || {}, emps, closer };
}

/** Écarts de stock = QUANTITÉS (jamais de devise), arrondies à 2 décimales, noms de produits nettoyés. */
/** Mention de l'auteur d'un signalement manuel d'anomalie (employé lui-même, ou clôturant / responsable). */
const reportedTxt = a => a && a.reported_by && a.kind !== 'ecart_caisse' && a.kind !== 'ecart_stock' && a.kind !== 'rattachement' ? (a.reported_self ? ' (signalée par l\'employé lui-même)' : ` (signalée par ${a.reported_by})`) : '';
const stockGapText = list => (list && list.length) ? list.map(x => `${String(x.product || '').replace(/\s+/g, ' ').trim()} : ${docs.cellText(fl(x.amount))}`).join(' ; ') : '-';

/** Texte du message (WhatsApp) : dates, carburant, autres ventes, compteurs, paiements, caisse, observations. */
function shareMessage(ctx, currency, employeeId = null) {
  const { s, c, st } = ctx;
  const m = v => `${docs.cellText(fl(v))} ${currency}`;
  const num6 = String(s.number).padStart(6, '0');
  const L = [];
  const stk = stockGapText;
  const mine = employeeId != null && Array.isArray(c.employees) ? c.employees.find(x => Number(x.employee_id) === Number(employeeId)) : null;
  // Message destiné à un employé sans situation individuelle (ancien rapport, ou employé sans situation sur ce quart) : jamais le message complet (il contient les collègues et la caisse globale).
  if (employeeId != null && !mine) {
    const alone = !(Array.isArray(c.employees) && c.employees.length) && ctx.emps && ctx.emps.length <= 1;   // seul employé du quart : le rapport complet est sa propre situation
    if (!alone) return `*${st.name || 'Station'}* - Quart ${num6} (${s.kind})\n\nVotre situation individuelle n'est pas disponible pour ce quart (rapport enregistré avant la séparation par employé). Rapprochez-vous du responsable du quart.`;
  }
  if (mine) {
    // Message individuel : gabarit unique (src/shift_message.js), uniquement la situation de CET employé
    return individualMessage({ stationName: st.name, currency, shift: s, mine, anomalies: c.anomalies, fixes: (c.attribution_check && c.attribution_check.fixes) || [], tz: process.env.APP_TZ || process.env.FLEET_TZ || 'Africa/Bamako' });
  }
  L.push(`*${st.name || 'Station'}* - Rapport de quart ${num6} (${s.kind})`);
  L.push(`Ouverture : ${docs.fmtDate(s.opened_at)}`, `Fermeture : ${docs.fmtDate(s.closed_at)}`, `Responsable : ${s.manager}`, '');
  L.push(`Carburant (compteurs) : ${m(c.fuel_total)}`);
  L.push(`Autres produits / ventes : ${m(c.other_sales?.total)}`);
  if (c.counters?.length) {
    L.push('', 'Pompes / compteurs :');
    for (const x of c.counters) L.push(`- ${x.pump} / ${x.counter} (${x.product}) : ${x.index_start} -> ${x.index_end}, ${docs.cellText(fl(x.liters))} L, ${m(x.amount)}`);
  }
  const fp = c.fuel_payments || {};
  L.push('', 'Paiements carburant :', `- Espèces : ${m(fp.especes)}`, `- Mobile money : ${m(fp.mobile_money)}`, `- Carte : ${m(fp.carte)}`, `- Crédit : ${m(fp.credit)}`);
  if (fp.autres) L.push(`- Autres : ${m(fp.autres)}`);
  const cash = c.cash || {};
  L.push('', 'Caisse :', `- Théorique : ${m(cash.theoretical)}`, `- Comptée : ${m(cash.counted)}`, `- Écart : ${m(cash.gap)}`);
  if (Array.isArray(c.employees) && c.employees.length) {
    L.push('', 'Situation par employé :');
    for (const e of c.employees) L.push(`- ${e.name} (${(e.pumps || []).join(', ') || 'sans pompe'}) : écart de caisse ${e.cash_gap == null ? 'n/d' : m(e.cash_gap)} ; écarts de stock ${stk(e.stock_gaps)}`);
    if (c.unassigned && ((c.unassigned.cash_gap && Math.abs(c.unassigned.cash_gap) > 0.004) || (c.unassigned.stock_gaps || []).length))
      L.push(`- Non attribué à un employé : écart de caisse ${c.unassigned.cash_gap ? m(c.unassigned.cash_gap) : '-'} ; écarts de stock ${stk(c.unassigned.stock_gaps)}`);
    const an = (c.anomalies || []).filter(a => a.employee && a.kind !== 'ecart_caisse' && a.kind !== 'ecart_stock');   // les écarts de caisse (FCFA) et de stock (quantités) sont déjà ci-dessus, chacun avec son unité
    if (an.length) { L.push('', 'Anomalies par employé :'); for (const a of an) L.push(`- ${a.employee} : ${String(a.description || '').replace(/\s+/g, ' ').trim()}${reportedTxt(a)}`); }
  }
  L.push('', `Justification des écarts : ${s.gap_justification || '-'}`, `Observations : ${s.observations || '-'}`);
  return L.join('\n');
}

/** Coordonnées des personnes concernées + message prêt à envoyer (aucune limite de 200 ventes côté navigateur). */
r.get('/shifts/:id/report-contacts', need(...SHARE_PERMS), wrap(async (req, res) => {
  const ctx = await shareContext(req.sid, req.params.id);
  const b = await docs.branding(req.sid);
  const st = { name: ctx.st.name || null, email: cleanEmail(ctx.st.email), whatsapp: waNumber(ctx.st.phone), phone: ctx.st.phone || null };
  res.json({
    shift: { id: ctx.s.id, number: ctx.s.number, kind: ctx.s.kind },
    station: st,
    employees: ctx.emps.map(e => ({ id: e.id, name: e.name, email: cleanEmail(e.email), whatsapp: waNumber(e.phone), phone: e.phone || null, message: shareMessage(ctx, b.currency, e.id) })),
    closer: ctx.closer && { name: ctx.closer.name, login: ctx.closer.login, email: cleanEmail(ctx.closer.email), whatsapp: waNumber(ctx.closer.phone), phone: ctx.closer.phone || null },
    message: shareMessage(ctx, b.currency)
  });
}));

/** Envoi du rapport PDF par e-mail : « employees » (employés concernés) ou « closer » (personne qui a clôturé). */
r.post('/shifts/:id/report-email', need(...SHARE_PERMS), body(z.object({ mode: z.enum(['employees', 'closer', 'employee']), employee_id: z.number().int().optional() })), wrap(async (req, res) => {
  const ctx = await shareContext(req.sid, req.params.id);
  const { buf, s } = await shiftReport(req.sid, req.params.id);
  const companyEmail = cleanEmail(ctx.st.email);
  let targets = [], fallback = false;
  const sharedReport = Array.isArray(ctx.c.employees) && ctx.c.employees.length > 0;
  if (req.body.mode === 'employees' || req.body.mode === 'employee') {
    const seen = new Set();
    let list = ctx.emps;
    if (req.body.mode === 'employee') {
      list = ctx.emps.filter(e => Number(e.id) === Number(req.body.employee_id));
      if (!list.length) throw new HttpError(404, "Cet employé n'est pas concerné par ce quart");
    }
    // Rapport récent : chaque employé reçoit SA situation uniquement ; seuls les employés ayant une situation sur le quart sont destinataires
    if (sharedReport) list = list.filter(e => ctx.c.employees.some(x => Number(x.employee_id) === Number(e.id)));
    // Ancien rapport (sans situation par employé) : le PDF complet contient les collègues et la caisse globale → envoyé seulement s'il n'y a qu'un employé concerné.
    else if (ctx.emps.length > 1) throw new HttpError(409, "Ce rapport a été clôturé avant la séparation par employé : il ne peut pas être envoyé aux employés sans montrer la situation de leurs collègues. Envoyez-le à la personne qui a clôturé.");
    for (const e of list) { const a = cleanEmail(e.email); if (a && !seen.has(a)) { seen.add(a); targets.push({ id: e.id, name: e.name, email: a }); } }
  } else {
    const a = cleanEmail(ctx.closer?.email);
    if (a) targets.push({ name: ctx.closer.name, email: a });
  }
  if (!targets.length && companyEmail) { targets = [{ name: ctx.st.name || 'Station', email: companyEmail }]; fallback = true; }
  if (!targets.length) {
    throw new HttpError(422, req.body.mode === 'employees'
      ? "Aucune adresse e-mail disponible : renseignez l'e-mail des employés concernés (fiche employé) ou celui de l'entreprise (Paramètres > Station)."
      : "Aucune adresse e-mail disponible pour la personne qui a clôturé : renseignez son e-mail (fiche employé) ou celui de l'entreprise (Paramètres > Station).");
  }
  const { sendMail } = require('./mailer');
  const num6 = String(s.number).padStart(6, '0');
  const subject = `Rapport de quart ${num6} - ${ctx.st.name || 'Station'}`;
  const sent = [], failed = [];
  for (const t of targets) {   // un e-mail par destinataire : les adresses ne sont pas exposées entre elles
    try {
      const personal = sharedReport && t.id != null && req.body.mode !== 'closer';
      const pdf = personal ? (await shiftReport(req.sid, req.params.id, { employeeId: t.id })).buf : buf;
      const text = personal
        ? `Bonjour ${t.name},\n\nVeuillez trouver ci-joint votre situation personnelle sur le quart ${num6} (${s.kind}), clôturé le ${docs.fmtDate(s.closed_at)} : vos pompes, vos ventes, vos écarts et vos anomalies uniquement.\n\n${ctx.st.name || ''}`.trim()
        : `Bonjour ${t.name},\n\nVeuillez trouver ci-joint le rapport du quart ${num6} (${s.kind}), clôturé le ${docs.fmtDate(s.closed_at)}.\n\n${ctx.st.name || ''}`.trim();
      await sendMail({ to: t.email, subject: personal ? `Votre situation sur le quart ${num6} - ${ctx.st.name || 'Station'}` : subject, text,
        attachments: [{ filename: personal ? `quart-${s.number}-employe-${t.id}.pdf` : `quart-${s.number}.pdf`, content: pdf, contentType: 'application/pdf' }] });
      sent.push(t.email);
    } catch (e) {
      if (e.status === 501) throw e;   // SMTP non configuré : message explicite, inutile de réessayer
      failed.push({ email: t.email, error: e.message });
    }
  }
  await audit(pool, req, 'quarts', `Envoi e-mail du rapport de quart ${num6} (${req.body.mode})`, 'shifts', s.id, null, { mode: req.body.mode, sent, failed: failed.map(f => f.email), fallback_company: fallback });
  if (!sent.length) throw new HttpError(502, "L'envoi de l'e-mail a échoué : " + (failed[0]?.error || 'erreur inconnue'));
  res.json({ ok: true, sent_to: sent, failed, fallback_company: fallback });
}));

r.get('/finance/audit', need('audit.view'), wrap(async (req, res) => {
  const { from, to } = parse(req), fmt = req.query.format || 'pdf';
  const { rows } = await pool.query("SELECT a.created_at, COALESCE(u.login, '') AS login, a.module, a.action, COALESCE(a.old_value::text, '') AS old_value, COALESCE(a.new_value::text, '') AS new_value FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id WHERE a.station_id = $1 AND a.created_at >= $2::date AND a.created_at < $3::date + 1 ORDER BY a.id", [req.sid, from, to]);
  const head = ['Date', 'Utilisateur', 'Module', 'Action', 'Ancienne valeur', 'Nouvelle valeur'], data = rows.map(x => [x.created_at, x.login, x.module, x.action, x.old_value.slice(0, 200), x.new_value.slice(0, 200)]);
  if (fmt === 'csv') return docs.send(res, 'csv', docs.csv(head, data), `audit-${to}`);
  const b = await docs.branding(req.sid), sub = `Période du ${from} au ${to}`;
  if (fmt === 'xlsx') return docs.send(res, 'xlsx', await docs.buildXlsx({ b, title: "Journal d'audit", subtitle: sub, ref: `AUD-${to.replace(/-/g, '')}`, sheets: [{ name: 'Audit', head, rows: data }] }), `audit-${to}`);
  docs.send(res, 'pdf', await docs.buildPdf({ b, title: "RAPPORT D'AUDIT", subtitle: sub, ref: `AUD-${to.replace(/-/g, '')}`, sections: [{ type: 'table', title: 'Opérations tracées', head, rows: data }], signatures: [{ label: 'Contrôleur' }, { label: 'Administrateur' }] }), `audit-${to}`);
}));


// ---------- Journal financier normalisé (P4) ----------
const EVENT_TYPES = ['VENTE','ACHAT','PAIEMENT_CLIENT','PAIEMENT_FOURNISSEUR','DEPENSE','AVANCE','REMBOURSEMENT','PRET','REMBOURSEMENT_PRET','PERTE','ECART','TRANSFERT','AUTRE'];

r.get('/finance/events', need(...VIEW, 'cash.manage'), wrap(async (req, res) => {
  const params = [req.sid];
  const where = ['station_id = $1'];
  if (req.query.type && EVENT_TYPES.includes(req.query.type)) {
    params.push(req.query.type); where.push(`event_type = $${params.length}`);
  }
  if (req.query.from) { params.push(req.query.from); where.push(`event_at >= $${params.length}::date`); }
  if (req.query.to) { params.push(req.query.to); where.push(`event_at < $${params.length}::date + 1`); }
  if (req.query.customer_id) { params.push(+req.query.customer_id); where.push(`customer_id = $${params.length}`); }
  if (req.query.supplier_id) { params.push(+req.query.supplier_id); where.push(`supplier_id = $${params.length}`); }
  if (req.query.from && req.query.to && String(req.query.from) > String(req.query.to)) throw new HttpError(400, 'La date de début ne peut pas être postérieure à la date de fin');
  const whereSql = where.join(' AND '), filterParams = params.slice();
  // limit : 100 par défaut ; jusqu'à 5000 pour l'export PDF (même plafond que le moteur de rapports)
  params.push(Math.min(+req.query.limit || 100, 5000));
  const { rows } = await pool.query(
    `SELECT * FROM financial_events WHERE ${whereSql} ORDER BY event_at DESC, id DESC LIMIT $${params.length}`,
    params
  ).catch(e => {
    if (e.code === '42P01') return { rows: [] };
    throw e;
  });
  const inSum = rows.filter(x => x.direction === 'in').reduce((a, x) => a + Number(x.amount), 0);
  const outSum = rows.filter(x => x.direction === 'out').reduce((a, x) => a + Number(x.amount), 0);
  // Totaux sur TOUTE la période filtrée (pas seulement les lignes renvoyées) : `totals` reste inchangé (lignes renvoyées), `period_totals` est exact.
  const { rows: [agg] } = await pool.query(
    `SELECT COUNT(*)::int AS n,
            COALESCE(SUM(amount) FILTER (WHERE direction = 'in'), 0) AS total_in,
            COALESCE(SUM(amount) FILTER (WHERE direction = 'out'), 0) AS total_out
       FROM financial_events WHERE ${whereSql}`, filterParams
  ).catch(e => { if (e.code === '42P01') return { rows: [{ n: 0, total_in: 0, total_out: 0 }] }; throw e; });
  const pIn = Number(agg.total_in), pOut = Number(agg.total_out);
  res.json({
    lines: rows,
    totals: { in: inSum, out: outSum, net: inSum - outSum },
    period_totals: { count: agg.n, in: pIn, out: pOut, net: pIn - pOut, truncated: agg.n > rows.length },
    event_types: EVENT_TYPES,
    note: 'Journal métier P4 — complète caisse/comptes sans les remplacer.'
  });
}));

r.post('/finance/events', need('money.manage', 'cash.manage'), body(z.object({
  event_type: z.enum(['VENTE','ACHAT','PAIEMENT_CLIENT','PAIEMENT_FOURNISSEUR','DEPENSE','AVANCE','REMBOURSEMENT','PRET','REMBOURSEMENT_PRET','PERTE','ECART','TRANSFERT','AUTRE']),
  direction: z.enum(['in','out','neutral']),
  amount: z.number().positive(),
  label: z.string().min(1).max(200),
  method: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  customer_id: z.number().int().optional().nullable(),
  supplier_id: z.number().int().optional().nullable(),
  employee_id: z.number().int().optional().nullable(),
  apply_settle: z.boolean().optional() // si true + method : impacte caisse/compte
})), wrap(async (req, res) => {
  const b = req.body;
  const out = await tx(async c => {
    let settleMeta = null;
    if (b.apply_settle && b.method) {
      const signed = b.direction === 'out' ? -b.amount : b.amount;
      settleMeta = await settle(c, {
        station: req.sid, method: b.method, amount: signed, label: b.label,
        ref: ['financial_events', null], by: req.user.id,
        event_type: b.event_type, customer_id: b.customer_id, supplier_id: b.supplier_id,
        employee_id: b.employee_id, description: b.description
      });
      // settle already wrote event if event_type set
      return { settled: true, method: settleMeta.code };
    }
    const id = await recordFinancialEvent(c, {
      station: req.sid, event_type: b.event_type, direction: b.direction, amount: b.amount,
      label: b.label, method: b.method, customer_id: b.customer_id, supplier_id: b.supplier_id,
      employee_id: b.employee_id, description: b.description, by: req.user.id
    });
    await audit(c, req, 'finance', `Événement ${b.event_type} ${b.amount}`, 'financial_events', id, null, b);
    return { id, settled: false };
  });
  res.status(201).json(out);
}));

r.get('/finance/events/summary', need(...VIEW, 'report.view'), wrap(async (req, res) => {
  const from = req.query.from || new Date().toISOString().slice(0, 7) + '-01';
  const to = req.query.to || new Date().toISOString().slice(0, 10);
  const { rows } = await pool.query(
    `SELECT event_type, direction, COUNT(*)::int AS n, COALESCE(SUM(amount),0) AS total
     FROM financial_events
     WHERE station_id = $1 AND event_at >= $2::date AND event_at < $3::date + 1
     GROUP BY event_type, direction ORDER BY event_type`,
    [req.sid, from, to]
  ).catch(e => {
    if (e.code === '42P01') return { rows: [] };
    throw e;
  });
  res.json({ from, to, by_type: rows });
}));


// ---------- Prêts hors-exploitation (personnels / tiers) ----------
const LOAN_VIEW = ['cash.manage', 'finance.view', 'money.manage'];
r.get('/finance/loans', need(...LOAN_VIEW), wrap(async (req, res) => {
  const status = req.query.status;
  let q = `SELECT pl.*, (pl.amount - pl.repaid_amount) AS balance
           FROM personal_loans pl WHERE pl.station_id = $1`;
  const params = [req.sid];
  if (status) { params.push(status); q += ` AND pl.status = $${params.length}`; }
  q += ' ORDER BY pl.loan_date DESC, pl.id DESC';
  const { rows } = await pool.query(q, params).catch(e => {
    if (e.code === '42P01') return { rows: [] };
    throw e;
  });
  res.json(rows);
}));

r.post('/finance/loans', need('money.manage', 'cash.manage'), body(z.object({
  borrower_name: z.string().min(2),
  borrower_phone: z.string().optional().nullable(),
  amount: z.number().positive(),
  // Compte / mode de sortie des fonds (obligatoire) — réduction de liquidité
  method: z.string().min(1),
  loan_date: ymd.optional(),
  due_date: ymd.optional().nullable(),
  notes: z.string().optional().nullable()
})), wrap(async (req, res) => {
  const b = req.body;
  const out = await tx(async c => {
    const { rows: [row] } = await c.query(
      `INSERT INTO personal_loans(station_id, borrower_name, borrower_phone, amount, loan_date, due_date, notes, created_by)
       VALUES ($1,$2,$3,$4,COALESCE($5::date, CURRENT_DATE),$6,$7,$8)
       RETURNING *`,
      [req.sid, b.borrower_name, b.borrower_phone || null, b.amount, b.loan_date || null, b.due_date || null, b.notes || null, req.user.id]
    );
    // Sortie de fonds : baisse caisse ou compte rattaché au moyen
    await settle(c, {
      station: req.sid, method: b.method, amount: -b.amount,
      label: 'Prêt hors-exploitation à ' + b.borrower_name,
      ref: ['personal_loans', row.id], by: req.user.id,
      event_type: 'TRANSFERT', description: b.notes || 'Prêt hors-exploitation'
    });
    await audit(c, req, 'finance', `Prêt ${b.amount} à ${b.borrower_name} (${b.method})`, 'personal_loans', row.id, null, b);
    return row;
  });
  res.status(201).json(out);
}));

r.post('/finance/loans/:id/repay', need('money.manage', 'cash.manage'), body(z.object({
  amount: z.number().positive(),
  // Compte / mode d’encaissement du remboursement (obligatoire)
  method: z.string().min(1),
  notes: z.string().optional().nullable()
})), wrap(async (req, res) => {
  const out = await tx(async c => {
    const { rows: [loan] } = await c.query(
      `SELECT * FROM personal_loans WHERE id=$1 AND station_id=$2 FOR UPDATE`, [req.params.id, req.sid]);
    if (!loan) throw new HttpError(404, 'Prêt introuvable');
    if (loan.status === 'repaid' || loan.status === 'written_off') throw new HttpError(409, 'Prêt déjà clôturé');
    const bal = Number(loan.amount) - Number(loan.repaid_amount);
    if (req.body.amount > bal + 0.001) throw new HttpError(400, `Montant supérieur au solde (${bal})`);
    await c.query(
      `INSERT INTO personal_loan_payments(loan_id, amount, method, notes, created_by) VALUES ($1,$2,$3,$4,$5)`,
      [loan.id, req.body.amount, req.body.method, req.body.notes || null, req.user.id]);
    // Rentrée de fonds sur le compte / caisse sélectionné
    await settle(c, {
      station: req.sid, method: req.body.method, amount: req.body.amount,
      label: 'Remboursement prêt hors-exploitation N° ' + loan.id,
      ref: ['personal_loans', loan.id], by: req.user.id,
      event_type: 'TRANSFERT', description: req.body.notes || null
    });
    const newRepaid = Number(loan.repaid_amount) + req.body.amount;
    const status = newRepaid >= Number(loan.amount) - 0.001 ? 'repaid' : 'partial';
    const { rows: [upd] } = await c.query(
      `UPDATE personal_loans SET repaid_amount=$2, status=$3, updated_at=now() WHERE id=$1 AND station_id=$4 RETURNING *, (amount - repaid_amount) AS balance`,
      [loan.id, newRepaid, status, req.sid]);
    await audit(c, req, 'finance', `Remboursement prêt ${req.body.amount} (${req.body.method})`, 'personal_loans', loan.id, loan, upd);
    return upd;
  });
  res.json(out);
}));

r.patch('/finance/loans/:id', need('money.manage'), body(z.object({
  status: z.enum(['open', 'partial', 'repaid', 'written_off']).optional(),
  notes: z.string().optional().nullable(),
  due_date: ymd.optional().nullable()
})), wrap(async (req, res) => {
  const fields = [], vals = [];
  let i = 1;
  for (const k of ['status', 'notes', 'due_date']) {
    if (req.body[k] !== undefined) { fields.push(`${k}=$${i++}`); vals.push(req.body[k]); }
  }
  if (!fields.length) throw new HttpError(400, 'Rien à modifier');
  vals.push(req.params.id, req.sid);
  const { rows: [row] } = await pool.query(
    `UPDATE personal_loans SET ${fields.join(',')}, updated_at=now()
     WHERE id=$${i++} AND station_id=$${i} RETURNING *`, vals);
  if (!row) throw new HttpError(404, 'Prêt introuvable');
  res.json(row);
}));



/** Taux de commission Mobile Money (calcul local, gratuit — aucun API opérateur).
 *  Stockage direct dans settings (clé hors registre KEYS admin — lecture SQL dédiée). */
async function loadMmCommissionRates(stationId) {
  const { rows: [row] } = await pool.query(
    `SELECT value FROM settings WHERE station_id = $1 AND key = 'mm_commission_rates'`, [stationId]);
  const v = row && row.value;
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return {
      wave: Number(v.wave) || 0,
      orange_money: Number(v.orange_money) || 0,
      mobile_money: Number(v.mobile_money) || 0,
      history: Array.isArray(v.history) ? v.history : [],
      note: v.note || 'Pourcentage (ex: 1.5 = 1,5 %). 0 = pas de commission.'
    };
  }
  return { wave: 0, orange_money: 0, mobile_money: 0, history: [], note: 'Pourcentage (ex: 1.5 = 1,5 %). 0 = pas de commission.' };
}

r.get('/money/commission-rates', need('finance.view', 'cash.manage', 'money.manage'), wrap(async (req, res) => {
  res.json(await loadMmCommissionRates(req.sid));
}));

r.put('/money/commission-rates', need('money.manage', 'settings.edit'), body(z.object({
  wave: z.number().min(0).max(100).optional(),
  orange_money: z.number().min(0).max(100).optional(),
  mobile_money: z.number().min(0).max(100).optional()
}).passthrough()), wrap(async (req, res) => {
  const cur = await loadMmCommissionRates(req.sid);
  const next = {
    wave: req.body.wave != null ? Number(req.body.wave) : cur.wave,
    orange_money: req.body.orange_money != null ? Number(req.body.orange_money) : cur.orange_money,
    mobile_money: req.body.mobile_money != null ? Number(req.body.mobile_money) : cur.mobile_money,
    note: cur.note || 'Pourcentage (ex: 1.5 = 1,5 %). 0 = pas de commission.'
  };
  const hist = Array.isArray(cur.history) ? cur.history.slice() : [];
  const changed = cur.wave !== next.wave
    || cur.orange_money !== next.orange_money
    || cur.mobile_money !== next.mobile_money;
  // Toujours journaliser un enregistrement explicite (même taux identiques → trace d’audit UI)
  hist.unshift({
    at: new Date().toISOString(),
    by: (req.user && (req.user.login || req.user.full_name)) || null,
    wave: next.wave,
    orange_money: next.orange_money,
    mobile_money: next.mobile_money,
    prev: { wave: cur.wave, orange_money: cur.orange_money, mobile_money: cur.mobile_money },
    unchanged: !changed
  });
  if (hist.length > 50) hist.length = 50;
  next.history = hist;
  await pool.query(
    `INSERT INTO settings(station_id, key, value) VALUES ($1,'mm_commission_rates',$2::jsonb)
     ON CONFLICT (station_id, key) DO UPDATE SET value = EXCLUDED.value`,
    [req.sid, JSON.stringify(next)]
  );
  await audit(pool, req, 'finance', 'Taux commission Mobile Money mis à jour', null, null, cur, next);
  res.json(next);
}));

r.get('/money/commission-rates/history', need('finance.view', 'cash.manage', 'money.manage'), wrap(async (req, res) => {
  const rates = await loadMmCommissionRates(req.sid);
  res.json({ history: rates.history || [] });
}));

r.get('/money/commission-report', need('finance.view', 'report.view'), wrap(async (req, res) => {
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from||'')) ? req.query.from : new Date().toISOString().slice(0, 10);
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to||'')) ? req.query.to : from;
  if (from > to) throw new HttpError(400, 'La date de début ne peut pas être postérieure à la date de fin');
  const rates = await loadMmCommissionRates(req.sid);
  const { rows } = await pool.query(
    `SELECT COALESCE(pm.code, p.method) AS code, COALESCE(pm.label, p.method) AS label, COALESCE(pm.kind,'autre') AS kind,
            SUM(p.amount)::float AS gross
       FROM payments p
       LEFT JOIN sales s ON s.id = p.sale_id
       LEFT JOIN payment_methods pm ON pm.station_id = p.station_id AND pm.code = p.method
      WHERE p.station_id=$1 AND p.paid_at >= $2::date AND p.paid_at < $3::date + 1
        AND (s.id IS NULL OR s.status='valide')
      GROUP BY 1,2,3 ORDER BY 4 DESC`, [req.sid, from, to]);
  const lines = rows.map(r => {
    const rate = Number(rates[r.code] != null ? rates[r.code] : (rates[r.kind] != null ? rates[r.kind] : 0)) || 0;
    const commission = r.kind === 'mobile_money' || rate > 0 ? (r.gross * rate / 100) : 0;
    return { ...r, rate_pct: rate, commission, net: r.gross - commission };
  });
  res.json({ from, to, rates, lines, total_gross: lines.reduce((a,x)=>a+x.gross,0), total_commission: lines.reduce((a,x)=>a+x.commission,0) });
}));

module.exports = r;
