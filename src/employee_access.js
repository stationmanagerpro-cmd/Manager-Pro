// Accès individuel : rôle propre à un employé, séparé des autres employés du même poste.
//  - le rôle commun (poste) reste la base ; un « rôle individuel » (roles.personal_user_id) n'appartient qu'à cet employé ;
//  - on ne délègue jamais plus de droits qu'on n'en possède ; les droits d'administration restent à l'administrateur local ;
//  - un rôle individuel n'est jamais écrasé par la synchronisation fonction ↔ rôle (voir role_sync.js).
const express = require('express');
const { z } = require('zod');
const { pool, tx, HttpError, wrap, body, need, audit } = require('./core');
const RS = require('./roles_scope');
const r = express.Router();
const ADMIN_ONLY = ['user.manage', 'role.assign'];

async function employeeOf(req, id) {
  const { rows: [e] } = await pool.query('SELECT id, user_id, first_name, last_name, position FROM employees WHERE id = $1 AND station_id = $2 AND deleted_at IS NULL', [id, req.sid]);
  if (!e) throw new HttpError(404, 'Employé introuvable');
  return e;
}
async function accountOf(e) {
  if (!e.user_id) return null;
  const { rows: [u] } = await pool.query(
    `SELECT u.id, u.login, u.active, u.is_global, u.client_id, r.id AS role_id, r.code AS role, r.label AS role_label, r.personal_user_id
       FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1 AND u.deleted_at IS NULL`, [e.user_id]);
  return u || null;
}
const rolePerms = async roleId => (await pool.query('SELECT p.code, p.label FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = $1 ORDER BY p.code', [roleId])).rows;

/** Contrôles communs aux modifications de rôle d'un employé. */
async function guardTarget(req, e) {
  const u = await accountOf(e);
  if (!u) throw new HttpError(409, "Cet employé n'a pas de compte utilisateur : créez ou liez son compte avant de lui donner un rôle individuel.");
  if (u.is_global || u.role === 'ADMIN' || u.role === 'SUPERADMIN') throw new HttpError(403, "Le rôle d'un administrateur ne peut pas être individualisé ici.");
  if (u.id === req.user.id) throw new HttpError(400, 'Vous ne pouvez pas modifier votre propre rôle : demandez à un autre administrateur.');
  RS.assertCanTouchTarget(req, u.role);
  const clientId = await RS.myClientId(req.user.id);
  if (!clientId) throw new HttpError(403, 'Aucun client lié à ce compte.');
  if (String(u.client_id) !== String(clientId)) throw new HttpError(403, 'Utilisateur hors de votre organisation.');
  const { loadContractForUser } = require('./contracts');
  const contract = await loadContractForUser(req.user.id, false);
  if (contract.suspended) throw new HttpError(403, 'Contrat suspendu ou expiré.');
  if (!contract.can_manage_users) throw new HttpError(403, 'Gestion des utilisateurs et des rôles non autorisée par votre contrat.');
  return { u, clientId };
}

r.get('/hr/employees/:id/access', wrap(async (req, res) => {
  const e = await employeeOf(req, req.params.id);
  const self = e.user_id != null && e.user_id === req.user.id, admin = ['role.assign', 'user.manage'].some(p => req.user.perms.has(p));
  if (!self && !admin) throw new HttpError(403, "Accès réservé à l'employé, à l'administrateur local et au gérant");
  const employee = { id: e.id, name: `${e.first_name} ${e.last_name}`.trim(), position: e.position };
  const u = await accountOf(e);
  if (!u) return res.json({ linked: false, employee });
  const perms = await rolePerms(u.role_id);
  const out = { linked: true, employee, account: { id: u.id, login: u.login, active: u.active }, role: { code: u.role, label: u.role_label, personal: u.personal_user_id != null },
    permissions: perms, expense_allowed: perms.some(p => p.code === 'expense.create'), can_edit: false };
  if (admin && !self && !u.is_global && u.role !== 'ADMIN' && req.user.perms.has('role.assign')) {
    try { RS.assertCanTouchTarget(req, u.role); out.can_edit = true; } catch (_) { /* non modifiable par cet utilisateur */ }
  }
  if (out.can_edit) {
    const { rows } = await pool.query('SELECT code, label FROM permissions ORDER BY code');
    out.catalogue = rows.filter(p => req.user.perms.has(p.code) && (req.user.role === 'ADMIN' || !ADMIN_ONLY.includes(p.code)));
  }
  res.json(out);
}));

r.put('/hr/employees/:id/personal-role', need('role.assign'), body(z.object({ permissions: z.array(z.string()).max(300) })), wrap(async (req, res) => {
  const e = await employeeOf(req, req.params.id);
  const { u, clientId } = await guardTarget(req, e);
  const wanted = [...new Set(req.body.permissions)];
  const current = (await rolePerms(u.role_id)).map(p => p.code);
  const added = wanted.filter(c => !current.includes(c));
  RS.assertDelegable(req, added);   // pas de droit qu'on ne possède pas soi-même
  if (req.user.role !== 'ADMIN' && added.some(c => ADMIN_ONLY.includes(c))) throw new HttpError(403, "Seul l'administrateur local peut accorder des droits d'administration (utilisateurs, rôles).");
  const preserved = current.filter(c => !req.user.perms.has(c));   // droits déjà présents que l'utilisateur ne peut ni voir ni retirer : conservés
  const final = [...new Set([...wanted, ...preserved])];
  const { rows: ids } = await pool.query('SELECT id, code FROM permissions WHERE code = ANY($1::text[])', [final]);
  const unknown = final.filter(c => !ids.some(x => x.code === c));
  if (unknown.length) throw new HttpError(400, 'Permission inconnue : ' + unknown.join(', '));
  const out = await tx(async c => {
    let { rows: [role] } = await c.query('SELECT id, code, label FROM roles WHERE personal_user_id = $1', [u.id]);
    if (!role) {
      const code = RS.customCode(clientId, `IND ${u.id} ${e.last_name}`);
      ({ rows: [role] } = await c.query('INSERT INTO roles(code, label, client_id, personal_user_id) VALUES ($1,$2,$3::bigint,$4) RETURNING id, code, label',
        [code, `${e.first_name} ${e.last_name} (individuel)`.slice(0, 80), clientId, u.id]));
    }
    await c.query('DELETE FROM role_permissions WHERE role_id = $1', [role.id]);
    for (const p of ids) await c.query('INSERT INTO role_permissions(role_id, permission_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [role.id, p.id]);
    await c.query('UPDATE users SET role_id = $2 WHERE id = $1', [u.id, role.id]);
    await audit(c, req, 'rôles', `Rôle individuel de ${e.first_name} ${e.last_name} (${u.login})`, 'roles', role.id,
      { role: u.role, permissions: current }, { role: role.code, permissions: final });
    return { role: { code: role.code, label: role.label }, permissions: final, added: final.filter(c => !current.includes(c)), removed: current.filter(c => !final.includes(c)) };
  });
  await require('./employee_actions').track(pool, { stationId: req.sid, employeeId: e.id, kind: 'role', actorUserId: req.user.id,
    description: `Vos droits d'accès ont été modifiés (rôle individuel) : ${out.added.length ? 'ajoutés ' + out.added.join(', ') : 'aucun ajout'}${out.removed.length ? ' ; retirés ' + out.removed.join(', ') : ''}` });
  res.json(out);
}));

r.post('/hr/employees/:id/personal-role/revert', need('role.assign'), body(z.object({ role: z.string().min(2) })), wrap(async (req, res) => {
  const e = await employeeOf(req, req.params.id);
  const { u } = await guardTarget(req, e);
  if (u.personal_user_id == null) throw new HttpError(409, "Cet employé n'a pas de rôle individuel.");
  const target = await RS.assertAssignableRole(req, req.body.role);
  const { rows: [t] } = await pool.query('SELECT id, code, label FROM roles WHERE id = $1 AND personal_user_id IS NULL', [target.id]);
  if (!t) throw new HttpError(400, 'Choisissez un rôle commun ou personnalisé de votre organisation.');
  await tx(async c => {
    await c.query('UPDATE users SET role_id = $2 WHERE id = $1', [u.id, t.id]);
    await c.query('DELETE FROM role_permissions WHERE role_id = $1', [u.role_id]);
    await c.query('DELETE FROM roles WHERE id = $1 AND personal_user_id = $2', [u.role_id, u.id]);
    await audit(c, req, 'rôles', `Retour de ${e.first_name} ${e.last_name} (${u.login}) au rôle ${t.code}`, 'users', u.id, { role: u.role }, { role: t.code });
  });
  await require('./employee_actions').track(pool, { stationId: req.sid, employeeId: e.id, kind: 'role', actorUserId: req.user.id, description: `Vos droits d'accès sont revenus au rôle commun « ${t.label} »` });
  res.json({ role: { code: t.code, label: t.label } });
}));

module.exports = r;
