// RH V2 — modules professionnels (extension non destructive de hr.js)
// Phase 1 sans risque financier + e-mail bulletin + contrôle de paie.
const express = require('express');
const { ignored } = require('./safe');
const { z } = require('zod');
const { pool, tx, fl, HttpError, wrap, body, need, audit } = require('./core');
const { getSetting } = require('./admin');
const { sendMail } = require('./mailer');
const { sendSystemAlert } = require('./messaging');
const docs = require('./docs');
const r = express.Router();

const D = c => `to_char(${c}, 'YYYY-MM-DD')`;
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const today = () => new Date().toISOString().slice(0, 10);

const DEFAULT_MODULES = {
  dossier: true, contracts: true, documents: true, schedule: true,
  attendance: true, leave: true, skills: true, training: true,
  evaluation: true, disciplinary: true, alerts: true, portal: true,
  payroll_email: true, payroll_control: true
};

// Lecture directe du modèle d'e-mail de bulletin : la clé n'est pas dans KEYS d'admin.getSetting (qui lève une TypeError → modèle personnalisé jamais relu).
async function readTemplate(sid) {
  const { rows: [row] } = await pool.query("SELECT value FROM settings WHERE station_id = $1 AND key = 'payslip_email_template'", [sid]);
  return row && row.value && typeof row.value === 'object' ? row.value : null;
}

async function modules(sid) {
  // Lecture directe (hr_modules n'est pas dans KEYS d'admin.getSetting)
  try {
    const { rows: [row] } = await pool.query(
      "SELECT value FROM settings WHERE station_id = $1 AND key = 'hr_modules'", [sid]
    );
    const v = row && row.value && typeof row.value === 'object' ? row.value : {};
    return { ...DEFAULT_MODULES, ...v };
  } catch {
    return { ...DEFAULT_MODULES };
  }
}
function requireModule(key) {
  return wrap(async (req, res, next) => {
    const m = await modules(req.sid);
    if (!m[key]) throw new HttpError(403, `Module RH « ${key} » désactivé dans les paramètres.`);
    next();
  });
}

// Compat : anciennes permissions + nouvelles
const any = (...codes) => need(...codes);

// ---------- Modules activés ----------
r.get('/hr/v2/modules', any('hr.view', 'hr.manage', 'hr.settings'), wrap(async (req, res) => {
  res.json({ modules: await modules(req.sid), note: 'Activation locale — aucun abonnement requis.' });
}));
r.put('/hr/v2/modules', need('hr.settings', 'hr.manage'), body(z.object({
  modules: z.record(z.boolean())
})), wrap(async (req, res) => {
  const prev = await modules(req.sid);
  // Fusion : seules les clés connues de DEFAULT_MODULES sont acceptées
  const patch = {};
  for (const [k, v] of Object.entries(req.body.modules || {})) {
    if (k in DEFAULT_MODULES) patch[k] = !!v;
  }
  const next = { ...DEFAULT_MODULES, ...prev, ...patch };
  await pool.query(
    `INSERT INTO settings(station_id, key, value) VALUES ($1,'hr_modules',$2::jsonb)
     ON CONFLICT (station_id, key) DO UPDATE SET value = EXCLUDED.value`,
    [req.sid, JSON.stringify(next)]
  );
  await audit(pool, req, 'rh', 'Mise à jour modules RH V2', 'settings', null, prev, next);
  res.json({ ok: true, modules: next });
}));

// ---------- Tableau de bord ----------
r.get('/hr/v2/dashboard', any('hr.view', 'hr.manage', 'hr.employee.view'), wrap(async (req, res) => {
  const [
    { rows: [hc] },
    { rows: [att] },
    { rows: [doc] },
    { rows: [lv] },
    { rows: [pay] },
    { rows: alerts }
  ] = await Promise.all([
    pool.query(`SELECT COUNT(*) FILTER (WHERE status='actif')::int AS actifs,
                       COUNT(*) FILTER (WHERE status='inactif')::int AS inactifs,
                       COUNT(*)::int AS total
                FROM employees WHERE station_id=$1 AND deleted_at IS NULL`, [req.sid]),
    pool.query(`SELECT COUNT(*) FILTER (WHERE status='present')::int AS presents,
                       COUNT(*) FILTER (WHERE status='absent')::int AS absents,
                       COUNT(*) FILTER (WHERE status='retard')::int AS retards
                FROM hr_attendance WHERE station_id=$1 AND work_date=CURRENT_DATE`, [req.sid]),
    pool.query(`SELECT COUNT(*) FILTER (WHERE expires_on BETWEEN CURRENT_DATE AND CURRENT_DATE + 30)::int AS expiring,
                       COUNT(*) FILTER (WHERE expires_on < CURRENT_DATE)::int AS expired
                FROM hr_documents WHERE station_id=$1`, [req.sid]),
    pool.query(`SELECT COUNT(*) FILTER (WHERE status='demande')::int AS pending
                FROM hr_leave_requests WHERE station_id=$1`, [req.sid]),
    pool.query(`SELECT COUNT(*) FILTER (WHERE status='brouillon')::int AS brouillons,
                       COUNT(*) FILTER (WHERE status='valide')::int AS valides,
                       COUNT(*) FILTER (WHERE status='paye' AND month >= date_trunc('month', CURRENT_DATE))::int AS payes_mois
                FROM payslips WHERE station_id=$1`, [req.sid]),
    pool.query(`SELECT id, level, kind, message, ${D('due_date')} AS due_date, status
                FROM hr_alerts WHERE station_id=$1 AND status='open' ORDER BY id DESC LIMIT 20`, [req.sid])
  ]);
  res.json({ headcount: hc, attendance_today: att, documents: doc, leave_pending: lv.pending,
    payroll: pay, alerts, level: '1_sans_risque_financier' });
}));

// ---------- Contrats ----------
r.get('/hr/v2/contracts', any('hr.view', 'hr.employee.view', 'hr.manage'), requireModule('contracts'), wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT c.*, e.first_name || ' ' || e.last_name AS employee, ${D('c.start_date')} AS start_date,
            ${D('c.end_date')} AS end_date, ${D('c.trial_end')} AS trial_end
     FROM hr_contracts c JOIN employees e ON e.id = c.employee_id
     WHERE c.station_id = $1 AND ($2::bigint IS NULL OR c.employee_id = $2)
     ORDER BY c.id DESC LIMIT 200`,
    [req.sid, req.query.employee_id ? +req.query.employee_id : null]
  );
  res.json(rows);
}));
r.post('/hr/v2/contracts', any('hr.employee.edit', 'hr.manage'), requireModule('contracts'), body(z.object({
  employee_id: z.number().int(),
  contract_type: z.string().min(1).max(40),
  position: z.string().optional().nullable(),
  start_date: ymd,
  end_date: ymd.optional().nullable(),
  trial_end: ymd.optional().nullable(),
  salary: z.number().nonnegative().optional().nullable(),
  hours_per_week: z.number().optional().nullable(),
  notes: z.string().optional().nullable()
})), wrap(async (req, res) => {
  const b = req.body;
  const { rows: [x] } = await pool.query(
    `INSERT INTO hr_contracts(station_id, employee_id, contract_type, position, start_date, end_date, trial_end, salary, hours_per_week, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [req.sid, b.employee_id, b.contract_type, b.position || null, b.start_date, b.end_date || null, b.trial_end || null,
      b.salary ?? null, b.hours_per_week ?? null, b.notes || null, req.user.id]
  );
  await audit(pool, req, 'rh', `Contrat ${b.contract_type} créé pour employé ${b.employee_id}`, 'hr_contracts', x.id, null, b);
  res.status(201).json({ id: x.id });
}));

// ---------- Documents ----------
r.get('/hr/v2/documents', any('hr.documents.view', 'hr.employee.documents', 'hr.view', 'hr.manage'), requireModule('documents'), wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT d.*, e.first_name || ' ' || e.last_name AS employee,
            ${D('d.issued_on')} AS issued_on, ${D('d.expires_on')} AS expires_on
     FROM hr_documents d JOIN employees e ON e.id = d.employee_id
     WHERE d.station_id = $1 AND ($2::bigint IS NULL OR d.employee_id = $2)
     ORDER BY d.id DESC LIMIT 300`,
    [req.sid, req.query.employee_id ? +req.query.employee_id : null]
  );
  res.json(rows);
}));
r.post('/hr/v2/documents', any('hr.documents.upload', 'hr.employee.documents', 'hr.manage'), requireModule('documents'), body(z.object({
  employee_id: z.number().int(),
  category: z.string().min(1).max(40),
  title: z.string().min(1).max(200),
  issued_on: ymd.optional().nullable(),
  expires_on: ymd.optional().nullable(),
  notes: z.string().optional().nullable(),
  file_path: z.string().optional().nullable()
})), wrap(async (req, res) => {
  const b = req.body;
  const { rows: [x] } = await pool.query(
    `INSERT INTO hr_documents(station_id, employee_id, category, title, issued_on, expires_on, notes, file_path, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [req.sid, b.employee_id, b.category, b.title, b.issued_on || null, b.expires_on || null, b.notes || null, b.file_path || null, req.user.id]
  );
  await audit(pool, req, 'rh', `Document RH « ${b.title} »`, 'hr_documents', x.id, null, b);
  if (b.expires_on) {
    await pool.query(
      `INSERT INTO hr_alerts(station_id, employee_id, level, kind, message, due_date)
       VALUES ($1,$2,'warning','document_expiration',$3,$4)`,
      [req.sid, b.employee_id, `Document « ${b.title} » expire le ${b.expires_on}`, b.expires_on]
    );
  }
  res.status(201).json({ id: x.id });
}));

// ---------- Équipes & Planning ----------
r.get('/hr/v2/teams', any('hr.schedule.view', 'hr.view', 'hr.manage'), requireModule('schedule'), wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM hr_teams WHERE station_id = $1 ORDER BY code', [req.sid]);
  res.json(rows);
}));
r.post('/hr/v2/teams', any('hr.schedule.manage', 'hr.manage'), requireModule('schedule'), body(z.object({
  code: z.string().min(1).max(20), name: z.string().min(1).max(80),
  start_time: z.string().optional().nullable(), end_time: z.string().optional().nullable()
})), wrap(async (req, res) => {
  const b = req.body;
  const { rows: [x] } = await pool.query(
    `INSERT INTO hr_teams(station_id, code, name, start_time, end_time) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [req.sid, b.code, b.name, b.start_time || null, b.end_time || null]
  );
  res.status(201).json({ id: x.id });
}));

r.get('/hr/v2/schedules', any('hr.schedule.view', 'hr.view', 'hr.manage'), requireModule('schedule'), wrap(async (req, res) => {
  const from = req.query.from || today();
  const to = req.query.to || today();
  const { rows } = await pool.query(
    `SELECT s.*, e.first_name || ' ' || e.last_name AS employee, t.name AS team_name,
            ${D('s.work_date')} AS work_date
     FROM hr_schedules s
     JOIN employees e ON e.id = s.employee_id
     LEFT JOIN hr_teams t ON t.id = s.team_id
     WHERE s.station_id = $1 AND s.work_date BETWEEN $2::date AND $3::date
     ORDER BY s.work_date, s.start_time`,
    [req.sid, from, to]
  );
  res.json(rows);
}));
r.post('/hr/v2/schedules', any('hr.schedule.manage', 'hr.manage'), requireModule('schedule'), body(z.object({
  employee_id: z.number().int(),
  team_id: z.number().int().optional().nullable(),
  work_date: ymd,
  start_time: z.string().optional().nullable(),
  end_time: z.string().optional().nullable(),
  notes: z.string().optional().nullable()
})), wrap(async (req, res) => {
  const b = req.body;
  const { rows: [x] } = await pool.query(
    `INSERT INTO hr_schedules(station_id, employee_id, team_id, work_date, start_time, end_time, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [req.sid, b.employee_id, b.team_id || null, b.work_date, b.start_time || null, b.end_time || null, b.notes || null, req.user.id]
  );
  await audit(pool, req, 'rh', `Planning ${b.work_date} employé ${b.employee_id}`, 'hr_schedules', x.id, null, b);
  res.status(201).json({ id: x.id });
}));

// ---------- Présence ----------
r.get('/hr/v2/attendance', any('hr.attendance.view', 'hr.view', 'hr.manage'), requireModule('attendance'), wrap(async (req, res) => {
  const from = req.query.from || today();
  const to = req.query.to || today();
  const { rows } = await pool.query(
    `SELECT a.*, e.first_name || ' ' || e.last_name AS employee, ${D('a.work_date')} AS work_date
     FROM hr_attendance a JOIN employees e ON e.id = a.employee_id
     WHERE a.station_id = $1 AND a.work_date BETWEEN $2::date AND $3::date
       AND ($4::bigint IS NULL OR a.employee_id = $4)
     ORDER BY a.work_date DESC, e.last_name LIMIT 500`,
    [req.sid, from, to, req.query.employee_id ? +req.query.employee_id : null]
  );
  res.json(rows);
}));
r.post('/hr/v2/attendance', any('hr.attendance.manage', 'hr.manage'), requireModule('attendance'), body(z.object({
  employee_id: z.number().int(),
  work_date: ymd,
  status: z.enum(['present','absent','retard','conge','maladie','mission','repos','autre']),
  time_in: z.string().optional().nullable(),
  time_out: z.string().optional().nullable(),
  late_minutes: z.number().int().nonnegative().optional(),
  notes: z.string().optional().nullable()
})), wrap(async (req, res) => {
  const b = req.body;
  const { rows: [employee] } = await pool.query(
    'SELECT id, user_id, first_name, last_name FROM employees WHERE id = $1 AND station_id = $2 AND deleted_at IS NULL', [b.employee_id, req.sid]);
  if (!employee) throw new HttpError(404, 'Employé introuvable dans cette station.');
  const { rows: [x] } = await pool.query(
    `INSERT INTO hr_attendance(station_id, employee_id, work_date, status, time_in, time_out, late_minutes, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (employee_id, work_date) DO UPDATE SET
       status = EXCLUDED.status, time_in = EXCLUDED.time_in, time_out = EXCLUDED.time_out,
       late_minutes = EXCLUDED.late_minutes, notes = EXCLUDED.notes, updated_at = now()
     RETURNING id`,
    [req.sid, b.employee_id, b.work_date, b.status, b.time_in || null, b.time_out || null, b.late_minutes || 0, b.notes || null, req.user.id]
  );
  await audit(pool, req, 'rh', `Présence ${b.work_date} ${b.status}`, 'hr_attendance', x.id, null, b);
  if (b.status === 'absent' || b.status === 'retard') {
    try {
      const { rows: [actor] } = await pool.query('SELECT client_id FROM users WHERE id = $1 AND deleted_at IS NULL', [req.user.id]);
      if (actor?.client_id) await sendSystemAlert({
        clientId: actor.client_id, actorUserId: req.user.id, employeeUserId: employee.user_id || null,
        kind: b.status === 'absent' ? 'absence' : 'late_arrival',
        body: `${b.status === 'absent' ? 'Absence' : `Retard de ${b.late_minutes || 0} minute(s)`} : ${employee.first_name} ${employee.last_name}, date ${b.work_date}${b.notes ? ` — ${b.notes}` : ''}`,
        refTable: 'hr_attendance', refId: x.id, stationId: req.sid,
        metricValue: Number(b.late_minutes || 0), metricUnit: 'minutes'
      });
    } catch (alertError) { console.warn('[alertes] Présence enregistrée mais non notifiée:', alertError.message); }
  }
  res.status(201).json({ id: x.id });
}));
r.post('/hr/v2/attendance/:id/correct', any('hr.attendance.correct', 'hr.manage'), requireModule('attendance'), body(z.object({
  status: z.enum(['present','absent','retard','conge','maladie','mission','repos','autre']).optional(),
  time_in: z.string().optional().nullable(),
  time_out: z.string().optional().nullable(),
  late_minutes: z.number().int().optional(),
  reason: z.string().min(3).max(400)
})), wrap(async (req, res) => {
  const { rows: [old] } = await pool.query('SELECT * FROM hr_attendance WHERE id = $1 AND station_id = $2', [req.params.id, req.sid]);
  if (!old) throw new HttpError(404, 'Présence introuvable');
  const b = req.body;
  const { rows: [x] } = await pool.query(
    `UPDATE hr_attendance SET
       status = COALESCE($3, status), time_in = COALESCE($4, time_in), time_out = COALESCE($5, time_out),
       late_minutes = COALESCE($6, late_minutes), corrected_by = $7, correction_reason = $8,
       previous_values = $9::jsonb, updated_at = now()
     WHERE id = $1 AND station_id = $2 RETURNING id`,
    [old.id, req.sid, b.status || null, b.time_in ?? null, b.time_out ?? null, b.late_minutes ?? null,
      req.user.id, b.reason, JSON.stringify({ status: old.status, time_in: old.time_in, time_out: old.time_out, late_minutes: old.late_minutes })]
  );
  await audit(pool, req, 'rh', `Correction présence ${old.id} : ${b.reason}`, 'hr_attendance', x.id,
    { status: old.status }, { status: b.status, reason: b.reason });
  const newStatus = b.status || old.status;
  if ((newStatus === 'absent' || newStatus === 'retard') && newStatus !== old.status) {
    try {
      const [{ rows: [employee] }, { rows: [actor] }] = await Promise.all([
        pool.query('SELECT user_id, first_name, last_name FROM employees WHERE id = $1 AND station_id = $2 AND deleted_at IS NULL', [old.employee_id, req.sid]),
        pool.query('SELECT client_id FROM users WHERE id = $1 AND deleted_at IS NULL', [req.user.id])
      ]);
      if (employee && actor?.client_id) await sendSystemAlert({
        clientId: actor.client_id, actorUserId: req.user.id, employeeUserId: employee.user_id || null,
        kind: newStatus === 'absent' ? 'absence' : 'late_arrival',
        body: `Présence corrigée : ${newStatus === 'absent' ? 'absence' : 'retard'} de ${employee.first_name} ${employee.last_name}. Motif de correction : ${b.reason}`,
        refTable: 'hr_attendance', refId: x.id, stationId: req.sid,
        metricValue: Number(b.late_minutes ?? old.late_minutes ?? 0), metricUnit: 'minutes'
      });
    } catch (alertError) { console.warn('[alertes] Correction enregistrée mais non notifiée:', alertError.message); }
  }
  res.json({ id: x.id, ok: true });
}));

// ---------- Congés ----------
r.get('/hr/v2/leave-types', any('hr.leave.view', 'hr.view', 'hr.manage'), requireModule('leave'), wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM hr_leave_types WHERE station_id IS NULL OR station_id = $1 ORDER BY code`, [req.sid]
  );
  res.json(rows);
}));
r.get('/hr/v2/leaves', any('hr.leave.view', 'hr.view', 'hr.manage'), requireModule('leave'), wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT l.*, e.first_name || ' ' || e.last_name AS employee, t.label AS type_label,
            ${D('l.start_date')} AS start_date, ${D('l.end_date')} AS end_date
     FROM hr_leave_requests l
     JOIN employees e ON e.id = l.employee_id
     LEFT JOIN hr_leave_types t ON t.id = l.leave_type_id
     WHERE l.station_id = $1 AND ($2::bigint IS NULL OR l.employee_id = $2)
     ORDER BY l.id DESC LIMIT 200`,
    [req.sid, req.query.employee_id ? +req.query.employee_id : null]
  );
  res.json(rows);
}));
r.post('/hr/v2/leaves', any('hr.leave.request', 'hr.leave.manage', 'hr.manage'), requireModule('leave'), body(z.object({
  employee_id: z.number().int(),
  leave_type_id: z.number().int().optional().nullable(),
  start_date: ymd, end_date: ymd,
  days: z.number().positive(),
  reason: z.string().optional().nullable()
})), wrap(async (req, res) => {
  const b = req.body;
  // Self-service : un salarié ne peut demander que pour lui
  const { rows: [me] } = await pool.query(
    'SELECT id FROM employees WHERE user_id = $1 AND station_id = $2 AND deleted_at IS NULL',
    [req.user.id, req.sid]
  );
  if (!req.user.perms.has('hr.leave.manage') && !req.user.perms.has('hr.manage') && !req.user.perms.has('hr.leave.approve')) {
    if (!me || me.id !== b.employee_id) throw new HttpError(403, 'Vous ne pouvez demander un congé que pour vous-même.');
  }
  const { rows: [x] } = await pool.query(
    `INSERT INTO hr_leave_requests(station_id, employee_id, leave_type_id, start_date, end_date, days, reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [req.sid, b.employee_id, b.leave_type_id || null, b.start_date, b.end_date, b.days, b.reason || null]
  );
  await pool.query(
    `INSERT INTO hr_alerts(station_id, employee_id, level, kind, message)
     VALUES ($1,$2,'info','leave_pending',$3)`,
    [req.sid, b.employee_id, `Demande de congé #${x.id} en attente`]
  );
  await audit(pool, req, 'rh', `Demande congé #${x.id}`, 'hr_leave_requests', x.id, null, b);
  res.status(201).json({ id: x.id, status: 'demande' });
}));
r.post('/hr/v2/leaves/:id/decide', any('hr.leave.approve', 'hr.manage'), requireModule('leave'), body(z.object({
  decision: z.enum(['approuve', 'refuse']),
  note: z.string().optional().nullable()
})), wrap(async (req, res) => {
  const { rows: [l] } = await pool.query('SELECT * FROM hr_leave_requests WHERE id = $1 AND station_id = $2', [req.params.id, req.sid]);
  if (!l) throw new HttpError(404, 'Demande introuvable');
  if (l.status !== 'demande' && l.status !== 'approuve_responsable') throw new HttpError(409, 'Demande déjà tranchée');
  await pool.query(
    `UPDATE hr_leave_requests SET status = $3, decided_by = $4, decided_at = now(), decision_note = $5 WHERE id = $1 AND station_id = $2`,
    [l.id, req.sid, req.body.decision, req.user.id, req.body.note || null]
  );
  await audit(pool, req, 'rh', `Congé #${l.id} → ${req.body.decision}`, 'hr_leave_requests', l.id, { status: l.status }, { status: req.body.decision });
  res.json({ id: l.id, status: req.body.decision });
}));

// ---------- Compétences ----------
r.get('/hr/v2/skills', any('hr.skills.view', 'hr.view', 'hr.manage'), requireModule('skills'), wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM hr_skills WHERE station_id IS NULL OR station_id = $1 ORDER BY label`, [req.sid]
  );
  res.json(rows);
}));
r.get('/hr/v2/employee-skills', any('hr.skills.view', 'hr.view', 'hr.manage'), requireModule('skills'), wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT es.*, s.label AS skill_label, e.first_name || ' ' || e.last_name AS employee
     FROM hr_employee_skills es
     JOIN hr_skills s ON s.id = es.skill_id
     JOIN employees e ON e.id = es.employee_id
     WHERE es.station_id = $1 AND ($2::bigint IS NULL OR es.employee_id = $2)`,
    [req.sid, req.query.employee_id ? +req.query.employee_id : null]
  );
  res.json(rows);
}));
r.post('/hr/v2/employee-skills', any('hr.skills.manage', 'hr.manage'), requireModule('skills'), body(z.object({
  employee_id: z.number().int(),
  skill_id: z.number().int(),
  level: z.enum(['debutant','intermediaire','confirme','expert']),
  comment: z.string().optional().nullable()
})), wrap(async (req, res) => {
  const b = req.body;
  const { rows: [x] } = await pool.query(
    `INSERT INTO hr_employee_skills(station_id, employee_id, skill_id, level, evaluated_on, evaluator_id, comment)
     VALUES ($1,$2,$3,$4,CURRENT_DATE,$5,$6)
     ON CONFLICT (employee_id, skill_id) DO UPDATE SET level = EXCLUDED.level, evaluated_on = CURRENT_DATE,
       evaluator_id = EXCLUDED.evaluator_id, comment = EXCLUDED.comment
     RETURNING id`,
    [req.sid, b.employee_id, b.skill_id, b.level, req.user.id, b.comment || null]
  );
  res.status(201).json({ id: x.id });
}));

// ---------- Formations ----------
r.get('/hr/v2/trainings', any('hr.training.view', 'hr.view', 'hr.manage'), requireModule('training'), wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT t.*, ${D('t.start_date')} AS start_date, ${D('t.end_date')} AS end_date
     FROM hr_trainings t WHERE t.station_id = $1 ORDER BY t.id DESC LIMIT 100`, [req.sid]
  );
  res.json(rows);
}));
r.post('/hr/v2/trainings', any('hr.training.manage', 'hr.manage'), requireModule('training'), body(z.object({
  title: z.string().min(1),
  organism: z.string().optional().nullable(),
  trainer: z.string().optional().nullable(),
  start_date: ymd.optional().nullable(),
  end_date: ymd.optional().nullable(),
  duration_hours: z.number().optional().nullable(),
  cost_info: z.number().optional().nullable(), // informatif
  notes: z.string().optional().nullable(),
  participant_ids: z.array(z.number().int()).optional()
})), wrap(async (req, res) => {
  const b = req.body;
  const out = await tx(async c => {
    const { rows: [t] } = await c.query(
      `INSERT INTO hr_trainings(station_id, title, organism, trainer, start_date, end_date, duration_hours, cost_info, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [req.sid, b.title, b.organism || null, b.trainer || null, b.start_date || null, b.end_date || null,
        b.duration_hours ?? null, b.cost_info ?? null, b.notes || null]
    );
    for (const eid of (b.participant_ids || [])) {
      await c.query(
        `INSERT INTO hr_training_participants(training_id, employee_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [t.id, eid]
      );
    }
    await audit(c, req, 'rh', `Formation « ${b.title} » (coût informatif ${b.cost_info || 0})`, 'hr_trainings', t.id, null, b);
    return t;
  });
  res.status(201).json({ id: out.id, note: 'Coût informatif uniquement — aucune écriture financière créée.' });
}));

// ---------- Évaluations ----------
r.get('/hr/v2/evaluation-templates', any('hr.evaluation.view', 'hr.view', 'hr.manage'), requireModule('evaluation'), wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM hr_evaluation_templates WHERE station_id IS NULL OR station_id = $1`, [req.sid]
  );
  res.json(rows);
}));
r.get('/hr/v2/evaluations', any('hr.evaluation.view', 'hr.view', 'hr.manage'), requireModule('evaluation'), wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT ev.*, e.first_name || ' ' || e.last_name AS employee, ${D('ev.evaluated_on')} AS evaluated_on
     FROM hr_evaluations ev JOIN employees e ON e.id = ev.employee_id
     WHERE ev.station_id = $1 AND ($2::bigint IS NULL OR ev.employee_id = $2)
     ORDER BY ev.id DESC LIMIT 100`,
    [req.sid, req.query.employee_id ? +req.query.employee_id : null]
  );
  res.json(rows);
}));
r.post('/hr/v2/evaluations', any('hr.evaluation.manage', 'hr.manage'), requireModule('evaluation'), body(z.object({
  employee_id: z.number().int(),
  template_id: z.number().int().optional().nullable(),
  period_label: z.string().optional().nullable(),
  scores: z.record(z.number()).optional(),
  overall_score: z.number().optional().nullable(),
  comment: z.string().optional().nullable()
})), wrap(async (req, res) => {
  const b = req.body;
  const { rows: [x] } = await pool.query(
    `INSERT INTO hr_evaluations(station_id, employee_id, template_id, period_label, scores, overall_score, comment, evaluator_id, evaluated_on, status)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,CURRENT_DATE,'brouillon') RETURNING id`,
    [req.sid, b.employee_id, b.template_id || null, b.period_label || null, JSON.stringify(b.scores || {}),
      b.overall_score ?? null, b.comment || null, req.user.id]
  );
  await audit(pool, req, 'rh', `Évaluation employé ${b.employee_id}`, 'hr_evaluations', x.id, null, b);
  res.status(201).json({ id: x.id, note: 'Aucune incidence automatique sur salaire ou paie.' });
}));

// ---------- Sanctions / récompenses ----------
r.get('/hr/v2/disciplinary', any('hr.view', 'hr.employee.view', 'hr.manage'), requireModule('disciplinary'), wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT d.*, e.first_name || ' ' || e.last_name AS employee, ${D('d.occurred_on')} AS occurred_on
     FROM hr_disciplinary d JOIN employees e ON e.id = d.employee_id
     WHERE d.station_id = $1 AND ($2::bigint IS NULL OR d.employee_id = $2)
     ORDER BY d.id DESC LIMIT 100`,
    [req.sid, req.query.employee_id ? +req.query.employee_id : null]
  );
  res.json(rows);
}));
r.post('/hr/v2/disciplinary', any('hr.employee.edit', 'hr.manage'), requireModule('disciplinary'), body(z.object({
  employee_id: z.number().int(),
  kind: z.enum(['sanction','recompense']),
  type_label: z.string().min(1),
  occurred_on: ymd.optional(),
  description: z.string().optional().nullable()
})), wrap(async (req, res) => {
  const b = req.body;
  const { rows: [x] } = await pool.query(
    `INSERT INTO hr_disciplinary(station_id, employee_id, kind, type_label, occurred_on, description, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [req.sid, b.employee_id, b.kind, b.type_label, b.occurred_on || today(), b.description || null, req.user.id]
  );
  await audit(pool, req, 'rh', `${b.kind} « ${b.type_label} » employé ${b.employee_id}`, 'hr_disciplinary', x.id, null, b);
  res.status(201).json({ id: x.id, note: 'Aucun impact automatique sur la paie.' });
}));

// ---------- Alertes ----------
r.get('/hr/v2/alerts', any('hr.view', 'hr.manage', 'hr.employee.view'), requireModule('alerts'), wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT a.*, e.first_name || ' ' || e.last_name AS employee, ${D('a.due_date')} AS due_date
     FROM hr_alerts a LEFT JOIN employees e ON e.id = a.employee_id
     WHERE a.station_id = $1 AND ($2::text IS NULL OR a.status = $2)
     ORDER BY a.id DESC LIMIT 100`,
    [req.sid, req.query.status || 'open']
  );
  res.json(rows);
}));
r.post('/hr/v2/alerts/:id/resolve', any('hr.manage', 'hr.employee.edit'), requireModule('alerts'), body(z.object({
  status: z.enum(['done','dismissed']).default('done')
})), wrap(async (req, res) => {
  await pool.query(
    `UPDATE hr_alerts SET status = $3, resolved_at = now(), resolved_by = $4 WHERE id = $1 AND station_id = $2`,
    [req.params.id, req.sid, req.body.status, req.user.id]
  );
  res.json({ ok: true });
}));

// Génération d'alertes (contrats / documents expirant) — lecture seule + inserts alertes
r.post('/hr/v2/alerts/refresh', any('hr.manage', 'hr.settings'), requireModule('alerts'), wrap(async (req, res) => {
  let n = 0;
  const { rows: contracts } = await pool.query(
    `SELECT c.id, c.employee_id, c.end_date, e.first_name || ' ' || e.last_name AS name
     FROM hr_contracts c JOIN employees e ON e.id = c.employee_id
     WHERE c.station_id = $1 AND c.status = 'actif' AND c.end_date IS NOT NULL
       AND c.end_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 45`, [req.sid]
  );
  for (const c of contracts) {
    await pool.query(
      `INSERT INTO hr_alerts(station_id, employee_id, level, kind, message, due_date)
       SELECT $1,$2,'warning','contract_expiration',$3,$4
       WHERE NOT EXISTS (
         SELECT 1 FROM hr_alerts a WHERE a.station_id=$1 AND a.employee_id=$2 AND a.kind='contract_expiration'
           AND a.due_date=$4 AND a.status='open')`,
      [req.sid, c.employee_id, `Contrat de ${c.name} expire le ${c.end_date.toISOString?.().slice(0,10) || c.end_date}`, c.end_date]
    );
    n++;
  }
  res.json({ refreshed: n, note: 'Alertes informatives — aucune écriture financière.' });
}));

// ---------- Contrôle de paie ----------
r.get('/hr/v2/payroll-control', any('hr.payroll.control', 'hr.payroll', 'hr.manage'), requireModule('payroll_control'), wrap(async (req, res) => {
  const month = req.query.month && /^\d{4}-\d{2}$/.test(req.query.month)
    ? req.query.month + '-01' : new Date().toISOString().slice(0, 7) + '-01';
  const [
    { rows: emps },
    { rows: slips },
    { rows: [flagsRow] }
  ] = await Promise.all([
    pool.query(`SELECT id, first_name || ' ' || last_name AS name, base_salary, status
                FROM employees WHERE station_id=$1 AND deleted_at IS NULL AND status='actif'`, [req.sid]),
    pool.query(`SELECT id, employee_id, number, status, net_pay, gross, is_locked
                FROM payslips WHERE station_id=$1 AND month=$2::date`, [req.sid, month]),
    pool.query(`SELECT value FROM settings WHERE station_id=$1 AND key='payroll_rules'`, [req.sid])
  ]);
  const flags = flagsRow?.value?.feature_flags || {};
  const slipByEmp = new Map(slips.map(s => [s.employee_id, s]));
  const anomalies = [];
  const without = [];
  for (const e of emps) {
    if (!(fl(e.base_salary) > 0)) anomalies.push({ level: 'warning', code: 'no_salary', message: `${e.name} : salaire de base absent` });
    const s = slipByEmp.get(e.id);
    if (!s) without.push({ id: e.id, name: e.name });
    else {
      if (fl(s.net_pay) < 0) anomalies.push({ level: 'critical', code: 'negative_net', message: `Bulletin ${s.number} : net négatif` });
      if (s.status === 'brouillon') anomalies.push({ level: 'info', code: 'draft', message: `Bulletin ${s.number} encore brouillon` });
    }
  }
  // Doublons
  const counts = {};
  for (const s of slips) {
    counts[s.employee_id] = (counts[s.employee_id] || 0) + 1;
    if (counts[s.employee_id] > 1) anomalies.push({ level: 'critical', code: 'duplicate', message: `Plusieurs bulletins pour employé #${s.employee_id}` });
  }
  const unconfirmedFlags = Object.entries(flags).filter(([, v]) => v === true);
  if (unconfirmedFlags.length) {
    anomalies.push({ level: 'info', code: 'flags_on', message: `Flags actifs : ${unconfirmedFlags.map(([k]) => k).join(', ')}` });
  }
  const blocked = anomalies.some(a => a.level === 'critical');
  res.json({
    month: month.slice(0, 7),
    employees: emps.length,
    payslips: slips.length,
    without_payslip: without,
    anomalies,
    status: blocked ? 'PAIE_BLOQUEE' : 'PAIE_PRETE',
    status_label: blocked ? '🔴 PAIE BLOQUÉE' : '🟢 PAIE PRÊTE',
    note: 'Contrôle purement informatif — n\'écrit rien en finance.'
  });
}));

// ---------- Envoi bulletin par e-mail ----------
r.post('/hr/payroll/:id/email', any('hr.payroll.email', 'hr.payroll', 'hr.manage'), requireModule('payroll_email'), body(z.object({
  force: z.boolean().optional()
}).optional()), wrap(async (req, res) => {
  const { rows: [s] } = await pool.query(
    `SELECT s.*, e.email, e.first_name, e.last_name, e.user_id, e.id AS emp_id
     FROM payslips s JOIN employees e ON e.id = s.employee_id
     WHERE s.id = $1 AND s.station_id = $2`, [req.params.id, req.sid]
  );
  if (!s) throw new HttpError(404, 'Bulletin introuvable');
  if (!['valide', 'paye'].includes(s.status)) throw new HttpError(409, 'Seuls les bulletins validés ou payés peuvent être envoyés.');
  if (!s.email) throw new HttpError(409, 'Adresse e-mail absente sur la fiche salarié. Complétez la fiche ou téléchargez le PDF.');

  // Anti double-envoi sauf force
  const { rows: prev } = await pool.query(
    `SELECT sent_at, recipient, status FROM payslip_email_log WHERE payslip_id = $1 AND status = 'sent' ORDER BY id DESC LIMIT 1`,
    [s.id]
  );
  if (prev[0] && !req.body?.force) {
    return res.status(409).json({
      error: 'Déjà envoyé',
      previous: prev[0],
      hint: 'Passez force:true pour renvoyer explicitement.'
    });
  }

  const period = (s.month instanceof Date ? s.month.toISOString() : String(s.month)).slice(0, 7);
  let tmpl = DEFAULT_EMAIL_TMPL;
  try {
    const v = await readTemplate(req.sid);
    if (v) tmpl = { ...DEFAULT_EMAIL_TMPL, ...v };
  } catch (e) { ignored('hr_v2:modele-email-bulletin', e); }
  const b = await docs.branding(req.sid);
  const vars = {
    periode: period,
    prenom: s.first_name,
    nom: s.last_name,
    entreprise: b.name || 'Entreprise',
    service_rh: 'Service RH',
    net: s.net_pay,
    numero: s.number || ''
  };
  const subject = applyTmpl(tmpl.subject, vars);
  const text = applyTmpl(tmpl.body, vars);

  // Générer PDF via docs — réutiliser endpoint logique minimale
  let pdfBuf;
  try {
    // Appel interne simplifié : le client peut aussi télécharger ; ici on tente docs si snapshot présent
    const b = await docs.branding(req.sid);
    const snap = typeof s.snapshot === 'string' ? JSON.parse(s.snapshot) : (s.snapshot || {});
    pdfBuf = await docs.buildPdf({
      b,
      title: 'BULLETIN DE PAIE',
      subtitle: `${s.first_name} ${s.last_name} — ${period}`,
      ref: s.number || `BP-${s.id}`,
      sections: [
        { type: 'kv', title: 'Employé', rows: [['Nom', `${s.first_name} ${s.last_name}`], ['Période', period], ['Net à payer', String(s.net_pay)]] },
        { type: 'text', title: 'Note', text: 'Document confidentiel. Généré par ' + (b.app_name || 'Manager PRO') + '.' }
      ]
    });
  } catch (e) {
    throw new HttpError(500, 'Génération PDF impossible : ' + e.message);
  }

  let status = 'sent', errMsg = null;
  try {
    await sendMail({
      to: s.email,
      subject,
      text,
      attachments: [{ filename: `Fiche_Paie_${s.last_name}_${period}.pdf`, content: pdfBuf }]
    });
  } catch (e) {
    status = e.status === 501 ? 'failed' : 'failed';
    errMsg = e.message;
    await pool.query(
      `INSERT INTO payslip_email_log(station_id, payslip_id, employee_id, recipient, subject, status, error_message, sent_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [req.sid, s.id, s.emp_id, s.email, subject, status, errMsg, req.user.id]
    );
    throw e;
  }

  await pool.query(
    `INSERT INTO payslip_email_log(station_id, payslip_id, employee_id, recipient, subject, status, sent_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [req.sid, s.id, s.emp_id, s.email, subject, status, req.user.id]
  );
  await audit(pool, req, 'paie', `Envoi e-mail bulletin ${s.number} → ${s.email}`, 'payslips', s.id, null, { recipient: s.email });
  res.json({ ok: true, recipient: s.email, subject, status });
}));

r.get('/hr/payroll/:id/email-log', any('hr.payroll.email', 'hr.payroll', 'hr.manage'), wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT l.*, u.login FROM payslip_email_log l LEFT JOIN users u ON u.id = l.sent_by
     WHERE l.payslip_id = $1 AND l.station_id = $2 ORDER BY l.id DESC`,
    [req.params.id, req.sid]
  );
  res.json(rows);
}));

// ---------- Portail salarié (self) ----------
r.get('/hr/v2/me/summary', requireModule('portal'), wrap(async (req, res) => {
  const { rows: [e] } = await pool.query(
    `SELECT id, first_name, last_name, position, email, phone FROM employees
     WHERE user_id = $1 AND station_id = $2 AND deleted_at IS NULL`, [req.user.id, req.sid]
  );
  if (!e) return res.json({ linked: false });
  const [leaves, att, docs, pays] = await Promise.all([
    pool.query(`SELECT id, status, ${D('start_date')} AS start_date, ${D('end_date')} AS end_date, days FROM hr_leave_requests WHERE employee_id=$1 ORDER BY id DESC LIMIT 10`, [e.id]),
    pool.query(`SELECT ${D('work_date')} AS work_date, status FROM hr_attendance WHERE employee_id=$1 ORDER BY work_date DESC LIMIT 14`, [e.id]),
    pool.query(`SELECT id, category, title, ${D('expires_on')} AS expires_on FROM hr_documents WHERE employee_id=$1 ORDER BY id DESC LIMIT 10`, [e.id]),
    pool.query(`SELECT id, number, ${D('month')} AS month, status, net_pay FROM payslips WHERE employee_id=$1 ORDER BY month DESC LIMIT 12`, [e.id])
  ]);
  res.json({
    linked: true, employee: e,
    leaves: leaves.rows, attendance: att.rows, documents: docs.rows, payslips: pays.rows,
    note: 'Portail limité à vos données personnelles.'
  });
}));


// ---------- Heures supplémentaires (workflow, simulation only) ----------
r.get('/hr/v2/overtime', any('hr.overtime.view', 'hr.view', 'hr.manage', 'hr.payroll'), wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT o.*, e.first_name || ' ' || e.last_name AS employee, ${D('o.work_date')} AS work_date
     FROM hr_overtime o JOIN employees e ON e.id = o.employee_id
     WHERE o.station_id = $1 AND ($2::bigint IS NULL OR o.employee_id = $2)
       AND ($3::text IS NULL OR o.status = $3)
     ORDER BY o.id DESC LIMIT 200`,
    [req.sid, req.query.employee_id ? +req.query.employee_id : null, req.query.status || null]
  );
  res.json({ lines: rows, note: 'Les HS approuvées sont disponibles en SIMULATION uniquement — jamais de paie automatique.' });
}));

r.post('/hr/v2/overtime', any('hr.overtime.propose', 'hr.manage'), body(z.object({
  employee_id: z.number().int(),
  work_date: ymd,
  hours: z.number().positive().max(24),
  rate_multiplier: z.number().positive().max(5).optional(),
  reason: z.string().optional().nullable(),
  amount_estimate: z.number().nonnegative().optional().nullable()
})), wrap(async (req, res) => {
  const b = req.body;
  const { rows: [x] } = await pool.query(
    `INSERT INTO hr_overtime(station_id, employee_id, work_date, hours, rate_multiplier, amount_estimate, reason, proposed_by, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'propose') RETURNING id`,
    [req.sid, b.employee_id, b.work_date, b.hours, b.rate_multiplier || 1.5, b.amount_estimate ?? null, b.reason || null, req.user.id]
  );
  await audit(pool, req, 'rh', `HS proposée ${b.hours}h employé ${b.employee_id}`, 'hr_overtime', x.id, null, b);
  res.status(201).json({ id: x.id, status: 'propose', note: 'Aucune écriture financière. Workflow: propose → valide → approuve.' });
}));

r.post('/hr/v2/overtime/:id/validate', any('hr.overtime.validate', 'hr.manage'), body(z.object({
  note: z.string().optional().nullable()
}).optional()), wrap(async (req, res) => {
  const { rows: [o] } = await pool.query('SELECT * FROM hr_overtime WHERE id=$1 AND station_id=$2', [req.params.id, req.sid]);
  if (!o) throw new HttpError(404, 'HS introuvable');
  if (o.status !== 'propose') throw new HttpError(409, 'Seules les HS « propose » peuvent être validées par le responsable');
  await pool.query(
    `UPDATE hr_overtime SET status='valide_responsable', validated_by=$3, validated_at=now(), decision_note=$4, updated_at=now() WHERE id=$1 AND station_id=$2`,
    [o.id, req.sid, req.user.id, req.body?.note || null]
  );
  await audit(pool, req, 'rh', `HS #${o.id} validée responsable`, 'hr_overtime', o.id, { status: o.status }, { status: 'valide_responsable' });
  res.json({ id: o.id, status: 'valide_responsable' });
}));

r.post('/hr/v2/overtime/:id/approve', any('hr.overtime.approve', 'hr.manage'), body(z.object({
  note: z.string().optional().nullable()
}).optional()), wrap(async (req, res) => {
  const { rows: [o] } = await pool.query('SELECT * FROM hr_overtime WHERE id=$1 AND station_id=$2', [req.params.id, req.sid]);
  if (!o) throw new HttpError(404, 'HS introuvable');
  if (o.status !== 'valide_responsable') throw new HttpError(409, 'La HS doit être validée par un responsable avant approbation RH');
  await pool.query(
    `UPDATE hr_overtime SET status='approuve_rh', approved_by=$3, approved_at=now(), decision_note=COALESCE($4, decision_note), updated_at=now() WHERE id=$1 AND station_id=$2`,
    [o.id, req.sid, req.user.id, req.body?.note || null]
  );
  await audit(pool, req, 'rh', `HS #${o.id} approuvée RH (simulation uniquement)`, 'hr_overtime', o.id, { status: o.status }, { status: 'approuve_rh' });
  res.json({
    id: o.id, status: 'approuve_rh',
    warning: 'HS approuvée pour SIMULATION de paie uniquement. Aucun bulletin réel n\'est modifié automatiquement.'
  });
}));

r.post('/hr/v2/overtime/:id/refuse', any('hr.overtime.validate', 'hr.overtime.approve', 'hr.manage'), body(z.object({
  note: z.string().min(3)
})), wrap(async (req, res) => {
  const { rows: [o] } = await pool.query('SELECT * FROM hr_overtime WHERE id=$1 AND station_id=$2', [req.params.id, req.sid]);
  if (!o) throw new HttpError(404, 'HS introuvable');
  if (['approuve_rh', 'annule', 'refuse'].includes(o.status)) throw new HttpError(409, 'Statut final');
  await pool.query(
    `UPDATE hr_overtime SET status='refuse', decision_note=$3, updated_at=now() WHERE id=$1 AND station_id=$2`,
    [o.id, req.sid, req.body.note]
  );
  await audit(pool, req, 'rh', `HS #${o.id} refusée`, 'hr_overtime', o.id, { status: o.status }, { status: 'refuse' });
  res.json({ id: o.id, status: 'refuse' });
}));

// HS approuvées pour un employé/mois (lecture simulation)
r.get('/hr/v2/overtime/approved-hours', any('hr.overtime.view', 'hr.payroll', 'hr.manage'), wrap(async (req, res) => {
  const month = req.query.month && /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : today().slice(0, 7);
  const empId = req.query.employee_id ? +req.query.employee_id : null;
  const { rows } = await pool.query(
    `SELECT employee_id, SUM(hours) AS hours, SUM(COALESCE(amount_estimate,0)) AS amount_estimate
     FROM hr_overtime
     WHERE station_id = $1 AND status = 'approuve_rh'
       AND to_char(work_date,'YYYY-MM') = $2
       AND ($3::bigint IS NULL OR employee_id = $3)
     GROUP BY employee_id`,
    [req.sid, month, empId]
  );
  res.json({ month, lines: rows, note: 'Données pour SIMULATION uniquement.' });
}));



// ---------- Clôture de période de paie ----------
r.get('/hr/v2/periods', any('hr.payroll', 'hr.payroll.control', 'hr.manage'), wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, ${D('month')} AS month, status, ${D('closed_at')} AS closed_at, notes
     FROM payroll_periods WHERE station_id = $1 ORDER BY month DESC LIMIT 36`, [req.sid]
  );
  res.json(rows);
}));

r.post('/hr/v2/periods/close', any('hr.payroll.close', 'hr.manage'), body(z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  notes: z.string().optional().nullable()
})), wrap(async (req, res) => {
  const month = req.body.month + '-01';
  const out = await tx(async c => {
    const { rows: slips } = await c.query(
      `SELECT COUNT(*)::int AS n,
              COUNT(*) FILTER (WHERE status='brouillon')::int AS drafts,
              COUNT(*) FILTER (WHERE status='valide')::int AS valides,
              COUNT(*) FILTER (WHERE status='paye')::int AS payes,
              COALESCE(SUM(net_pay) FILTER (WHERE status IN ('valide','paye')),0) AS net_total
       FROM payslips WHERE station_id=$1 AND month=$2::date`, [req.sid, month]
    );
    if (slips[0].drafts > 0) throw new HttpError(409, `${slips[0].drafts} bulletin(s) encore en brouillon — validez ou supprimez-les avant clôture.`);
    const snap = { ...slips[0], closed_at: new Date().toISOString() };
    const { rows: [p] } = await c.query(
      `INSERT INTO payroll_periods(station_id, month, status, closed_by, closed_at, notes, snapshot)
       VALUES ($1,$2::date,'cloture',$3,now(),$4,$5::jsonb)
       ON CONFLICT (station_id, month) DO UPDATE SET
         status='cloture', closed_by=$3, closed_at=now(), notes=$4, snapshot=$5::jsonb, reopen_reason=NULL
       RETURNING id, status`,
      [req.sid, month, req.user.id, req.body.notes || null, JSON.stringify(snap)]
    );
    await audit(c, req, 'paie', `Clôture période ${req.body.month}`, 'payroll_periods', p.id, null, snap);
    return { id: p.id, month: req.body.month, status: 'cloture', snapshot: snap };
  });
  res.json({ ...out, note: 'Période clôturée : aucun nouveau bulletin pour ce mois. Bulletins existants inchangés.' });
}));

r.post('/hr/v2/periods/reopen', any('hr.payroll.reopen', 'hr.manage'), body(z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  reason: z.string().min(5).max(400)
})), wrap(async (req, res) => {
  const month = req.body.month + '-01';
  const { rows: [p] } = await pool.query(
    `UPDATE payroll_periods SET status='ouvert', reopen_reason=$3, closed_at=NULL, closed_by=NULL
     WHERE station_id=$1 AND month=$2::date AND status='cloture' RETURNING id`,
    [req.sid, month, req.body.reason]
  );
  if (!p) throw new HttpError(404, 'Période clôturée introuvable');
  await audit(pool, req, 'paie', `Réouverture période ${req.body.month} : ${req.body.reason}`, 'payroll_periods', p.id, { status: 'cloture' }, { status: 'ouvert' });
  res.json({ id: p.id, status: 'ouvert', warning: 'Réouverture exceptionnelle — audité.' });
}));

async function assertPeriodOpen(sid, monthDate) {
  const { rows: [p] } = await pool.query(
    `SELECT status FROM payroll_periods WHERE station_id=$1 AND month=$2::date`, [sid, monthDate]
  );
  if (p && p.status === 'cloture') throw new HttpError(409, 'Période de paie clôturée : impossible de créer ou modifier un bulletin pour ce mois.');
}

// Exposé pour hr.js via require si besoin — aussi hook local
r.get('/hr/v2/periods/check', any('hr.payroll', 'hr.manage'), wrap(async (req, res) => {
  const month = (req.query.month || today().slice(0, 7)) + '-01';
  const { rows: [p] } = await pool.query(
    `SELECT status FROM payroll_periods WHERE station_id=$1 AND month=$2::date`, [req.sid, month]
  );
  res.json({ month: month.slice(0, 7), status: p?.status || 'ouvert', open: !p || p.status !== 'cloture' });
}));

// ---------- Modèle e-mail bulletin ----------
const DEFAULT_EMAIL_TMPL = {
  subject: 'Fiche de paie — {{periode}} — {{entreprise}}',
  body: 'Bonjour {{prenom}},\n\nVeuillez trouver en pièce jointe votre fiche de paie relative à la période {{periode}}.\n\nCordialement,\n{{entreprise}}\nService RH'
};

r.get('/hr/v2/email-template', any('hr.payroll.email', 'hr.settings', 'hr.manage'), wrap(async (req, res) => {
  let t = DEFAULT_EMAIL_TMPL;
  try {
    const v = await readTemplate(req.sid);
    if (v) t = { ...DEFAULT_EMAIL_TMPL, ...v };
  } catch (e) { ignored('hr_v2:modele-email-lecture', e); }
  res.json(t);
}));

r.put('/hr/v2/email-template', any('hr.settings', 'hr.manage'), body(z.object({
  subject: z.string().min(3).max(200),
  body: z.string().min(10).max(4000)
})), wrap(async (req, res) => {
  await pool.query(
    `INSERT INTO settings(station_id, key, value) VALUES ($1,'payslip_email_template',$2::jsonb)
     ON CONFLICT (station_id, key) DO UPDATE SET value = EXCLUDED.value`,
    [req.sid, JSON.stringify(req.body)]
  );
  await audit(pool, req, 'rh', 'Modèle e-mail bulletin modifié', 'settings', null, null, req.body);
  res.json({ ok: true });
}));

function applyTmpl(str, vars) {
  return String(str || '').replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : ''));
}


module.exports = r;
