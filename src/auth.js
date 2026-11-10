// Authentification, session, utilisateurs.
const express = require('express');
const { swallow } = require('./safe');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const { pool, tx, HttpError, wrap, body, need, audit } = require('./core');
const files = require('./files');

const pub = express.Router();  // sans authentification
const priv = express.Router(); // authentifié, sans station

const MAX_FAILS = 5;
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Trop de tentatives, réessayez plus tard' } });

// Hachage factice : le mot de passe est comparé même pour un compte absent ou inactif (temps de réponse identique, RG-05).
const DUMMY_HASH = bcrypt.hashSync('compte-inexistant-comparaison-factice', 12);
const LOGIN_FAIL_MSG = 'Identifiant ou mot de passe incorrect';

pub.post('/login', limiter, require('./access_keys').requireGate, body(z.object({ login: z.string().min(1).max(200), password: z.string().min(1).max(1000) })), wrap(async (req, res) => {
  const { rows: [u] } = await pool.query(
    'SELECT u.*, r.code AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.login = $1 AND u.deleted_at IS NULL', [req.body.login]);
  // Verrouillage lié à l'identifiant ET à l'adresse IP : 5 échecs depuis une adresse ne bloquent pas la connexion depuis une autre (RG-05).
  const key = String(req.body.login).trim().toLowerCase(), ip = String(req.ip || '');
  const { rows: [th] } = await pool.query('SELECT lockout_until FROM login_throttle WHERE login = $1 AND ip = $2', [key, ip]);
  const locked = !!(th && th.lockout_until && new Date(th.lockout_until) > new Date());
  const match = await bcrypt.compare(req.body.password, u ? u.password_hash : DUMMY_HASH);
  const ok = !!(u && u.active && match && !locked);
  if (!ok) {
    // Même code et même message pour compte inexistant, inactif, verrouillé ou mot de passe faux.
    if (!locked) {
      // Déverrouillage automatique après 15 minutes ; l'incrément reste atomique (tentatives simultanées).
      const { rows: [t] } = await pool.query(
        `INSERT INTO login_throttle (login, ip, failed_logins, lockout_until, updated_at)
         VALUES ($1, $2, 1, CASE WHEN 1 >= $3 THEN now() + interval '15 minutes' END, now())
         ON CONFLICT (login, ip) DO UPDATE SET
           failed_logins = CASE WHEN login_throttle.lockout_until IS NOT NULL AND login_throttle.lockout_until <= now() THEN 1 ELSE login_throttle.failed_logins + 1 END,
           lockout_until = CASE WHEN (CASE WHEN login_throttle.lockout_until IS NOT NULL AND login_throttle.lockout_until <= now() THEN 1 ELSE login_throttle.failed_logins + 1 END) >= $3
                                THEN now() + interval '15 minutes' ELSE NULL END,
           updated_at = now()
         RETURNING failed_logins`, [key, ip, MAX_FAILS]);
      if (t && t.failed_logins >= MAX_FAILS) {
        // Journalisation des verrouillages (identifiant tronqué : donnée saisie par un tiers).
        await audit(pool, { user: u || null, ip }, 'auth', `Verrouillage temporaire de la connexion « ${key.slice(0, 60)} » depuis ${ip} après ${MAX_FAILS} échecs`)
          .catch(e => console.error('[auth] verrouillage non journalisé :', e.message));
      }
      if (Math.random() < 0.01) pool.query("DELETE FROM login_throttle WHERE updated_at < now() - interval '1 day'").catch(() => {});
    }
    throw new HttpError(401, LOGIN_FAIL_MSG);
  }
  await pool.query('DELETE FROM login_throttle WHERE login = $1 AND ip = $2', [key, ip]);
  // Si le compte est lié à un employé inactif → accès refusé (seule façon de tout suspendre)
  if (u && !u.is_global) {
    const { rows: [emp] } = await pool.query(
      `SELECT id, status FROM employees WHERE user_id = $1 AND deleted_at IS NULL LIMIT 1`, [u.id]
    );
    if (emp && emp.status === 'inactif') {
      throw new HttpError(403, 'Employé inactif : accès au compte suspendu. Réactivez la fiche employé pour rétablir l\'accès.');
    }
  }
  const hours = require('./session_policy').sessionHours({ role: u.role, isGlobal: u.is_global });
  const { rows: [s] } = await pool.query(
    `INSERT INTO user_sessions(user_id, ip_address, expires_at) VALUES ($1,$2, now() + make_interval(hours => $3::int)) RETURNING id`, [u.id, req.ip, hours]);
  await pool.query('UPDATE users SET failed_logins = 0, lockout_until = NULL, last_login_at = now(), successful_login_count = COALESCE(successful_login_count, 0) + 1 WHERE id = $1', [u.id]);
  await audit(pool, { user: u, ip: req.ip }, 'auth', 'Connexion de ' + u.login);
  const token = jwt.sign({ uid: u.id, sid: s.id }, process.env.JWT_SECRET, { expiresIn: hours + 'h' });
  res.json({ token, user: { id: u.id, login: u.login, role: u.role } });
}));

/** Thème personnel : autorisé pour tout utilisateur authentifié (SuperAdmin et comptes clients).
 *  Isolé par user_id — ne contamine jamais un autre compte ni les règles de sécurité. */
async function canPersonalizeForUser(req) {
  return !!(req.user && req.user.id && req.user.active !== false);
}

priv.get('/me/preferences/theme', wrap(async (req, res) => {
  const allowed = await canPersonalizeForUser(req);
  const { rows: [x] } = await pool.query("SELECT value FROM user_preferences WHERE user_id=$1 AND key='theme'", [req.user.id]).catch(swallow('auth:72', { rows: [] }));
  res.json({ allowed, theme: x?.value || { mode: 'light', primary: '#0a6b5c', secondary: '#647184' } });
}));

priv.put('/me/preferences/theme', body(z.object({ theme: z.object({ mode: z.enum(['light','dark']), primary: z.string().regex(/^#[0-9a-fA-F]{6}$/), secondary: z.string().regex(/^#[0-9a-fA-F]{6}$/) }) })), wrap(async (req, res) => {
  if (!(await canPersonalizeForUser(req))) throw new HttpError(403, 'Personnalisation personnelle non autorisée.');
  await pool.query(`INSERT INTO user_preferences(user_id,key,value,updated_at,updated_by) VALUES ($1,'theme',$2::jsonb,now(),$1) ON CONFLICT(user_id,key) DO UPDATE SET value=EXCLUDED.value, updated_at=now(), updated_by=$1`, [req.user.id, JSON.stringify(req.body.theme)]);
  await audit(pool, req, 'profil', 'Modification du thème personnel', 'user_preferences', req.user.id, null, req.body.theme).catch(e => console.error('[prefs] audit non enregistré :', e.message));
  res.json({ ok: true, theme: req.body.theme });
}));

// Couleurs personnelles du menu de gauche et de l'en-tête : propres à chaque compte (y compris le Super Admin).
const { navColorsSchema } = require('./nav_colors');
priv.get('/me/preferences/nav-colors', wrap(async (req, res) => {
  const { rows: [x] } = await pool.query("SELECT value FROM user_preferences WHERE user_id=$1 AND key='nav_colors'", [req.user.id]).catch(swallow('auth:86', { rows: [] }));
  const p = navColorsSchema.safeParse(x?.value || {});
  res.json({ nav_colors: p.success ? p.data : { sidebar: null, header: null } });
}));
priv.put('/me/preferences/nav-colors', body(z.object({ nav_colors: navColorsSchema })), wrap(async (req, res) => {
  if (!(await canPersonalizeForUser(req))) throw new HttpError(403, 'Personnalisation personnelle non autorisée.');
  const value = req.body.nav_colors;
  await pool.query(`INSERT INTO user_preferences(user_id,key,value,updated_at,updated_by) VALUES ($1,'nav_colors',$2::jsonb,now(),$1) ON CONFLICT(user_id,key) DO UPDATE SET value=EXCLUDED.value, updated_at=now(), updated_by=$1`, [req.user.id, JSON.stringify(value)]);
  await audit(pool, req, 'profil', 'Modification des couleurs personnelles du menu', 'user_preferences', req.user.id, null, value).catch(e => console.error('[prefs] audit non enregistré :', e.message));
  res.json({ ok: true, nav_colors: value });
}));
priv.delete('/me/preferences/nav-colors', wrap(async (req, res) => {
  await pool.query("DELETE FROM user_preferences WHERE user_id=$1 AND key='nav_colors'", [req.user.id]);
  await audit(pool, req, 'profil', 'Couleurs personnelles du menu rétablies par défaut', 'user_preferences', req.user.id).catch(e => console.error('[prefs] audit non enregistré :', e.message));
  res.json({ ok: true, nav_colors: { sidebar: null, header: null } });
}));

// Effets visuels personnels : préférence par utilisateur, sans impact sur les données métier.
priv.get('/me/preferences/motion', wrap(async (req, res) => {
  const { rows: [x] } = await pool.query("SELECT value FROM user_preferences WHERE user_id=$1 AND key='motion'", [req.user.id]).catch(swallow('auth:105', { rows: [] }));
  res.json({ motion: x?.value?.mode || 'subtle' });
}));
priv.put('/me/preferences/motion', body(z.object({ mode: z.enum(['off','subtle','full']) })), wrap(async (req, res) => {
  if (!(await canPersonalizeForUser(req))) throw new HttpError(403, 'Personnalisation personnelle non autorisée.');
  await pool.query(`INSERT INTO user_preferences(user_id,key,value,updated_at,updated_by) VALUES ($1,'motion',$2::jsonb,now(),$1) ON CONFLICT(user_id,key) DO UPDATE SET value=EXCLUDED.value, updated_at=now(), updated_by=$1`, [req.user.id, JSON.stringify({ mode: req.body.mode })]);
  await audit(pool, req, 'profil', 'Modification des animations personnelles', 'user_preferences', req.user.id, null, { mode: req.body.mode }).catch(e => console.error('[prefs] audit non enregistré :', e.message));
  res.json({ ok: true, mode: req.body.mode });
}));

priv.post('/auth/logout', wrap(async (req, res) => {
  await pool.query('UPDATE user_sessions SET revoked_at = now() WHERE id = $1', [req.sessionId]);
  await audit(pool, req, 'auth', 'Déconnexion de ' + req.user.login);
  res.json({ ok: true });
}));

// Profil, permissions et stations accessibles

// Profil, permissions et stations accessibles
priv.get('/me', wrap(async (req, res) => {
  let stations;

  if (req.user.is_global) {
    // L'Administrateur Principal n'a aucune station : son périmètre est la plateforme.
    stations = [];
  } else {
    // Utilisateur standard : uniquement ses stations autorisées
    const r = await pool.query(`
      SELECT s.id, s.name, s.currency
      FROM stations s
      JOIN user_stations us
        ON us.station_id = s.id
      WHERE us.user_id = $1
        AND s.active = true
      ORDER BY s.id
    `, [req.user.id]);

    stations = r.rows;
  }

  let contract = null;
  try {
    const { loadContractForUser } = require('./contracts');
    contract = await loadContractForUser(
      req.user.id,
      req.user.is_global
    );
  } catch (_) {
    // Ignore les erreurs de chargement du contrat
  }

  // Profil réel de l'utilisateur connecté (nom complet, fonction, libellé du rôle, photo) : colonnes ajoutées par la migration 023
  let prof = {};
  try {
    const { rows: [x] } = await pool.query(
      'SELECT u.full_name, u.job_title, (u.photo_path IS NOT NULL) AS has_photo, r.label AS role_label, COALESCE(u.successful_login_count,0) AS successful_login_count FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1', [req.user.id]);
    prof = x || {};
  } catch (e) {
    if (e.code !== '42703') throw e;   // colonnes absentes : migration 023 pas encore appliquée
    const { rows: [x] } = await pool.query('SELECT r.label AS role_label FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1', [req.user.id]);
    prof = x || {};
  }

  res.json({
    id: req.user.id,
    login: req.user.login,
    full_name: prof.full_name || null,
    job_title: prof.job_title || null,
    role_label: prof.role_label || req.user.role,
    has_photo: !!prof.has_photo,
    successful_login_count: Number(prof.successful_login_count || 0),
    role: req.user.role,
    is_global: req.user.is_global,
    permissions: [...req.user.perms],
    stations,
    contract
  });
}));

priv.post('/users', need('user.manage'), body(z.object({
  login: z.string().min(3), password: z.string().min(8), role: z.string(), station_ids: z.array(z.number().int()).default([]), is_global: z.boolean().default(false),
  full_name: z.string().trim().max(120).optional(), job_title: z.string().trim().max(120).optional(),
  employee_id: z.number().int().positive().optional(), // obligatoire pour comptes station : l'employé doit exister d'abord
})), wrap(async (req, res) => {
  const b = req.body;
  // L'Administrateur Principal gère les comptes de plateforme, pas les employés/utilisateurs d'une station.
  if (req.user.is_global && !b.is_global) throw new HttpError(403, 'Les utilisateurs de station doivent être créés depuis le compte client/gérant.');
  if (b.is_global && b.role !== 'SUPERADMIN') throw new HttpError(400, 'Un compte de plateforme doit obligatoirement utiliser le rôle SUPERADMIN.');
  if (!b.is_global && b.role === 'SUPERADMIN') throw new HttpError(403, 'Le rôle SUPERADMIN est réservé aux comptes de plateforme.');
  if (req.user.is_global && b.station_ids?.length) throw new HttpError(403, 'Un compte de plateforme ne peut pas être rattaché à une station ici.');
  if (b.is_global && !req.user.is_global) throw new HttpError(403, 'Impossible de créer un Administrateur Principal.');
  await require('./roles_scope').assertAssignableRole(req, b.role, { platformAccount: !!b.is_global });
  { const pwErr = require('./password_policy').checkPassword(b.password, { role: b.role, isGlobal: b.is_global, login: b.login }); if (pwErr) throw new HttpError(400, pwErr); }
  let clientId = null;
  if (!req.user.is_global) {
    const { loadContractForUser, countClientUsers } = require('./contracts');
    const contract = await loadContractForUser(req.user.id, false);
    if (contract.suspended) throw new HttpError(403, 'Contrat suspendu ou expiré.');
    if (!contract.can_manage_users) throw new HttpError(403, 'Gestion des utilisateurs non autorisée par votre contrat.');
    if (!contract.client_id) throw new HttpError(403, 'Aucun client lié.');
    const n = await countClientUsers(contract.client_id);
    if (contract.max_users != null && n >= contract.max_users) {
      throw new HttpError(403, `Limite d'utilisateurs prévue par votre contrat atteinte (${n}/${contract.max_users}).`);
    }
    clientId = contract.client_id;
  } else if (b.station_ids?.length) {
    // Admin : propager client_id depuis la première station si liée
    const { rows: [st] } = await pool.query('SELECT client_id FROM stations WHERE id = $1', [b.station_ids[0]]);
    clientId = st?.client_id || null;
  }
  const u = await tx(async c => {
    const { rows: [r] } = await c.query('SELECT id FROM roles WHERE code = $1', [b.role]);
    if (!r) throw new HttpError(400, 'Rôle inconnu');
    const hash = await bcrypt.hash(b.password, 12);
    const isGlobal = req.user.is_global ? !!b.is_global : false;
    const { rows: [n] } = await c.query(
      'INSERT INTO users(login, password_hash, role_id, is_global, client_id, full_name, job_title) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, login',
      [b.login, hash, r.id, isGlobal, clientId, b.full_name || null, b.job_title || null]
    );
    for (const sid of b.station_ids) {
      // Gérant : stations du même client uniquement
      if (!req.user.is_global && clientId) {
        const { rows: [st] } = await c.query('SELECT client_id FROM stations WHERE id = $1', [sid]);
        if (!st || st.client_id !== clientId) throw new HttpError(403, 'Station hors de votre organisation.');
      }
      await c.query('INSERT INTO user_stations(user_id, station_id) VALUES ($1,$2)', [n.id, sid]);
    }
    // Lien employé ↔ compte (règle métier : employé d'abord, compte optionnel)
    if (!isGlobal) {
      if (!b.employee_id) {
        throw new HttpError(400, 'Sélectionnez un employé existant. Créez d\'abord la fiche employé, puis octroyez-lui un accès compte.');
      }
      const sid0 = b.station_ids[0] || (req.headers['x-station-id'] ? +req.headers['x-station-id'] : null);
      if (!sid0) throw new HttpError(400, 'Station requise pour lier un employé');
      const { rows: [emp] } = await c.query(
        `SELECT id, user_id, status, first_name, last_name, position FROM employees
         WHERE id = $1 AND station_id = $2 AND deleted_at IS NULL FOR UPDATE`,
        [b.employee_id, sid0]
      );
      if (!emp) throw new HttpError(404, 'Employé introuvable sur cette station');
      if (emp.status === 'inactif') throw new HttpError(409, 'Impossible d\'octroyer un accès à un employé inactif. Réactivez-le d\'abord.');
      if (emp.user_id) throw new HttpError(409, 'Cet employé a déjà un compte utilisateur lié');
      await c.query('UPDATE employees SET user_id = $2 WHERE id = $1 AND station_id = $3', [emp.id, n.id, sid0]);
      await require('./role_sync').syncFromUser(c, req, n.id, b.role);
      // Compléter le profil si vide
      if (!b.full_name) {
        await c.query('UPDATE users SET full_name = $2, job_title = COALESCE(job_title, $3) WHERE id = $1',
          [n.id, (emp.first_name + ' ' + emp.last_name).trim(), emp.position || null]);
      }
    }
    await audit(c, req, 'utilisateurs', 'Création de ' + b.login + (b.employee_id ? ' (employé #' + b.employee_id + ')' : ''), 'users', n.id, null, { login: b.login, role: b.role, client_id: clientId, employee_id: b.employee_id || null });
    return n;
  });
  res.status(201).json(u);
}));

// Changement de mot de passe : mot de passe actuel exigé, les autres sessions sont révoquées
priv.post('/auth/password', body(z.object({ current: z.string().min(1), next: z.string().min(8, '8 caractères minimum') })), wrap(async (req, res) => {
  const { rows: [u] } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  if (!(await bcrypt.compare(req.body.current, u.password_hash))) throw new HttpError(400, 'Mot de passe actuel incorrect');
  if (req.body.current === req.body.next) throw new HttpError(400, "Le nouveau mot de passe doit être différent de l'ancien");
  { const pwErr = require('./password_policy').checkPassword(req.body.next, { role: req.user.role, isGlobal: req.user.is_global, login: req.user.login }); if (pwErr) throw new HttpError(400, pwErr); }
  await pool.query('UPDATE users SET password_hash = $2 WHERE id = $1', [req.user.id, await bcrypt.hash(req.body.next, 12)]);
  await pool.query('UPDATE user_sessions SET revoked_at = now() WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL', [req.user.id, req.sessionId]);
  await audit(pool, req, 'auth', 'Changement de mot de passe de ' + req.user.login);
  res.json({ ok: true });
}));

priv.get('/users', need('user.manage'), wrap(async (req, res) => {
  if (req.user.is_global) {
    // L'Administrateur Principal ne gère ici que les comptes de plateforme.
    // Les utilisateurs/employés d'une station restent dans le périmètre du gérant.
    const { rows } = await pool.query(
      `SELECT u.id, u.login, u.full_name, u.job_title, r.code AS role, r.label AS role_label, u.active, GREATEST(u.failed_logins, COALESCE((SELECT MAX(t.failed_logins) FROM login_throttle t WHERE t.login = lower(u.login)), 0))::int AS failed_logins, u.last_login_at, u.is_global, u.client_id
       FROM users u JOIN roles r ON r.id = u.role_id
       WHERE u.deleted_at IS NULL AND u.is_global = true ORDER BY u.id`
    );
    return res.json(rows);
  }
  const { rows: [me] } = await pool.query('SELECT client_id FROM users WHERE id = $1', [req.user.id]);
  if (!me?.client_id) {
    // Historique : voir utilisateurs des stations accessibles
    const { rows } = await pool.query(
      `SELECT DISTINCT u.id, u.login, u.full_name, u.job_title, r.code AS role, r.label AS role_label, u.active, GREATEST(u.failed_logins, COALESCE((SELECT MAX(t.failed_logins) FROM login_throttle t WHERE t.login = lower(u.login)), 0))::int AS failed_logins, u.last_login_at, u.client_id
       FROM users u JOIN roles r ON r.id = u.role_id
       JOIN user_stations us ON us.user_id = u.id
       WHERE u.deleted_at IS NULL AND us.station_id IN (SELECT station_id FROM user_stations WHERE user_id = $1)
       ORDER BY u.id`, [req.user.id]
    );
    return res.json(rows);
  }
  const { rows } = await pool.query(
    `SELECT u.id, u.login, u.full_name, u.job_title, r.code AS role, r.label AS role_label, u.active, GREATEST(u.failed_logins, COALESCE((SELECT MAX(t.failed_logins) FROM login_throttle t WHERE t.login = lower(u.login)), 0))::int AS failed_logins, u.last_login_at, u.client_id
     FROM users u JOIN roles r ON r.id = u.role_id
     WHERE u.deleted_at IS NULL AND u.client_id = $1 ORDER BY u.id`, [me.client_id]
  );
  res.json(rows);
}));

priv.post('/users/:id/unlock', need('user.manage'), wrap(async (req, res) => {
  const targetId = Number(req.params.id);
  if (!Number.isSafeInteger(targetId) || targetId <= 0) throw new HttpError(400, 'Identifiant de compte invalide');
  await require('./roles_scope').assertSuperadminScope(req, targetId);
  const { rows: [target] } = await pool.query(
    `SELECT id, is_global, client_id, failed_logins, lockout_until FROM users WHERE id = $1 AND deleted_at IS NULL`, [targetId]
  );
  if (!target) throw new HttpError(404, 'Compte introuvable');

  if (req.user.is_global) {
    // Le Superadmin débloque les comptes de plateforme et l'administrateur local d'un client (garde-fou assertSuperadminScope ci-dessus).
  } else {
    if (target.is_global) throw new HttpError(403, 'Accès refusé.');
    const { rows: [actor] } = await pool.query('SELECT client_id FROM users WHERE id = $1', [req.user.id]);
    let inScope = !!actor?.client_id && target.client_id === actor.client_id;
    if (!actor?.client_id && !target.client_id) {
      const { rowCount } = await pool.query(
        `SELECT 1 FROM user_stations mine JOIN user_stations theirs ON theirs.station_id = mine.station_id
          WHERE mine.user_id = $1 AND theirs.user_id = $2 LIMIT 1`, [req.user.id, targetId]
      );
      inScope = rowCount > 0;
    }
    if (!inScope) throw new HttpError(403, 'Ce compte ne relève pas de votre client ou de vos stations.');
  }

  await pool.query('UPDATE users SET failed_logins = 0, lockout_until = NULL WHERE id = $1', [targetId]);
  await pool.query('DELETE FROM login_throttle WHERE login = (SELECT lower(login) FROM users WHERE id = $1)', [targetId]);   // verrous par identifiant + adresse IP
  await audit(pool, req, 'utilisateurs', 'Déblocage du compte ' + targetId, 'users', targetId,
    { failed_logins: target.failed_logins ?? null, lockout_until: target.lockout_until ?? null },
    { failed_logins: 0, lockout_until: null });
  res.json({ ok: true });
}));



/** Descriptifs des rôles métier prédéfinis (pour l’UI de création de compte). */
const ROLE_PRESETS = {
  POMPISTE: { label: 'Pompiste', summary: 'Saisie des ventes carburant / produits et consultation de ses rapports de quart.', icon: '⛽' },
  CAISSIER: { label: 'Caissier', summary: 'Ventes, caisse, clients, ouverture/clôture de quart, rapports.', icon: '💰' },
  GERANT: { label: 'Gérant', summary: 'Pilotage complet de la station (ops, stock, RH, utilisateurs, paramètres).', icon: '📋' },
  COMPTABLE: { label: 'Comptable', summary: 'Finance, rapports, audit, créances/dettes, paie en lecture/gestion.', icon: '📊' },
  SUPERVISEUR: { label: 'Superviseur', summary: 'Supervision ops, stocks, caisse et rapports — sans gestion des comptes.', icon: '👁️' },
  MAGASINIER: { label: 'Magasinier', summary: 'Stocks, achats, fournisseurs.', icon: '📦' },
  ADMIN: { label: 'Administrateur', summary: 'Toutes les permissions de la station / organisation.', icon: '🛡️' }
};

priv.get('/roles/presets', need('user.manage', 'role.assign', 'settings.edit'), wrap(async (req, res) => {
  const { rows: roles } = await pool.query(
    `SELECT r.code, r.label,
            COALESCE(array_agg(p.code ORDER BY p.code) FILTER (WHERE p.code IS NOT NULL), '{}') AS permissions
       FROM roles r
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
       LEFT JOIN permissions p ON p.id = rp.permission_id
      GROUP BY r.id, r.code, r.label
      ORDER BY r.code`
  );
  const list = roles.map(r => ({
    code: r.code,
    label: (ROLE_PRESETS[r.code] && ROLE_PRESETS[r.code].label) || r.label,
    summary: (ROLE_PRESETS[r.code] && ROLE_PRESETS[r.code].summary) || '',
    icon: (ROLE_PRESETS[r.code] && ROLE_PRESETS[r.code].icon) || '•',
    permissions: r.permissions || []
  }));
  res.json(list);
}));


priv.patch('/users/:id/role', need('role.assign', 'user.manage'), body(z.object({
  role: z.string().min(1)
})), wrap(async (req, res) => {
  const targetId = +req.params.id;
  const newRole = req.body.role;
  await require('./roles_scope').assertSuperadminScope(req, targetId);
  if (!req.user.is_global && newRole === req.user.role && targetId === req.user.id) {
    // ok stay
  }
  const { rows: [target] } = await pool.query(
    `SELECT u.id, u.login, u.is_global, u.client_id, r.code AS role
     FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1 AND u.deleted_at IS NULL`, [targetId]
  );
  if (!target) throw new HttpError(404, 'Utilisateur introuvable');
  if (target.is_global && !req.user.is_global) throw new HttpError(403, 'Impossible de modifier un Administrateur Principal.');
  if (target.is_global && newRole !== 'SUPERADMIN') throw new HttpError(400, 'Un compte de plateforme doit conserver le rôle SUPERADMIN.');
  if (!target.is_global && newRole === 'SUPERADMIN') throw new HttpError(403, 'Le rôle SUPERADMIN est réservé aux comptes de plateforme.');
  await require('./roles_scope').assertAssignableRole(req, newRole, { platformAccount: !!target.is_global });
  if (!req.user.is_global) {
    // même client uniquement
    const { rows: [me] } = await pool.query('SELECT client_id FROM users WHERE id = $1', [req.user.id]);
    if (me?.client_id && target.client_id !== me.client_id) throw new HttpError(403, 'Utilisateur hors de votre organisation.');
    // Un administrateur local en révoque un autre (jamais lui-même) ; un non-administrateur ne touche pas aux administrateurs.
    require('./roles_scope').assertCanTouchTarget(req, target.role);
    if (targetId === req.user.id && newRole !== target.role) throw new HttpError(400, 'Vous ne pouvez pas modifier votre propre rôle : demandez à un autre administrateur local.');
  }
  const { rows: [r] } = await pool.query('SELECT id FROM roles WHERE code = $1', [newRole]);
  if (!r) throw new HttpError(400, 'Rôle inconnu');
  await pool.query('UPDATE users SET role_id = $2 WHERE id = $1', [targetId, r.id]);
  await audit(pool, req, 'utilisateurs', `Rôle de ${target.login} : ${target.role} → ${newRole}`, 'users', targetId,
    { role: target.role }, { role: newRole });
  // La fonction de la fiche employé liée suit le rôle (un employé ne peut pas avoir deux fonctions différentes).
  const synced = await require('./role_sync').syncFromUser(pool, req, targetId, newRole);
  res.json({ id: targetId, role: newRole, position: synced.position || undefined });
}));

priv.patch('/users/:id/active', need('user.manage'), body(z.object({
  active: z.boolean()
})), wrap(async (req, res) => {
  const targetId = +req.params.id;
  if (targetId === req.user.id) throw new HttpError(400, 'Vous ne pouvez pas désactiver votre propre compte.');
  await require('./roles_scope').assertSuperadminScope(req, targetId);
  const { rows: [target] } = await pool.query(
    `SELECT u.id, u.login, u.is_global, u.client_id, u.active FROM users u WHERE u.id = $1 AND u.deleted_at IS NULL`, [targetId]
  );
  if (!target) throw new HttpError(404, 'Utilisateur introuvable');
  if (target.is_global && !req.user.is_global) throw new HttpError(403, 'Impossible de modifier un Administrateur Principal.');
  if (!req.user.is_global) {
    const { rows: [me] } = await pool.query('SELECT client_id FROM users WHERE id = $1', [req.user.id]);
    if (me?.client_id && target.client_id !== me.client_id) throw new HttpError(403, 'Utilisateur hors de votre organisation.');
    const { rows: [tr] } = await pool.query('SELECT r.code FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1', [targetId]);
    require('./roles_scope').assertCanTouchTarget(req, tr && tr.code);   // révoquer un administrateur local : réservé à un autre administrateur local
  }
  await pool.query('UPDATE users SET active = $2 WHERE id = $1', [targetId, req.body.active]);
  await audit(pool, req, 'utilisateurs', `${req.body.active ? 'Activation' : 'Désactivation'} de ${target.login}`, 'users', targetId,
    { active: target.active }, { active: req.body.active });
  res.json({ id: targetId, active: req.body.active });
}));


// ---------- Profil : photo personnelle (chacun gère la sienne) ----------
priv.get('/me/photo', wrap(async (req, res) => {
  const { rows: [u] } = await pool.query('SELECT photo_path FROM users WHERE id = $1', [req.user.id]);
  const buf = await files.read(u && u.photo_path);
  if (!buf) throw new HttpError(404, 'Aucune photo');
  res.set('Content-Type', await files.typeOf(u.photo_path)).set('Cache-Control', 'private, max-age=60').send(buf);
}));
priv.put('/me/photo', body(z.object({ data_url: z.string().min(20) })), wrap(async (req, res) => {
  const { rows: [u] } = await pool.query('SELECT photo_path FROM users WHERE id = $1', [req.user.id]);
  const rel = await files.save('users', req.body.data_url, false);   // PNG / JPEG contrôlés d'après les octets, 2 Mo max
  await pool.query('UPDATE users SET photo_path = $2 WHERE id = $1', [req.user.id, rel]);
  await files.remove(u && u.photo_path);
  await audit(pool, req, 'utilisateurs', 'Photo de profil modifiée : ' + req.user.login, 'users', req.user.id);
  res.json({ ok: true });
}));
priv.delete('/me/photo', wrap(async (req, res) => {
  const { rows: [u] } = await pool.query('SELECT photo_path FROM users WHERE id = $1', [req.user.id]);
  await pool.query('UPDATE users SET photo_path = NULL WHERE id = $1', [req.user.id]);
  await files.remove(u && u.photo_path);
  res.json({ ok: true });
}));

// Nom complet et fonction d'un utilisateur (gestionnaire d'utilisateurs, dans son périmètre)
priv.patch('/users/:id/profile', need('user.manage'), body(z.object({
  full_name: z.string().trim().max(120).nullable().optional(), job_title: z.string().trim().max(120).nullable().optional()
})), wrap(async (req, res) => {
  const targetId = +req.params.id;
  await require('./roles_scope').assertSuperadminScope(req, targetId);
  const { rows: [target] } = await pool.query('SELECT id, login, is_global, client_id FROM users WHERE id = $1 AND deleted_at IS NULL', [targetId]);
  if (!target) throw new HttpError(404, 'Utilisateur introuvable');
  if (target.is_global && !req.user.is_global) throw new HttpError(403, 'Impossible de modifier un Administrateur Principal.');
  if (!req.user.is_global) {
    const { rows: [me] } = await pool.query('SELECT client_id FROM users WHERE id = $1', [req.user.id]);
    if (me?.client_id && target.client_id !== me.client_id) throw new HttpError(403, 'Utilisateur hors de votre organisation.');
    const { rows: [tr] } = await pool.query('SELECT r.code FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1', [targetId]);
    require('./roles_scope').assertCanTouchTarget(req, tr && tr.code);
  }
  await pool.query('UPDATE users SET full_name = $2, job_title = $3 WHERE id = $1', [targetId, req.body.full_name || null, req.body.job_title || null]);
  // La fonction saisie ici est aussi celle de la fiche employé liée, et le rôle suit si elle correspond à un rôle standard.
  if (req.body.job_title) {
    const { rows: [le] } = await pool.query('SELECT id FROM employees WHERE user_id = $1 AND deleted_at IS NULL', [targetId]);
    if (le) {
      await pool.query('UPDATE employees SET position = $2 WHERE id = $1', [le.id, req.body.job_title]);
      await require('./role_sync').syncFromEmployee(pool, req, le.id, req.body.job_title);
    }
  }
  await audit(pool, req, 'utilisateurs', 'Profil de ' + target.login + ' modifié', 'users', targetId, null, req.body);
  res.json({ ok: true });
}));

// ---- Cohérence fonction de l'employé ↔ rôle du compte ----
async function roleMismatches(req) {
  if (req.user.is_global) return [];
  const { roleForPosition } = require('./role_sync');
  const { rows: [me] } = await pool.query('SELECT client_id FROM users WHERE id = $1', [req.user.id]);
  const { rows } = await pool.query(
    `SELECT e.id AS employee_id, e.first_name, e.last_name, e.position, u.id AS user_id, u.login, r.code AS role, r.label AS role_label
       FROM employees e JOIN users u ON u.id = e.user_id JOIN roles r ON r.id = u.role_id
      WHERE e.deleted_at IS NULL AND u.deleted_at IS NULL AND u.is_global = false AND u.client_id IS NOT DISTINCT FROM $1 AND r.code <> 'ADMIN' AND r.personal_user_id IS NULL`, [me ? me.client_id : null]);
  return rows.map(x => ({ ...x, expected_role: roleForPosition(x.position) })).filter(x => x.expected_role && x.expected_role !== x.role);
}
priv.get('/users/role-consistency', need('user.manage'), wrap(async (req, res) => {
  res.json(await roleMismatches(req));
}));
priv.post('/users/role-consistency/fix', need('user.manage'), body(z.object({ mode: z.enum(['employee', 'user']) })), wrap(async (req, res) => {
  const sync = require('./role_sync');
  const list = await roleMismatches(req);
  let fixed = 0;
  for (const m of list) {
    const r = req.body.mode === 'employee'
      ? await sync.syncFromEmployee(pool, req, m.employee_id, m.position)   // le rôle suit la fonction
      : await sync.syncFromUser(pool, req, m.user_id, m.role);             // la fonction suit le rôle
    if (r.changed) fixed++;
  }
  res.json({ checked: list.length, fixed });
}));

module.exports = { pub, priv };
