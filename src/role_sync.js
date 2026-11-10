// Cohérence « fonction de l'employé » ↔ « rôle du compte utilisateur ».
// Un employé ne peut pas être pompiste sur sa fiche et caissier dans ses accès : les deux sont liés par employees.user_id.
//  - fonction modifiée sur la fiche employé  → le rôle du compte lié suit (si la fonction correspond à un rôle standard) ;
//  - rôle modifié dans Paramètres > Utilisateurs → la fonction de la fiche employé suit ;
//  - le compte ADMIN (administrateur du compte client) et les comptes plateforme ne sont jamais modifiés par cette synchronisation.
const { audit } = require('./core');

const RULES = [
  [/pompist/i, 'POMPISTE'],
  [/caissi/i, 'CAISSIER'],
  [/g[ée]rant|manager|directeur/i, 'GERANT'],
  [/magasini/i, 'MAGASINIER'],
  [/comptab/i, 'COMPTABLE'],
  [/superviseur|chef de piste/i, 'SUPERVISEUR'],
];
const LABELS = { POMPISTE: 'Pompiste', CAISSIER: 'Caissier', GERANT: 'Gérant', MAGASINIER: 'Magasinier', COMPTABLE: 'Comptable', SUPERVISEUR: 'Superviseur' };

const roleForPosition = pos => {
  const t = String(pos || '');
  for (const [re, code] of RULES) if (re.test(t)) return code;
  return null;
};

// Employé → compte : q = client de transaction ou pool.
async function syncFromEmployee(q, req, employeeId, newPosition) {
  const { rows: [emp] } = await q.query('SELECT id, user_id, first_name, last_name FROM employees WHERE id = $1', [employeeId]);
  if (!emp || !emp.user_id) return { changed: false };
  const { rows: [u] } = await q.query(
    'SELECT u.id, u.login, u.is_global, r.code AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1 AND u.deleted_at IS NULL', [emp.user_id]);
  if (!u || u.is_global || u.role === 'ADMIN') return { changed: false };
  await q.query('UPDATE users SET job_title = $2 WHERE id = $1', [u.id, newPosition || null]);
  // Rôle individuel : jamais remplacé automatiquement par un changement de fonction (l'administrateur décide)
  const { rows: [pr] } = await q.query('SELECT 1 FROM roles WHERE code = $1 AND personal_user_id IS NOT NULL', [u.role]);
  if (pr) return { changed: false, kept_personal: true };
  const code = roleForPosition(newPosition);
  if (!code || code === u.role) return { changed: false };
  try {
    await require('./roles_scope').assertAssignableRole(req, code);
  } catch (e) {
    return { changed: false, skipped: code, reason: e.message };
  }
  const { rows: [role] } = await q.query('SELECT id FROM roles WHERE code = $1', [code]);
  if (!role) return { changed: false };
  await q.query('UPDATE users SET role_id = $2 WHERE id = $1', [u.id, role.id]);
  await audit(q, req, 'utilisateurs', `Rôle de ${u.login} aligné sur la fonction « ${newPosition} » : ${u.role} → ${code}`, 'users', u.id, { role: u.role }, { role: code });
  return { changed: true, role: code };
}

// Compte → employé : la fonction de la fiche suit le rôle attribué.
async function syncFromUser(q, req, userId, roleCode) {
  const { rows: [emp] } = await q.query('SELECT id, position FROM employees WHERE user_id = $1 AND deleted_at IS NULL', [userId]);
  if (!emp || roleCode === 'ADMIN' || roleCode === 'SUPERADMIN') return { changed: false };
  const { rows: [pr] } = await q.query('SELECT 1 FROM roles WHERE code = $1 AND personal_user_id IS NOT NULL', [roleCode]);
  if (pr) return { changed: false, kept_personal: true };   // la fonction (poste) reste celle de la fiche employé
  if (roleForPosition(emp.position) === roleCode) return { changed: false };
  let label = LABELS[roleCode];
  if (!label) {
    const { rows: [r] } = await q.query('SELECT label FROM roles WHERE code = $1', [roleCode]);
    label = r && r.label;
  }
  if (!label) return { changed: false };
  await q.query('UPDATE employees SET position = $2 WHERE id = $1', [emp.id, label]);
  await q.query('INSERT INTO employee_history(employee_id, field, old_value, new_value, changed_by) VALUES ($1,$2,$3,$4,$5)',
    [emp.id, 'position', emp.position, label, req.user.id]).catch(() => {});
  await q.query('UPDATE users SET job_title = $2 WHERE id = $1', [userId, label]);
  return { changed: true, position: label };
}

// Nom : le nom complet du compte suit toujours celui de la fiche employé liée.
async function syncNameFromEmployee(q, employeeId) {
  await q.query(
    `UPDATE users u SET full_name = btrim(e.first_name || ' ' || e.last_name)
       FROM employees e WHERE e.id = $1 AND e.user_id = u.id AND u.is_global = FALSE
        AND u.full_name IS DISTINCT FROM btrim(e.first_name || ' ' || e.last_name)`, [employeeId]);
}

module.exports = { roleForPosition, syncFromEmployee, syncFromUser, syncNameFromEmployee, LABELS };
