// Ressources humaines : fiche employé, historique, écarts, dettes, avances, paie, bulletins, situation financière.
const express = require('express');
const { z } = require('zod');
const { pool, tx, fl, HttpError, wrap, body, need, audit, settle } = require('./core');
const files = require('./files');
const { getSetting } = require('./admin');
const docs = require('./docs');
const r = express.Router();

const D = c => `to_char(${c}, 'YYYY-MM-DD')`;
const EMP_COLS = `id, station_id, user_id, matricule, last_name, first_name, phone, position, status, address, email, base_salary, contract_type, photo_path, gender, birth_place, emergency_contact, emergency_phone, department, team, manager_id, payment_method, notes, ${D('birth_date')} AS birth_date, ${D('hired_on')} AS hired_on, ${D('contract_start')} AS contract_start, ${D('contract_end')} AS contract_end`;
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date AAAA-MM-JJ');
const ym = z.string().regex(/^\d{4}-\d{2}$/, 'Mois AAAA-MM');
const monthStart = m => { if (!/^\d{4}-\d{2}$/.test(m || '')) throw new HttpError(400, 'Mois invalide (AAAA-MM)'); return m + '-01'; };
const today = () => new Date().toISOString().slice(0, 10);
const range = req => { const f = /^\d{4}-\d{2}-\d{2}$/; const from = f.test(req.query.from) ? req.query.from : today().slice(0, 8) + '01', to = f.test(req.query.to) ? req.query.to : today(); return [from, to]; };
const DEBT_PAID = 'COALESCE((SELECT SUM(p.amount) FROM employee_debt_payments p WHERE p.debt_id = d.id), 0)';

// Accès à la fiche : droits RH, ou l'employé lui-même (son propre compte uniquement)
async function emp(req, id) {
  const { rows: [e] } = await pool.query(`SELECT ${EMP_COLS} FROM employees WHERE id = $1 AND station_id = $2 AND deleted_at IS NULL`, [id, req.sid]);
  if (!e) throw new HttpError(404, 'Employé introuvable');
  const P = req.user.perms, self = e.user_id === req.user.id;
  if (!(self || ['hr.view', 'hr.manage', 'hr.payroll', 'hr.debts', 'hr.gaps'].some(p => P.has(p)))) throw new HttpError(403, "Vous n'avez pas accès à cette fiche");
  if (!(self || P.has('hr.manage') || P.has('hr.payroll'))) delete e.base_salary;   // le salaire n'est visible que pour la paie, l'administration ou l'intéressé
  return e;
}
const fullName = e => `${e.first_name} ${e.last_name}`;

// ---------- Fiche, modification, historique ----------
r.get('/hr/me', wrap(async (req, res) => {   // la fiche de l'utilisateur connecté (accès à ses propres informations)
  const { rows: [e] } = await pool.query('SELECT id FROM employees WHERE user_id = $1 AND station_id = $2 AND deleted_at IS NULL', [req.user.id, req.sid]);
  res.json(e || null);
}));
r.get('/hr/employees/:id', wrap(async (req, res) => {
  const e = await emp(req, req.params.id);
  const [h, d, a] = await Promise.all([
    pool.query(`SELECT h.field, h.old_value, h.new_value, h.changed_at, u.login FROM employee_history h LEFT JOIN users u ON u.id = h.changed_by WHERE h.employee_id = $1 ORDER BY h.id DESC LIMIT 60`, [e.id]),
    pool.query(`SELECT COALESCE(SUM(d.amount),0) AS initial, COALESCE(SUM(${DEBT_PAID}),0) AS repaid FROM employee_debts d WHERE d.employee_id = $1 AND d.status <> 'annule'`, [e.id]),
    pool.query("SELECT COALESCE(SUM(amount - deducted),0) AS outstanding FROM salary_advances WHERE employee_id = $1 AND status = 'en_cours'", [e.id]),
  ]);
  res.json({ employee: e, history: h.rows, debts: { initial: d.rows[0].initial, repaid: d.rows[0].repaid, balance: fl(d.rows[0].initial - d.rows[0].repaid) }, advances_outstanding: a.rows[0].outstanding });
}));
const patchSchema = z.object({
  matricule: z.string().min(1), last_name: z.string().min(1), first_name: z.string().min(1), phone: z.string().nullable(), position: z.string().min(1),
  status: z.enum(['actif', 'suspendu', 'inactif']), address: z.string().nullable(), email: z.string().nullable(), base_salary: z.number().min(0),
  contract_type: z.string().nullable(), hired_on: ymd.nullable(), contract_start: ymd.nullable(), contract_end: ymd.nullable(), user_id: z.number().int().nullable(),
  gender: z.string().nullable(), birth_date: ymd.nullable(), birth_place: z.string().nullable(),
  emergency_contact: z.string().nullable(), emergency_phone: z.string().nullable(),
  department: z.string().nullable(), team: z.string().nullable(), manager_id: z.number().int().nullable(),
  payment_method: z.string().nullable(), notes: z.string().nullable()
}).partial().strict();
r.patch('/hr/employees/:id', need('hr.manage'), body(patchSchema), wrap(async (req, res) => {
  const keys = Object.keys(req.body); if (!keys.length) throw new HttpError(400, 'Aucun champ à modifier');
  await tx(async c => {
    const { rows: [old] } = await c.query(`SELECT ${EMP_COLS} FROM employees WHERE id = $1 AND station_id = $2 FOR UPDATE`, [req.params.id, req.sid]);
    if (!old) throw new HttpError(404, 'Employé introuvable');
    const changed = keys.filter(k => String(req.body[k] ?? '') !== String(old[k] ?? ''));
    if (!changed.length) return;
    await c.query(`UPDATE employees SET ${changed.map((k, i) => `${k} = $${i + 3}`).join(', ')} WHERE id = $1 AND station_id = $2`, [old.id, req.sid, ...changed.map(k => req.body[k])]);
    for (const k of changed) await c.query('INSERT INTO employee_history(employee_id, field, old_value, new_value, changed_by) VALUES ($1,$2,$3,$4,$5)', [old.id, k, old[k] == null ? null : String(old[k]), req.body[k] == null ? null : String(req.body[k]), req.user.id]);
    if (changed.includes('position')) await require('./role_sync').syncFromEmployee(c, req, old.id, req.body.position);
    if (changed.includes('first_name') || changed.includes('last_name')) await require('./role_sync').syncNameFromEmployee(c, old.id);
    await audit(c, req, 'rh', 'Modification de la fiche de ' + fullName(old), 'employees', old.id, Object.fromEntries(changed.map(k => [k, old[k]])), Object.fromEntries(changed.map(k => [k, req.body[k]])));
  });
  res.json({ ok: true });
}));

// ---------- Historique des quarts et des performances ----------
r.get('/hr/employees/:id/shifts', wrap(async (req, res) => {
  const e = await emp(req, req.params.id), [from, to] = range(req);
  const { rows } = await pool.query(
    `SELECT sh.id, sh.number, sh.kind, sh.status, sh.opened_at, sh.closed_at, u.login AS manager, pu.name AS pump,
            COALESCE((SELECT SUM(sa.total) FROM sales sa WHERE sa.shift_id = sh.id AND sa.employee_id = $2 AND sa.status = 'valide'), 0) AS revenue,
            (SELECT COUNT(*)::int FROM sales sa WHERE sa.shift_id = sh.id AND sa.employee_id = $2 AND sa.status = 'valide') AS operations,
            (SELECT COUNT(*)::int FROM shift_anomalies a WHERE a.shift_id = sh.id) AS anomalies
       FROM shifts sh JOIN users u ON u.id = sh.manager_id LEFT JOIN shift_employees se ON se.shift_id = sh.id AND se.employee_id = $2 LEFT JOIN pumps pu ON pu.id = se.pump_id
      WHERE sh.station_id = $1 AND (se.employee_id IS NOT NULL OR EXISTS (SELECT 1 FROM sales s2 WHERE s2.shift_id = sh.id AND s2.employee_id = $2))
        AND sh.opened_at >= $3::date AND sh.opened_at < $4::date + 1 ORDER BY sh.id DESC LIMIT 200`, [req.sid, e.id, from, to]);
  res.json(rows.map(x => ({ ...x, state: x.status === 'ouvert' ? 'ouvert' : x.anomalies > 0 ? 'en anomalie' : 'clôturé' })));
}));
r.get('/hr/employees/:id/operations', wrap(async (req, res) => {
  const e = await emp(req, req.params.id);
  const { rows } = await pool.query(
    `SELECT sa.id, sa.sold_at, sa.kind, sa.input_mode, sa.total, sa.status, p.name AS product, d.quantity, pu.name AS pump, d.index_old, d.index_new
       FROM sales sa JOIN sale_details d ON d.sale_id = sa.id JOIN products p ON p.id = d.product_id LEFT JOIN pumps pu ON pu.id = sa.pump_id
      WHERE sa.station_id = $1 AND sa.employee_id = $2 AND sa.shift_id = $3 ORDER BY sa.id`, [req.sid, e.id, +req.query.shift_id]);
  res.json(rows);
}));
async function perf(stationId, empId, from, to) {
  const q = sql => pool.query(sql, [stationId, empId, from, to]).then(x => x.rows);
  const base = "FROM sales sa JOIN sale_details d ON d.sale_id = sa.id JOIN products p ON p.id = d.product_id LEFT JOIN pumps pu ON pu.id = sa.pump_id WHERE sa.station_id = $1 AND sa.employee_id = $2 AND sa.status = 'valide' AND sa.sold_at >= $3::date AND sa.sold_at < $4::date + 1";
  const [byProduct, byPump, tot, shifts] = await Promise.all([
    q(`SELECT p.name AS product, SUM(d.quantity) AS quantity, SUM(d.amount) AS amount ${base} GROUP BY p.name ORDER BY 3 DESC`),
    q(`SELECT COALESCE(pu.name, 'Hors pompe') AS pump, SUM(d.quantity) AS quantity, SUM(d.amount) AS amount ${base} AND sa.kind = 'carburant' GROUP BY 1 ORDER BY 3 DESC`),
    q(`SELECT COALESCE(SUM(d.amount),0) AS revenue, COUNT(DISTINCT sa.id)::int AS operations, COALESCE(SUM(CASE WHEN sa.kind = 'carburant' THEN d.quantity END),0) AS liters ${base}`),
    q("SELECT COUNT(DISTINCT sh.id)::int AS n FROM shifts sh LEFT JOIN shift_employees se ON se.shift_id = sh.id AND se.employee_id = $2 WHERE sh.station_id = $1 AND sh.opened_at >= $3::date AND sh.opened_at < $4::date + 1 AND (se.employee_id IS NOT NULL OR EXISTS (SELECT 1 FROM sales s2 WHERE s2.shift_id = sh.id AND s2.employee_id = $2))"),
  ]);
  return { from, to, revenue: tot[0].revenue, operations: tot[0].operations, liters: tot[0].liters, shifts: shifts[0].n, avg_per_shift: shifts[0].n ? fl(tot[0].revenue / shifts[0].n) : 0, by_product: byProduct, by_pump: byPump };
}
r.get('/hr/employees/:id/performance', wrap(async (req, res) => {
  const e = await emp(req, req.params.id), [from, to] = range(req);
  const days = Math.round((new Date(to) - new Date(from)) / 864e5) + 1, pTo = new Date(new Date(from) - 864e5).toISOString().slice(0, 10), pFrom = new Date(new Date(from) - days * 864e5).toISOString().slice(0, 10);
  const cur = await perf(req.sid, e.id, from, to), prev = await perf(req.sid, e.id, pFrom, pTo);
  res.json({ ...cur, previous: { from: pFrom, to: pTo, revenue: prev.revenue, shifts: prev.shifts, liters: prev.liters }, variation_pct: prev.revenue ? fl((cur.revenue - prev.revenue) / prev.revenue * 100) : null,
    note: "Le chiffre d'affaires attribué est celui des ventes saisies par l'employé : ce n'est ni un bénéfice ni une somme lui appartenant." });
}));

// ---------- Écarts : attribution, justification, décision (aucune retenue automatique) ----------
const GAP_SQL = `SELECT g.id, g.shift_id, sh.number AS shift_number, g.kind, g.amount, g.status, g.employee_id, g.product_id, p.name AS product, g.employee_justification, g.manager_decision,
   e.first_name || ' ' || e.last_name AS employee, g.created_at, (SELECT id FROM employee_debts d WHERE d.gap_id = g.id AND d.status <> 'annule' LIMIT 1) AS debt_id
   FROM employee_gaps g JOIN shifts sh ON sh.id = g.shift_id LEFT JOIN products p ON p.id = g.product_id LEFT JOIN employees e ON e.id = g.employee_id`;
r.get('/hr/gaps', need('hr.view', 'hr.gaps'), wrap(async (req, res) => {
  const { rows } = await pool.query(`${GAP_SQL} WHERE g.station_id = $1 AND ($2::text IS NULL OR g.status = $2) AND ($3::bigint IS NULL OR g.employee_id = $3) AND ($4::boolean IS NOT TRUE OR g.employee_id IS NULL) ORDER BY g.id DESC LIMIT 200`,
    [req.sid, req.query.status || null, req.query.employee_id ? +req.query.employee_id : null, req.query.unassigned === '1']);
  res.json(rows);
}));
r.get('/hr/employees/:id/gaps', wrap(async (req, res) => {
  const e = await emp(req, req.params.id);
  const { rows } = await pool.query(`${GAP_SQL} WHERE g.station_id = $1 AND g.employee_id = $2 ORDER BY g.id DESC`, [req.sid, e.id]);
  for (const g of rows) g.events = (await pool.query('SELECT ev.action, ev.note, ev.from_status, ev.to_status, ev.created_at, u.login FROM employee_gap_events ev LEFT JOIN users u ON u.id = ev.user_id WHERE ev.gap_id = $1 ORDER BY ev.id', [g.id])).rows;
  res.json(rows);
}));
// Anomalies déclarées ou constatées au nom de cet employé (rattachées à son profil)
r.get('/hr/employees/:id/anomalies', wrap(async (req, res) => {
  const e = await emp(req, req.params.id);
  const { rows } = await pool.query(
    `SELECT sa.id, sa.shift_id, sh.number AS shift_number, sa.kind, sa.description, sa.amount, sa.created_at,
            (SELECT g.id FROM employee_gaps g WHERE g.anomaly_id = sa.id LIMIT 1) AS gap_id
       FROM shift_anomalies sa JOIN shifts sh ON sh.id = sa.shift_id
      WHERE sh.station_id = $1 AND sa.employee_id = $2 ORDER BY sa.id DESC LIMIT 500`, [req.sid, e.id]);
  res.json(rows);
}));
const gapEvent = (c, gap, action, note, from, to, user) => c.query('INSERT INTO employee_gap_events(gap_id, action, note, from_status, to_status, user_id) VALUES ($1,$2,$3,$4,$5,$6)', [gap, action, note || null, from, to, user]);
async function gap(c, req, id) {
  const { rows: [g] } = await c.query('SELECT * FROM employee_gaps WHERE id = $1 AND station_id = $2 FOR UPDATE', [id, req.sid]);
  if (!g) throw new HttpError(404, 'Écart introuvable'); return g;
}
r.post('/hr/gaps/:id/assign', need('hr.gaps'), body(z.object({ employee_id: z.number().int(), force: z.boolean().default(false) })), wrap(async (req, res) => {
  await tx(async c => {
    const g = await gap(c, req, req.params.id);
    if (g.status !== 'en_attente') throw new HttpError(409, "L'écart n'est plus en attente : l'attribution est figée");
    const { rows: [e] } = await c.query('SELECT id, first_name, last_name FROM employees WHERE id = $1 AND station_id = $2', [req.body.employee_id, req.sid]);
    if (!e) throw new HttpError(400, 'Employé inconnu');
    const { rowCount } = await c.query('SELECT 1 FROM shift_employees WHERE shift_id = $1 AND employee_id = $2', [g.shift_id, e.id]);
    if (!rowCount && !req.body.force) throw new HttpError(409, "Cet employé n'est pas affecté à ce quart (utilisez force pour confirmer)");
    await c.query('UPDATE employee_gaps SET employee_id = $2, updated_at = now() WHERE id = $1 AND station_id = $3', [g.id, e.id, req.sid]);
    await gapEvent(c, g.id, 'attribution', 'Attribué à ' + fullName(e), g.status, g.status, req.user.id);
    await audit(c, req, 'rh', `Écart ${g.id} attribué à ${fullName(e)}`, 'employee_gaps', g.id, { employee_id: g.employee_id }, { employee_id: e.id });
  });
  res.json({ ok: true });
}));
r.post('/hr/gaps/:id/justify', body(z.object({ text: z.string().min(3) })), wrap(async (req, res) => {
  await tx(async c => {
    const g = await gap(c, req, req.params.id);
    const { rows: [e] } = g.employee_id ? await c.query('SELECT user_id FROM employees WHERE id = $1', [g.employee_id]) : { rows: [] };
    if (!(req.user.perms.has('hr.gaps') || (e && e.user_id === req.user.id))) throw new HttpError(403, "Seuls l'employé concerné ou un responsable peuvent justifier cet écart");
    if (g.status === 'cloture') throw new HttpError(409, 'Écart clôturé');
    await c.query('UPDATE employee_gaps SET employee_justification = $2, updated_at = now() WHERE id = $1 AND station_id = $3', [g.id, req.body.text, req.sid]);
    await gapEvent(c, g.id, 'justification', req.body.text, g.status, g.status, req.user.id);
  });
  res.json({ ok: true });
}));
const NEXT = { en_attente: ['accepte', 'conteste', 'cloture'], conteste: ['accepte', 'cloture'], accepte: ['regularise', 'cloture'], regularise: ['cloture'], cloture: [] };
r.post('/hr/gaps/:id/decide', need('hr.gaps', 'hr.payroll'), body(z.object({ status: z.enum(['accepte', 'conteste', 'regularise', 'cloture']), decision: z.string().min(3) })), wrap(async (req, res) => {
  let employeeToTell = null;
  await tx(async c => {
    const g = await gap(c, req, req.params.id);
    if (!NEXT[g.status].includes(req.body.status)) throw new HttpError(409, `Transition impossible : ${g.status} vers ${req.body.status}`);
    if (!g.employee_id && req.body.status !== 'cloture') throw new HttpError(409, "Attribuez d'abord l'écart à un employé");
    await c.query('UPDATE employee_gaps SET status = $2, manager_decision = $3, updated_at = now() WHERE id = $1 AND station_id = $4', [g.id, req.body.status, req.body.decision, req.sid]);
    await gapEvent(c, g.id, 'décision', req.body.decision, g.status, req.body.status, req.user.id);
    await audit(c, req, 'rh', `Écart ${g.id} : ${g.status} vers ${req.body.status}`, 'employee_gaps', g.id, { status: g.status }, { status: req.body.status, decision: req.body.decision });
    employeeToTell = { id: g.employee_id, text: `Décision sur votre écart N° ${g.id} : ${g.status} → ${req.body.status}. ${req.body.decision}` };
  });
  if (employeeToTell && employeeToTell.id) await require('./employee_actions').track(pool, { stationId: req.sid, employeeId: employeeToTell.id, kind: 'decision_ecart', description: employeeToTell.text, actorUserId: req.user.id });
  res.json({ ok: true });
}));
// L'enregistrement d'une dette à partir d'un écart est une décision explicite du gérant
r.post('/hr/gaps/:id/to-debt', need('hr.gaps', 'hr.debts', 'hr.payroll'), body(z.object({ amount: z.number().positive(), reason: z.string().optional() })), wrap(async (req, res) => {
  const out = await tx(async c => {
    const g = await gap(c, req, req.params.id);
    if (g.status !== 'accepte' || !g.employee_id) throw new HttpError(409, "L'écart doit être attribué puis accepté avant de créer une dette");
    if ((await c.query("SELECT 1 FROM employee_debts WHERE gap_id = $1 AND status <> 'annule'", [g.id])).rowCount) throw new HttpError(409, 'Une dette existe déjà pour cet écart');
    const { rows: [d] } = await c.query('INSERT INTO employee_debts(station_id, employee_id, amount, reason, gap_id, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [req.sid, g.employee_id, req.body.amount, req.body.reason || `Écart ${g.kind} du quart ${g.shift_id}`, g.id, req.user.id]);
    await gapEvent(c, g.id, 'dette créée', `Dette N° ${d.id} : ${req.body.amount}`, g.status, g.status, req.user.id);
    await audit(c, req, 'rh', `Dette ${d.id} créée depuis l'écart ${g.id}`, 'employee_debts', d.id, null, { amount: req.body.amount });
    return d;
  });
  await require('./employee_actions').track(pool, { stationId: req.sid, employeeId: out.employee_id, kind: 'dette_employe', amount: out.amount, refTable: 'employee_debts', refId: out.id, actorUserId: req.user.id,
    description: `Dette N° ${out.id} enregistrée à votre nom à partir de l'écart N° ${req.params.id}` });
  res.status(201).json(out);
}));

// ---------- Dettes des employés ----------
const DEBT_SQL = `SELECT d.id, d.employee_id, e.first_name || ' ' || e.last_name AS employee, d.amount, ${D('d.debt_date')} AS debt_date, d.reason, d.method, d.cash_out, d.status, d.attachment_path IS NOT NULL AS has_attachment, d.gap_id,
   ${DEBT_PAID} AS paid, d.amount - ${DEBT_PAID} AS balance FROM employee_debts d JOIN employees e ON e.id = d.employee_id`;
r.get('/hr/debts', need('hr.view', 'hr.debts'), wrap(async (req, res) => {
  const { rows } = await pool.query(`${DEBT_SQL} WHERE d.station_id = $1 AND ($2::bigint IS NULL OR d.employee_id = $2) AND ($3::text IS NULL OR d.status = $3) ORDER BY d.id DESC LIMIT 300`, [req.sid, req.query.employee_id ? +req.query.employee_id : null, req.query.status || null]);
  res.json(rows);
}));
r.get('/hr/employees/:id/debts', wrap(async (req, res) => {
  const e = await emp(req, req.params.id);
  const { rows } = await pool.query(`${DEBT_SQL} WHERE d.employee_id = $1 AND d.station_id = $2 ORDER BY d.id DESC`, [e.id, req.sid]);
  for (const d of rows) {
    d.payments = (await pool.query('SELECT id, amount, method, source, receipt_no, note, paid_at FROM employee_debt_payments WHERE debt_id = $1 ORDER BY id', [d.id])).rows;
    d.edits = (await pool.query('SELECT x.reason, x.old_value, x.new_value, x.changed_at, u.login FROM employee_debt_edits x LEFT JOIN users u ON u.id = x.changed_by WHERE x.debt_id = $1 ORDER BY x.id', [d.id])).rows;
  }
  res.json(rows);
}));
r.get('/hr/debts/:id/attachment', wrap(async (req, res) => {
  const { rows: [d] } = await pool.query('SELECT d.attachment_path, e.user_id FROM employee_debts d JOIN employees e ON e.id = d.employee_id WHERE d.id = $1 AND d.station_id = $2', [req.params.id, req.sid]);
  if (!d || !(req.user.perms.has('hr.view') || req.user.perms.has('hr.debts') || d.user_id === req.user.id)) throw new HttpError(404, 'Introuvable');
  const buf = await files.read(d.attachment_path); if (!buf) throw new HttpError(404, 'Aucune pièce jointe');
  res.set('Content-Type', await files.typeOf(d.attachment_path)).send(buf);
}));
r.post('/hr/debts', need('hr.debts'), body(z.object({ employee_id: z.number().int(), amount: z.number().positive(), reason: z.string().min(3), debt_date: ymd.optional(), method: z.string().optional(), cash_out: z.boolean().default(false), attachment: z.string().optional() })), wrap(async (req, res) => {
  const b = req.body;
  const d = await tx(async c => {
    const { rows: [e] } = await c.query('SELECT id, first_name, last_name FROM employees WHERE id = $1 AND station_id = $2', [b.employee_id, req.sid]);
    if (!e) throw new HttpError(400, 'Employé inconnu');
    const att = b.attachment ? await files.save('debts', b.attachment, true) : null;
    const { rows: [d] } = await c.query('INSERT INTO employee_debts(station_id, employee_id, amount, reason, debt_date, method, cash_out, attachment_path, created_by) VALUES ($1,$2,$3,$4,COALESCE($5::date, CURRENT_DATE),$6,$7,$8,$9) RETURNING id, amount, status',
      [req.sid, e.id, b.amount, b.reason, b.debt_date || null, b.method || null, b.cash_out, att, req.user.id]);
    if (b.cash_out) await settle(c, { station: req.sid, method: b.method || 'especes', amount: -b.amount, label: 'Prêt à ' + fullName(e), ref: ['employee_debts', d.id], by: req.user.id });
    await audit(c, req, 'rh', `Dette créée pour ${fullName(e)} : ${b.amount}`, 'employee_debts', d.id, null, { amount: b.amount, reason: b.reason });
    return d;
  });
  res.status(201).json(d);
}));
r.patch('/hr/debts/:id', need('hr.debts'), body(z.object({ amount: z.number().positive().optional(), reason: z.string().min(3).optional(), debt_date: ymd.optional(), status: z.enum(['en_cours', 'conteste']).optional(), edit_reason: z.string().min(3) }).strict()), wrap(async (req, res) => {
  const { edit_reason, ...ch } = req.body;
  await tx(async c => {
    const { rows: [d] } = await c.query(`SELECT d.*, ${DEBT_PAID} AS paid FROM employee_debts d WHERE d.id = $1 AND d.station_id = $2 FOR UPDATE`, [req.params.id, req.sid]);
    if (!d) throw new HttpError(404, 'Dette introuvable');
    if (['solde', 'annule'].includes(d.status)) throw new HttpError(409, 'Une dette soldée ou annulée ne peut plus être modifiée');
    if (ch.amount != null && ch.amount < d.paid) throw new HttpError(400, `Le montant ne peut pas être inférieur aux remboursements déjà effectués (${d.paid})`);
    const keys = Object.keys(ch); if (!keys.length) throw new HttpError(400, 'Aucun champ à modifier');
    await c.query(`UPDATE employee_debts SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`, [d.id, ...keys.map(k => ch[k])]);
    await c.query('INSERT INTO employee_debt_edits(debt_id, reason, old_value, new_value, changed_by) VALUES ($1,$2,$3,$4,$5)', [d.id, edit_reason, JSON.stringify(Object.fromEntries(keys.map(k => [k, d[k]]))), JSON.stringify(ch), req.user.id]);
    if (ch.amount != null && ch.amount === d.paid) await c.query("UPDATE employee_debts SET status = 'solde' WHERE id = $1", [d.id]);
    await audit(c, req, 'rh', 'Modification de la dette ' + d.id, 'employee_debts', d.id, Object.fromEntries(keys.map(k => [k, d[k]])), { ...ch, motif: edit_reason });
  });
  res.json({ ok: true });
}));
r.post('/hr/debts/:id/cancel', need('hr.debts'), body(z.object({ reason: z.string().min(3) })), wrap(async (req, res) => {
  await tx(async c => {
    const { rows: [d] } = await c.query(`SELECT d.*, ${DEBT_PAID} AS paid FROM employee_debts d WHERE d.id = $1 AND d.station_id = $2 FOR UPDATE`, [req.params.id, req.sid]);
    if (!d) throw new HttpError(404, 'Dette introuvable');
    if (d.paid > 0) throw new HttpError(409, 'Des remboursements existent : annulation impossible');
    if (d.status === 'annule') throw new HttpError(409, 'Dette déjà annulée');
    await c.query("UPDATE employee_debts SET status = 'annule', cancel_reason = $2 WHERE id = $1", [d.id, req.body.reason]);
    await c.query('INSERT INTO employee_debt_edits(debt_id, reason, old_value, new_value, changed_by) VALUES ($1,$2,$3,$4,$5)', [d.id, req.body.reason, JSON.stringify({ status: d.status }), JSON.stringify({ status: 'annule' }), req.user.id]);
    if (d.cash_out) await settle(c, { station: req.sid, method: d.method || 'especes', amount: d.amount, label: 'Annulation du prêt, dette ' + d.id, ref: ['employee_debts', d.id], by: req.user.id });
    await audit(c, req, 'rh', 'Annulation de la dette ' + d.id, 'employee_debts', d.id, { status: d.status }, { status: 'annule', motif: req.body.reason });
  });
  res.json({ ok: true });
}));
async function closeIfPaid(c, req, debtId) {
  const { rows: [d] } = await c.query(`SELECT d.id, d.gap_id, d.amount - ${DEBT_PAID} AS balance FROM employee_debts d WHERE d.id = $1`, [debtId]);
  if (d.balance > 0) return;
  await c.query("UPDATE employee_debts SET status = 'solde' WHERE id = $1", [d.id]);
  if (d.gap_id) { const { rows: [g] } = await c.query("SELECT status FROM employee_gaps WHERE id = $1 AND status = 'accepte'", [d.gap_id]); if (g) { await c.query("UPDATE employee_gaps SET status = 'regularise', updated_at = now() WHERE id = $1", [d.gap_id]); await gapEvent(c, d.gap_id, 'régularisation', 'Dette soldée', 'accepte', 'regularise', req.user.id); } }
}
r.post('/hr/debts/:id/pay', need('hr.debts'), body(z.object({ amount: z.number().positive(), method: z.string().min(1), note: z.string().optional() })), wrap(async (req, res) => {
  const out = await tx(async c => {
    const { rows: [d] } = await c.query(`SELECT d.*, ${DEBT_PAID} AS paid FROM employee_debts d WHERE d.id = $1 AND d.station_id = $2 FOR UPDATE`, [req.params.id, req.sid]);
    if (!d) throw new HttpError(404, 'Dette introuvable');
    if (d.status !== 'en_cours') throw new HttpError(409, `Remboursement impossible : la dette est « ${d.status} »`);
    const bal = fl(d.amount - d.paid);
    if (req.body.amount > bal) throw new HttpError(400, `Montant supérieur au solde restant (${bal})`);
    const { rows: [sh] } = await c.query("SELECT id FROM shifts WHERE station_id = $1 AND status = 'ouvert'", [req.sid]);
    const pm = await settle(c, { station: req.sid, method: req.body.method, amount: req.body.amount, label: 'Remboursement dette ' + d.id, ref: ['employee_debts', d.id], shift: sh?.id, by: req.user.id });
    if (pm.kind === 'credit') throw new HttpError(400, 'Moyen de paiement invalide pour un remboursement');
    const { rows: [p] } = await c.query("INSERT INTO employee_debt_payments(debt_id, amount, method, source, note, created_by) VALUES ($1,$2,$3,'direct',$4,$5) RETURNING id", [d.id, req.body.amount, req.body.method, req.body.note || null, req.user.id]);
    const receipt = `RD-${req.sid}-${String(p.id).padStart(6, '0')}`;
    await c.query('UPDATE employee_debt_payments SET receipt_no = $2 WHERE id = $1', [p.id, receipt]);
    await closeIfPaid(c, req, d.id);
    await audit(c, req, 'rh', `Remboursement de ${req.body.amount} sur la dette ${d.id}`, 'employee_debt_payments', p.id, { solde: bal }, { solde: fl(bal - req.body.amount) });
    return { id: p.id, receipt_no: receipt, balance: fl(bal - req.body.amount) };
  });
  res.status(201).json(out);
}));
r.get('/hr/debt-payments/:id/receipt.pdf', wrap(async (req, res) => {
  const { rows: [p] } = await pool.query(
    `SELECT p.*, d.amount AS initial, d.reason, d.employee_id, e.first_name, e.last_name, e.matricule, e.user_id, u.login,
            (SELECT SUM(x.amount) FROM employee_debt_payments x WHERE x.debt_id = d.id AND x.id <= p.id) AS repaid_to_date
       FROM employee_debt_payments p JOIN employee_debts d ON d.id = p.debt_id JOIN employees e ON e.id = d.employee_id LEFT JOIN users u ON u.id = p.created_by WHERE p.id = $1 AND d.station_id = $2`, [req.params.id, req.sid]);
  if (!p || !(req.user.perms.has('hr.view') || req.user.perms.has('hr.debts') || p.user_id === req.user.id)) throw new HttpError(404, 'Reçu introuvable');
  const b = await docs.branding(req.sid);
  const buf = await docs.buildPdf({ b, title: 'REÇU DE PAIEMENT', subtitle: 'Remboursement de dette', ref: p.receipt_no, landscape: false, sections: [
    { type: 'kv', title: 'Employé', rows: [['Nom', `${p.first_name} ${p.last_name}`], ['Matricule', p.matricule]] },
    { type: 'kv', title: 'Opération', rows: [['Motif de la dette', p.reason], ['Dette initiale', `${docs.cellText(p.initial)} ${b.currency}`], ['Montant payé', `${docs.cellText(p.amount)} ${b.currency}`], ['Mode de paiement', p.method === 'retenue_salaire' ? 'Retenue sur salaire' : p.method], ['Date', docs.fmtDate(p.paid_at)], ['Total remboursé à ce jour', `${docs.cellText(p.repaid_to_date)} ${b.currency}`], ['Solde restant', `${docs.cellText(fl(p.initial - p.repaid_to_date))} ${b.currency}`], ['Enregistré par', p.login || '-']] }],
    signatures: [{ label: 'Employé', name: `${p.first_name} ${p.last_name}` }, { label: 'Responsable', name: p.login, status: p.login ? 'Enregistré' : undefined, date: p.paid_at }] });
  docs.send(res, 'pdf', buf, p.receipt_no);
}));

// ---------- Avances sur salaire et éléments de paie ----------
r.get('/hr/advances', need('hr.view', 'hr.payroll'), wrap(async (req, res) => {
  const { rows } = await pool.query(`SELECT a.id, a.employee_id, e.first_name || ' ' || e.last_name AS employee, a.amount, a.deducted, a.amount - a.deducted AS remaining, ${D('a.advance_date')} AS advance_date, ${D('a.pay_month')} AS pay_month, a.method, a.reason, a.reference, a.status
    FROM salary_advances a JOIN employees e ON e.id = a.employee_id WHERE a.station_id = $1 AND ($2::bigint IS NULL OR a.employee_id = $2) ORDER BY a.id DESC LIMIT 300`, [req.sid, req.query.employee_id ? +req.query.employee_id : null]);
  res.json(rows);
}));
r.get('/hr/employees/:id/advances', wrap(async (req, res) => {
  const e = await emp(req, req.params.id);
  const { rows } = await pool.query(`SELECT id, amount, deducted, amount - deducted AS remaining, ${D('advance_date')} AS advance_date, ${D('pay_month')} AS pay_month, method, reason, reference, status FROM salary_advances WHERE employee_id = $1 ORDER BY id DESC`, [e.id]);
  res.json(rows);
}));
r.post('/hr/advances', need('hr.payroll'), body(z.object({ employee_id: z.number().int(), amount: z.number().positive(), method: z.string().min(1), pay_month: ym, reason: z.string().optional(), reference: z.string().optional(), advance_date: ymd.optional() })), wrap(async (req, res) => {
  const b = req.body;
  const out = await tx(async c => {
    const { rows: [e] } = await c.query('SELECT id, first_name, last_name, base_salary FROM employees WHERE id = $1 AND station_id = $2', [b.employee_id, req.sid]);
    if (!e) throw new HttpError(400, 'Employé inconnu');
    const { rows: [a] } = await c.query('INSERT INTO salary_advances(station_id, employee_id, amount, advance_date, method, pay_month, reason, reference, created_by) VALUES ($1,$2,$3,COALESCE($4::date, CURRENT_DATE),$5,$6,$7,$8,$9) RETURNING id, amount',
      [req.sid, e.id, b.amount, b.advance_date || null, b.method, monthStart(b.pay_month), b.reason || null, b.reference || null, req.user.id]);
    await settle(c, { station: req.sid, method: b.method, amount: -b.amount, label: 'Avance sur salaire : ' + fullName(e), ref: ['salary_advances', a.id], by: req.user.id });
    await audit(c, req, 'rh', `Avance de ${b.amount} à ${fullName(e)}`, 'salary_advances', a.id, null, b);
    return a;
  });
  res.status(201).json(out);
}));
r.post('/hr/advances/:id/cancel', need('hr.payroll'), body(z.object({ reason: z.string().min(3) })), wrap(async (req, res) => {
  await tx(async c => {
    const { rows: [a] } = await c.query('SELECT * FROM salary_advances WHERE id = $1 AND station_id = $2 FOR UPDATE', [req.params.id, req.sid]);
    if (!a) throw new HttpError(404, 'Avance introuvable');
    if (a.status !== 'en_cours' || a.deducted > 0) throw new HttpError(409, 'Cette avance a déjà été déduite ou annulée');
    await c.query("UPDATE salary_advances SET status = 'annule' WHERE id = $1", [a.id]);
    await settle(c, { station: req.sid, method: a.method, amount: a.amount, label: 'Annulation avance ' + a.id, ref: ['salary_advances', a.id], by: req.user.id });
    await audit(c, req, 'rh', 'Annulation de l\'avance ' + a.id, 'salary_advances', a.id, { status: a.status }, { status: 'annule', motif: req.body.reason });
  });
  res.json({ ok: true });
}));
const monthLocked = async (c, station, employee, month) => { if ((await c.query("SELECT 1 FROM payslips WHERE station_id = $1 AND employee_id = $2 AND month = $3::date AND status <> 'brouillon' AND rectifies_id IS NULL", [station, employee, month])).rowCount) throw new HttpError(409, 'Le bulletin de ce mois est validé : utilisez une rectification'); };
r.get('/hr/adjustments', need('hr.view', 'hr.payroll'), wrap(async (req, res) => {
  const { rows } = await pool.query(`SELECT id, employee_id, ${D('month')} AS month, kind, label, amount FROM payroll_adjustments WHERE station_id = $1 AND ($2::bigint IS NULL OR employee_id = $2) AND ($3::text IS NULL OR ${D('month')} = $3) ORDER BY id`, [req.sid, req.query.employee_id ? +req.query.employee_id : null, req.query.month ? monthStart(req.query.month) : null]);
  res.json(rows);
}));
r.post('/hr/adjustments', need('hr.payroll'), body(z.object({ employee_id: z.number().int(), month: ym, kind: z.enum(['prime', 'indemnite', 'autre_gain', 'retenue']), label: z.string().min(2), amount: z.number().positive() })), wrap(async (req, res) => {
  const b = req.body;
  const out = await tx(async c => {
    if (!(await c.query('SELECT 1 FROM employees WHERE id = $1 AND station_id = $2', [b.employee_id, req.sid])).rowCount) throw new HttpError(400, 'Employé inconnu');
    await monthLocked(c, req.sid, b.employee_id, monthStart(b.month));
    const { rows: [x] } = await c.query('INSERT INTO payroll_adjustments(station_id, employee_id, month, kind, label, amount, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id', [req.sid, b.employee_id, monthStart(b.month), b.kind, b.label, b.amount, req.user.id]);
    await audit(c, req, 'paie', `${b.kind} « ${b.label} » : ${b.amount}`, 'payroll_adjustments', x.id, null, b);
    return x;
  });
  res.status(201).json(out);
}));
r.delete('/hr/adjustments/:id', need('hr.payroll'), wrap(async (req, res) => {
  await tx(async c => {
    const { rows: [x] } = await c.query(`SELECT *, ${D('month')} AS m FROM payroll_adjustments WHERE id = $1 AND station_id = $2`, [req.params.id, req.sid]);
    if (!x) throw new HttpError(404, 'Introuvable');
    await monthLocked(c, req.sid, x.employee_id, x.m);
    await c.query('DELETE FROM payroll_adjustments WHERE id = $1 AND station_id = $2', [x.id, req.sid]);
    await audit(c, req, 'paie', `Suppression de « ${x.label} »`, 'payroll_adjustments', x.id, { amount: x.amount }, null);
  });
  res.json({ ok: true });
}));
r.get('/hr/rules', need('hr.view', 'hr.manage'), wrap(async (req, res) => res.json({
  ...(await getSetting(req.sid, 'payroll_rules')),
  warning: 'Règles de retenue et cotisations à valider par rapport aux obligations applicables au Mali. AMO, INPS et ITS sont désactivés par défaut (feature flags OFF).'
})));

// ---------- Catalogue de rubriques (Phase 3) — lecture + gestion, aucune activation auto ----------
r.get('/hr/payroll-items', need('hr.view', 'hr.manage', 'hr.payroll'), wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT i.*,
       (SELECT json_build_object('version', v.version, 'rate', v.rate, 'amount', v.amount, 'legal_status', v.legal_status, 'technical_status', v.technical_status, 'effective_from', v.effective_from)
        FROM payroll_rule_versions v WHERE v.item_id = i.id ORDER BY v.version DESC LIMIT 1) AS current_version
     FROM payroll_items i
     WHERE (i.station_id IS NULL OR i.station_id = $1)
       AND ($2::text IS NULL OR i.item_type = $2)
       AND ($3::text IS NULL OR i.legal_status = $3)
       AND ($4::text IS NULL OR i.technical_status = $4)
     ORDER BY i.sort_order, i.code`,
    [req.sid, req.query.type || null, req.query.legal_status || null, req.query.technical_status || null]
  );
  res.json(rows);
}));

r.get('/hr/payroll-items/to-confirm', need('hr.view', 'hr.manage'), wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT i.code, i.label, i.item_type, i.legal_status, i.technical_status, i.source_org, i.source_ref, i.comment,
       v.rate, v.version, v.effective_from
     FROM payroll_items i
     LEFT JOIN LATERAL (
       SELECT * FROM payroll_rule_versions v WHERE v.item_id = i.id ORDER BY v.version DESC LIMIT 1
     ) v ON true
     WHERE (i.station_id IS NULL OR i.station_id = $1)
       AND i.legal_status IN ('a_confirmer', 'en_attente')
     ORDER BY i.sort_order, i.code`,
    [req.sid]
  );
  res.json({ count: rows.length, items: rows, message: 'Ces rubriques ne produisent aucun calcul tant qu\'elles ne sont pas Confirmées et Activées manuellement.' });
}));

r.post('/hr/payroll-items', need('hr.manage'), body(z.object({
  code: z.string().min(1).max(40),
  label: z.string().min(1).max(120),
  item_type: z.enum(['gain', 'retenue', 'charge_patronale']),
  nature: z.string().max(40).optional(),
  default_rate: z.number().optional(),
  default_amount: z.number().optional(),
  sort_order: z.number().int().optional(),
  imposable_its: z.boolean().optional(),
  soumis_inps: z.boolean().optional(),
  soumis_amo: z.boolean().optional(),
  charge_employeur: z.boolean().optional(),
  source_org: z.string().max(60).optional(),
  source_ref: z.string().max(200).optional(),
  comment: z.string().max(500).optional()
})), wrap(async (req, res) => {
  const b = req.body;
  const out = await tx(async c => {
    const { rows: [x] } = await c.query(
      `INSERT INTO payroll_items(station_id, code, label, item_type, nature, default_rate, default_amount, sort_order,
        imposable_its, soumis_inps, soumis_amo, charge_employeur, source_org, source_ref, comment, created_by,
        active, legal_status, technical_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, false, 'a_confirmer', 'desactivee')
       RETURNING *`,
      [req.sid, b.code.toUpperCase(), b.label, b.item_type, b.nature || null, b.default_rate ?? null, b.default_amount ?? null,
       b.sort_order ?? 100, !!b.imposable_its, !!b.soumis_inps, !!b.soumis_amo, !!b.charge_employeur,
       b.source_org || null, b.source_ref || null, b.comment || null, req.user.id]
    );
    await c.query(
      `INSERT INTO payroll_rule_versions(item_id, version, rate, amount, legal_status, technical_status, effective_from, source_org, comment, created_by)
       VALUES ($1,1,$2,$3,'a_confirmer','desactivee',CURRENT_DATE,$4,'Version initiale',$5)`,
      [x.id, b.default_rate ?? null, b.default_amount ?? null, b.source_org || null, req.user.id]
    );
    await audit(c, req, 'paie', `Rubrique créée « ${x.code} » (désactivée, à confirmer)`, 'payroll_items', x.id, null, { code: x.code });
    return x;
  });
  res.status(201).json(out);
}));

// Activation technique : uniquement si legal_status = confirmee
r.post('/hr/payroll-items/:id/activate', need('hr.manage'), body(z.object({ reason: z.string().min(3).max(300) })), wrap(async (req, res) => {
  const out = await tx(async c => {
    const { rows: [item] } = await c.query('SELECT * FROM payroll_items WHERE id = $1 AND (station_id = $2 OR station_id IS NULL) FOR UPDATE', [req.params.id, req.sid]);
    if (!item) throw new HttpError(404, 'Rubrique introuvable');
    if (item.legal_status !== 'confirmee') throw new HttpError(409, 'Impossible d\'activer une rubrique non confirmée juridiquement. Faites d\'abord « Approuver / Confirmer ».');
    if (item.technical_status === 'active') throw new HttpError(409, 'Rubrique déjà active');
    await c.query(`UPDATE payroll_items SET technical_status = 'active', active = true, updated_at = now() WHERE id = $1`, [item.id]);
    await c.query(
      `INSERT INTO payroll_rule_versions(item_id, version, rate, amount, ceiling, legal_status, technical_status, effective_from, source_org, source_ref, comment, approved_by, approved_at, approval_reason, created_by)
       SELECT item_id, version+1, rate, amount, ceiling, 'confirmee', 'active', CURRENT_DATE, source_org, source_ref, $2, $3, now(), $2, $3
       FROM payroll_rule_versions WHERE item_id = $1 ORDER BY version DESC LIMIT 1`,
      [item.id, req.body.reason, req.user.id]
    );
    await audit(c, req, 'paie', `Activation technique de la rubrique ${item.code}`, 'payroll_items', item.id, { technical_status: 'desactivee' }, { technical_status: 'active', reason: req.body.reason });
    return { id: item.id, code: item.code, technical_status: 'active', warning: 'Cette activation n\'active pas automatiquement le calcul dans le moteur de paie tant que le feature flag correspondant (AMO/INPS/ITS…) n\'est pas activé.' };
  });
  res.json(out);
}));

r.post('/hr/payroll-items/:id/deactivate', need('hr.manage'), body(z.object({ reason: z.string().min(3).max(300) })), wrap(async (req, res) => {
  const out = await tx(async c => {
    const { rows: [item] } = await c.query('SELECT * FROM payroll_items WHERE id = $1 AND (station_id = $2 OR station_id IS NULL) FOR UPDATE', [req.params.id, req.sid]);
    if (!item) throw new HttpError(404, 'Rubrique introuvable');
    await c.query(`UPDATE payroll_items SET technical_status = 'desactivee', active = false, updated_at = now() WHERE id = $1`, [item.id]);
    await audit(c, req, 'paie', `Désactivation de la rubrique ${item.code} : ${req.body.reason}`, 'payroll_items', item.id, { technical_status: item.technical_status }, { technical_status: 'desactivee' });
    return { id: item.id, code: item.code, technical_status: 'desactivee' };
  });
  res.json(out);
}));

// Confirmation juridique (ne rend pas active techniquement)
r.post('/hr/payroll-items/:id/confirm', need('hr.manage'), body(z.object({ reason: z.string().min(3).max(300), source_ref: z.string().max(200).optional() })), wrap(async (req, res) => {
  const out = await tx(async c => {
    const { rows: [item] } = await c.query('SELECT * FROM payroll_items WHERE id = $1 AND (station_id = $2 OR station_id IS NULL) FOR UPDATE', [req.params.id, req.sid]);
    if (!item) throw new HttpError(404, 'Rubrique introuvable');
    await c.query(`UPDATE payroll_items SET legal_status = 'confirmee', source_ref = COALESCE($2, source_ref), updated_at = now() WHERE id = $1`, [item.id, req.body.source_ref || null]);
    await audit(c, req, 'paie', `Confirmation juridique de la rubrique ${item.code} : ${req.body.reason}`, 'payroll_items', item.id, { legal_status: item.legal_status }, { legal_status: 'confirmee', reason: req.body.reason });
    return { id: item.id, code: item.code, legal_status: 'confirmee', next_step: 'La rubrique est confirmée mais reste DÉSACTIVÉE techniquement. Utilisez /activate pour l\'activer (feature flag toujours requis pour le calcul).' };
  });
  res.json(out);
}));

// ---------- API barèmes ITS (Phase 5) ----------
r.get('/hr/its-brackets', need('hr.view', 'hr.manage', 'hr.payroll'), wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, station_id, version, label, legal_status, technical_status, effective_from, effective_to,
            brackets, deductions, source_org, source_ref, source_url, comment, approved_at, created_at
     FROM its_brackets
     WHERE station_id IS NULL OR station_id = $1
     ORDER BY effective_from DESC, version DESC`,
    [req.sid]
  );
  res.json(rows);
}));

r.post('/hr/its-brackets', need('hr.manage'), body(z.object({
  label: z.string().min(2).max(120).optional(),
  brackets: z.array(z.object({
    from: z.number().min(0),
    to: z.number().positive().nullable().optional(),
    rate: z.number().min(0).max(100)
  })).min(1),
  deductions: z.record(z.any()).optional(),
  source_org: z.string().max(60).optional(),
  source_ref: z.string().max(200).optional(),
  source_url: z.string().max(300).optional(),
  comment: z.string().max(500).optional(),
  effective_from: z.string().optional()
})), wrap(async (req, res) => {
  const b = req.body;
  const out = await tx(async c => {
    const { rows: [last] } = await c.query(
      `SELECT COALESCE(MAX(version),0) AS v FROM its_brackets WHERE station_id = $1 OR (station_id IS NULL AND $1 IS NULL)`,
      [req.sid]
    );
    const { rows: [x] } = await c.query(
      `INSERT INTO its_brackets(station_id, version, label, legal_status, technical_status, effective_from,
        brackets, deductions, source_org, source_ref, source_url, comment, created_by)
       VALUES ($1,$2,$3,'a_confirmer','desactivee',COALESCE($4::date,CURRENT_DATE),$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [req.sid, (last?.v || 0) + 1, b.label || 'Barème ITS', b.effective_from || null,
       JSON.stringify(b.brackets), JSON.stringify(b.deductions || {}),
       b.source_org || 'DGI', b.source_ref || null, b.source_url || null, b.comment || null, req.user.id]
    );
    await audit(c, req, 'paie', `Barème ITS v${x.version} créé (à confirmer, désactivé)`, 'its_brackets', x.id, null, { version: x.version });
    return x;
  });
  res.status(201).json(out);
}));

r.post('/hr/its-brackets/:id/confirm', need('hr.manage'), body(z.object({ reason: z.string().min(3).max(300) })), wrap(async (req, res) => {
  const out = await tx(async c => {
    const { rows: [b] } = await c.query('SELECT * FROM its_brackets WHERE id = $1 AND (station_id = $2 OR station_id IS NULL) FOR UPDATE', [req.params.id, req.sid]);
    if (!b) throw new HttpError(404, 'Barème introuvable');
    await c.query(`UPDATE its_brackets SET legal_status = 'confirmee', approved_by = $2, approved_at = now(), approval_reason = $3 WHERE id = $1`,
      [b.id, req.user.id, req.body.reason]);
    await audit(c, req, 'paie', `Confirmation juridique barème ITS v${b.version} : ${req.body.reason}`, 'its_brackets', b.id, { legal_status: b.legal_status }, { legal_status: 'confirmee' });
    return { id: b.id, version: b.version, legal_status: 'confirmee', next_step: 'Barème confirmé mais toujours DÉSACTIVÉ. Activez-le puis activez le feature flag payroll_its_enabled.' };
  });
  res.json(out);
}));

r.post('/hr/its-brackets/:id/activate', need('hr.manage'), body(z.object({ reason: z.string().min(3).max(300) })), wrap(async (req, res) => {
  const out = await tx(async c => {
    const { rows: [b] } = await c.query('SELECT * FROM its_brackets WHERE id = $1 AND (station_id = $2 OR station_id IS NULL) FOR UPDATE', [req.params.id, req.sid]);
    if (!b) throw new HttpError(404, 'Barème introuvable');
    if (b.legal_status !== 'confirmee') throw new HttpError(409, 'Impossible d\'activer un barème non confirmé juridiquement.');
    // Désactiver les autres barèmes actifs de la même portée
    await c.query(
      `UPDATE its_brackets SET technical_status = 'desactivee'
       WHERE technical_status = 'active' AND (station_id = $1 OR (station_id IS NULL AND $1 IS NULL))`,
      [b.station_id]
    );
    await c.query(`UPDATE its_brackets SET technical_status = 'active', approved_by = $2, approved_at = now(), approval_reason = $3 WHERE id = $1`,
      [b.id, req.user.id, req.body.reason]);
    await audit(c, req, 'paie', `Activation barème ITS v${b.version} : ${req.body.reason}`, 'its_brackets', b.id, { technical_status: 'desactivee' }, { technical_status: 'active' });
    return {
      id: b.id, version: b.version, technical_status: 'active',
      warning: 'Le barème est actif mais le calcul ITS reste OFF tant que payroll_its_enabled n\'est pas passé à true dans les règles de paie.'
    };
  });
  res.json(out);
}));

r.post('/hr/its-brackets/:id/deactivate', need('hr.manage'), body(z.object({ reason: z.string().min(3).max(300) })), wrap(async (req, res) => {
  const out = await tx(async c => {
    const { rows: [b] } = await c.query('SELECT * FROM its_brackets WHERE id = $1 AND (station_id = $2 OR station_id IS NULL) FOR UPDATE', [req.params.id, req.sid]);
    if (!b) throw new HttpError(404, 'Barème introuvable');
    await c.query(`UPDATE its_brackets SET technical_status = 'desactivee' WHERE id = $1`, [b.id]);
    await audit(c, req, 'paie', `Désactivation barème ITS v${b.version} : ${req.body.reason}`, 'its_brackets', b.id);
    return { id: b.id, technical_status: 'desactivee' };
  });
  res.json(out);
}));

// ---------- API branches INPS (Phase 6) ----------
r.get('/hr/inps-branches', need('hr.view', 'hr.manage', 'hr.payroll'), wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, station_id, code, label, version, legal_status, technical_status, effective_from, effective_to,
            employee_rate, employer_rate, base_kind, ceiling, floor_amount, source_org, source_ref, source_url, comment, approved_at, created_at
     FROM inps_branches
     WHERE station_id IS NULL OR station_id = $1
     ORDER BY code, version DESC`,
    [req.sid]
  );
  res.json(rows);
}));

r.post('/hr/inps-branches', need('hr.manage'), body(z.object({
  code: z.string().min(1).max(30),
  label: z.string().min(2).max(120),
  employee_rate: z.number().min(0).max(100).default(0),
  employer_rate: z.number().min(0).max(100).default(0),
  base_kind: z.string().max(30).optional(),
  ceiling: z.number().positive().optional().nullable(),
  source_org: z.string().max(60).optional(),
  source_ref: z.string().max(200).optional(),
  comment: z.string().max(500).optional(),
  effective_from: z.string().optional()
})), wrap(async (req, res) => {
  const b = req.body;
  const out = await tx(async c => {
    const { rows: [last] } = await c.query(
      `SELECT COALESCE(MAX(version),0) AS v FROM inps_branches WHERE code = $1 AND (station_id = $2 OR (station_id IS NULL AND $2 IS NOT NULL))`,
      [b.code.toUpperCase(), req.sid]
    );
    const { rows: [x] } = await c.query(
      `INSERT INTO inps_branches(station_id, code, label, version, legal_status, technical_status, effective_from,
        employee_rate, employer_rate, base_kind, ceiling, source_org, source_ref, comment, created_by)
       VALUES ($1,$2,$3,$4,'a_confirmer','desactivee',COALESCE($5::date,CURRENT_DATE),$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [req.sid, b.code.toUpperCase(), b.label, (last?.v || 0) + 1, b.effective_from || null,
       b.employee_rate ?? 0, b.employer_rate ?? 0, b.base_kind || 'brut', b.ceiling ?? null,
       b.source_org || 'INPS', b.source_ref || null, b.comment || null, req.user.id]
    );
    await audit(c, req, 'paie', `Branche INPS ${x.code} v${x.version} créée (à confirmer, désactivée)`, 'inps_branches', x.id, null, { code: x.code });
    return x;
  });
  res.status(201).json(out);
}));

r.post('/hr/inps-branches/:id/confirm', need('hr.manage'), body(z.object({ reason: z.string().min(3).max(300) })), wrap(async (req, res) => {
  const out = await tx(async c => {
    const { rows: [b] } = await c.query('SELECT * FROM inps_branches WHERE id = $1 AND (station_id = $2 OR station_id IS NULL) FOR UPDATE', [req.params.id, req.sid]);
    if (!b) throw new HttpError(404, 'Branche introuvable');
    await c.query(`UPDATE inps_branches SET legal_status = 'confirmee', approved_by = $2, approved_at = now(), approval_reason = $3 WHERE id = $1`,
      [b.id, req.user.id, req.body.reason]);
    await audit(c, req, 'paie', `Confirmation juridique INPS ${b.code} v${b.version} : ${req.body.reason}`, 'inps_branches', b.id);
    return { id: b.id, code: b.code, legal_status: 'confirmee', next_step: 'Confirmée mais DÉSACTIVÉE. Activez la branche puis le flag payroll_inps_enabled.' };
  });
  res.json(out);
}));

r.post('/hr/inps-branches/:id/activate', need('hr.manage'), body(z.object({ reason: z.string().min(3).max(300) })), wrap(async (req, res) => {
  const out = await tx(async c => {
    const { rows: [b] } = await c.query('SELECT * FROM inps_branches WHERE id = $1 AND (station_id = $2 OR station_id IS NULL) FOR UPDATE', [req.params.id, req.sid]);
    if (!b) throw new HttpError(404, 'Branche introuvable');
    if (b.legal_status !== 'confirmee') throw new HttpError(409, 'Impossible d\'activer une branche non confirmée juridiquement.');
    // Désactiver les autres versions actives du même code
    await c.query(
      `UPDATE inps_branches SET technical_status = 'desactivee'
       WHERE code = $1 AND technical_status = 'active' AND (station_id = $2 OR (station_id IS NULL AND $2 IS NULL))`,
      [b.code, b.station_id]
    );
    await c.query(`UPDATE inps_branches SET technical_status = 'active', approved_by = $2, approved_at = now(), approval_reason = $3 WHERE id = $1`,
      [b.id, req.user.id, req.body.reason]);
    await audit(c, req, 'paie', `Activation INPS ${b.code} v${b.version} : ${req.body.reason}`, 'inps_branches', b.id);
    return {
      id: b.id, code: b.code, technical_status: 'active',
      warning: 'Branche active mais calcul INPS OFF tant que payroll_inps_enabled n\'est pas true.'
    };
  });
  res.json(out);
}));

r.post('/hr/inps-branches/:id/deactivate', need('hr.manage'), body(z.object({ reason: z.string().min(3).max(300) })), wrap(async (req, res) => {
  const out = await tx(async c => {
    const { rows: [b] } = await c.query('SELECT * FROM inps_branches WHERE id = $1 AND (station_id = $2 OR station_id IS NULL) FOR UPDATE', [req.params.id, req.sid]);
    if (!b) throw new HttpError(404, 'Branche introuvable');
    await c.query(`UPDATE inps_branches SET technical_status = 'desactivee' WHERE id = $1`, [b.id]);
    await audit(c, req, 'paie', `Désactivation INPS ${b.code} v${b.version} : ${req.body.reason}`, 'inps_branches', b.id);
    return { id: b.id, technical_status: 'desactivee' };
  });
  res.json(out);
}));

// ---------- API branches AMO (Phase 7) ----------
r.get('/hr/amo-branches', need('hr.view', 'hr.manage', 'hr.payroll'), wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, station_id, code, label, version, legal_status, technical_status, effective_from, effective_to,
            employee_rate, employer_rate, base_kind, ceiling, floor_amount, source_org, source_ref, source_url, comment, approved_at, created_at
     FROM amo_branches
     WHERE station_id IS NULL OR station_id = $1
     ORDER BY code, version DESC`,
    [req.sid]
  );
  res.json(rows);
}));

r.post('/hr/amo-branches', need('hr.manage'), body(z.object({
  code: z.string().min(1).max(30),
  label: z.string().min(2).max(120),
  employee_rate: z.number().min(0).max(100).default(0),
  employer_rate: z.number().min(0).max(100).default(0),
  base_kind: z.string().max(30).optional(),
  ceiling: z.number().positive().optional().nullable(),
  source_org: z.string().max(60).optional(),
  source_ref: z.string().max(200).optional(),
  comment: z.string().max(500).optional(),
  effective_from: z.string().optional()
})), wrap(async (req, res) => {
  const b = req.body;
  const out = await tx(async c => {
    const { rows: [last] } = await c.query(
      `SELECT COALESCE(MAX(version),0) AS v FROM amo_branches WHERE code = $1 AND (station_id = $2 OR (station_id IS NULL AND $2 IS NOT NULL))`,
      [b.code.toUpperCase(), req.sid]
    );
    const { rows: [x] } = await c.query(
      `INSERT INTO amo_branches(station_id, code, label, version, legal_status, technical_status, effective_from,
        employee_rate, employer_rate, base_kind, ceiling, source_org, source_ref, comment, created_by)
       VALUES ($1,$2,$3,$4,'a_confirmer','desactivee',COALESCE($5::date,CURRENT_DATE),$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [req.sid, b.code.toUpperCase(), b.label, (last?.v || 0) + 1, b.effective_from || null,
       b.employee_rate ?? 0, b.employer_rate ?? 0, b.base_kind || 'brut', b.ceiling ?? null,
       b.source_org || 'CANAM', b.source_ref || null, b.comment || null, req.user.id]
    );
    await audit(c, req, 'paie', `Branche AMO ${x.code} v${x.version} créée (à confirmer, désactivée)`, 'amo_branches', x.id, null, { code: x.code });
    return x;
  });
  res.status(201).json(out);
}));

r.post('/hr/amo-branches/:id/confirm', need('hr.manage'), body(z.object({ reason: z.string().min(3).max(300) })), wrap(async (req, res) => {
  const out = await tx(async c => {
    const { rows: [b] } = await c.query('SELECT * FROM amo_branches WHERE id = $1 AND (station_id = $2 OR station_id IS NULL) FOR UPDATE', [req.params.id, req.sid]);
    if (!b) throw new HttpError(404, 'Branche introuvable');
    await c.query(`UPDATE amo_branches SET legal_status = 'confirmee', approved_by = $2, approved_at = now(), approval_reason = $3 WHERE id = $1`,
      [b.id, req.user.id, req.body.reason]);
    await audit(c, req, 'paie', `Confirmation juridique AMO ${b.code} v${b.version} : ${req.body.reason}`, 'amo_branches', b.id);
    return { id: b.id, code: b.code, legal_status: 'confirmee', next_step: 'Confirmée mais DÉSACTIVÉE. Activez la branche puis le flag payroll_amo_enabled.' };
  });
  res.json(out);
}));

r.post('/hr/amo-branches/:id/activate', need('hr.manage'), body(z.object({ reason: z.string().min(3).max(300) })), wrap(async (req, res) => {
  const out = await tx(async c => {
    const { rows: [b] } = await c.query('SELECT * FROM amo_branches WHERE id = $1 AND (station_id = $2 OR station_id IS NULL) FOR UPDATE', [req.params.id, req.sid]);
    if (!b) throw new HttpError(404, 'Branche introuvable');
    if (b.legal_status !== 'confirmee') throw new HttpError(409, 'Impossible d\'activer une branche non confirmée juridiquement.');
    await c.query(
      `UPDATE amo_branches SET technical_status = 'desactivee'
       WHERE code = $1 AND technical_status = 'active' AND (station_id = $2 OR (station_id IS NULL AND $2 IS NULL))`,
      [b.code, b.station_id]
    );
    await c.query(`UPDATE amo_branches SET technical_status = 'active', approved_by = $2, approved_at = now(), approval_reason = $3 WHERE id = $1`,
      [b.id, req.user.id, req.body.reason]);
    await audit(c, req, 'paie', `Activation AMO ${b.code} v${b.version} : ${req.body.reason}`, 'amo_branches', b.id);
    return {
      id: b.id, code: b.code, technical_status: 'active',
      warning: 'Branche active mais calcul AMO OFF tant que payroll_amo_enabled n\'est pas true.'
    };
  });
  res.json(out);
}));

r.post('/hr/amo-branches/:id/deactivate', need('hr.manage'), body(z.object({ reason: z.string().min(3).max(300) })), wrap(async (req, res) => {
  const out = await tx(async c => {
    const { rows: [b] } = await c.query('SELECT * FROM amo_branches WHERE id = $1 AND (station_id = $2 OR station_id IS NULL) FOR UPDATE', [req.params.id, req.sid]);
    if (!b) throw new HttpError(404, 'Branche introuvable');
    await c.query(`UPDATE amo_branches SET technical_status = 'desactivee' WHERE id = $1`, [b.id]);
    await audit(c, req, 'paie', `Désactivation AMO ${b.code} v${b.version} : ${req.body.reason}`, 'amo_branches', b.id);
    return { id: b.id, technical_status: 'desactivee' };
  });
  res.json(out);
}));

// ---------- API charges patronales (Phase 8) ----------
r.get('/hr/employer-charges', need('hr.view', 'hr.manage', 'hr.payroll'), wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, station_id, code, label, version, legal_status, technical_status, effective_from, effective_to,
            rate, fixed_amount, base_kind, ceiling, floor_amount, source_org, source_ref, source_url, comment, approved_at, created_at
     FROM employer_charges
     WHERE station_id IS NULL OR station_id = $1
     ORDER BY code, version DESC`,
    [req.sid]
  );
  res.json(rows);
}));

r.post('/hr/employer-charges', need('hr.manage'), body(z.object({
  code: z.string().min(1).max(30),
  label: z.string().min(2).max(120),
  rate: z.number().min(0).max(100).default(0),
  fixed_amount: z.number().positive().optional().nullable(),
  base_kind: z.string().max(30).optional(),
  ceiling: z.number().positive().optional().nullable(),
  source_org: z.string().max(60).optional(),
  source_ref: z.string().max(200).optional(),
  comment: z.string().max(500).optional(),
  effective_from: z.string().optional()
})), wrap(async (req, res) => {
  const b = req.body;
  const out = await tx(async c => {
    const { rows: [last] } = await c.query(
      `SELECT COALESCE(MAX(version),0) AS v FROM employer_charges WHERE code = $1 AND (station_id = $2 OR (station_id IS NULL AND $2 IS NOT NULL))`,
      [b.code.toUpperCase(), req.sid]
    );
    const { rows: [x] } = await c.query(
      `INSERT INTO employer_charges(station_id, code, label, version, legal_status, technical_status, effective_from,
        rate, fixed_amount, base_kind, ceiling, source_org, source_ref, comment, created_by)
       VALUES ($1,$2,$3,$4,'a_confirmer','desactivee',COALESCE($5::date,CURRENT_DATE),$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [req.sid, b.code.toUpperCase(), b.label, (last?.v || 0) + 1, b.effective_from || null,
       b.rate ?? 0, b.fixed_amount ?? null, b.base_kind || 'brut', b.ceiling ?? null,
       b.source_org || 'interne', b.source_ref || null, b.comment || null, req.user.id]
    );
    await audit(c, req, 'paie', `Charge patronale ${x.code} v${x.version} créée (à confirmer, désactivée)`, 'employer_charges', x.id, null, { code: x.code });
    return x;
  });
  res.status(201).json(out);
}));

r.post('/hr/employer-charges/:id/confirm', need('hr.manage'), body(z.object({ reason: z.string().min(3).max(300) })), wrap(async (req, res) => {
  const out = await tx(async c => {
    const { rows: [b] } = await c.query('SELECT * FROM employer_charges WHERE id = $1 AND (station_id = $2 OR station_id IS NULL) FOR UPDATE', [req.params.id, req.sid]);
    if (!b) throw new HttpError(404, 'Charge introuvable');
    await c.query(`UPDATE employer_charges SET legal_status = 'confirmee', approved_by = $2, approved_at = now(), approval_reason = $3 WHERE id = $1`,
      [b.id, req.user.id, req.body.reason]);
    await audit(c, req, 'paie', `Confirmation juridique charge ${b.code} v${b.version} : ${req.body.reason}`, 'employer_charges', b.id);
    return { id: b.id, code: b.code, legal_status: 'confirmee', next_step: 'Confirmée mais DÉSACTIVÉE. Activez puis le flag payroll_employer_charges_enabled.' };
  });
  res.json(out);
}));

r.post('/hr/employer-charges/:id/activate', need('hr.manage'), body(z.object({ reason: z.string().min(3).max(300) })), wrap(async (req, res) => {
  const out = await tx(async c => {
    const { rows: [b] } = await c.query('SELECT * FROM employer_charges WHERE id = $1 AND (station_id = $2 OR station_id IS NULL) FOR UPDATE', [req.params.id, req.sid]);
    if (!b) throw new HttpError(404, 'Charge introuvable');
    if (b.legal_status !== 'confirmee') throw new HttpError(409, 'Impossible d\'activer une charge non confirmée juridiquement.');
    await c.query(
      `UPDATE employer_charges SET technical_status = 'desactivee'
       WHERE code = $1 AND technical_status = 'active' AND (station_id = $2 OR (station_id IS NULL AND $2 IS NULL))`,
      [b.code, b.station_id]
    );
    await c.query(`UPDATE employer_charges SET technical_status = 'active', approved_by = $2, approved_at = now(), approval_reason = $3 WHERE id = $1`,
      [b.id, req.user.id, req.body.reason]);
    await audit(c, req, 'paie', `Activation charge patronale ${b.code} v${b.version} : ${req.body.reason}`, 'employer_charges', b.id);
    return {
      id: b.id, code: b.code, technical_status: 'active',
      warning: 'Charge active mais calcul OFF tant que payroll_employer_charges_enabled n\'est pas true. N\'affecte jamais le net salarié.'
    };
  });
  res.json(out);
}));

r.post('/hr/employer-charges/:id/deactivate', need('hr.manage'), body(z.object({ reason: z.string().min(3).max(300) })), wrap(async (req, res) => {
  const out = await tx(async c => {
    const { rows: [b] } = await c.query('SELECT * FROM employer_charges WHERE id = $1 AND (station_id = $2 OR station_id IS NULL) FOR UPDATE', [req.params.id, req.sid]);
    if (!b) throw new HttpError(404, 'Charge introuvable');
    await c.query(`UPDATE employer_charges SET technical_status = 'desactivee' WHERE id = $1`, [b.id]);
    await audit(c, req, 'paie', `Désactivation charge ${b.code} v${b.version} : ${req.body.reason}`, 'employer_charges', b.id);
    return { id: b.id, technical_status: 'desactivee' };
  });
  res.json(out);
}));

// ---------- Moteur INPS (Phase 6) — uniquement si flag ON + branches Confirmées + Actives ----------
async function getActiveInpsBranches(c, stationId) {
  const { rows } = await c.query(
    `SELECT DISTINCT ON (code) *
     FROM inps_branches
     WHERE technical_status = 'active' AND legal_status = 'confirmee'
       AND (station_id = $1 OR station_id IS NULL)
       AND effective_from <= CURRENT_DATE
       AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
     ORDER BY code, station_id NULLS LAST, effective_from DESC, version DESC`,
    [stationId]
  );
  return rows;
}

function computeINPS(baseGross, branches) {
  if (!branches || !branches.length) {
    return { employee: 0, employer: 0, base: fl(baseGross), detail: { skipped: true, reason: 'Aucune branche INPS active et confirmée', branches: [] } };
  }
  let empTotal = 0, patTotal = 0;
  const lines = [];
  for (const b of branches) {
    let base = fl(baseGross);
    if (b.ceiling != null && base > fl(b.ceiling)) base = fl(b.ceiling);
    if (b.floor_amount != null && base < fl(b.floor_amount)) base = 0;
    const empRate = fl(b.employee_rate || 0) / 100;
    const patRate = fl(b.employer_rate || 0) / 100;
    const empAmt = fl(base * empRate);
    const patAmt = fl(base * patRate);
    empTotal = fl(empTotal + empAmt);
    patTotal = fl(patTotal + patAmt);
    lines.push({
      code: b.code, label: b.label, version: b.version,
      base, employee_rate: b.employee_rate, employer_rate: b.employer_rate,
      employee_amount: empAmt, employer_amount: patAmt,
      ceiling: b.ceiling, source_org: b.source_org, source_ref: b.source_ref
    });
  }
  return {
    employee: empTotal,
    employer: patTotal,
    base: fl(baseGross),
    detail: {
      branches: lines,
      employee_total: empTotal,
      employer_total: patTotal,
      formula: 'Pour chaque branche active : assiette × taux_salarié / taux_employeur'
    }
  };
}

// ---------- Moteur AMO (Phase 7) — uniquement si flag ON + branches Confirmées + Actives ----------
async function getActiveAmoBranches(c, stationId) {
  const { rows } = await c.query(
    `SELECT DISTINCT ON (code) *
     FROM amo_branches
     WHERE technical_status = 'active' AND legal_status = 'confirmee'
       AND (station_id = $1 OR station_id IS NULL)
       AND effective_from <= CURRENT_DATE
       AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
     ORDER BY code, station_id NULLS LAST, effective_from DESC, version DESC`,
    [stationId]
  );
  return rows;
}

function computeAMO(baseGross, branches) {
  if (!branches || !branches.length) {
    return { employee: 0, employer: 0, base: fl(baseGross), detail: { skipped: true, reason: 'Aucune branche AMO active et confirmée', branches: [] } };
  }
  let empTotal = 0, patTotal = 0;
  const lines = [];
  for (const b of branches) {
    let base = fl(baseGross);
    if (b.ceiling != null && base > fl(b.ceiling)) base = fl(b.ceiling);
    if (b.floor_amount != null && base < fl(b.floor_amount)) base = 0;
    const empRate = fl(b.employee_rate || 0) / 100;
    const patRate = fl(b.employer_rate || 0) / 100;
    const empAmt = fl(base * empRate);
    const patAmt = fl(base * patRate);
    empTotal = fl(empTotal + empAmt);
    patTotal = fl(patTotal + patAmt);
    lines.push({
      code: b.code, label: b.label, version: b.version,
      base, employee_rate: b.employee_rate, employer_rate: b.employer_rate,
      employee_amount: empAmt, employer_amount: patAmt,
      ceiling: b.ceiling, source_org: b.source_org, source_ref: b.source_ref,
      formula: `${base} × ${b.employee_rate}% (salarié) / ${b.employer_rate}% (employeur)`
    });
  }
  return {
    employee: empTotal,
    employer: patTotal,
    base: fl(baseGross),
    detail: {
      branches: lines,
      employee_total: empTotal,
      employer_total: patTotal,
      formula: 'Pour chaque branche active : assiette × taux_salarié / taux_employeur (CANAM)'
    }
  };
}

// ---------- Moteur charges patronales (Phase 8) — uniquement si flag ON + charges Confirmées + Actives ----------
// Ces montants n'affectent JAMAIS le net salarié — uniquement le coût employeur.
async function getActiveEmployerCharges(c, stationId) {
  const { rows } = await c.query(
    `SELECT DISTINCT ON (code) *
     FROM employer_charges
     WHERE technical_status = 'active' AND legal_status = 'confirmee'
       AND (station_id = $1 OR station_id IS NULL)
       AND effective_from <= CURRENT_DATE
       AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
     ORDER BY code, station_id NULLS LAST, effective_from DESC, version DESC`,
    [stationId]
  );
  return rows;
}

function computeEmployerCharges(baseGross, charges) {
  if (!charges || !charges.length) {
    return { total: 0, base: fl(baseGross), detail: { skipped: true, reason: 'Aucune charge patronale active et confirmée', lines: [] } };
  }
  let total = 0;
  const lines = [];
  for (const ch of charges) {
    let base = fl(baseGross);
    if (ch.ceiling != null && base > fl(ch.ceiling)) base = fl(ch.ceiling);
    if (ch.floor_amount != null && base < fl(ch.floor_amount)) base = 0;
    let amount = 0;
    let formula;
    if (ch.fixed_amount != null && fl(ch.fixed_amount) > 0) {
      amount = fl(ch.fixed_amount);
      formula = `Montant fixe : ${amount}`;
    } else {
      const rate = fl(ch.rate || 0) / 100;
      amount = fl(base * rate);
      formula = `${base} × ${ch.rate}%`;
    }
    total = fl(total + amount);
    lines.push({
      code: ch.code, label: ch.label, version: ch.version,
      base, rate: ch.rate, fixed_amount: ch.fixed_amount,
      amount, ceiling: ch.ceiling, source_org: ch.source_org, source_ref: ch.source_ref, formula
    });
  }
  return {
    total,
    base: fl(baseGross),
    detail: {
      lines,
      total,
      formula: 'Somme des charges actives (taux × assiette ou montant fixe) — jamais déduit du net'
    }
  };
}

// ---------- Moteur ITS (Phase 5) — uniquement si flag ON + barème Confirmé + Active ----------
async function getActiveItsBracket(c, stationId) {

  const { rows } = await c.query(
    `SELECT * FROM its_brackets
     WHERE technical_status = 'active' AND legal_status = 'confirmee'
       AND (station_id = $1 OR station_id IS NULL)
       AND effective_from <= CURRENT_DATE
       AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
     ORDER BY station_id NULLS LAST, effective_from DESC, version DESC
     LIMIT 1`,
    [stationId]
  );
  return rows[0] || null;
}

function computeITS(taxableBase, bracketRow, employee, ctx = {}) {
  if (!bracketRow || !Array.isArray(bracketRow.brackets) || bracketRow.brackets.length === 0) {
    return { amount: 0, detail: { skipped: true, reason: 'Aucun barème ITS actif et confirmé' } };
  }
  // Mode « annuel » (barèmes créés par l'assistant d'activation Fiscalité) : annualisation du salaire, cotisations
  // salariales déduites de l'assiette, réductions familiales en % de l'impôt brut, tranches contiguës sans décalage.
  const dd = bracketRow.deductions || {};
  if (dd.mode === 'annual') {
    const res = require('./fiscal_calc').computeAnnualITS(
      { gross: taxableBase, employeeContributions: ctx.employeeContributions || 0 },
      { brackets: bracketRow.brackets, annualize: dd.annualize, deduct_contributions: dd.deduct_contributions, family: dd.family || {} },
      { family_status: employee.family_status, children: employee.dependents }
    );
    res.detail = { ...res.detail, bracket_version: bracketRow.version, bracket_id: bracketRow.id, bracket_label: bracketRow.label, source_org: bracketRow.source_org, source_ref: bracketRow.source_ref };
    return res;
  }
  const brackets = bracketRow.brackets.slice().sort((a, b) => (a.from || 0) - (b.from || 0))
    // Tranches saisies « de 175 001 » : début ramené à la fin de la précédente (pas de franc mal taxé)
    .map((b, i, arr) => (i > 0 && fl(b.from || 0) === fl(arr[i - 1].to || 0) + 1 ? { ...b, from: arr[i - 1].to } : b));
  const deductions = bracketRow.deductions || {};
  let base = Math.max(0, fl(taxableBase));
  const dependentReduction = fl((deductions.per_dependent || 0) * (employee.dependents || 0));
  const minTaxable = fl(deductions.min_taxable || 0);
  base = Math.max(0, fl(base - dependentReduction));
  if (base < minTaxable) {
    return {
      amount: 0,
      detail: {
        taxable_before_reductions: fl(taxableBase), dependent_reduction: dependentReduction,
        dependents: employee.dependents || 0, base_after_reductions: base, min_taxable: minTaxable,
        amount: 0, reason: 'Base inférieure au minimum imposable configuré',
        bracket_version: bracketRow.version, bracket_id: bracketRow.id, bracket_label: bracketRow.label
      }
    };
  }
  let tax = 0;
  const lines = [];
  for (const b of brackets) {
    const from = fl(b.from || 0);
    const to = b.to == null ? Infinity : fl(b.to);
    const rate = fl(b.rate || 0) / 100;
    if (base <= from) break;
    const slice = Math.min(base, to) - from;
    if (slice > 0) {
      const sliceTax = fl(slice * rate);
      tax = fl(tax + sliceTax);
      lines.push({ from, to: b.to == null ? null : to, rate: b.rate, slice: fl(slice), tax: sliceTax });
    }
  }
  return {
    amount: tax,
    detail: {
      taxable_before_reductions: fl(taxableBase), dependent_reduction: dependentReduction,
      dependents: employee.dependents || 0, base_after_reductions: base, min_taxable: minTaxable,
      lines, amount: tax, bracket_version: bracketRow.version, bracket_id: bracketRow.id,
      bracket_label: bracketRow.label, source_org: bracketRow.source_org, source_ref: bracketRow.source_ref,
      formula: 'Somme (tranche_i × taux_i) sur base imposable après réductions'
    }
  };
}

// ---------- Calcul de la paie (toujours côté serveur) ----------
async function compute(c, station, e, month, mode, requested, opts = {}) {
  const rules = await getSetting(station, 'payroll_rules');
  const securityMode = rules.security_mode || 'strict';
  const engineVersion = rules.engine_version || '2.0.0';
  // flag_overrides : uniquement en simulation / dry-run (jamais en paie réelle)
  const flags = { ...(rules.feature_flags || {}), ...(opts.flag_overrides || {}) };
  const calculationMode = opts.calculation_mode || 'reel';
  if (calculationMode === 'reel' && opts.flag_overrides) {
    throw new HttpError(400, 'Les surcharges de flags (flag_overrides) sont interdites en mode paie réelle.');
  }
  const { rows: adj } = await c.query('SELECT id, kind, label, amount FROM payroll_adjustments WHERE employee_id = $1 AND month = $2::date ORDER BY id', [e.id, month]);
  const sum = k => fl(adj.filter(x => k.includes(x.kind)).reduce((a, x) => a + x.amount, 0));
  // Commissions vendeurs dues (module commissions) : payées sur le bulletin sous le libellé « Commission sur vente »,
  // et comprises dans la rémunération du mois. Sont reprises les lignes « du » dont la période se termine au plus tard à la fin du mois.
  const commissionLines = [];
  {
    const { rows: [reg] } = await c.query("SELECT to_regclass('public.seller_commission_entries') IS NOT NULL AS ok");
    // Module Vendeurs & commissions désactivé : aucune commission n'est reprise sur le bulletin
    if (reg && reg.ok && await require('./seller_commissions').isModuleActive(c, station)) {
      const { rows: com } = await c.query(
        `SELECT id, kind, COALESCE(amount_remaining, amount)::float AS due, period_from, period_to
           FROM seller_commission_entries
          WHERE station_id = $1 AND employee_id = $2 AND status = 'du' AND kind IN ('commission','prime','ajustement')
            AND COALESCE(amount_remaining, amount) > 0
            AND COALESCE(period_to, created_at::date) < ($3::date + INTERVAL '1 month')
          ORDER BY created_at, id`, [station, e.id, month]);
      com.forEach(x => commissionLines.push({ id: x.id, kind: 'commission', source_kind: x.kind, label: x.kind === 'prime' ? 'Prime vendeur' : 'Commission sur vente', amount: fl(x.due), period_from: x.period_from, period_to: x.period_to }));
    }
  }
  const commissionTotal = fl(commissionLines.reduce((a, x) => a + x.amount, 0));
  const bonuses = fl(sum(['prime']) + commissionTotal), allowances = sum(['indemnite', 'autre_gain']), otherDed = sum(['retenue']), base = fl(e.base_salary);
  // Heures supplémentaires (flag OFF par défaut) — HS approuvées du mois uniquement
  let overtimeHours = 0, overtimeAmount = 0, overtimeDetail = { skipped: true, reason: 'Feature flag payroll_overtime_enabled = OFF' };
  if (flags.payroll_overtime_enabled) {
    try {
      const ym = (month instanceof Date ? month.toISOString() : String(month)).slice(0, 7);
      const { rows: otRows } = await c.query(
        `SELECT COALESCE(SUM(hours),0) AS hours, COALESCE(SUM(amount_estimate),0) AS amount
         FROM hr_overtime WHERE station_id = $1 AND employee_id = $2 AND status = 'approuve_rh'
           AND to_char(work_date,'YYYY-MM') = $3`, [station, e.id, ym]);
      overtimeHours = Number(otRows[0]?.hours || 0);
      overtimeAmount = fl(otRows[0]?.amount || 0);
      // Si amount_estimate absent, estimation simple : (base/173.33) * hours * 1.5
      if (overtimeAmount === 0 && overtimeHours > 0 && base > 0) {
        overtimeAmount = fl((base / 173.33) * overtimeHours * 1.5);
      }
      overtimeDetail = {
        skipped: false,
        hours: overtimeHours,
        amount: overtimeAmount,
        note: 'HS approuvées RH injectées car payroll_overtime_enabled = ON'
      };
      /* OT warning pushed after warnings init */
    } catch (err) {
      overtimeDetail = { skipped: true, reason: 'Table hr_overtime indisponible: ' + (err.message || err) };
    }
  }
  const gross = fl(base + bonuses + allowances + (flags.payroll_overtime_enabled ? overtimeAmount : 0));
  let avail = Math.max(fl(gross - otherDed), 0);
  const autoDeduct = flags.payroll_automatic_deductions_enabled !== false;
  const advLines = [];
  let advTotal = 0;
  if (autoDeduct) {
    const { rows: advs } = await c.query("SELECT id, amount - deducted AS remaining, to_char(pay_month,'YYYY-MM') AS pay_month, reason FROM salary_advances WHERE employee_id = $1 AND status = 'en_cours' AND pay_month <= $2::date ORDER BY pay_month, id FOR UPDATE", [e.id, month]);
    for (const a of advs) { const t = fl(Math.min(a.remaining, avail)); if (t > 0) { advLines.push({ advance_id: a.id, amount: t, pay_month: a.pay_month, reason: a.reason }); avail = fl(avail - t); } }
    advTotal = fl(advLines.reduce((a, x) => a + x.amount, 0));
  }
  const beforeDebt = fl(gross - otherDed - advTotal);
  const { rows: debts } = await c.query(`SELECT d.id, d.reason, d.status, d.amount - ${DEBT_PAID} AS balance FROM employee_debts d WHERE d.employee_id = $1 AND d.status IN ('en_cours','conteste') ORDER BY d.debt_date, d.id FOR UPDATE OF d`, [e.id]);
  const eligible = debts.filter(d => d.status === 'en_cours'), eligibleTotal = fl(eligible.reduce((a, d) => a + d.balance, 0)), allDebt = fl(debts.reduce((a, d) => a + d.balance, 0));
  const warnings = [];
  if (flags.payroll_overtime_enabled && overtimeAmount > 0) warnings.push(`Heures sup. : ${overtimeHours}h / ${overtimeAmount} (flag ON)`);
  else if (!flags.payroll_overtime_enabled) warnings.push('Heures sup. non injectées (payroll_overtime_enabled = OFF)');
  if (beforeDebt < 0) warnings.push('Les retenues dépassent la rémunération brute : montant incohérent');
  let want = 0, debtTotal = 0;
  const debtLines = [];
  if (autoDeduct) {
    want = mode === 'all' ? eligibleTotal : mode === 'partial' ? (requested || 0) : 0;
    if (mode === 'partial' && !(requested > 0)) throw new HttpError(400, 'Indiquez le montant partiel à déduire');
    if (mode !== 'none' && !rules.allow_debt_deduction) throw new HttpError(409, 'La déduction des dettes sur salaire est désactivée dans les règles de paie');
    if (mode === 'partial' && requested > eligibleTotal) throw new HttpError(400, `Le montant demandé (${requested}) dépasse les dettes admissibles (${eligibleTotal})`);
    const cap = fl(Math.max(beforeDebt, 0) * rules.max_debt_deduction_pct / 100);
    debtTotal = fl(Math.min(want, cap, Math.max(beforeDebt, 0)));
    if (want > debtTotal) warnings.push(`Retenue limitée à ${debtTotal} (plafond de ${rules.max_debt_deduction_pct} % du net avant dettes) au lieu de ${want}`);
    let left = debtTotal;
    for (const d of eligible) { const t = fl(Math.min(d.balance, left)); if (t > 0) { debtLines.push({ debt_id: d.id, amount: t, reason: d.reason }); left = fl(left - t); } }
  }
  const contested = debts.filter(d => d.status === 'conteste');
  if (contested.length) warnings.push(`${contested.length} dette(s) contestée(s) exclue(s) de la retenue`);

  // --- Charges patronales « autres » (Phase 8) : uniquement si flag ON — JAMAIS sur le net ---
  let employerChargesTotal = 0, employerChargesDetail = { skipped: true, reason: 'Feature flag payroll_employer_charges_enabled = OFF' };
  if (flags.payroll_employer_charges_enabled) {
    const charges = await getActiveEmployerCharges(c, station);
    if (!charges.length) {
      warnings.push('Charges patronales activées (flag ON) mais aucune charge Confirmée + Active : total = 0');
      employerChargesDetail = { skipped: true, reason: 'Aucune charge avec legal_status=confirmee et technical_status=active', lines: [] };
    } else {
      const chResult = computeEmployerCharges(gross, charges);
      employerChargesTotal = chResult.total;
      employerChargesDetail = chResult.detail;
      warnings.push(`Charges patronales (autres) : ${employerChargesTotal} (${charges.length} charge(s)) — hors net salarié`);
    }
  } else {
    warnings.push('Charges patronales non activées (feature flag OFF)');
  }

  // --- AMO (Phase 7) : uniquement si flag ON ---
  let amoEmployee = 0, amoEmployer = 0, amoBase = 0, amoDetail = { skipped: true, reason: 'Feature flag payroll_amo_enabled = OFF' };
  if (flags.payroll_amo_enabled) {
    amoBase = gross;
    const branches = await getActiveAmoBranches(c, station);
    if (!branches.length) {
      warnings.push('AMO activée (flag ON) mais aucune branche Confirmée + Active : cotisations AMO = 0');
      amoDetail = { skipped: true, reason: 'Aucune branche AMO avec legal_status=confirmee et technical_status=active', branches: [] };
    } else {
      const amoResult = computeAMO(amoBase, branches);
      amoEmployee = amoResult.employee;
      amoEmployer = amoResult.employer;
      amoDetail = amoResult.detail;
      warnings.push(`AMO salarié : ${amoEmployee} · AMO employeur : ${amoEmployer} (${branches.length} branche(s))`);
    }
  } else {
    warnings.push('AMO non activée (feature flag OFF) — aucune cotisation AMO calculée');
  }

  // --- INPS (Phase 6) : uniquement si flag ON ---
  let inpsEmployee = 0, inpsEmployer = 0, inpsBase = 0, inpsDetail = { skipped: true, reason: 'Feature flag payroll_inps_enabled = OFF' };
  if (flags.payroll_inps_enabled) {
    inpsBase = gross;
    const branches = await getActiveInpsBranches(c, station);
    if (!branches.length) {
      warnings.push('INPS activé (flag ON) mais aucune branche Confirmée + Active : cotisations INPS = 0');
      inpsDetail = { skipped: true, reason: 'Aucune branche INPS avec legal_status=confirmee et technical_status=active', branches: [] };
    } else {
      const inpsResult = computeINPS(inpsBase, branches);
      inpsEmployee = inpsResult.employee;
      inpsEmployer = inpsResult.employer;
      inpsDetail = inpsResult.detail;
      warnings.push(`INPS salarié : ${inpsEmployee} · INPS employeur : ${inpsEmployer} (${branches.length} branche(s))`);
    }
  } else {
    warnings.push('INPS non activée (feature flag OFF) — aucune cotisation INPS calculée');
  }

  // --- ITS (Phase 5) : uniquement si flag ON ---
  let itsAmount = 0, itsBase = 0, itsDetail = { skipped: true, reason: 'Feature flag payroll_its_enabled = OFF' };
  if (flags.payroll_its_enabled) {
    // Base imposable simplifiée Phase 5 : brut - éléments explicitement non imposables (retenues manuelles non prises ici)
    // Les rubriques du catalogue avec imposable_its=false pourront être exclues dans une phase ultérieure
    itsBase = gross;
    const bracket = await getActiveItsBracket(c, station);
    if (!bracket) {
      warnings.push('ITS activé (flag ON) mais aucun barème Confirmé + Active : montant ITS = 0');
      itsDetail = { skipped: true, reason: 'Aucun barème ITS avec legal_status=confirmee et technical_status=active' };
      if (securityMode === 'strict') {
        warnings.push('MODE STRICT : barème ITS obligatoire manquant — validation possible uniquement si allow_negative_net ou net OK sans ITS');
      }
    } else {
      const itsResult = computeITS(itsBase, bracket, e, { employeeContributions: fl(inpsEmployee + amoEmployee) });
      itsAmount = itsResult.amount;
      itsDetail = itsResult.detail;
      warnings.push(`ITS calculé : ${itsAmount} (barème v${bracket.version} « ${bracket.label} »)`);
    }
  } else {
    warnings.push('ITS non activé (feature flag OFF) — aucun impôt sur les traitements et salaires calculé');
  }

  const netPay = fl(beforeDebt - debtTotal - itsAmount - inpsEmployee - amoEmployee);
  const allowNeg = rules.allow_negative_net === true;
  if (netPay < 0 && !allowNeg) warnings.push('NET NÉGATIF : validation et paiement bloqués tant que le net est inférieur à zéro');
  const grossDetail = { base_salary: base, bonuses, allowances, overtime: overtimeAmount, overtime_hours: overtimeHours, commission: commissionTotal, lines: [...adj.filter(x => ['prime', 'indemnite', 'autre_gain'].includes(x.kind)).map(x => ({ kind: x.kind, label: x.label, amount: x.amount })), ...commissionLines.map(x => ({ kind: 'commission', label: x.label, amount: x.amount }))] };
  const deductionDetail = {
    other_deductions: otherDed, advances: advLines, debts: debtLines, its: itsAmount, inps_employee: inpsEmployee, amo_employee: amoEmployee,
    lines: [
      ...adj.filter(x => x.kind === 'retenue').map(x => ({ kind: x.kind, label: x.label, amount: x.amount })),
      ...(amoEmployee > 0 ? [{ kind: 'cotisation', label: 'AMO salarié', amount: amoEmployee }] : []),
      ...(inpsEmployee > 0 ? [{ kind: 'cotisation', label: 'INPS salarié', amount: inpsEmployee }] : []),
      ...(itsAmount > 0 ? [{ kind: 'impot', label: 'ITS', amount: itsAmount }] : [])
    ]
  };
  return {
    month: month.slice(0, 7), mode, requested: requested ?? null,
    base_salary: base, bonuses, allowances, gross,
    other_deductions: otherDed, advances_deducted: advTotal, net_before_debt: beforeDebt,
    debts_eligible: eligibleTotal, debts_deducted: debtTotal,
    its_base: itsBase, its_amount: itsAmount, its_detail: itsDetail,
    inps_base: inpsBase, inps_employee: inpsEmployee, inps_employer: inpsEmployer, inps_detail: inpsDetail,
    amo_base: amoBase, amo_employee: amoEmployee, amo_employer: amoEmployer, amo_detail: amoDetail,
    employer_charges_total: employerChargesTotal, employer_charges_detail: employerChargesDetail,
    total_deductions: fl(otherDed + advTotal + debtTotal + itsAmount + inpsEmployee + amoEmployee), net_pay: netPay,
    debt_remaining: fl(allDebt - debtTotal),
    employer_cost: fl(gross + inpsEmployer + amoEmployer + employerChargesTotal),
    adjustments: adj, commission_lines: commissionLines, commission_total: commissionTotal, advance_lines: advLines, debt_lines: debtLines, rules, warnings,
    engine_version: engineVersion, security_mode: securityMode, calculation_mode: calculationMode,
    feature_flags: flags, overtime_hours: overtimeHours, overtime_amount: overtimeAmount, overtime_detail: overtimeDetail, gross_detail: grossDetail, deduction_detail: deductionDetail,
    can_validate: netPay >= 0 || allowNeg, can_pay: (netPay >= 0 || allowNeg) && calculationMode === 'reel',
    rules_unverified: 'Règles à vérifier (Mali). AMO/INPS/ITS/charges patronales calculés uniquement si flag ON + règles Confirmées et Actives.'
  };
}
const payrollBody = z.object({ employee_id: z.number().int(), month: ym, debt_mode: z.enum(['none', 'all', 'partial']).default('none'), debt_amount: z.number().positive().optional() });
async function employeeFor(c, req, id) { const { rows: [e] } = await c.query('SELECT * FROM employees WHERE id = $1 AND station_id = $2 AND deleted_at IS NULL', [id, req.sid]); if (!e) throw new HttpError(404, 'Employé introuvable'); return e; }
r.post('/hr/payroll/preview', need('hr.payroll'), body(payrollBody), wrap(async (req, res) => {
  const b = req.body, month = monthStart(b.month);
  // Toujours ROLLBACK : même si compute ne fait que des SELECT, on garantit zéro écriture
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const e = await employeeFor(c, req, b.employee_id);
    const p = await compute(c, req.sid, e, month, b.debt_mode, b.debt_amount, { calculation_mode: 'simulation' });
    await c.query('ROLLBACK');
    res.json({
      employee: fullName(e), ...p,
      dry_run: true, financial_impact: false,
      note: 'Simulation pure — transaction annulée (ROLLBACK). Aucune écriture financière, dettes/avances inchangées.'
    });
  } catch (err) {
    try { await c.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw err;
  } finally { c.release(); }
}));

// DRY RUN explicite (Phase 11) — alias renforcé du preview + overrides de flags pour tests
r.post('/hr/payroll/dry-run', need('hr.payroll', 'hr.manage'), body(z.object({
  employee_id: z.number().int(),
  month: ym,
  debt_mode: z.enum(['none', 'all', 'partial']).default('none'),
  debt_amount: z.number().positive().optional(),
  flag_overrides: z.object({
    payroll_amo_enabled: z.boolean().optional(),
    payroll_inps_enabled: z.boolean().optional(),
    payroll_its_enabled: z.boolean().optional(),
    payroll_employer_charges_enabled: z.boolean().optional(),
    payroll_automatic_deductions_enabled: z.boolean().optional()
  }).optional()
})), wrap(async (req, res) => {
  const b = req.body, month = monthStart(b.month);
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const e = await employeeFor(c, req, b.employee_id);
    const p = await compute(c, req.sid, e, month, b.debt_mode, b.debt_amount, {
      calculation_mode: 'simulation',
      flag_overrides: b.flag_overrides || {}
    });
    // HS approuvées (informatif / simulation — NON inclus dans le net réel)
    const ym = b.month;
    const { rows: ot } = await c.query(
      `SELECT COALESCE(SUM(hours),0) AS hours, COALESCE(SUM(amount_estimate),0) AS amount_estimate
       FROM hr_overtime WHERE station_id=$1 AND employee_id=$2 AND status='approuve_rh'
         AND to_char(work_date,'YYYY-MM')=$3`, [req.sid, e.id, ym]);
    await c.query('ROLLBACK');
    res.json({
      dry_run: true,
      financial_impact: false,
      can_create_payslip: false,
      can_pay: false,
      employee: { id: e.id, name: fullName(e), matricule: e.matricule },
      flag_overrides_applied: b.flag_overrides || null,
      overtime_simulation: {
        hours: ot[0]?.hours || 0,
        amount_estimate: ot[0]?.amount_estimate || 0,
        note: 'HS approuvées affichées pour simulation uniquement — non injectées dans le net du bulletin réel.'
      },
      result: p,
      guarantees: [
        'ROLLBACK forcé — aucune ligne INSERT/UPDATE/DELETE persistée',
        'can_pay = false en mode simulation',
        'Dettes et avances non modifiées',
        'Caisse / banque / mobile money non touchés',
        'Aucun bulletin créé'
      ]
    });
  } catch (err) {
    try { await c.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw err;
  } finally { c.release(); }
}));

// Simulation batch sur tous les salariés actifs d'une période
r.post('/hr/payroll/dry-run-batch', need('hr.payroll', 'hr.manage'), body(z.object({
  month: ym,
  debt_mode: z.enum(['none', 'all', 'partial']).default('none'),
  flag_overrides: z.object({
    payroll_amo_enabled: z.boolean().optional(),
    payroll_inps_enabled: z.boolean().optional(),
    payroll_its_enabled: z.boolean().optional(),
    payroll_employer_charges_enabled: z.boolean().optional(),
    payroll_overtime_enabled: z.boolean().optional()
  }).optional()
})), wrap(async (req, res) => {
  const month = monthStart(req.body.month);
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const { rows: employees } = await c.query(
      `SELECT * FROM employees WHERE station_id = $1 AND deleted_at IS NULL AND status = 'actif' ORDER BY last_name, first_name`,
      [req.sid]
    );
    const lines = [];
    let sumGross = 0, sumNet = 0, sumEmployer = 0, errors = 0;
    for (const e of employees) {
      try {
        if (!(fl(e.base_salary) > 0)) {
          lines.push({ employee_id: e.id, name: fullName(e), skipped: true, reason: 'Salaire de base absent' });
          continue;
        }
        const p = await compute(c, req.sid, e, month, req.body.debt_mode || 'none', undefined, {
          calculation_mode: 'simulation',
          flag_overrides: req.body.flag_overrides || {}
        });
        sumGross = fl(sumGross + p.gross);
        sumNet = fl(sumNet + p.net_pay);
        sumEmployer = fl(sumEmployer + (p.employer_cost || p.gross));
        lines.push({
          employee_id: e.id, name: fullName(e), matricule: e.matricule,
          gross: p.gross, net_pay: p.net_pay, employer_cost: p.employer_cost,
          its: p.its_amount, inps_employee: p.inps_employee, amo_employee: p.amo_employee,
          warnings: p.warnings, can_validate: p.can_validate
        });
      } catch (err) {
        errors += 1;
        lines.push({ employee_id: e.id, name: fullName(e), error: err.message || String(err) });
      }
    }
    await c.query('ROLLBACK');
    res.json({
      dry_run: true, financial_impact: false, month: req.body.month,
      employees: employees.length, computed: lines.filter(l => !l.skipped && !l.error).length,
      errors, skipped: lines.filter(l => l.skipped).length,
      totals: { gross: sumGross, net_pay: sumNet, employer_cost: sumEmployer },
      lines,
      note: 'Simulation batch — ROLLBACK forcé. Aucun bulletin, aucune écriture financière.'
    });
  } catch (err) {
    try { await c.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw err;
  } finally { c.release(); }
}));

// Rapport d'impact AVANT / APRÈS activation d'un flag (Phase 11 / spec §51)
r.post('/hr/payroll/impact', need('hr.manage'), body(z.object({
  month: ym,
  flag: z.enum(['payroll_amo_enabled', 'payroll_inps_enabled', 'payroll_its_enabled', 'payroll_employer_charges_enabled']),
  employee_id: z.number().int().optional()
})), wrap(async (req, res) => {
  const month = monthStart(req.body.month);
  const flag = req.body.flag;
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    let employees;
    if (req.body.employee_id) {
      const e = await employeeFor(c, req, req.body.employee_id);
      employees = [e];
    } else {
      const { rows } = await c.query(
        `SELECT * FROM employees WHERE station_id = $1 AND deleted_at IS NULL AND status = 'actif' AND base_salary > 0 ORDER BY last_name`,
        [req.sid]
      );
      employees = rows;
    }
    const before = [], after = [];
    let totalNetBefore = 0, totalNetAfter = 0, totalCostBefore = 0, totalCostAfter = 0;
    for (const e of employees) {
      const p0 = await compute(c, req.sid, e, month, 'none', undefined, { calculation_mode: 'simulation' });
      const p1 = await compute(c, req.sid, e, month, 'none', undefined, {
        calculation_mode: 'simulation',
        flag_overrides: { [flag]: true }
      });
      before.push({ id: e.id, name: fullName(e), net: p0.net_pay, cost: p0.employer_cost, its: p0.its_amount, inps_e: p0.inps_employee, amo_e: p0.amo_employee });
      after.push({ id: e.id, name: fullName(e), net: p1.net_pay, cost: p1.employer_cost, its: p1.its_amount, inps_e: p1.inps_employee, amo_e: p1.amo_employee });
      totalNetBefore = fl(totalNetBefore + p0.net_pay);
      totalNetAfter = fl(totalNetAfter + p1.net_pay);
      totalCostBefore = fl(totalCostBefore + (p0.employer_cost || 0));
      totalCostAfter = fl(totalCostAfter + (p1.employer_cost || 0));
    }
    await c.query('ROLLBACK');
    res.json({
      dry_run: true, financial_impact: false,
      flag, month: req.body.month,
      employees_concerned: employees.length,
      before: { net_pay: totalNetBefore, employer_cost: totalCostBefore },
      after: { net_pay: totalNetAfter, employer_cost: totalCostAfter },
      delta: {
        net_pay: fl(totalNetAfter - totalNetBefore),
        employer_cost: fl(totalCostAfter - totalCostBefore)
      },
      details: employees.map((_, i) => ({
        employee: before[i].name,
        net_before: before[i].net, net_after: after[i].net,
        cost_before: before[i].cost, cost_after: after[i].cost
      })),
      warning: 'Rapport d\'impact uniquement. Aucune règle n\'a été activée. Aucune écriture financière.',
      next_steps: [
        '1. Vérifier les montants',
        '2. Confirmer juridiquement la règle (confirm)',
        '3. Activer techniquement (activate)',
        '4. Passer le feature flag à true dans payroll_rules'
      ]
    });
  } catch (err) {
    try { await c.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw err;
  } finally { c.release(); }
}));
r.post('/hr/payroll', need('hr.payroll'), body(payrollBody), wrap(async (req, res) => {
  const b = req.body, month = monthStart(b.month);
  // Clôture de période (RH V2)
  {
    const { rows: [per] } = await pool.query(
      `SELECT status FROM payroll_periods WHERE station_id = $1 AND month = $2::date`, [req.sid, month]);
    if (per && per.status === 'cloture') throw new HttpError(409, 'Période de paie clôturée pour ce mois.');
  }
  const out = await tx(async c => {
    const e = await employeeFor(c, req, b.employee_id), p = await compute(c, req.sid, e, month, b.debt_mode, b.debt_amount, { calculation_mode: 'reel' });
    if (p.base_salary <= 0 && p.gross <= 0) throw new HttpError(409, "Aucun salaire de base configuré pour cet employé (fiche RH, réservée à l'administrateur)");
    if (!p.can_validate) throw new HttpError(409, 'Le bulletin produit un net négatif. Aucune préparation possible tant que le net est inférieur à zéro.');

    const { rows: [s] } = await c.query(
      `INSERT INTO payslips(station_id, employee_id, month, status, base_salary, bonuses, allowances, gross, other_deductions, advances_deducted, debts_deducted, total_deductions, net_pay, debt_remaining, debt_mode, debt_requested, snapshot, created_by,
        engine_version, calculation_mode, security_mode, warnings, gross_detail, deduction_detail, employer_cost, its_base, its_amount, its_detail, inps_base, inps_employee, inps_employer, inps_detail, amo_base, amo_employee, amo_employer, amo_detail, employer_charges_total, employer_charges_detail)
       VALUES ($1,$2,$3,'brouillon',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37) RETURNING id`,
      [req.sid, e.id, month, p.base_salary, p.bonuses, p.allowances, p.gross, p.other_deductions, p.advances_deducted, p.debts_deducted, p.total_deductions, p.net_pay, p.debt_remaining, b.debt_mode, b.debt_amount || null, JSON.stringify(p), req.user.id, p.engine_version, p.calculation_mode, p.security_mode, JSON.stringify(p.warnings||[]), JSON.stringify(p.gross_detail||{}), JSON.stringify(p.deduction_detail||{}), p.employer_cost||0, p.its_base||0, p.its_amount||0, JSON.stringify(p.its_detail||{}), p.inps_base||0, p.inps_employee||0, p.inps_employer||0, JSON.stringify(p.inps_detail||{}), p.amo_base||0, p.amo_employee||0, p.amo_employer||0, JSON.stringify(p.amo_detail||{}), p.employer_charges_total||0, JSON.stringify(p.employer_charges_detail||{})]);
    const number = `BP-${b.month.replace('-', '')}-${String(s.id).padStart(5, '0')}`;
    await c.query('UPDATE payslips SET number = $2 WHERE id = $1 AND station_id = $3', [s.id, number, req.sid]);
    await audit(c, req, 'paie', `Bulletin ${number} préparé pour ${fullName(e)}`, 'payslips', s.id, null, { net: p.net_pay });
    return { id: s.id, number, ...p };
  });
  res.status(201).json(out);
}));
const SLIP = `SELECT s.*, ${D('s.month')} AS month_s, e.first_name, e.last_name, e.matricule, e.position, e.user_id FROM payslips s JOIN employees e ON e.id = s.employee_id`;
async function slip(req, id, c = pool) {
  const { rows: [s] } = await c.query(`${SLIP} WHERE s.id = $1 AND s.station_id = $2`, [id, req.sid]);
  if (!s) throw new HttpError(404, 'Bulletin introuvable');
  if (!(s.user_id === req.user.id || ['hr.view', 'hr.payroll', 'hr.manage'].some(p => req.user.perms.has(p)))) throw new HttpError(403, 'Accès refusé');
  return s;
}
r.get('/hr/payroll', wrap(async (req, res) => {
  const all = ['hr.view', 'hr.payroll', 'hr.manage'].some(p => req.user.perms.has(p));
  const { rows } = await pool.query(`SELECT s.id, s.number, ${D('s.month')} AS month, s.status, s.employee_id, e.first_name || ' ' || e.last_name AS employee, s.gross, s.total_deductions, s.net_pay, s.rectifies_id, s.validated_at, s.paid_at
    FROM payslips s JOIN employees e ON e.id = s.employee_id WHERE s.station_id = $1 AND ($2::bigint IS NULL OR s.employee_id = $2) AND ($3::text IS NULL OR ${D('s.month')} = $3) AND ($4::boolean OR e.user_id = $5) ORDER BY s.month DESC, s.id DESC LIMIT 300`,
    [req.sid, req.query.employee_id ? +req.query.employee_id : null, req.query.month ? monthStart(req.query.month) : null, all, req.user.id]);
  res.json(rows);
}));
r.get('/hr/payroll/:id', wrap(async (req, res) => res.json(await slip(req, req.params.id))));
r.delete('/hr/payroll/:id', need('hr.payroll'), wrap(async (req, res) => {
  await tx(async c => {
    const s = await slip(req, req.params.id, c);
    if (s.status !== 'brouillon') throw new HttpError(409, 'Seul un brouillon peut être supprimé');
    await c.query('DELETE FROM payslips WHERE id = $1 AND station_id = $2', [s.id, req.sid]);
    await audit(c, req, 'paie', 'Suppression du brouillon ' + s.number, 'payslips', s.id, { net: s.net_pay }, null);
  });
  res.json({ ok: true });
}));
// Validation : recalcul avec verrous, refus si les soldes ont changé, puis gel du bulletin et application des retenues
r.post('/hr/payroll/:id/validate', need('hr.payroll'), wrap(async (req, res) => {
  const out = await tx(async c => {
    const { rows: [s0] } = await c.query('SELECT * FROM payslips WHERE id = $1 AND station_id = $2 FOR UPDATE', [req.params.id, req.sid]);
    if (!s0) throw new HttpError(404, 'Bulletin introuvable');
    if (s0.status !== 'brouillon') throw new HttpError(409, 'Bulletin déjà validé');
    if (s0.rectifies_id) { await c.query("UPDATE payslips SET status = 'valide', validated_by = $2, validated_at = now() WHERE id = $1 AND station_id = $3", [s0.id, req.user.id, req.sid]); await audit(c, req, 'paie', 'Validation de la rectification ' + s0.number, 'payslips', s0.id); return { id: s0.id, status: 'valide' }; }
    const e = await employeeFor(c, req, s0.employee_id), month = s0.month.toISOString ? `${s0.month.getFullYear()}-${String(s0.month.getMonth() + 1).padStart(2, '0')}-01` : s0.month;
    const p = await compute(c, req.sid, e, month, s0.debt_mode, s0.debt_requested, { calculation_mode: 'reel' });
    if (!p.can_validate) throw new HttpError(409, 'Le bulletin produit un net négatif. Aucune validation financière n\'est autorisée. Ajustez les retenues ou activez allow_negative_net (non recommandé).');
    if (p.net_pay !== s0.net_pay || p.debts_deducted !== s0.debts_deducted || p.advances_deducted !== s0.advances_deducted || p.gross !== s0.gross)
      throw new HttpError(409, 'Les soldes ont changé depuis la préparation (dettes, avances ou éléments de paie) : supprimez le brouillon et recalculez');
    for (const a of p.advance_lines) {
      await c.query("UPDATE salary_advances SET deducted = deducted + $2, status = CASE WHEN deducted + $2 >= amount THEN 'solde' ELSE status END WHERE id = $1", [a.advance_id, a.amount]);
      await c.query('INSERT INTO payslip_advance_lines(payslip_id, advance_id, amount) VALUES ($1,$2,$3)', [s0.id, a.advance_id, a.amount]);
    }
    for (const d of p.debt_lines) {
      const { rows: [pay] } = await c.query("INSERT INTO employee_debt_payments(debt_id, amount, method, source, payslip_id, note, created_by) VALUES ($1,$2,'retenue_salaire','salaire',$3,$4,$5) RETURNING id", [d.debt_id, d.amount, s0.id, 'Retenue sur le bulletin ' + s0.number, req.user.id]);
      await c.query('UPDATE employee_debt_payments SET receipt_no = $2 WHERE id = $1', [pay.id, `RD-${req.sid}-${String(pay.id).padStart(6, '0')}`]);
      await closeIfPaid(c, req, d.debt_id);
    }
    // Commissions payées par ce bulletin : lignes soldées et règlement tracé dans le module commissions
    if ((p.commission_lines || []).length) {
      for (const cl of p.commission_lines) {
        const { rowCount } = await c.query(
          `UPDATE seller_commission_entries SET status = 'regle', amount_remaining = 0, settled_at = now(), settled_by = $2,
                  note = CASE WHEN note IS NULL OR note = '' THEN $3 ELSE note || ' · ' || $3 END
            WHERE id = $1 AND status = 'du'`, [cl.id, req.user.id, 'Payé sur le bulletin ' + s0.number]);
        if (!rowCount) throw new HttpError(409, 'Une commission a été réglée entre-temps : supprimez le brouillon et recalculez');
      }
      await c.query(
        `INSERT INTO seller_commission_entries (station_id, employee_id, kind, period_from, period_to, amount, amount_remaining, note, status, created_by, settled_at, settled_by)
         VALUES ($1,$2,'reglement',$3,$4,$5,0,$6,'regle',$7,now(),$7)`,
        [req.sid, s0.employee_id, p.commission_lines.map(x => x.period_from).filter(Boolean).sort()[0] || null, p.commission_lines.map(x => x.period_to).filter(Boolean).sort().slice(-1)[0] || null, p.commission_total, 'Payé sur le bulletin ' + s0.number, req.user.id]);
    }
    const snap = {
      ...p,
      identity: { name: fullName(e), matricule: e.matricule, position: e.position },
      frozen_at: new Date().toISOString(),
      computed_at: new Date().toISOString(),
      validated_by: req.user.id
    };
    await c.query(`UPDATE payslips SET status = 'valide', snapshot = $2, validated_by = $3, validated_at = now(),
      engine_version = $4, calculation_mode = $5, security_mode = $6, warnings = $7,
      gross_detail = $8, deduction_detail = $9, employer_cost = $10, is_locked = TRUE,
      its_base = $11, its_amount = $12, its_detail = $13,
      inps_base = $14, inps_employee = $15, inps_employer = $16, inps_detail = $17,
      amo_base = $18, amo_employee = $19, amo_employer = $20, amo_detail = $21,
      employer_charges_total = $22, employer_charges_detail = $23
      WHERE id = $1 AND station_id = $24`,
      [s0.id, JSON.stringify(snap), req.user.id, p.engine_version, p.calculation_mode, p.security_mode,
       JSON.stringify(p.warnings || []), JSON.stringify(p.gross_detail || {}), JSON.stringify(p.deduction_detail || {}), p.employer_cost || 0,
       p.its_base || 0, p.its_amount || 0, JSON.stringify(p.its_detail || {}),
       p.inps_base || 0, p.inps_employee || 0, p.inps_employer || 0, JSON.stringify(p.inps_detail || {}),
       p.amo_base || 0, p.amo_employee || 0, p.amo_employer || 0, JSON.stringify(p.amo_detail || {}),
       p.employer_charges_total || 0, JSON.stringify(p.employer_charges_detail || {}), req.sid]);
    await audit(c, req, 'paie', `Validation du bulletin ${s0.number} : net ${p.net_pay}`, 'payslips', s0.id, { statut: 'brouillon' }, { statut: 'valide', net: p.net_pay, retenue_dettes: p.debts_deducted, avances: p.advances_deducted });
    return { id: s0.id, status: 'valide', net_pay: p.net_pay };
  });
  res.json(out);
}));
r.post('/hr/payroll/:id/pay', need('hr.payroll'), body(z.object({ method: z.string().min(1) })), wrap(async (req, res) => {
  const out = await tx(async c => {
    const { rows: [s] } = await c.query(`${SLIP} WHERE s.id = $1 AND s.station_id = $2 FOR UPDATE OF s`, [req.params.id, req.sid]);
    if (!s) throw new HttpError(404, 'Bulletin introuvable');
    if (s.status !== 'valide') throw new HttpError(409, s.status === 'paye' ? 'Bulletin déjà payé' : 'Le bulletin doit être validé avant le paiement');
    if (s.net_pay < 0) throw new HttpError(409, 'Net négatif : aucune validation financière n\'est autorisée.');
    if (s.calculation_mode === 'simulation') throw new HttpError(409, 'Ce bulletin a été calculé en mode simulation : paiement réel interdit.');
    if (s.is_locked === false) { /* should be locked after validation */ }
    const { rows: [sh] } = await c.query("SELECT id FROM shifts WHERE station_id = $1 AND status = 'ouvert'", [req.sid]);
    if (s.net_pay > 0) await settle(c, { station: req.sid, method: req.body.method, amount: -s.net_pay, label: `Salaire ${s.number} : ${s.first_name} ${s.last_name}`, ref: ['payslips', s.id], shift: sh?.id, by: req.user.id });
    // charge de personnel = rémunération brute (les avances et dettes déduites avaient déjà été versées ou constatées) ; pour une rectification : le montant du complément
    const charge = s.rectifies_id ? s.net_pay : s.gross;
    if (charge > 0) await c.query("INSERT INTO expenses(station_id, shift_id, category, amount, method, beneficiary, comment, created_by) VALUES ($1,$2,'Salaires',$3,$4,$5,$6,$7)", [req.sid, sh?.id || null, charge, req.body.method, `${s.first_name} ${s.last_name}`, 'Bulletin ' + s.number, req.user.id]);
    await c.query("UPDATE payslips SET status = 'paye', paid_by = $2, paid_at = now(), paid_method = $3 WHERE id = $1 AND station_id = $4", [s.id, req.user.id, req.body.method, req.sid]);
    await audit(c, req, 'paie', `Paiement du bulletin ${s.number} : ${s.net_pay}`, 'payslips', s.id, { statut: 'valide' }, { statut: 'paye', mode: req.body.method });
    return { id: s.id, status: 'paye', net_pay: s.net_pay };
  });
  res.json(out);
}));
// Rectification d'un bulletin validé ou payé : bulletin complémentaire qui conserve la trace avant / après
r.post('/hr/payroll/:id/rectify', need('hr.payroll'), body(z.object({ reason: z.string().min(3), lines: z.array(z.object({ label: z.string().min(2), amount: z.number().refine(x => x !== 0, 'Montant non nul') })).min(1) })), wrap(async (req, res) => {
  const out = await tx(async c => {
    const { rows: [o] } = await c.query('SELECT * FROM payslips WHERE id = $1 AND station_id = $2 AND rectifies_id IS NULL FOR UPDATE', [req.params.id, req.sid]);
    if (!o) throw new HttpError(404, 'Bulletin introuvable');
    if (o.status === 'brouillon') throw new HttpError(409, 'Un brouillon se modifie directement : supprimez-le et recalculez');
    const gain = fl(req.body.lines.filter(l => l.amount > 0).reduce((a, l) => a + l.amount, 0)), ded = fl(req.body.lines.filter(l => l.amount < 0).reduce((a, l) => a - l.amount, 0));
    const { rows: [n] } = await c.query('SELECT COUNT(*)::int + 1 AS n FROM payslips WHERE rectifies_id = $1', [o.id]);
    const number = `${o.number}-R${n.n}`;
    const snap = { rectification: true, reason: req.body.reason, before: { number: o.number, gross: o.gross, net_pay: o.net_pay, status: o.status }, lines: req.body.lines, after: { net_pay: fl(o.net_pay + gain - ded) } };
    const { rows: [s] } = await c.query("INSERT INTO payslips(station_id, employee_id, month, number, status, gross, other_deductions, total_deductions, net_pay, snapshot, rectifies_id, rectify_reason, created_by) VALUES ($1,$2,$3,$4,'brouillon',$5,$6,$6,$7,$8,$9,$10,$11) RETURNING id",
      [req.sid, o.employee_id, o.month, number, gain, ded, fl(gain - ded), JSON.stringify(snap), o.id, req.body.reason, req.user.id]);
    await audit(c, req, 'paie', `Rectification ${number} du bulletin ${o.number}`, 'payslips', s.id, snap.before, { complement: fl(gain - ded), motif: req.body.reason });
    return { id: s.id, number, net_pay: fl(gain - ded) };
  });
  res.status(201).json(out);
}));
// ---------- Détail du calcul (Phase 9) — lecture seule, aucun effet financier ----------
r.get('/hr/payroll/:id/detail', wrap(async (req, res) => {
  const s = await slip(req, req.params.id);
  const p = s.snapshot || {};
  res.json({
    id: s.id, number: s.number, status: s.status, month: s.month_s,
    employee: { id: s.employee_id, name: `${s.first_name} ${s.last_name}`, matricule: s.matricule, position: s.position },
    engine_version: s.engine_version || p.engine_version,
    security_mode: s.security_mode || p.security_mode,
    calculation_mode: s.calculation_mode || p.calculation_mode,
    gross: s.gross, net_pay: s.net_pay, total_deductions: s.total_deductions,
    employer_cost: s.employer_cost,
    bases: {
      its: s.its_base, inps: s.inps_base, amo: s.amo_base
    },
    social_fiscal: {
      its_amount: s.its_amount, its_detail: s.its_detail || p.its_detail,
      inps_employee: s.inps_employee, inps_employer: s.inps_employer, inps_detail: s.inps_detail || p.inps_detail,
      amo_employee: s.amo_employee, amo_employer: s.amo_employer, amo_detail: s.amo_detail || p.amo_detail,
      employer_charges_total: s.employer_charges_total, employer_charges_detail: s.employer_charges_detail || p.employer_charges_detail
    },
    gross_detail: s.gross_detail || p.gross_detail,
    deduction_detail: s.deduction_detail || p.deduction_detail,
    warnings: s.warnings || p.warnings || [],
    appreciation: { performance_rating: s.performance_rating, appreciation: s.appreciation, hr_comment: s.hr_comment },
    snapshot: p
  });
}));

// Appréciation (indépendante du calcul financier)
r.post('/hr/payroll/:id/appreciation', need('hr.payroll', 'hr.manage'), body(z.object({
  performance_rating: z.string().max(40).optional().nullable(),
  appreciation: z.string().max(1000).optional().nullable(),
  hr_comment: z.string().max(1000).optional().nullable()
})), wrap(async (req, res) => {
  const out = await tx(async c => {
    const s = await slip(req, req.params.id, c);
    if (s.is_locked && s.status !== 'brouillon') {
      // autorisé même sur bulletin figé : n'affecte pas les montants
    }
    await c.query(
      `UPDATE payslips SET performance_rating = COALESCE($2, performance_rating),
        appreciation = COALESCE($3, appreciation), hr_comment = COALESCE($4, hr_comment) WHERE id = $1 AND station_id = $5`,
      [s.id, req.body.performance_rating ?? null, req.body.appreciation ?? null, req.body.hr_comment ?? null, req.sid]
    );
    await audit(c, req, 'paie', `Appréciation bulletin ${s.number}`, 'payslips', s.id, null, {
      performance_rating: req.body.performance_rating, appreciation: req.body.appreciation
    });
    return { id: s.id, ok: true };
  });
  res.json(out);
}));

r.get('/hr/payroll/:id/pdf', wrap(async (req, res) => {
  const s = await slip(req, req.params.id);
  const b = await docs.branding(req.sid);
  const layout = await getSetting(req.sid, 'payslip_layout');
  const p = s.snapshot || {};
  const cur = b.currency;
  const m = v => `${docs.cellText(fl(v))} ${cur}`;
  const { rows: [emp] } = await pool.query(
    `SELECT e.*, ${D('e.hired_on')} AS hired_on_s FROM employees e WHERE e.id = $1`, [s.employee_id]
  );
  const { rows: [vu] } = await pool.query(
    'SELECT (SELECT login FROM users WHERE id = $1) AS v, (SELECT login FROM users WHERE id = $2) AS p',
    [s.validated_by, s.paid_by]
  );

  // Rectification : format court
  if (s.rectifies_id) {
    const sections = [
      { type: 'kv', title: 'Bulletin de rectification', rows: [
        ['Bulletin corrigé', p.before?.number], ['Motif', s.rectify_reason],
        ['Net avant rectification', m(p.before?.net_pay)]
      ]},
      { type: 'table', title: 'Lignes de correction', head: ['Libellé', 'Montant'], rows: (p.lines || []).map(l => [l.label, l.amount]) },
      { type: 'kv', rows: [['Complément net', m(s.net_pay)], ['Net après rectification', m(p.after?.net_pay)]] }
    ];
    const buf = await docs.buildPdf({
      b, title: layout.title || 'BULLETIN DE PAIE', subtitle: 'Rectification · ' + (s.month_s || '').slice(0, 7),
      ref: s.number, landscape: false, sections,
      signatures: [
        { label: (layout.signature_labels || [])[0] || 'Employé', name: `${s.first_name} ${s.last_name}` },
        { label: (layout.signature_labels || [])[1] || 'Validation', name: vu.v, status: s.validated_at ? 'Validé' : undefined, date: s.validated_at }
      ]
    });
    return docs.send(res, 'pdf', buf, s.number || 'bulletin');
  }

  // --- Structure moderne ---
  const empRows = [
    ['Nom', `${s.first_name} ${s.last_name}`],
    ['Matricule', s.matricule || emp?.matricule || '-'],
    ['Poste', s.position || emp?.position || '-'],
    ['Type de contrat', emp?.contract_type || '-'],
    ['Date d\'entrée', emp?.hired_on_s || emp?.hired_on || '-'],
    ['Situation familiale', emp?.family_status || '-'],
    ['Personnes à charge', emp?.dependents != null ? String(emp.dependents) : '-'],
    ['N° INPS', emp?.inps_number || '-'],
    ['N° AMO', emp?.amo_number || '-'],
    ['N° retraite', emp?.retirement_number || '-']
  ];

  const periodRows = [
    ['Période', (s.month_s || '').slice(0, 7)],
    ['État', String(s.status || '').toUpperCase()],
    ['Mode de calcul', s.calculation_mode || p.calculation_mode || 'reel'],
    ['Moteur', s.engine_version || p.engine_version || '-']
  ];
  if (layout.show_payment_method && s.paid_method) periodRows.push(['Mode de paiement', s.paid_method]);
  if (s.paid_at) periodRows.push(['Date de paiement', docs.fmtDate(s.paid_at)]);

  // Gains
  // Commissions / primes vendeur payées sur ce bulletin (module commissions) : lignes détaillées du snapshot,
  // à défaut les lignes de gross_detail, à défaut une ligne globale (le montant est déjà inclus dans le brut).
  const commLines = (Array.isArray(p.commission_lines) && p.commission_lines.length ? p.commission_lines
    : ((s.gross_detail || p.gross_detail || {}).lines || []).filter(x => x.kind === 'commission'));
  const commRows = commLines.length
    ? commLines.map(x => [x.source_kind === 'prime' || /prime/i.test(x.label || '') ? 'Prime vendeur' : 'Commission',
        x.label || 'Commission sur vente',
        x.period_from && x.period_to ? `${String(x.period_from).slice(0, 10)} → ${String(x.period_to).slice(0, 10)}` : '',
        m(x.amount)])
    : (fl(p.commission_total) > 0 ? [['Commission', 'Commission sur vente', '', m(p.commission_total)]] : []);
  const otAmount = fl(p.overtime_amount || (p.gross_detail || {}).overtime || 0);
  const otRows = otAmount > 0 ? [['Heures supplémentaires', 'Heures supplémentaires', p.overtime_hours ? `${p.overtime_hours} h` : '', m(otAmount)]] : [];
  const gainRows = [
    ['Salaire de base', '', '', m(s.base_salary)],
    ...(p.adjustments || []).filter(x => x.kind === 'prime').map(x => ['Prime', x.label, '', m(x.amount)]),
    ...(p.adjustments || []).filter(x => ['indemnite', 'autre_gain'].includes(x.kind)).map(x => ['Indemnité', x.label, '', m(x.amount)]),
    ...commRows,
    ...otRows
  ];

  // Retenues salariales
  const dedRows = [
    ...(p.adjustments || []).filter(x => x.kind === 'retenue').map(x => ['Retenue', x.label, '', m(x.amount)]),
    ...(p.advance_lines || []).map(x => ['Avance', x.reason || x.pay_month || '', '', m(x.amount)]),
    ...(p.debt_lines || []).map(x => ['Dette', x.reason || '', '', m(x.amount)])
  ];
  if (fl(s.amo_employee) > 0) {
    const rate = (s.amo_detail?.branches?.[0]?.employee_rate != null) ? `${s.amo_detail.branches[0].employee_rate} %` : '';
    dedRows.push(['AMO salarié', layout.show_rates ? rate : '', layout.show_bases ? m(s.amo_base) : '', m(s.amo_employee)]);
  }
  if (fl(s.inps_employee) > 0) {
    dedRows.push(['INPS salarié', '', layout.show_bases ? m(s.inps_base) : '', m(s.inps_employee)]);
  }
  if (fl(s.its_amount) > 0) {
    dedRows.push(['ITS', '', layout.show_bases ? m(s.its_base) : '', m(s.its_amount)]);
  }

  // Synthèse
  const synthRows = [
    ['Rémunération brute', m(s.gross)],
    ['Total retenues salariales', m(s.total_deductions)],
    ['NET À PAYER', m(s.net_pay)]
  ];
  if (layout.show_bases) {
    if (fl(s.its_base) > 0) synthRows.push(['Base ITS', m(s.its_base)]);
    if (fl(s.inps_base) > 0) synthRows.push(['Base INPS', m(s.inps_base)]);
    if (fl(s.amo_base) > 0) synthRows.push(['Base AMO', m(s.amo_base)]);
  }
  if (layout.show_employer_charges || layout.show_employer_cost) {
    const patLines = [];
    if (fl(s.amo_employer) > 0) patLines.push(['AMO employeur', m(s.amo_employer)]);
    if (fl(s.inps_employer) > 0) patLines.push(['INPS employeur', m(s.inps_employer)]);
    if (fl(s.employer_charges_total) > 0) patLines.push(['Autres charges patronales', m(s.employer_charges_total)]);
    if (layout.show_employer_cost) {
      synthRows.push(['Total charges patronales', m(fl((s.amo_employer || 0) + (s.inps_employer || 0) + (s.employer_charges_total || 0)))]);
      synthRows.push(['COÛT TOTAL EMPLOYEUR', m(s.employer_cost || fl(s.gross + (s.amo_employer || 0) + (s.inps_employer || 0) + (s.employer_charges_total || 0)))]);
    }
  }

  const sections = [
    { type: 'kv', title: 'Salarié', rows: empRows },
    { type: 'kv', title: 'Période', rows: periodRows },
    { type: 'table', title: 'Gains', head: ['Nature', 'Libellé', 'Base / Taux', 'Montant'], rows: gainRows, totals: ['Brut', m(s.gross)] },
    { type: 'table', title: 'Retenues salariales', head: ['Nature', 'Libellé / Taux', 'Base', 'Montant'], rows: dedRows.length ? dedRows : [['Aucune retenue', '', '', m(0)]], totals: ['Total retenues', m(s.total_deductions)] },
    { type: 'kv', title: 'Synthèse', rows: synthRows },
    { type: 'kpis', items: [
      { label: 'NET À PAYER', value: m(s.net_pay) },
      { label: 'État', value: String(s.status || '').toUpperCase() },
      ...(layout.show_employer_cost ? [{ label: 'Coût employeur', value: m(s.employer_cost || s.gross) }] : [])
    ]}
  ];

  if (layout.show_appreciation && (s.performance_rating || s.appreciation || s.hr_comment)) {
    sections.push({
      type: 'kv', title: 'Appréciation (hors calcul financier)',
      rows: [
        ...(s.performance_rating ? [['Performance', s.performance_rating]] : []),
        ...(s.appreciation ? [['Appréciation', s.appreciation]] : []),
        ...(s.hr_comment ? [['Commentaire RH', s.hr_comment]] : [])
      ]
    });
  }

  if (layout.footer_mentions) {
    sections.push({ type: 'text', title: 'Mentions', text: layout.footer_mentions });
  }

  const sigs = [
    { label: (layout.signature_labels || [])[0] || 'Employé (lu et approuvé)', name: `${s.first_name} ${s.last_name}` },
    { label: (layout.signature_labels || [])[1] || 'Validation gérant', name: vu.v, status: s.validated_at ? 'Validé' : undefined, date: s.validated_at },
    { label: (layout.signature_labels || [])[2] || 'Paiement', name: vu.p, status: s.paid_at ? 'Payé' + (s.paid_method ? ' (' + s.paid_method + ')' : '') : undefined, date: s.paid_at }
  ];

  const buf = await docs.buildPdf({
    b,
    title: layout.title || 'BULLETIN DE PAIE',
    subtitle: (s.month_s || '').slice(0, 7),
    ref: s.number,
    landscape: false,
    sections,
    signatures: sigs
  });
  docs.send(res, 'pdf', buf, s.number || 'bulletin');
}));

// ---------- Situation financière individuelle ----------
async function finance(req, e, month) {
  const m0 = monthStart(month), q = (sql, p) => pool.query(sql, p).then(x => x.rows);
  const [ops, slips, adv, advDed, dbt, dbtRep] = await Promise.all([
    q(`SELECT COALESCE(SUM(d.amount),0) AS revenue, COALESCE(SUM(CASE WHEN sa.kind = 'carburant' THEN d.quantity END),0) AS liters, COUNT(DISTINCT sa.id)::int AS operations FROM sales sa JOIN sale_details d ON d.sale_id = sa.id
        WHERE sa.station_id = $1 AND sa.employee_id = $2 AND sa.status = 'valide' AND sa.sold_at >= $3::date AND sa.sold_at < ($3::date + interval '1 month')`, [req.sid, e.id, m0]),
    q("SELECT id, number, status, rectifies_id, base_salary, bonuses, allowances, gross, advances_deducted, debts_deducted, other_deductions, net_pay, paid_at FROM payslips WHERE employee_id = $1 AND month = $2::date ORDER BY id", [e.id, m0]),
    q("SELECT COALESCE(SUM(amount),0) AS received FROM salary_advances WHERE employee_id = $1 AND pay_month = $2::date AND status <> 'annule'", [e.id, m0]),
    q("SELECT COALESCE(SUM(amount - deducted),0) AS outstanding FROM salary_advances WHERE employee_id = $1 AND status = 'en_cours'", [e.id]),
    q(`SELECT COALESCE(SUM(d.amount),0) AS initial FROM employee_debts d WHERE d.employee_id = $1 AND d.status <> 'annule' AND d.debt_date < ($2::date + interval '1 month')`, [e.id, m0]),
    q(`SELECT COALESCE(SUM(p.amount),0) AS repaid, COALESCE(SUM(CASE WHEN p.source = 'salaire' THEN p.amount END),0) AS via_salary FROM employee_debt_payments p JOIN employee_debts d ON d.id = p.debt_id
        WHERE d.employee_id = $1 AND d.status <> 'annule' AND p.paid_at < ($2::date + interval '1 month')`, [e.id, m0]),
  ]);
  const inMonth = await q("SELECT COALESCE(SUM(p.amount),0) AS repaid FROM employee_debt_payments p JOIN employee_debts d ON d.id = p.debt_id WHERE d.employee_id = $1 AND p.paid_at >= $2::date AND p.paid_at < ($2::date + interval '1 month')", [e.id, m0]);
  const main = slips.find(s => !s.rectifies_id), rect = slips.filter(s => s.rectifies_id && ['valide', 'paye'].includes(s.status));
  const counted = [...(main && main.status !== 'brouillon' ? [main] : []), ...rect];
  const netDue = fl(counted.reduce((a, s) => a + s.net_pay, 0)), paid = fl(counted.filter(s => s.status === 'paye').reduce((a, s) => a + s.net_pay, 0)), remaining = fl(netDue - paid);
  return { employee: { id: e.id, name: fullName(e), matricule: e.matricule, position: e.position }, month,
    operational: { ...ops[0], note: "Données de vente : à ne pas confondre avec la rémunération." },
    remuneration: { configured_base_salary: e.base_salary, payslip: main ? { number: main.number, status: main.status, base_salary: main.base_salary, bonuses: main.bonuses, allowances: main.allowances, gross: main.gross, other_deductions: main.other_deductions, advances_deducted: main.advances_deducted, debts_deducted: main.debts_deducted, net_pay: main.net_pay } : null,
      rectifications: rect.length, net_due: netDue, paid, remaining: remaining > 0 ? remaining : 0, overpaid: remaining < 0 ? -remaining : 0, status_note: main ? null : "Aucun bulletin préparé pour ce mois" },
    advances: { received_this_month: adv[0].received, deducted_this_month: main ? main.advances_deducted : 0, outstanding: advDed[0].outstanding },
    debts: { initial_to_date: dbt[0].initial, repaid_this_month: inMonth[0].repaid, repaid_to_date: dbtRep[0].repaid, deducted_from_salary_to_date: dbtRep[0].via_salary, balance: fl(dbt[0].initial - dbtRep[0].repaid) } };
}
r.get('/hr/employees/:id/finance', wrap(async (req, res) => { const e = await emp(req, req.params.id); res.json(await finance(req, e, req.query.month || today().slice(0, 7))); }));
r.get('/hr/employees/:id/finance.pdf', wrap(async (req, res) => {
  const e = await emp(req, req.params.id), f = await finance(req, e, req.query.month || today().slice(0, 7)), b = await docs.branding(req.sid), cur = b.currency, m = v => `${docs.cellText(fl(v))} ${cur}`, pl = f.remuneration.payslip;
  const buf = await docs.buildPdf({ b, title: 'SITUATION FINANCIÈRE INDIVIDUELLE', subtitle: `${fullName(e)} - ${f.month}`, ref: `SFI-${e.matricule}-${f.month}`, landscape: false, sections: [
    { type: 'kv', title: 'Employé', rows: [['Nom', fullName(e)], ['Matricule', e.matricule], ['Fonction', e.position]] },
    { type: 'kv', title: 'Activité de vente (données opérationnelles, sans lien avec le salaire)', rows: [["Chiffre d'affaires réalisé", m(f.operational.revenue)], ['Litres de carburant vendus', f.operational.liters], ['Opérations enregistrées', f.operational.operations]] },
    { type: 'table', title: 'Rémunération du mois', head: ['Élément', 'Montant'], rows: pl ? [['Bulletin ' + pl.number + ' (' + pl.status + ')', ''], ['Salaire de base', m(pl.base_salary)], ['Primes', m(pl.bonuses)], ['Indemnités', m(pl.allowances)], ['Rémunération brute', m(pl.gross)], ['Avances déduites', m(pl.advances_deducted)], ['Remboursement de dettes retenu', m(pl.debts_deducted)], ['Autres retenues', m(pl.other_deductions)]] : [['Aucun bulletin préparé pour ce mois', '']],
      totals: ['Net à payer (bulletins validés)', m(f.remuneration.net_due)] },
    { type: 'kpis', items: [{ label: 'Salaire déjà payé', value: m(f.remuneration.paid) }, { label: 'Reste à payer', value: m(f.remuneration.remaining) }, { label: 'Trop-perçu', value: m(f.remuneration.overpaid) }] },
    { type: 'kv', title: 'Avances et dettes', rows: [['Avances reçues (mois)', m(f.advances.received_this_month)], ['Avances restant à déduire', m(f.advances.outstanding)], ['Dettes initiales (cumul)', m(f.debts.initial_to_date)], ['Remboursements du mois', m(f.debts.repaid_this_month)], ['Remboursements cumulés', m(f.debts.repaid_to_date)], ['dont retenues sur salaire', m(f.debts.deducted_from_salary_to_date)], ['Solde des dettes', m(f.debts.balance)]] }],
    signatures: [{ label: 'Employé', name: fullName(e) }, { label: 'Gérant' }] });
  docs.send(res, 'pdf', buf, `situation-${e.matricule}-${f.month}`);
}));


// ---------- Rapports RH (Phase 10) — lecture seule, zéro écriture financière ----------
function parsePeriod(req) {
  const ymRe = /^\d{4}-\d{2}$/, dRe = /^\d{4}-\d{2}-\d{2}$/;
  let from = req.query.from, to = req.query.to;
  if (ymRe.test(req.query.month || '')) {
    from = req.query.month + '-01';
    const [y, m] = req.query.month.split('-').map(Number);
    const last = new Date(y, m, 0).getDate();
    to = `${req.query.month}-${String(last).padStart(2, '0')}`;
  }
  if (!dRe.test(from || '')) from = new Date().toISOString().slice(0, 7) + '-01';
  if (!dRe.test(to || '')) {
    const now = new Date();
    to = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
  }
  return { from, to };
}

async function payrollMassData(stationId, from, to, statusFilter) {
  const statuses = statusFilter === 'all'
    ? ['brouillon', 'valide', 'paye']
    : statusFilter === 'paye'
      ? ['paye']
      : ['valide', 'paye'];
  const { rows: slips } = await pool.query(
    `SELECT s.id, s.number, s.status, to_char(s.month,'YYYY-MM') AS month, s.employee_id,
            e.first_name || ' ' || e.last_name AS employee, e.matricule, e.position,
            s.base_salary, s.bonuses, s.allowances, s.gross,
            s.other_deductions, s.advances_deducted, s.debts_deducted, s.total_deductions, s.net_pay,
            COALESCE(s.its_amount,0) AS its_amount,
            COALESCE(s.inps_employee,0) AS inps_employee, COALESCE(s.inps_employer,0) AS inps_employer,
            COALESCE(s.amo_employee,0) AS amo_employee, COALESCE(s.amo_employer,0) AS amo_employer,
            COALESCE(s.employer_charges_total,0) AS employer_charges_total,
            COALESCE(s.employer_cost, s.gross, 0) AS employer_cost,
            s.paid_at, s.paid_method
     FROM payslips s
     JOIN employees e ON e.id = s.employee_id
     WHERE s.station_id = $1
       AND s.month >= $2::date AND s.month <= $3::date
       AND s.status = ANY($4::text[])
       AND s.rectifies_id IS NULL
     ORDER BY s.month, e.last_name, e.first_name, s.id`,
    [stationId, from, to, statuses]
  );
  const sum = (k) => fl(slips.reduce((a, r) => a + fl(r[k] || 0), 0));
  const totals = {
    count: slips.length,
    gross: sum('gross'), net_pay: sum('net_pay'), total_deductions: sum('total_deductions'),
    its: sum('its_amount'), inps_employee: sum('inps_employee'), inps_employer: sum('inps_employer'),
    amo_employee: sum('amo_employee'), amo_employer: sum('amo_employer'),
    employer_charges: sum('employer_charges_total'), employer_cost: sum('employer_cost'),
    advances_deducted: sum('advances_deducted'), debts_deducted: sum('debts_deducted'),
    base_salary: sum('base_salary'), bonuses: sum('bonuses'), allowances: sum('allowances')
  };
  return { slips, totals, statuses };
}

async function advancesDebtsSummary(stationId, from, to) {
  const { rows: [adv] } = await pool.query(
    `SELECT COALESCE(SUM(amount),0) AS granted, COALESCE(SUM(deducted),0) AS deducted,
            COALESCE(SUM(CASE WHEN status = 'en_cours' THEN amount - deducted ELSE 0 END),0) AS outstanding
     FROM salary_advances WHERE station_id = $1 AND advance_date >= $2::date AND advance_date <= $3::date`,
    [stationId, from, to]
  );
  const { rows: [dbt] } = await pool.query(
    `SELECT COALESCE(SUM(d.amount),0) AS created,
            COALESCE((SELECT SUM(p.amount) FROM employee_debt_payments p
                      JOIN employee_debts d2 ON d2.id = p.debt_id
                      WHERE d2.station_id = $1 AND p.paid_at::date >= $2::date AND p.paid_at::date <= $3::date),0) AS repaid
     FROM employee_debts d
     WHERE d.station_id = $1 AND d.debt_date >= $2::date AND d.debt_date <= $3::date AND d.status <> 'annule'`,
    [stationId, from, to]
  );
  const { rows: [bal] } = await pool.query(
    `SELECT COALESCE(SUM(d.amount - COALESCE((SELECT SUM(p.amount) FROM employee_debt_payments p WHERE p.debt_id = d.id),0)),0) AS balance
     FROM employee_debts d WHERE d.station_id = $1 AND d.status IN ('en_cours','conteste')`,
    [stationId]
  );
  return {
    advances: { granted: fl(adv.granted), deducted: fl(adv.deducted), outstanding: fl(adv.outstanding) },
    debts: { created: fl(dbt.created), repaid: fl(dbt.repaid), balance_open: fl(bal.balance) }
  };
}

r.get('/hr/reports/payroll', need('hr.view', 'hr.payroll', 'hr.manage'), wrap(async (req, res) => {
  const { from, to } = parsePeriod(req);
  const statusFilter = req.query.status || 'valide_paye';
  const fmt = req.query.format || 'json';
  const data = await payrollMassData(req.sid, from, to, statusFilter === 'valide_paye' ? 'valide_paye' : statusFilter);
  const extra = await advancesDebtsSummary(req.sid, from, to);
  const payload = {
    period: { from, to }, filter_status: data.statuses, totals: data.totals, advances_debts: extra,
    lines: data.slips.map(s => ({
      number: s.number, month: s.month, status: s.status, employee: s.employee, matricule: s.matricule, position: s.position,
      base_salary: fl(s.base_salary), bonuses: fl(s.bonuses), allowances: fl(s.allowances),
      gross: fl(s.gross), total_deductions: fl(s.total_deductions), net_pay: fl(s.net_pay),
      its: fl(s.its_amount), inps_employee: fl(s.inps_employee), inps_employer: fl(s.inps_employer),
      amo_employee: fl(s.amo_employee), amo_employer: fl(s.amo_employer),
      employer_charges: fl(s.employer_charges_total), employer_cost: fl(s.employer_cost), paid_method: s.paid_method
    })),
    note: 'Montants issus des bulletins enregistrés. Cotisations à 0 = feature flag OFF ou règle non activée.'
  };
  if (fmt === 'json') return res.json(payload);
  const b = await docs.branding(req.sid), cur = b.currency, sub = `${from} → ${to}`, t = payload.totals;
  const head = ['N°', 'Mois', 'Employé', 'Matricule', 'Brut', 'Retenues', 'Net', 'ITS', 'INPS sal.', 'AMO sal.', 'Coût emp.', 'État'];
  const rows = payload.lines.map(l => [l.number, l.month, l.employee, l.matricule, l.gross, l.total_deductions, l.net_pay, l.its, l.inps_employee, l.amo_employee, l.employer_cost, l.status]);
  if (fmt === 'xlsx') {
    return docs.send(res, 'xlsx', await docs.buildXlsx({ b, title: 'Masse salariale', subtitle: sub, ref: `MS-${to.replace(/-/g, '')}`, sheets: [
      { name: 'Masse salariale', head, rows, sumCols: [4, 5, 6, 7, 8, 9, 10], notes: [`Période ${sub} · ${t.count} bulletin(s)`, payload.note] },
      { name: 'Synthèse', head: ['Indicateur', 'Montant'], rows: [
        ['Bulletins', t.count], ['Brut', t.gross], ['Net', t.net_pay], ['ITS', t.its],
        ['INPS salarié', t.inps_employee], ['INPS employeur', t.inps_employer],
        ['AMO salarié', t.amo_employee], ['AMO employeur', t.amo_employer],
        ['Charges patronales', t.employer_charges], ['Coût employeur', t.employer_cost],
        ['Avances accordées', extra.advances.granted], ['Dettes créées', extra.debts.created], ['Solde dettes ouvertes', extra.debts.balance_open]
      ]}
    ] }), `masse-salariale-${to}`);
  }
  const sections = [
    { type: 'kpis', items: [
      { label: 'Bulletins', value: String(t.count) }, { label: 'Brut', value: `${docs.cellText(t.gross)} ${cur}` },
      { label: 'Net', value: `${docs.cellText(t.net_pay)} ${cur}` }, { label: 'Coût employeur', value: `${docs.cellText(t.employer_cost)} ${cur}` }
    ]},
    { type: 'kv', title: 'Social / fiscal', rows: [
      ['ITS', `${docs.cellText(t.its)} ${cur}`],
      ['INPS sal. / emp.', `${docs.cellText(t.inps_employee)} / ${docs.cellText(t.inps_employer)} ${cur}`],
      ['AMO sal. / emp.', `${docs.cellText(t.amo_employee)} / ${docs.cellText(t.amo_employer)} ${cur}`],
      ['Charges patronales', `${docs.cellText(t.employer_charges)} ${cur}`]
    ]},
    { type: 'table', title: 'Détail', head, rows: rows.slice(0, 200) },
    { type: 'text', title: 'Note', text: payload.note }
  ];
  docs.send(res, 'pdf', await docs.buildPdf({ b, title: 'MASSE SALARIALE', subtitle: sub, ref: `MS-${to.replace(/-/g, '')}`, sections, landscape: true, signatures: [{ label: 'RH' }, { label: 'Direction' }] }), `masse-salariale-${to}`);
}));

r.get('/hr/reports/employer-cost', need('hr.view', 'hr.payroll', 'hr.manage'), wrap(async (req, res) => {
  const { from, to } = parsePeriod(req);
  const fmt = req.query.format || 'json';
  const data = await payrollMassData(req.sid, from, to, 'valide_paye');
  const byEmployee = {};
  for (const s of data.slips) {
    const k = s.employee_id;
    if (!byEmployee[k]) byEmployee[k] = { employee_id: k, employee: s.employee, matricule: s.matricule, position: s.position, months: 0, gross: 0, net_pay: 0, inps_employer: 0, amo_employer: 0, employer_charges: 0, employer_cost: 0 };
    const e = byEmployee[k];
    e.months += 1;
    e.gross = fl(e.gross + fl(s.gross)); e.net_pay = fl(e.net_pay + fl(s.net_pay));
    e.inps_employer = fl(e.inps_employer + fl(s.inps_employer)); e.amo_employer = fl(e.amo_employer + fl(s.amo_employer));
    e.employer_charges = fl(e.employer_charges + fl(s.employer_charges_total)); e.employer_cost = fl(e.employer_cost + fl(s.employer_cost));
  }
  const lines = Object.values(byEmployee).sort((a, b) => b.employer_cost - a.employer_cost);
  const t = data.totals;
  const payload = {
    period: { from, to },
    totals: { employees: lines.length, gross: t.gross, employer_social: fl(t.inps_employer + t.amo_employer + t.employer_charges), employer_cost: t.employer_cost, net_pay: t.net_pay },
    lines, formula: 'Coût employeur = Brut + INPS employeur + AMO employeur + charges patronales autres',
    note: 'Bulletins validés ou payés uniquement. Cotisations à 0 si flags OFF.'
  };
  if (fmt === 'json') return res.json(payload);
  const b = await docs.branding(req.sid), cur = b.currency, sub = `${from} → ${to}`;
  const head = ['Employé', 'Matricule', 'Poste', 'Mois', 'Brut', 'Charges emp.', 'Coût total', 'Net versé'];
  const rows = lines.map(l => [l.employee, l.matricule, l.position, l.months, l.gross, fl(l.inps_employer + l.amo_employer + l.employer_charges), l.employer_cost, l.net_pay]);
  if (fmt === 'xlsx') {
    return docs.send(res, 'xlsx', await docs.buildXlsx({ b, title: 'Coût du personnel', subtitle: sub, ref: `CP-${to.replace(/-/g, '')}`, sheets: [{ name: 'Coût personnel', head, rows, sumCols: [4, 5, 6, 7], notes: [payload.formula, payload.note] }] }), `cout-personnel-${to}`);
  }
  docs.send(res, 'pdf', await docs.buildPdf({ b, title: 'COÛT RÉEL DU PERSONNEL', subtitle: sub, ref: `CP-${to.replace(/-/g, '')}`, sections: [
    { type: 'kpis', items: [
      { label: 'Salariés', value: String(payload.totals.employees) }, { label: 'Brut', value: `${docs.cellText(t.gross)} ${cur}` },
      { label: 'Charges emp.', value: `${docs.cellText(payload.totals.employer_social)} ${cur}` }, { label: 'Coût total', value: `${docs.cellText(t.employer_cost)} ${cur}` }
    ]},
    { type: 'table', title: 'Par employé', head, rows },
    { type: 'text', title: 'Formule', text: payload.formula + '\n' + payload.note }
  ], landscape: true, signatures: [{ label: 'RH' }, { label: 'Direction' }] }), `cout-personnel-${to}`);
}));

r.get('/hr/reports/employees', need('hr.view', 'hr.manage'), wrap(async (req, res) => {
  const fmt = req.query.format || 'json';
  const { rows } = await pool.query(
    `SELECT e.matricule, e.first_name, e.last_name, e.position, e.status, e.contract_type, e.base_salary, e.phone, e.email,
            to_char(e.hired_on,'YYYY-MM-DD') AS hired_on, e.family_status, e.dependents,
            e.inps_number, e.amo_number, e.retirement_number, e.bank_name, e.bank_account, e.payment_method_pref
     FROM employees e WHERE e.station_id = $1 AND e.deleted_at IS NULL ORDER BY e.last_name, e.first_name`, [req.sid]);
  const lines = rows.map(e => ({
    matricule: e.matricule, nom: e.last_name, prenom: e.first_name, poste: e.position, statut: e.status,
    contrat: e.contract_type, salaire_base: fl(e.base_salary), embauche: e.hired_on, telephone: e.phone, email: e.email,
    situation_familiale: e.family_status, personnes_a_charge: e.dependents, inps: e.inps_number, amo: e.amo_number,
    retraite: e.retirement_number, banque: e.bank_name, compte: e.bank_account, mode_paiement: e.payment_method_pref
  }));
  if (fmt === 'json') return res.json({ count: lines.length, lines });
  const b = await docs.branding(req.sid);
  const head = ['Matricule', 'Nom', 'Prénom', 'Poste', 'Statut', 'Contrat', 'Salaire base', 'Embauche', 'Tél', 'INPS', 'AMO'];
  const dataRows = lines.map(l => [l.matricule, l.nom, l.prenom, l.poste, l.statut, l.contrat, l.salaire_base, l.embauche, l.telephone, l.inps, l.amo]);
  if (fmt === 'xlsx') {
    return docs.send(res, 'xlsx', await docs.buildXlsx({ b, title: 'Liste des salariés', subtitle: `${lines.length} employé(s)`, ref: 'EMP', sheets: [{ name: 'Salariés', head, rows: dataRows }] }), 'salaries');
  }
  docs.send(res, 'pdf', await docs.buildPdf({ b, title: 'LISTE DES SALARIÉS', subtitle: `${lines.length} employé(s)`, ref: 'EMP', sections: [{ type: 'table', title: 'Effectif', head, rows: dataRows }], landscape: true, signatures: [{ label: 'RH' }] }), 'salaries');
}));

r.get('/hr/reports/social-fiscal', need('hr.view', 'hr.payroll', 'hr.manage'), wrap(async (req, res) => {
  const { from, to } = parsePeriod(req);
  const fmt = req.query.format || 'json';
  const data = await payrollMassData(req.sid, from, to, 'valide_paye');
  const t = data.totals;
  const payload = {
    period: { from, to },
    its: { total: t.its, lines: data.slips.filter(s => fl(s.its_amount) > 0).map(s => ({ number: s.number, employee: s.employee, matricule: s.matricule, month: s.month, amount: fl(s.its_amount) })) },
    inps: { employee: t.inps_employee, employer: t.inps_employer, lines: data.slips.filter(s => fl(s.inps_employee) + fl(s.inps_employer) > 0).map(s => ({ number: s.number, employee: s.employee, month: s.month, employee_amount: fl(s.inps_employee), employer_amount: fl(s.inps_employer) })) },
    amo: { employee: t.amo_employee, employer: t.amo_employer, lines: data.slips.filter(s => fl(s.amo_employee) + fl(s.amo_employer) > 0).map(s => ({ number: s.number, employee: s.employee, month: s.month, employee_amount: fl(s.amo_employee), employer_amount: fl(s.amo_employer) })) },
    note: 'Montants figés sur les bulletins. 0 = flag OFF ou règle inactive au calcul.'
  };
  if (fmt === 'json') return res.json(payload);
  const b = await docs.branding(req.sid), cur = b.currency, sub = `${from} → ${to}`;
  if (fmt === 'xlsx') {
    return docs.send(res, 'xlsx', await docs.buildXlsx({ b, title: 'État social et fiscal', subtitle: sub, ref: `SF-${to.replace(/-/g, '')}`, sheets: [
      { name: 'ITS', head: ['Bulletin', 'Employé', 'Matricule', 'Mois', 'Montant'], rows: payload.its.lines.map(l => [l.number, l.employee, l.matricule, l.month, l.amount]), sumCols: [4] },
      { name: 'INPS', head: ['Bulletin', 'Employé', 'Mois', 'Salarié', 'Employeur'], rows: payload.inps.lines.map(l => [l.number, l.employee, l.month, l.employee_amount, l.employer_amount]), sumCols: [3, 4] },
      { name: 'AMO', head: ['Bulletin', 'Employé', 'Mois', 'Salarié', 'Employeur'], rows: payload.amo.lines.map(l => [l.number, l.employee, l.month, l.employee_amount, l.employer_amount]), sumCols: [3, 4] }
    ] }), `social-fiscal-${to}`);
  }
  docs.send(res, 'pdf', await docs.buildPdf({ b, title: 'ÉTAT SOCIAL ET FISCAL', subtitle: sub, ref: `SF-${to.replace(/-/g, '')}`, sections: [
    { type: 'kpis', items: [
      { label: 'ITS', value: `${docs.cellText(t.its)} ${cur}` },
      { label: 'INPS sal./emp.', value: `${docs.cellText(t.inps_employee)} / ${docs.cellText(t.inps_employer)}` },
      { label: 'AMO sal./emp.', value: `${docs.cellText(t.amo_employee)} / ${docs.cellText(t.amo_employer)}` }
    ]},
    { type: 'table', title: 'ITS', head: ['Bulletin', 'Employé', 'Mois', 'Montant'], rows: payload.its.lines.map(l => [l.number, l.employee, l.month, l.amount]) },
    { type: 'table', title: 'INPS', head: ['Bulletin', 'Employé', 'Mois', 'Salarié', 'Employeur'], rows: payload.inps.lines.map(l => [l.number, l.employee, l.month, l.employee_amount, l.employer_amount]) },
    { type: 'table', title: 'AMO', head: ['Bulletin', 'Employé', 'Mois', 'Salarié', 'Employeur'], rows: payload.amo.lines.map(l => [l.number, l.employee, l.month, l.employee_amount, l.employer_amount]) },
    { type: 'text', title: 'Note', text: payload.note }
  ], landscape: true, signatures: [{ label: 'RH' }, { label: 'Comptabilité' }] }), `social-fiscal-${to}`);
}));



// ---------- Activation progressive (Phase 13) ----------
// Tableau de bord + activation sécurisée des feature flags après prérequis.

r.get('/hr/activation-status', need('hr.view', 'hr.manage', 'hr.payroll'), wrap(async (req, res) => {
  const rules = await getSetting(req.sid, 'payroll_rules');
  const flags = rules.feature_flags || {};
  const securityMode = rules.security_mode || 'strict';

  const [its, inps, amo, charges, items] = await Promise.all([
    pool.query(
      `SELECT id, version, label, legal_status, technical_status, effective_from, source_org, source_ref
       FROM its_brackets WHERE station_id IS NULL OR station_id = $1
       ORDER BY version DESC LIMIT 20`, [req.sid]),
    pool.query(
      `SELECT id, code, label, version, legal_status, technical_status, employee_rate, employer_rate, source_org
       FROM inps_branches WHERE station_id IS NULL OR station_id = $1
       ORDER BY code, version DESC`, [req.sid]),
    pool.query(
      `SELECT id, code, label, version, legal_status, technical_status, employee_rate, employer_rate, source_org
       FROM amo_branches WHERE station_id IS NULL OR station_id = $1
       ORDER BY code, version DESC`, [req.sid]),
    pool.query(
      `SELECT id, code, label, version, legal_status, technical_status, rate, fixed_amount, source_org
       FROM employer_charges WHERE station_id IS NULL OR station_id = $1
       ORDER BY code, version DESC`, [req.sid]),
    pool.query(
      `SELECT code, label, item_type, legal_status, technical_status, source_org
       FROM payroll_items WHERE station_id IS NULL OR station_id = $1
       ORDER BY sort_order, code LIMIT 100`, [req.sid])
  ]);

  const ready = (rows, pred) => rows.filter(pred);
  const itsReady = ready(its.rows, b => b.legal_status === 'confirmee' && b.technical_status === 'active');
  const inpsReady = ready(inps.rows, b => b.legal_status === 'confirmee' && b.technical_status === 'active');
  const amoReady = ready(amo.rows, b => b.legal_status === 'confirmee' && b.technical_status === 'active');
  const chargesReady = ready(charges.rows, b => b.legal_status === 'confirmee' && b.technical_status === 'active');

  const modules = [
    {
      code: 'payroll_its_enabled',
      label: 'ITS (Impôt sur les traitements)',
      flag_on: !!flags.payroll_its_enabled,
      prerequisites: [
        { step: 1, label: 'Barème confirmé juridiquement', ok: its.rows.some(b => b.legal_status === 'confirmee') },
        { step: 2, label: 'Barème activé techniquement', ok: itsReady.length > 0 },
        { step: 3, label: 'Feature flag ON', ok: !!flags.payroll_its_enabled }
      ],
      can_enable_flag: itsReady.length > 0,
      active_rules: itsReady.length,
      pending_rules: its.rows.filter(b => b.legal_status === 'a_confirmer').length
    },
    {
      code: 'payroll_inps_enabled',
      label: 'INPS (cotisations sociales)',
      flag_on: !!flags.payroll_inps_enabled,
      prerequisites: [
        { step: 1, label: 'Au moins une branche confirmée', ok: inps.rows.some(b => b.legal_status === 'confirmee') },
        { step: 2, label: 'Au moins une branche active', ok: inpsReady.length > 0 },
        { step: 3, label: 'Feature flag ON', ok: !!flags.payroll_inps_enabled }
      ],
      can_enable_flag: inpsReady.length > 0,
      active_rules: inpsReady.length,
      pending_rules: inps.rows.filter(b => b.legal_status === 'a_confirmer').length
    },
    {
      code: 'payroll_amo_enabled',
      label: 'AMO / CANAM',
      flag_on: !!flags.payroll_amo_enabled,
      prerequisites: [
        { step: 1, label: 'Branche AMO confirmée', ok: amo.rows.some(b => b.legal_status === 'confirmee') },
        { step: 2, label: 'Branche AMO active', ok: amoReady.length > 0 },
        { step: 3, label: 'Feature flag ON', ok: !!flags.payroll_amo_enabled }
      ],
      can_enable_flag: amoReady.length > 0,
      active_rules: amoReady.length,
      pending_rules: amo.rows.filter(b => b.legal_status === 'a_confirmer').length
    },
    {
      code: 'payroll_employer_charges_enabled',
      label: 'Charges patronales (autres)',
      flag_on: !!flags.payroll_employer_charges_enabled,
      prerequisites: [
        { step: 1, label: 'Charge confirmée', ok: charges.rows.some(b => b.legal_status === 'confirmee') },
        { step: 2, label: 'Charge active', ok: chargesReady.length > 0 },
        { step: 3, label: 'Feature flag ON', ok: !!flags.payroll_employer_charges_enabled }
      ],
      can_enable_flag: chargesReady.length > 0,
      active_rules: chargesReady.length,
      pending_rules: charges.rows.filter(b => b.legal_status === 'a_confirmer').length
    }
  ];

  const checklist = [
    { id: 'security_mode', label: 'Mode sécurité paie', value: securityMode, ok: securityMode === 'strict', advice: 'Recommandé : strict' },
    { id: 'flags_default_off', label: 'Flags réglementaires OFF tant que non validés', ok: true, advice: 'État attendu' },
    { id: 'test_preview', label: 'Tester via /hr/payroll/preview ou dry-run avant activation réelle', ok: null, advice: 'Obligatoire avant flag ON' },
    { id: 'impact', label: 'Générer un rapport d\'impact (POST /hr/payroll/impact)', ok: null, advice: 'Avant chaque activation de flag' }
  ];

  res.json({
    security_mode: securityMode,
    engine_version: rules.engine_version || '2.0.0',
    feature_flags: flags,
    modules,
    to_confirm: {
      its_brackets: its.rows.filter(b => b.legal_status === 'a_confirmer'),
      inps_branches: inps.rows.filter(b => b.legal_status === 'a_confirmer'),
      amo_branches: amo.rows.filter(b => b.legal_status === 'a_confirmer'),
      employer_charges: charges.rows.filter(b => b.legal_status === 'a_confirmer'),
      payroll_items: items.rows.filter(i => i.legal_status === 'a_confirmer')
    },
    checklist,
    workflow: [
      '1. Renseigner les taux / barèmes officiels (source DGI / INPS / CANAM)',
      '2. Confirmer juridiquement (POST …/confirm { reason })',
      '3. Activer techniquement (POST …/activate { reason })',
      '4. Tester : POST /hr/payroll/dry-run ou /impact',
      '5. Activer le feature flag (POST /hr/activation/enable-flag)',
      '6. Contrôler un bulletin en preview puis paie réelle sur un cas pilote'
    ],
    warning: 'Aucune règle incertaine ne doit être activée automatiquement. Toute activation est manuelle, auditée et réversible.'
  });
}));

// Active un feature flag UNIQUEMENT si prérequis remplis + motif + confirmation explicite
r.post('/hr/activation/enable-flag', need('hr.manage'), body(z.object({
  flag: z.enum(['payroll_amo_enabled', 'payroll_inps_enabled', 'payroll_its_enabled', 'payroll_employer_charges_enabled']),
  reason: z.string().min(5).max(400),
  confirm: z.literal(true),
  run_impact: z.boolean().optional().default(true),
  month: ym.optional()
})), wrap(async (req, res) => {
  const flag = req.body.flag;
  const month = req.body.month || new Date().toISOString().slice(0, 7);

  // Vérifier prérequis
  let prereqOk = false, detail = '';
  if (flag === 'payroll_its_enabled') {
    const { rows } = await pool.query(
      `SELECT id FROM its_brackets WHERE technical_status = 'active' AND legal_status = 'confirmee'
         AND (station_id = $1 OR station_id IS NULL) LIMIT 1`, [req.sid]);
    prereqOk = rows.length > 0;
    detail = prereqOk ? 'Barème ITS Confirmé+Active trouvé' : 'Aucun barème ITS Confirmé + Active';
  } else if (flag === 'payroll_inps_enabled') {
    const { rows } = await pool.query(
      `SELECT id FROM inps_branches WHERE technical_status = 'active' AND legal_status = 'confirmee'
         AND (station_id = $1 OR station_id IS NULL) LIMIT 1`, [req.sid]);
    prereqOk = rows.length > 0;
    detail = prereqOk ? 'Branche INPS Confirmée+Active trouvée' : 'Aucune branche INPS Confirmée + Active';
  } else if (flag === 'payroll_amo_enabled') {
    const { rows } = await pool.query(
      `SELECT id FROM amo_branches WHERE technical_status = 'active' AND legal_status = 'confirmee'
         AND (station_id = $1 OR station_id IS NULL) LIMIT 1`, [req.sid]);
    prereqOk = rows.length > 0;
    detail = prereqOk ? 'Branche AMO Confirmée+Active trouvée' : 'Aucune branche AMO Confirmée + Active';
  } else if (flag === 'payroll_employer_charges_enabled') {
    const { rows } = await pool.query(
      `SELECT id FROM employer_charges WHERE technical_status = 'active' AND legal_status = 'confirmee'
         AND (station_id = $1 OR station_id IS NULL) LIMIT 1`, [req.sid]);
    prereqOk = rows.length > 0;
    detail = prereqOk ? 'Charge patronale Confirmée+Active trouvée' : 'Aucune charge Confirmée + Active';
  }
  if (!prereqOk) throw new HttpError(409, 'Prérequis non remplis : ' + detail + '. Confirmez puis activez une règle avant le flag.');

  let impact = null;
  if (req.body.run_impact) {
    // Impact dry-run (rollback interne via l'endpoint logique — recalcul local simplifié)
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const { rows: employees } = await c.query(
        `SELECT * FROM employees WHERE station_id = $1 AND deleted_at IS NULL AND status = 'actif' AND base_salary > 0 LIMIT 50`,
        [req.sid]
      );
      let netB = 0, netA = 0, costB = 0, costA = 0;
      for (const e of employees) {
        const p0 = await compute(c, req.sid, e, monthStart(month), 'none', undefined, { calculation_mode: 'simulation' });
        const p1 = await compute(c, req.sid, e, monthStart(month), 'none', undefined, {
          calculation_mode: 'simulation', flag_overrides: { [flag]: true }
        });
        netB = fl(netB + p0.net_pay); netA = fl(netA + p1.net_pay);
        costB = fl(costB + (p0.employer_cost || 0)); costA = fl(costA + (p1.employer_cost || 0));
      }
      await c.query('ROLLBACK');
      impact = {
        employees_sampled: employees.length,
        net_before: netB, net_after: netA, delta_net: fl(netA - netB),
        cost_before: costB, cost_after: costA, delta_cost: fl(costA - costB)
      };
    } catch (err) {
      try { await c.query('ROLLBACK'); } catch (_) {}
      throw err;
    } finally { c.release(); }
  }

  const out = await tx(async c => {
    const current = await getSetting(req.sid, 'payroll_rules');
    const next = {
      ...current,
      feature_flags: { ...(current.feature_flags || {}), [flag]: true }
    };
    await c.query(
      `INSERT INTO settings(station_id, key, value) VALUES ($1,'payroll_rules',$2::jsonb)
       ON CONFLICT (station_id, key) DO UPDATE SET value = EXCLUDED.value`,
      [req.sid, JSON.stringify(next)]
    );
    await audit(c, req, 'paie', `Activation progressive flag ${flag} : ${req.body.reason}`, 'settings', null,
      { [flag]: false }, { [flag]: true, reason: req.body.reason, impact });
    return next.feature_flags;
  });

  res.json({
    ok: true,
    flag,
    enabled: true,
    prerequisite: detail,
    reason: req.body.reason,
    impact,
    feature_flags: out,
    warning: 'Le flag est maintenant ON pour les NOUVEAUX calculs uniquement. Les bulletins historiques restent inchangés.',
    next_steps: [
      'Contrôler un dry-run sur un salarié pilote',
      'Préparer un bulletin brouillon puis valider en paie réelle si conforme',
      'En cas de doute : POST /hr/activation/disable-flag'
    ]
  });
}));

r.post('/hr/activation/disable-flag', need('hr.manage'), body(z.object({
  flag: z.enum(['payroll_amo_enabled', 'payroll_inps_enabled', 'payroll_its_enabled', 'payroll_employer_charges_enabled']),
  reason: z.string().min(5).max(400)
})), wrap(async (req, res) => {
  const flag = req.body.flag;
  const out = await tx(async c => {
    const current = await getSetting(req.sid, 'payroll_rules');
    const next = {
      ...current,
      feature_flags: { ...(current.feature_flags || {}), [flag]: false }
    };
    await c.query(
      `INSERT INTO settings(station_id, key, value) VALUES ($1,'payroll_rules',$2::jsonb)
       ON CONFLICT (station_id, key) DO UPDATE SET value = EXCLUDED.value`,
      [req.sid, JSON.stringify(next)]
    );
    await audit(c, req, 'paie', `Désactivation flag ${flag} : ${req.body.reason}`, 'settings', null,
      { [flag]: true }, { [flag]: false, reason: req.body.reason });
    return next.feature_flags;
  });
  res.json({
    ok: true, flag, enabled: false, feature_flags: out,
    note: 'Flag OFF. Les nouveaux calculs n\'appliqueront plus cette cotisation. Bulletins déjà validés/payés inchangés.'
  });
}));



// ---------- Audit trail RH / paie avancé (Phase 14) ----------
const HR_AUDIT_MODULES = ['rh', 'paie'];
const CRITICAL_TABLES = new Set(['payslips', 'settings', 'its_brackets', 'inps_branches', 'amo_branches', 'employer_charges', 'payroll_items', 'payroll_rule_versions']);
const CRITICAL_KEYWORDS = /validation|paiement|activation|confirm|flag|rectif|suppression|annulation|activation progressive/i;

function classifyAudit(row) {
  const action = row.action || '';
  const table = row.table_name || '';
  if (CRITICAL_TABLES.has(table) && CRITICAL_KEYWORDS.test(action)) return 'critique';
  if (/paiement|validation|activation progressive|flag/i.test(action)) return 'critique';
  if (/confirm|activation|désactivation|rectif/i.test(action)) return 'sensible';
  return 'info';
}

r.get('/hr/audit', need('hr.view', 'hr.manage', 'hr.payroll'), wrap(async (req, res) => {
  const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : null;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? req.query.to : null;
  const module = req.query.module; // rh | paie | all
  const table = req.query.table || null;
  const recordId = req.query.record_id ? +req.query.record_id : null;
  const q = (req.query.q || '').trim();
  const severity = req.query.severity; // critique | sensible | info | all
  const limit = Math.min(+req.query.limit || 100, 500);
  const offset = Math.max(+req.query.offset || 0, 0);

  const modules = module === 'rh' || module === 'paie' ? [module] : HR_AUDIT_MODULES;

  const { rows } = await pool.query(
    `SELECT a.id, a.module, a.action, a.table_name, a.record_id, a.old_value, a.new_value,
            a.ip_address::text AS ip_address, a.created_at, u.login AS user_login
     FROM audit_logs a
     LEFT JOIN users u ON u.id = a.user_id
     WHERE a.station_id = $1
       AND a.module = ANY($2::text[])
       AND ($3::date IS NULL OR a.created_at::date >= $3::date)
       AND ($4::date IS NULL OR a.created_at::date <= $4::date)
       AND ($5::text IS NULL OR a.table_name = $5)
       AND ($6::bigint IS NULL OR a.record_id = $6)
       AND ($7::text IS NULL OR a.action ILIKE '%' || $7 || '%' OR COALESCE(u.login,'') ILIKE '%' || $7 || '%')
     ORDER BY a.id DESC
     LIMIT $8 OFFSET $9`,
    [req.sid, modules, from, to, table, recordId, q || null, limit, offset]
  );

  const lines = rows.map(row => ({
    ...row,
    severity: classifyAudit(row)
  })).filter(row => !severity || severity === 'all' || row.severity === severity);

  const { rows: [cnt] } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM audit_logs a
     WHERE a.station_id = $1 AND a.module = ANY($2::text[])
       AND ($3::date IS NULL OR a.created_at::date >= $3::date)
       AND ($4::date IS NULL OR a.created_at::date <= $4::date)`,
    [req.sid, modules, from, to]
  );

  res.json({
    total: cnt.n,
    count: lines.length,
    limit, offset,
    filters: { from, to, module: module || 'rh+paie', table, record_id: recordId, q, severity: severity || 'all' },
    lines,
    note: 'Journal append-only. Les simulations / dry-run ne produisent aucune entrée d\'audit financière.'
  });
}));

r.get('/hr/audit/integrity', need('hr.manage', 'hr.payroll'), wrap(async (req, res) => {
  const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? req.query.to : new Date().toISOString().slice(0, 10);

  const { rows: events } = await pool.query(
    `SELECT a.module, a.action, a.table_name, a.record_id, a.created_at, u.login
     FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
     WHERE a.station_id = $1 AND a.module = ANY($2::text[])
       AND a.created_at::date >= $3::date AND a.created_at::date <= $4::date
     ORDER BY a.id DESC LIMIT 2000`,
    [req.sid, HR_AUDIT_MODULES, from, to]
  );

  const classified = events.map(e => ({ ...e, severity: classifyAudit(e) }));
  const bySeverity = { critique: 0, sensible: 0, info: 0 };
  const byTable = {};
  const byUser = {};
  for (const e of classified) {
    bySeverity[e.severity] = (bySeverity[e.severity] || 0) + 1;
    const t = e.table_name || '(sans table)';
    byTable[t] = (byTable[t] || 0) + 1;
    const u = e.login || '(système)';
    byUser[u] = (byUser[u] || 0) + 1;
  }

  // Contrôles d'intégrité soft
  const { rows: locked } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM payslips WHERE station_id = $1 AND status IN ('valide','paye') AND COALESCE(is_locked,false) = false`,
    [req.sid]
  );
  const { rows: paidUnlocked } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM payslips WHERE station_id = $1 AND status = 'paye'`,
    [req.sid]
  );
  const { rows: flagsOn } = await pool.query(
    `SELECT value FROM settings WHERE station_id = $1 AND key = 'payroll_rules'`,
    [req.sid]
  );
  const flags = (flagsOn[0]?.value?.feature_flags) || {};

  res.json({
    period: { from, to },
    events_scanned: classified.length,
    by_severity: bySeverity,
    by_table: byTable,
    by_user: byUser,
    critical_events: classified.filter(e => e.severity === 'critique').slice(0, 50),
    integrity_checks: [
      {
        code: 'payslips_unlocked_final',
        label: 'Bulletins validés/payés sans verrou is_locked',
        count: locked[0].n,
        ok: locked[0].n === 0,
        advice: locked[0].n ? 'Vérifier migration 004 et validations' : 'OK'
      },
      {
        code: 'paid_count',
        label: 'Bulletins payés (période non filtrée station)',
        count: paidUnlocked[0].n,
        ok: true,
        advice: 'Informational'
      },
      {
        code: 'feature_flags',
        label: 'Flags réglementaires actifs',
        value: flags,
        ok: true,
        advice: 'Chaque flag ON doit correspondre à des règles Confirmées+Actives'
      }
    ],
    append_only: true,
    note: 'audit_logs est protégé par trigger : UPDATE/DELETE interdits.'
  });
}));

r.get('/hr/audit/export', need('hr.manage', 'hr.payroll'), wrap(async (req, res) => {
  const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? req.query.to : new Date().toISOString().slice(0, 10);
  const fmt = req.query.format || 'pdf';
  const modules = req.query.module === 'rh' || req.query.module === 'paie' ? [req.query.module] : HR_AUDIT_MODULES;

  const { rows } = await pool.query(
    `SELECT a.created_at, u.login, a.module, a.action, a.table_name, a.record_id,
            a.old_value, a.new_value, a.ip_address::text AS ip
     FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
     WHERE a.station_id = $1 AND a.module = ANY($2::text[])
       AND a.created_at::date >= $3::date AND a.created_at::date <= $4::date
     ORDER BY a.id DESC LIMIT 1000`,
    [req.sid, modules, from, to]
  );

  const head = ['Date', 'Utilisateur', 'Module', 'Action', 'Table', 'N°', 'Sévérité', 'IP'];
  const dataRows = rows.map(r => {
    const sev = classifyAudit(r);
    return [r.created_at, r.login || '', r.module, r.action, r.table_name || '', r.record_id || '', sev, r.ip || ''];
  });

  const b = await docs.branding(req.sid);
  const sub = `${from} → ${to}`;
  if (fmt === 'xlsx') {
    return docs.send(res, 'xlsx', await docs.buildXlsx({
      b, title: 'Journal audit RH/Paie', subtitle: sub, ref: `AUD-RH-${to.replace(/-/g, '')}`,
      sheets: [{ name: 'Audit RH', head, rows: dataRows, notes: ['Journal append-only', 'Dry-run non journalisé comme écriture financière'] }]
    }), `audit-rh-${to}`);
  }
  const sections = [
    { type: 'kpis', items: [
      { label: 'Événements', value: String(rows.length) },
      { label: 'Période', value: sub },
      { label: 'Modules', value: modules.join(', ') }
    ]},
    { type: 'table', title: 'Événements', head, rows: dataRows.slice(0, 300) },
    { type: 'text', title: 'Note', text: 'Audit append-only. Les simulations ne créent pas d\'écriture financière ni d\'entrée critique.' }
  ];
  docs.send(res, 'pdf', await docs.buildPdf({
    b, title: 'JOURNAL D\'AUDIT RH & PAIE', subtitle: sub, ref: `AUD-RH-${to.replace(/-/g, '')}`,
    sections, landscape: true, signatures: [{ label: 'Contrôleur' }, { label: 'Direction' }]
  }), `audit-rh-${to}`);
}));

// Historique d'un bulletin (chaîne d'audit liée)
r.get('/hr/payroll/:id/audit', need('hr.view', 'hr.payroll', 'hr.manage'), wrap(async (req, res) => {
  const s = await slip(req, req.params.id);
  const { rows } = await pool.query(
    `SELECT a.id, a.module, a.action, a.old_value, a.new_value, a.created_at, u.login,
            a.ip_address::text AS ip_address
     FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
     WHERE a.station_id = $1 AND a.table_name = 'payslips' AND a.record_id = $2
     ORDER BY a.id`,
    [req.sid, s.id]
  );
  res.json({
    payslip_id: s.id,
    number: s.number,
    status: s.status,
    is_locked: s.is_locked,
    events: rows.map(r => ({ ...r, severity: classifyAudit(r) })),
    note: 'Historique append-only de ce bulletin (préparation, validation, paiement, appréciation, rectification liée côté enregistrement).'
  });
}));



// ---------- Compléments finaux (portail salarié, prévision, stats) ----------

// Portail salarié : mes bulletins (sans droits RH)
r.get('/hr/me/payslips', wrap(async (req, res) => {
  const { rows: [e] } = await pool.query(
    'SELECT id FROM employees WHERE user_id = $1 AND station_id = $2 AND deleted_at IS NULL',
    [req.user.id, req.sid]
  );
  if (!e) return res.json({ employee_id: null, lines: [] });
  const { rows } = await pool.query(
    `SELECT s.id, s.number, ${D('s.month')} AS month, s.status, s.gross, s.total_deductions, s.net_pay,
            s.employer_cost, s.paid_at, s.validated_at
     FROM payslips s WHERE s.station_id = $1 AND s.employee_id = $2
     ORDER BY s.month DESC, s.id DESC LIMIT 120`,
    [req.sid, e.id]
  );
  res.json({ employee_id: e.id, lines: rows, note: 'Téléchargement PDF via GET /hr/payroll/:id/pdf (accès self autorisé).' });
}));

// Prévision de masse salariale (dry-run, aucun impact financier)
r.get('/hr/reports/forecast', need('hr.view', 'hr.payroll', 'hr.manage'), wrap(async (req, res) => {
  const month = req.query.month && /^\d{4}-\d{2}$/.test(req.query.month)
    ? req.query.month
    : new Date().toISOString().slice(0, 7);
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const { rows: employees } = await c.query(
      `SELECT * FROM employees WHERE station_id = $1 AND deleted_at IS NULL AND status = 'actif' ORDER BY last_name`,
      [req.sid]
    );
    const lines = [];
    let gross = 0, net = 0, cost = 0, its = 0, inpsE = 0, inpsP = 0, amoE = 0, amoP = 0, charges = 0;
    for (const e of employees) {
      if (!(fl(e.base_salary) > 0)) {
        lines.push({ employee_id: e.id, name: fullName(e), skipped: true, reason: 'Pas de salaire de base' });
        continue;
      }
      const p = await compute(c, req.sid, e, monthStart(month), 'none', undefined, { calculation_mode: 'simulation' });
      gross = fl(gross + p.gross);
      net = fl(net + p.net_pay);
      cost = fl(cost + (p.employer_cost || p.gross));
      its = fl(its + (p.its_amount || 0));
      inpsE = fl(inpsE + (p.inps_employee || 0));
      inpsP = fl(inpsP + (p.inps_employer || 0));
      amoE = fl(amoE + (p.amo_employee || 0));
      amoP = fl(amoP + (p.amo_employer || 0));
      charges = fl(charges + (p.employer_charges_total || 0));
      lines.push({
        employee_id: e.id, name: fullName(e), matricule: e.matricule,
        base_salary: fl(e.base_salary), gross: p.gross, net_pay: p.net_pay,
        employer_cost: p.employer_cost, warnings: p.warnings
      });
    }
    await c.query('ROLLBACK');
    res.json({
      dry_run: true, financial_impact: false,
      month,
      headcount: employees.length,
      with_salary: lines.filter(l => !l.skipped).length,
      totals: {
        gross, net_pay: net, employer_cost: cost,
        its, inps_employee: inpsE, inps_employer: inpsP,
        amo_employee: amoE, amo_employer: amoP,
        employer_charges: charges
      },
      lines,
      note: 'Prévision pure (ROLLBACK). Flags et règles actuels. Aucun bulletin créé.'
    });
  } catch (err) {
    try { await c.query('ROLLBACK'); } catch (_) {}
    throw err;
  } finally { c.release(); }
}));

// Statistiques RH (lecture seule, hors calcul de paie)
r.get('/hr/reports/stats', need('hr.view', 'hr.manage'), wrap(async (req, res) => {
  const [
    { rows: [head] },
    { rows: byStatus },
    { rows: byContract },
    { rows: [pay] },
    { rows: [debt] },
    { rows: [adv] }
  ] = await Promise.all([
    pool.query(
      `SELECT COUNT(*) FILTER (WHERE status = 'actif')::int AS actifs,
              COUNT(*) FILTER (WHERE status = 'suspendu')::int AS suspendus,
              COUNT(*) FILTER (WHERE status = 'inactif')::int AS inactifs,
              COUNT(*)::int AS total
       FROM employees WHERE station_id = $1 AND deleted_at IS NULL`, [req.sid]),
    pool.query(
      `SELECT status, COUNT(*)::int AS n FROM employees
       WHERE station_id = $1 AND deleted_at IS NULL GROUP BY status`, [req.sid]),
    pool.query(
      `SELECT COALESCE(contract_type,'(non renseigné)') AS contract_type, COUNT(*)::int AS n
       FROM employees WHERE station_id = $1 AND deleted_at IS NULL GROUP BY 1 ORDER BY n DESC`, [req.sid]),
    pool.query(
      `SELECT COUNT(*)::int AS bulletins,
              COUNT(*) FILTER (WHERE status = 'paye')::int AS payes,
              COUNT(*) FILTER (WHERE status = 'valide')::int AS valides,
              COUNT(*) FILTER (WHERE status = 'brouillon')::int AS brouillons,
              COALESCE(SUM(net_pay) FILTER (WHERE status = 'paye'),0) AS net_paid_ytd
       FROM payslips WHERE station_id = $1 AND EXTRACT(YEAR FROM month) = EXTRACT(YEAR FROM CURRENT_DATE)`, [req.sid]),
    pool.query(
      `SELECT COUNT(*) FILTER (WHERE status = 'en_cours')::int AS en_cours,
              COALESCE(SUM(amount - COALESCE((SELECT SUM(p.amount) FROM employee_debt_payments p WHERE p.debt_id = d.id),0))
                FILTER (WHERE status = 'en_cours'),0) AS solde
       FROM employee_debts d WHERE station_id = $1`, [req.sid]),
    pool.query(
      `SELECT COUNT(*) FILTER (WHERE status = 'en_cours')::int AS en_cours,
              COALESCE(SUM(amount - deducted) FILTER (WHERE status = 'en_cours'),0) AS outstanding
       FROM salary_advances WHERE station_id = $1`, [req.sid])
  ]);
  res.json({
    headcount: head,
    by_status: byStatus,
    by_contract: byContract,
    payroll_year: pay,
    debts: debt,
    advances: adv,
    note: 'Statistiques descriptives — aucun impact sur les calculs de paie.'
  });
}));


module.exports = r;
