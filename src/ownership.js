'use strict';
// Gestion des sous-comptes client et des stations : seul l'administrateur local qui les a créés peut les suspendre,
// archiver ou désactiver. Le superadmin (compte global) ne gère pas les comptes ni les stations d'un client.
// Historique sans auteur (created_by NULL) : tout administrateur local du même client disposant de user.manage.

const hasManage = user => !!(user && user.perms && user.perms.has && user.perms.has('user.manage'));

/** Station : son auteur, ou (sans auteur / créée par le superadmin) tout administrateur local lié à la station. */
async function canManageStation(pool, user, sid) {
  if (!user || user.is_global || !sid) return false;
  const { rows: [s] } = await pool.query(
    `SELECT s.created_by, cb.is_global AS creator_global
       FROM stations s
       JOIN user_stations us ON us.station_id = s.id AND us.user_id = $1
       LEFT JOIN users cb ON cb.id = s.created_by
      WHERE s.id = $2`, [user.id, sid]);
  if (!s) return false;
  if (Number(s.created_by) === Number(user.id)) return true;
  return (s.created_by == null || !!s.creator_global) && hasManage(user);
}

/** Sous-compte client : seul son auteur (administrateur local), ou tout administrateur local du client si l'auteur est inconnu. */
async function canManageUser(pool, user, target) {
  if (!user || user.is_global || !target || target.client_id == null) return false;
  const { rows: [me] } = await pool.query('SELECT client_id FROM users WHERE id = $1', [user.id]);
  if (!me || Number(me.client_id) !== Number(target.client_id)) return false;
  if (target.created_by != null) return Number(target.created_by) === Number(user.id);
  return hasManage(user);
}

module.exports = { canManageStation, canManageUser, hasManage };
