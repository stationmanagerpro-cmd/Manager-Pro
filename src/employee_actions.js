// Historique des actions faites au nom d'un employé : journal + notification dans sa messagerie + droit de rejeter.
//  - chaque action (vente, dette client, écart, anomalie, décision, rôle) est journalisée dans employee_actions ;
//  - si quelqu'un d'autre que l'employé l'a faite, l'employé est prévenu dans sa messagerie ;
//  - l'employé peut la rejeter avec un motif : l'action n'est jamais supprimée, le rejet y est mentionné et le gérant est prévenu ;
//  - un rejet n'annule rien et ne déclenche aucune retenue : il oblige simplement à une réponse du gérant.
const express = require('express');
const { z } = require('zod');
const { pool, HttpError, wrap, body } = require('./core');
const r = express.Router();

const VIEW_OTHERS = ['hr.view', 'hr.gaps', 'hr.payroll', 'role.assign', 'user.manage'];
const REVIEW = ['hr.gaps', 'hr.payroll', 'role.assign', 'user.manage'];
const money = v => Number(v).toLocaleString('fr-FR');
const warn = (label, e) => console.warn(`[actions employé] ${label} :`, e && e.message);

/** Journalise une action au nom d'un employé (sans notifier). Idempotent pour vente / dette / écart / anomalie. */
async function record(q, d) {
  const { rows: [e] } = await q.query('SELECT user_id FROM employees WHERE id = $1 AND station_id = $2', [d.employeeId, d.stationId]);
  if (!e) return null;
  const self = e.user_id != null && d.actorUserId != null && Number(e.user_id) === Number(d.actorUserId);
  const { rows: [a] } = await q.query(
    `INSERT INTO employee_actions(station_id, employee_id, kind, description, amount, ref_table, ref_id, performed_by, self_made)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING RETURNING *`,
    [d.stationId, d.employeeId, d.kind, d.description, d.amount ?? null, d.refTable || null, d.refId ?? null, d.actorUserId ?? null, self]);
  return a || null;
}

/** Prévient l'employé dans sa messagerie (jamais pour ce qu'il a fait lui-même). Ne lève jamais d'erreur. */
async function notify(q, a) {
  if (!a || a.self_made) return false;
  try {
    const { rows: [t] } = await q.query(
      `SELECT e.user_id, u.client_id, TRIM(e.first_name || ' ' || e.last_name) AS emp_name, (SELECT COALESCE(NULLIF(TRIM(au.full_name), ''), au.login) FROM users au WHERE au.id = $2) AS actor
         FROM employees e JOIN users u ON u.id = e.user_id WHERE e.id = $1`, [a.employee_id, a.performed_by]);
    if (!t || !t.client_id) return false;
    const { deliverSystemMessage, clientAdminIds } = require('./messaging');
    // Anomalies et écarts : conversation PRIVÉE limitée à l'employé concerné, à la personne qui l'a enregistrée (clôturant / responsable) et aux administrateurs locaux du compte.
    // Autres actions : l'employé seul.
    const shared = a.kind === 'anomalie' || a.kind === 'ecart';
    const ids = shared ? [...new Set([Number(t.user_id), ...(a.performed_by ? [Number(a.performed_by)] : []), ...await clientAdminIds(t.client_id)])] : [t.user_id];
    const res = await deliverSystemMessage({
      clientId: t.client_id, userIds: ids, kind: 'employee_action', refTable: 'employee_actions', refId: a.id,
      title: shared ? `${a.kind === 'anomalie' ? 'Anomalie' : 'Écart'} — ${t.emp_name}` : 'Action enregistrée à votre nom',
      body: shared
        ? `Employé concerné : ${t.emp_name}.\n${a.description}${a.amount != null ? ' — ' + money(a.amount) + ' FCFA' : ''}.\nEnregistré par ${t.actor || 'un responsable'}.\nL'employé peut consulter et, si besoin, rejeter cette action dans son profil > Historique de mes actions. Un rejet ne supprime rien : il est mentionné et le gérant est prévenu.`
        : `${a.description}${a.amount != null ? ' — ' + money(a.amount) + ' FCFA' : ''}.\nEnregistré par ${t.actor || 'un responsable'}.\nVous pouvez consulter et, si besoin, rejeter cette action dans votre profil > Historique de mes actions. Un rejet ne supprime rien : il est mentionné et le gérant est prévenu.` });
    if (res === false || (res && res.ok === false)) return false;
    await q.query('UPDATE employee_actions SET notified_at = now() WHERE id = $1', [a.id]);
    return true;
  } catch (e) { warn('notification non envoyée', e); return false; }
}

/** Journalise + notifie sans jamais faire échouer l'opération métier appelante. */
async function track(q, d) {
  try { const a = await record(q, d); await notify(q, a); return a; } catch (e) { warn('journal non enregistré', e); return null; }
}

/** Après la création d'une vente : dette client et/ou vente enregistrée par une autre personne. */
async function afterSale(req, saleId) {
  try {
    const { rows: [s] } = await pool.query(
      `SELECT sa.id, sa.employee_id, sa.total, sa.invoice_no, cu.name AS customer,
              (SELECT COALESCE(SUM(l.amount), 0) FROM customer_ledger l WHERE l.ref_table = 'sales' AND l.ref_id = sa.id AND l.kind = 'credit') AS credit
         FROM sales sa LEFT JOIN customers cu ON cu.id = sa.customer_id WHERE sa.id = $1 AND sa.station_id = $2`, [saleId, req.sid]);
    if (!s || !s.employee_id) return null;
    if (Number(s.credit) > 0) return track(pool, { stationId: req.sid, employeeId: s.employee_id, kind: 'dette_client', amount: s.credit, refTable: 'sales', refId: s.id, actorUserId: req.user.id,
      description: `Dette client : ${s.customer || 'client'} doit ${money(s.credit)} FCFA (vente N° ${s.id})` });
    const { rows: [e] } = await pool.query('SELECT user_id FROM employees WHERE id = $1', [s.employee_id]);
    if (e && e.user_id != null && Number(e.user_id) === Number(req.user.id)) return null;   // ses propres ventes courantes : pas de bruit
    return track(pool, { stationId: req.sid, employeeId: s.employee_id, kind: 'vente', amount: s.total, refTable: 'sales', refId: s.id, actorUserId: req.user.id,
      description: `Vente N° ${s.id} enregistrée à votre nom (${money(s.total)} FCFA)` });
  } catch (e) { warn('vente non journalisée', e); return null; }
}

/** Après la clôture d'un quart : écarts et anomalies de chaque employé. */
async function afterClose(req, shiftId, number) {
  try {
    const { rows: gaps } = await pool.query(
      `SELECT g.id, g.employee_id, g.kind, g.amount, p.name AS product, p.unit AS unit FROM employee_gaps g LEFT JOIN products p ON p.id = g.product_id
        WHERE g.shift_id = $1 AND g.station_id = $2 AND g.employee_id IS NOT NULL ORDER BY g.id`, [shiftId, req.sid]);
    for (const g of gaps) await track(pool, { stationId: req.sid, employeeId: g.employee_id, kind: 'ecart', amount: g.kind === 'stock' ? null : g.amount, refTable: 'employee_gaps', refId: g.id, actorUserId: req.user.id,   // un écart de stock est une QUANTITÉ : jamais dans la colonne « montant » (FCFA)
      description: g.kind === 'stock' ? `Écart de stock ${(g.product || '').trim()} imputé au quart N° ${number} : ${Number(Number(g.amount).toFixed(2)).toLocaleString('fr-FR')} ${g.unit || ''}`.trim() : g.kind === 'anomalie' ? `Écart lié à une anomalie, quart N° ${number} : ${money(g.amount)}` : `Écart de caisse imputé au quart N° ${number}` });
    const { rows: an } = await pool.query(
      `SELECT id, employee_id, description, amount FROM shift_anomalies
        WHERE shift_id = $1 AND employee_id IS NOT NULL AND kind NOT IN ('ecart_caisse','ecart_stock') ORDER BY id`, [shiftId]);
    for (const a of an) await track(pool, { stationId: req.sid, employeeId: a.employee_id, kind: 'anomalie', amount: a.amount, refTable: 'shift_anomalies', refId: a.id, actorUserId: req.user.id,
      description: `Anomalie au quart N° ${number} : ${a.description}` });
  } catch (e) { warn('clôture non journalisée', e); }
}

// ---------------------------------------------------------------- API
r.get('/hr/employees/:id/actions', wrap(async (req, res) => {
  const { rows: [e] } = await pool.query('SELECT id, user_id, first_name, last_name FROM employees WHERE id = $1 AND station_id = $2 AND deleted_at IS NULL', [req.params.id, req.sid]);
  if (!e) throw new HttpError(404, 'Employé introuvable');
  const self = e.user_id != null && e.user_id === req.user.id;
  if (!self && !VIEW_OTHERS.some(p => req.user.perms.has(p))) throw new HttpError(403, "Historique réservé à l'employé et à ses responsables");
  const { rows } = await pool.query(
    `SELECT a.id, a.kind, a.description, a.amount, a.ref_table, a.ref_id, a.self_made, a.notified_at, a.status, a.rejected_at, a.rejected_reason, a.review_note, a.reviewed_at, a.created_at,
            COALESCE(NULLIF(TRIM(u.full_name), ''), u.login) AS performed_by_name
       FROM employee_actions a LEFT JOIN users u ON u.id = a.performed_by
      WHERE a.employee_id = $1 AND a.station_id = $2 ORDER BY a.id DESC LIMIT 500`, [e.id, req.sid]);
  res.json({ employee: { id: e.id, name: `${e.first_name} ${e.last_name}`.trim() }, can_reject: self, can_review: REVIEW.some(p => req.user.perms.has(p)), actions: rows });
}));

// L'employé rejette une action faite à son nom : elle reste, avec la mention du rejet ; un écart concerné passe « contesté ».
r.post('/hr/actions/:id/reject', body(z.object({ reason: z.string().trim().min(3).max(500) })), wrap(async (req, res) => {
  const { rows: [a] } = await pool.query(
    `SELECT a.*, e.user_id AS emp_user, e.first_name, e.last_name FROM employee_actions a JOIN employees e ON e.id = a.employee_id WHERE a.id = $1 AND a.station_id = $2`, [req.params.id, req.sid]);
  if (!a) throw new HttpError(404, 'Action introuvable');
  if (a.emp_user == null || a.emp_user !== req.user.id) throw new HttpError(403, 'Seul l\'employé concerné peut rejeter une action faite à son nom');
  if (a.self_made) throw new HttpError(409, 'Vous avez fait cette action vous-même : elle ne se rejette pas.');
  if (a.status === 'rejete') throw new HttpError(409, 'Action déjà rejetée');
  const { tx } = require('./core');
  await tx(async c => {
    await c.query("UPDATE employee_actions SET status = 'rejete', rejected_at = now(), rejected_reason = $2 WHERE id = $1 AND station_id = $3", [a.id, req.body.reason, req.sid]);
    if (a.ref_table === 'employee_gaps' && a.ref_id) {
      const { rows: [g] } = await c.query('SELECT id, status FROM employee_gaps WHERE id = $1 AND station_id = $2 FOR UPDATE', [a.ref_id, req.sid]);
      if (g && g.status === 'en_attente') {
        await c.query("UPDATE employee_gaps SET status = 'conteste', updated_at = now() WHERE id = $1 AND station_id = $2", [g.id, req.sid]);
        await c.query('INSERT INTO employee_gap_events(gap_id, action, note, from_status, to_status, user_id) VALUES ($1,$2,$3,$4,$5,$6)', [g.id, 'rejet employé', req.body.reason, g.status, 'conteste', req.user.id]);
      } else if (g) await c.query('INSERT INTO employee_gap_events(gap_id, action, note, from_status, to_status, user_id) VALUES ($1,$2,$3,$4,$5,$6)', [g.id, 'rejet employé', req.body.reason, g.status, g.status, req.user.id]);
    }
  });
  try {   // le gérant / l'administrateur local et l'auteur de l'action sont prévenus
    const { rows: [u] } = await pool.query('SELECT client_id FROM users WHERE id = $1', [req.user.id]);
    if (u && u.client_id) {
      const m = require('./messaging'); const admins = await m.clientAdminIds(u.client_id);
      const ids = [...new Set([req.user.id, ...(a.performed_by ? [a.performed_by] : []), ...admins].map(Number))];   // employé concerné + personne qui a enregistré l'action (clôturant) + administrateurs locaux : conversation privée
      await m.deliverSystemMessage({ clientId: u.client_id, userIds: ids, title: `Action rejetée par ${a.first_name} ${a.last_name}`, kind: 'employee_action_rejected', refTable: 'employee_actions', refId: a.id,
        body: `${a.first_name} ${a.last_name} rejette : ${a.description}.\nMotif : ${req.body.reason}\nL'action n'est pas supprimée : répondez dans son profil > Historique des actions.` });
    }
  } catch (e) { warn('gérant non prévenu du rejet', e); }
  res.json({ ok: true });
}));

// Réponse du gérant / de l'administrateur à un rejet (l'employé est prévenu)
r.post('/hr/actions/:id/review', body(z.object({ note: z.string().trim().min(3).max(500) })), wrap(async (req, res) => {
  if (!REVIEW.some(p => req.user.perms.has(p))) throw new HttpError(403, 'Réponse réservée à l\'administrateur local, au gérant ou à la paie');
  const { rows: [a] } = await pool.query('SELECT id, employee_id, status, description FROM employee_actions WHERE id = $1 AND station_id = $2', [req.params.id, req.sid]);
  if (!a) throw new HttpError(404, 'Action introuvable');
  if (a.status !== 'rejete') throw new HttpError(409, "Cette action n'a pas été rejetée");
  await pool.query('UPDATE employee_actions SET review_note = $2, reviewed_by = $3, reviewed_at = now() WHERE id = $1 AND station_id = $4', [a.id, req.body.note, req.user.id, req.sid]);
  await track(pool, { stationId: req.sid, employeeId: a.employee_id, kind: 'autre', actorUserId: req.user.id, refTable: 'employee_actions', refId: null,
    description: `Réponse à votre rejet (« ${a.description} ») : ${req.body.note}` });
  res.json({ ok: true });
}));

// Dettes clients enregistrées au nom d'un employé (ventes à crédit), avec leur statut
r.get('/hr/employees/:id/customer-debts', wrap(async (req, res) => {
  const { rows: [e] } = await pool.query('SELECT id, user_id FROM employees WHERE id = $1 AND station_id = $2 AND deleted_at IS NULL', [req.params.id, req.sid]);
  if (!e) throw new HttpError(404, 'Employé introuvable');
  const self = e.user_id != null && e.user_id === req.user.id;
  if (!self && !VIEW_OTHERS.concat(['receivable.view', 'customer.view']).some(p => req.user.perms.has(p))) throw new HttpError(403, 'Historique réservé à l\'employé et à ses responsables');
  const { rows } = await pool.query(
    `SELECT sa.id AS sale_id, sa.sold_at, cu.id AS customer_id, cu.name AS customer, cl.amount, sa.status AS sale_status,
            COALESCE((SELECT SUM(cp.amount) FROM customer_payments cp WHERE cp.sale_id = sa.id), 0) AS paid_linked
       FROM customer_ledger cl JOIN sales sa ON cl.ref_table = 'sales' AND cl.ref_id = sa.id JOIN customers cu ON cu.id = cl.customer_id
      WHERE cl.kind = 'credit' AND sa.employee_id = $1 AND sa.station_id = $2 ORDER BY sa.sold_at DESC LIMIT 300`, [e.id, req.sid]);
  const items = rows.map(x => {
    const amount = Number(x.amount), paid = Number(x.paid_linked);
    const status = x.sale_status === 'annule' ? 'annulée' : paid >= amount ? 'soldée' : paid > 0 ? 'partielle' : 'ouverte';
    return { sale_id: x.sale_id, sold_at: x.sold_at, customer_id: x.customer_id, customer: x.customer, amount, paid_linked: paid, remaining: status === 'annulée' ? 0 : Math.max(amount - paid, 0), status };
  });
  res.json({ items, note: "Le statut tient compte des règlements rattachés à la vente ; un règlement global du client apparaît dans la fiche du client." });
}));

module.exports = r;
module.exports.record = record; module.exports.notify = notify; module.exports.track = track; module.exports.afterSale = afterSale; module.exports.afterClose = afterClose;
