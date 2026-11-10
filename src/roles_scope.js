// Périmètre des rôles : qui peut attribuer quel rôle (anti-élévation de privilèges, isolation par client).
//  - Le Super Admin (SUPERADMIN) est réservé aux comptes de plateforme ; ADMIN = administrateur d'un compte client.
//  - Superadmin : uniquement le rôle ADMIN (administrateur local) pour un compte client ; SUPERADMIN pour les comptes de plateforme.
//  - Administrateur local (ADMIN) : tous les rôles de son compte, y compris ADMIN ; un rôle non-ADMIN ne peut jamais nommer ni modifier un ADMIN.
//  - Un client ne peut attribuer que : les rôles communs, ADMIN (par un ADMIN) et ses propres rôles personnalisés.
//  - Un client ne peut jamais déléguer une permission qu'il ne possède pas lui-même.
const { pool, HttpError } = require('./core');

async function myClientId(userId) {
  const { rows: [u] } = await pool.query('SELECT client_id FROM users WHERE id = $1', [userId]);
  return u && u.client_id != null ? String(u.client_id) : null;
}

async function assertAssignableRole(req, code, { platformAccount = false } = {}) {
  const { rows: [r] } = await pool.query('SELECT id, code, client_id FROM roles WHERE code = $1', [code]);
  if (!r) throw new HttpError(400, 'Rôle inconnu');
  if (r.code === 'SUPERADMIN') {
    if (req.user.is_global && platformAccount) return r;
    throw new HttpError(403, 'Le rôle Super administrateur est réservé aux comptes de plateforme.');
  }
  // Séparation stricte : le Superadmin ne donne QUE le rôle « Administrateur local » (premier administrateur du compte client).
  // Gérant, comptable, caissier, pompiste… sont attribués par l'administrateur local, selon les permissions du contrat.
  if (req.user.is_global) {
    if (r.code === 'ADMIN') return r;
    throw new HttpError(403, 'Le Superadmin ne donne que le rôle Administrateur local : les autres rôles sont attribués par l\'administrateur local du compte client.');
  }
  // Un administrateur local peut en nommer un autre ; un autre rôle (gérant, comptable…) ne le peut pas.
  if (r.code === 'ADMIN') {
    if (req.user.role !== 'ADMIN') throw new HttpError(403, 'Seul un administrateur local peut nommer un autre administrateur local.');
    return r;
  }
  const mine = await myClientId(req.user.id);
  if (r.client_id != null && String(r.client_id) !== mine) throw new HttpError(403, 'Ce rôle appartient à une autre organisation.');
  const { rows } = await pool.query('SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = $1', [r.id]);
  const extra = rows.map(x => x.code).filter(c => !req.user.perms.has(c));
  if (extra.length) throw new HttpError(403, `Ce rôle contient des permissions que vous ne possédez pas (${extra.join(', ')}) : vous ne pouvez pas déléguer plus que vos propres droits.`);
  return r;
}

/** Permissions demandées pour un rôle personnalisé : toutes doivent exister et appartenir à l'utilisateur courant. */
function assertDelegable(req, codes) {
  const bad = [...new Set(codes)].filter(c => !req.user.perms.has(c));
  if (bad.length) throw new HttpError(403, `Vous ne pouvez pas déléguer des permissions que vous ne possédez pas : ${bad.join(', ')}.`);
}

/** Code technique d'un rôle personnalisé : C<clientId>_<LIBELLÉ_NORMALISÉ>, unique et conforme à /^[A-Z][A-Z0-9_]*$/ */
function customCode(clientId, label) {
  const slug = String(label).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 28);
  return `C${clientId}_${slug || 'ROLE'}`.slice(0, 40);
}

/** Un compte non-ADMIN (gérant…) ne peut ni modifier, ni désactiver, ni débloquer un administrateur local. */
function assertCanTouchTarget(req, targetRole) {
  if (req.user.is_global) return;
  if (targetRole === 'ADMIN' && req.user.role !== 'ADMIN') throw new HttpError(403, 'Seul un administrateur local peut gérer un autre administrateur local.');
}

/** Le Superadmin ne gère, parmi les comptes d'un client, que l'administrateur local (ADMIN) : jamais gérant, comptable, caissier, pompiste…
 * (ces comptes relèvent de l'administrateur local). Les comptes de plateforme restent dans son périmètre. */
async function assertSuperadminScope(req, targetId) {
  if (!req.user.is_global) return;
  const { rows: [u] } = await pool.query('SELECT u.is_global, r.code AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1 AND u.deleted_at IS NULL', [targetId]);
  if (!u || u.is_global) return;   // introuvable : la route répond 404 ; compte de plateforme : dans le périmètre
  if (u.role !== 'ADMIN') throw new HttpError(403, 'Le Superadmin ne gère que l\'administrateur local d\'un compte client : les autres comptes (gérant, comptable, caissier, pompiste…) relèvent de l\'administrateur local.');
}

module.exports = { myClientId, assertAssignableRole, assertDelegable, assertCanTouchTarget, assertSuperadminScope, customCode };
