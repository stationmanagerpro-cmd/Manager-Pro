// Messagerie interne — isolée par client_id
// Feature flags (client_contracts.features) : can_use_messaging, messaging_attachments,
// messaging_groups, messaging_broadcast, can_use_auto_alerts — tous false par défaut.
const express = require('express');
const { swallow, ignored } = require('./safe');
const { dispatchExternal } = require('./notify_channels');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { z } = require('zod');
const { pool, tx, wrap, body, need, audit, HttpError } = require('./core');
const { featureOn, loadContractForUser, requireFeature } = require('./contracts');
const files = require('./files');
const realtime = require('./realtime');

const r = express.Router();

/** Résout une source fournie par un client sans autoriser la lecture de fichiers hors du répertoire d'uploads. */
function resolveUploadSource(filePath) {
  if (typeof filePath !== 'string' || !filePath.trim()) throw new HttpError(400, 'Chemin de fichier invalide.');
  let uploadRoot, source;
  try {
    uploadRoot = fs.realpathSync(path.resolve(process.env.UPLOAD_DIR || './uploads'));
    source = fs.realpathSync(path.resolve(filePath));
  } catch (_) {
    throw new HttpError(400, 'Fichier source introuvable.');
  }
  const relative = path.relative(uploadRoot, source);
  if (!relative || relative === '.' || relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) {
    throw new HttpError(400, 'Le fichier source doit être situé dans le répertoire de téléversement.');
  }
  let stat;
  try { stat = fs.statSync(source); } catch (_) { throw new HttpError(400, 'Fichier source introuvable.'); }
  if (!stat.isFile()) throw new HttpError(400, 'La source doit être un fichier ordinaire.');
  return { path: source, stat };
}

function safeStoredName(originalName) {
  const ext = path.extname(String(originalName || '')).replace(/[^a-zA-Z0-9.]/g, '').slice(0, 16);
  return crypto.randomBytes(16).toString('hex') + ext;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

async function clientIdOf(userId) {
  const { rows: [u] } = await pool.query(
    'SELECT client_id FROM users WHERE id = $1 AND deleted_at IS NULL', [userId]
  );
  if (!u?.client_id) throw new HttpError(403, 'Aucun compte client lié. La messagerie est réservée aux utilisateurs d\'une organisation.');
  return u.client_id;
}

/** client_id pour un membre (SA inclus) à partir de la conversation. */
async function clientIdForMessaging(req, conversationId) {
  if (!req.user.is_global) return clientIdOf(req.user.id);
  if (!(await isMember(conversationId, req.user.id))) throw new HttpError(403, 'Conversation inaccessible.');
  const { rows: [c] } = await pool.query(
    'SELECT client_id FROM conversations WHERE id = $1 AND deleted_at IS NULL', [conversationId]
  );
  if (!c) throw new HttpError(404, 'Conversation introuvable');
  return c.client_id;
}

async function assertSameClient(userId, clientId) {
  const { rows: [u] } = await pool.query(
    'SELECT client_id FROM users WHERE id = $1 AND deleted_at IS NULL AND active', [userId]
  );
  if (!u || u.client_id !== clientId) throw new HttpError(403, 'Utilisateur hors de votre organisation.');
  return true;
}

async function isMember(conversationId, userId) {
  const { rowCount } = await pool.query(
    'SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2',
    [conversationId, userId]
  );
  return rowCount > 0;
}

async function requireMessaging(req) {
  if (!req.contract) req.contract = await loadContractForUser(req.user.id, req.user.is_global);
  // SuperAdmin : autorisé pour les conversations support dont il est membre
  if (req.user.is_global) {
    req._messaging_support = true;
    return;
  }
  if (!featureOn(req.contract, 'can_use_messaging') && !featureOn(req.contract, 'module:messaging')) {
    throw new HttpError(403, 'Messagerie interne non incluse dans votre contrat.', {
      code: 'FEATURE_DISABLED',
      feature: 'can_use_messaging',
      why: 'Cette fonctionnalité n\'est pas activée pour votre compte.',
      who: 'Seul l\'Administrateur Principal peut l\'autoriser.',
      how: 'Contactez l\'administrateur principal pour demander l\'activation.'
    });
  }
}

/** Client autorisé au support SuperAdmin (flag messaging_support ou messaging). */
function clientCanSupport(contract) {
  return featureOn(contract, 'messaging_support') || featureOn(contract, 'can_use_messaging') || featureOn(contract, 'module:messaging');
}

async function requireAttachments(req) {
  await requireMessaging(req);
  if (!featureOn(req.contract, 'messaging_attachments')) {
    throw new HttpError(403, 'L\'envoi de fichiers n\'est pas autorisé pour votre compte.', {
      code: 'FEATURE_DISABLED',
      feature: 'messaging_attachments',
      why: 'Les pièces jointes ne sont pas incluses dans votre contrat.',
      who: 'Seul l\'Administrateur Principal peut autoriser les pièces jointes.',
      how: 'Contactez l\'administrateur principal.'
    });
  }
}

async function canBroadcast(req, clientId) {
  if (!featureOn(req.contract, 'messaging_broadcast')) return false;
  const { rows: [row] } = await pool.query(
    `SELECT allowed FROM messaging_broadcast_roles
      WHERE client_id = $1 AND role_code = $2`,
    [clientId, req.user.role]
  );
  // Si aucune règle : seuls ADMIN / GERANT par défaut
  if (!row) return ['ADMIN', 'GERANT'].includes(req.user.role);
  return !!row.allowed;
}

function disabledPayload(feature, extra = {}) {
  return {
    enabled: false,
    feature,
    status: 'locked',
    label: '🔒 Fonctionnalité désactivée',
    why: extra.why || 'Cette fonctionnalité est désactivée sur le contrat de votre organisation. Les nouveaux contrats ont ces options actives par défaut ; le Super Admin peut les désactiver.',
    who: extra.who || 'Seul l\'Administrateur Principal (Super Admin) peut l\'activer.',
    how: extra.how || 'Super Admin → Comptes clients & licences → ouvrir le client → Modifier le contrat → cocher « Messagerie interne » (can_use_messaging) et/ou « Support SuperAdmin (dialogue) » (messaging_support) → Enregistrer.',
    after: 'Après activation, rechargez la page Messagerie. Les conversations restent isolées par client_id ; Client A ne voit jamais Client B.'
  };
}

/* -------------------------------------------------------------------------- */
/* Statut / infos (guide intégré)                                             */
/* -------------------------------------------------------------------------- */

r.get('/messaging/status', wrap(async (req, res) => {
  if (req.user.is_global) {
    return res.json({
      enabled: true,
      support_mode: true,
      reason: 'platform_admin',
      label: 'Messagerie support — dialogue avec les comptes clients.',
      features: {
        messaging: { enabled: true },
        attachments: { enabled: true },
        groups: { enabled: false },
        broadcast: { enabled: false },
        support: { enabled: true }
      },
      unread: 0
    });
  }
  const contract = await loadContractForUser(req.user.id, false);
  const messaging = featureOn(contract, 'can_use_messaging') || featureOn(contract, 'module:messaging');
  const attachments = featureOn(contract, 'messaging_attachments');
  const groups = featureOn(contract, 'messaging_groups');
  const broadcast = featureOn(contract, 'messaging_broadcast');
  const alerts = featureOn(contract, 'can_use_auto_alerts') || featureOn(contract, 'module:auto_alerts');

  let clientId = null;
  try { clientId = await clientIdOf(req.user.id); } catch { /* pas de client */ }

  const unread = clientId && messaging
    ? (await pool.query(
        `SELECT COUNT(*)::int AS n FROM message_states ms
           JOIN messages m ON m.id = ms.message_id AND m.deleted_at IS NULL
          WHERE ms.user_id = $1 AND ms.read_at IS NULL AND ms.deleted_at IS NULL`,
        [req.user.id]
      )).rows[0].n
    : 0;

  res.json({
    enabled: messaging,
    features: {
      messaging: messaging ? { enabled: true } : disabledPayload('can_use_messaging'),
      attachments: attachments ? { enabled: true } : disabledPayload('messaging_attachments', {
        why: 'Les pièces jointes ne sont pas autorisées pour votre compte.'
      }),
      groups: groups ? { enabled: true } : disabledPayload('messaging_groups'),
      broadcast: broadcast ? { enabled: true } : disabledPayload('messaging_broadcast'),
      auto_alerts: alerts ? { enabled: true } : disabledPayload('can_use_auto_alerts'),
      support: (featureOn(contract, 'messaging_support') || messaging) ? { enabled: true } : disabledPayload('messaging_support', {
        why: 'Le dialogue avec le SuperAdmin n\'est pas autorisé sur votre contrat.'
      })
    },
    unread,
    client_id: clientId
  });
}));

/* -------------------------------------------------------------------------- */
/* Employés du même client (pour sélection destinataires)                     */
/* -------------------------------------------------------------------------- */

r.get('/messaging/users', wrap(async (req, res) => {
  await requireMessaging(req);
  const clientId = await clientIdOf(req.user.id);
  const q = (req.query.q || '').trim();
  const params = [clientId, req.user.id];
  // Les destinataires sont les employés du compte client qui ont un compte actif : on cherche donc aussi
  // dans la fiche employé liée (prénom, nom, matricule, poste), pas seulement dans le compte utilisateur.
  let sql = `
    SELECT u.id, u.login, COALESCE(NULLIF(u.full_name, ''), NULLIF(btrim(concat_ws(' ', e.first_name, e.last_name)), '')) AS full_name,
           COALESCE(NULLIF(u.job_title, ''), e.position) AS job_title, e.matricule, r.code AS role, r.label AS role_label
      FROM users u JOIN roles r ON r.id = u.role_id
      LEFT JOIN employees e ON e.user_id = u.id AND e.deleted_at IS NULL
     WHERE u.client_id = $1 AND u.deleted_at IS NULL AND u.active AND u.id <> $2`;
  if (q) {
    params.push('%' + q + '%');
    // Recherche insensible à la casse et aux accents français usuels, sans dépendre
    // de l'extension PostgreSQL unaccent (qui n'est pas forcément installée).
    const fold = (expr) => `translate(lower(COALESCE(${expr}, '')), 'áàâãäåéèêëíìîïóòôõöúùûüçñýÿ', 'aaaaaaeeeeiiiiooooouuuucnyy')`;
    sql += ` AND (${fold('u.login')} ILIKE ${fold('$3')} OR ${fold('u.full_name')} ILIKE ${fold('$3')} OR ${fold('u.job_title')} ILIKE ${fold('$3')}
      OR ${fold('e.first_name')} ILIKE ${fold('$3')} OR ${fold('e.last_name')} ILIKE ${fold('$3')} OR ${fold('e.matricule')} ILIKE ${fold('$3')} OR ${fold('e.position')} ILIKE ${fold('$3')}
      OR ${fold("concat_ws(' ', e.first_name, e.last_name)")} ILIKE ${fold('$3')} OR ${fold("concat_ws(' ', e.last_name, e.first_name)")} ILIKE ${fold('$3')})`;
  }
  sql += ' ORDER BY COALESCE(u.full_name, u.login) LIMIT 50';
  const { rows } = await pool.query(sql, params);
  rows.sort((a, b) => String(a.full_name || a.login).localeCompare(String(b.full_name || b.login), 'fr', { sensitivity: 'base' }));
  res.json(rows);
}));

/** Photo de profil d'un interlocuteur : uniquement soi-même ou une personne avec qui on partage une conversation. */
r.get('/messaging/users/:id/photo', wrap(async (req, res) => {
  await requireMessaging(req);
  const uid = parseInt(req.params.id, 10);
  if (!uid) throw new HttpError(400, 'Identifiant invalide.');
  const { rows: [u] } = await pool.query(
    `SELECT u.photo_path FROM users u
      WHERE u.id = $1 AND u.photo_path IS NOT NULL AND u.deleted_at IS NULL
        AND (u.id = $2 OR EXISTS (
              SELECT 1 FROM conversation_members a JOIN conversation_members b ON b.conversation_id = a.conversation_id
               WHERE a.user_id = $2 AND b.user_id = u.id))`, [uid, req.user.id]);
  if (!u) throw new HttpError(404, 'Aucune photo');
  const buf = await files.read(u.photo_path);
  if (!buf) throw new HttpError(404, 'Aucune photo');
  res.set('Content-Type', await files.typeOf(u.photo_path)).set('Cache-Control', 'private, max-age=300').send(buf);
}));

/** Présence « En ligne » : uniquement pour les personnes avec qui je partage au moins une conversation. */
r.get('/messaging/presence', wrap(async (req, res) => {
  await requireMessaging(req);
  const { rows: peers } = await pool.query(
    `SELECT DISTINCT b.user_id FROM conversation_members a
       JOIN conversation_members b ON b.conversation_id = a.conversation_id AND b.user_id <> a.user_id
       JOIN conversations c ON c.id = a.conversation_id AND c.deleted_at IS NULL
      WHERE a.user_id = $1`, [req.user.id]);
  const ids = peers.map(p => p.user_id);
  const seen = new Map();
  if (ids.length) {
    try {
      const { rows } = await pool.query('SELECT user_id, last_seen_at FROM user_presence WHERE user_id = ANY($1::bigint[])', [ids]);
      rows.forEach(x => seen.set(String(x.user_id), x.last_seen_at));
    } catch (_) { /* migration 087 non appliquée : on ne renvoie que l'état « en ligne » */ }
  }
  const presence = {};
  for (const id of ids) presence[id] = { online: realtime.isOnline(id), last_seen_at: seen.get(String(id)) || null };
  res.json({ presence });
}));

/** Flux temps réel (Server-Sent Events) : les nouveaux messages sont poussés dès leur enregistrement. */
r.get('/messaging/stream', wrap(async (req, res) => {
  await requireMessaging(req);
  req.socket.setTimeout(0);
  req.socket.setKeepAlive(true);
  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  if (res.flushHeaders) res.flushHeaders();
  res.write('retry: 4000\n\nevent: hello\ndata: {}\n\n');
  const off = realtime.subscribe(req.user.id, res);
  const beat = setInterval(() => { try { res.write(': ping\n\n'); } catch (_) { /* connexion fermée */ } }, 25000);
  // Durée de vie limitée : le client se reconnecte (et se ré-authentifie), une session révoquée ne garde pas un flux ouvert indéfiniment.
  const ttl = setTimeout(() => { try { res.end(); } catch (_) { /* déjà fermée */ } }, 30 * 60 * 1000);
  req.on('close', () => { clearInterval(beat); clearTimeout(ttl); off(); });
}));

/* -------------------------------------------------------------------------- */
/* Conversations                                                              */
/* -------------------------------------------------------------------------- */

r.get('/messaging/conversations', wrap(async (req, res) => {
  await requireMessaging(req);
  // SuperAdmin : conversations support dont il est membre (tous clients)
  if (req.user.is_global) {
    const { rows } = await pool.query(
      `SELECT c.id,
              CASE WHEN COALESCE(c.is_support, FALSE) THEN
                concat_ws(' — ', COALESCE(NULLIF(creator.full_name, ''), creator.login, 'Administrateur'), cl.name)
                ELSE c.title END AS title,
              c.is_group, c.is_broadcast, COALESCE(c.is_support, FALSE) AS is_support, (c.is_group AND c.created_by IS NULL) AS is_system_conv, c.client_id, c.created_at,
              (SELECT COUNT(*)::int FROM messages m
                 LEFT JOIN message_states ms ON ms.message_id = m.id AND ms.user_id = $1
                WHERE m.conversation_id = c.id AND m.deleted_at IS NULL AND m.sender_id <> $1
                  AND (ms.read_at IS NULL OR ms.message_id IS NULL)
              ) AS unread,
              (SELECT json_build_object('id', m2.id, 'body', left(m2.body, 120), 'sender_id', m2.sender_id, 'created_at', m2.created_at)
                 FROM messages m2 WHERE m2.conversation_id = c.id AND m2.deleted_at IS NULL ORDER BY m2.created_at DESC LIMIT 1
              ) AS last_message
       FROM conversations c
       LEFT JOIN clients cl ON cl.id = c.client_id
       LEFT JOIN users creator ON creator.id = c.created_by
       JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = $1
       WHERE c.deleted_at IS NULL
       ORDER BY COALESCE((SELECT max(m.created_at) FROM messages m WHERE m.conversation_id = c.id), c.created_at) DESC
       LIMIT 100`, [req.user.id]
    );
    return res.json(rows);
  }
  const clientId = await clientIdOf(req.user.id);
  const { rows } = await pool.query(
    `SELECT c.id,
            CASE WHEN COALESCE(c.is_support, FALSE) THEN
              concat_ws(' — ', COALESCE(NULLIF(creator.full_name, ''), creator.login, 'Administrateur'), cl.name)
              ELSE c.title END AS title,
            COALESCE(c.is_support, FALSE) AS is_support, c.is_group, c.is_broadcast, (c.is_group AND c.created_by IS NULL) AS is_system_conv, c.created_at,
            cm.last_read_at,
            (SELECT COUNT(*)::int FROM messages m
               LEFT JOIN message_states ms ON ms.message_id = m.id AND ms.user_id = $2
              WHERE m.conversation_id = c.id AND m.deleted_at IS NULL
                AND m.sender_id <> $2
                AND (ms.read_at IS NULL OR ms.message_id IS NULL)
            ) AS unread,
            (SELECT json_build_object(
                'id', m2.id, 'body', left(m2.body, 120), 'sender_id', m2.sender_id,
                'created_at', m2.created_at, 'is_system', m2.is_system
              )
               FROM messages m2
              WHERE m2.conversation_id = c.id AND m2.deleted_at IS NULL
              ORDER BY m2.created_at DESC LIMIT 1
            ) AS last_message,
            (SELECT json_agg(json_build_object(
                'id', u.id, 'login', u.login, 'full_name', u.full_name, 'role', r.code, 'has_photo', (u.photo_path IS NOT NULL)
              ))
               FROM conversation_members cm2
               JOIN users u ON u.id = cm2.user_id
               JOIN roles r ON r.id = u.role_id
              WHERE cm2.conversation_id = c.id AND u.id <> $2
            ) AS members
       FROM conversations c
       LEFT JOIN clients cl ON cl.id = c.client_id
       LEFT JOIN users creator ON creator.id = c.created_by
       JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = $2
      WHERE c.client_id = $1 AND c.deleted_at IS NULL
      ORDER BY COALESCE(
        (SELECT max(m.created_at) FROM messages m WHERE m.conversation_id = c.id AND m.deleted_at IS NULL),
        c.created_at
      ) DESC`,
    [clientId, req.user.id]
  );
  res.json(rows);
}));

/** Messages non lus destinés à la cloche ; limités aux conversations dont l’utilisateur est membre. */
r.get('/messaging/unread', wrap(async (req, res) => {
  await requireMessaging(req);
  const params = [req.user.id];
  let tenantFilter = '';
  if (req.user.is_global) {
    // Le Superadmin ne reçoit ici que les conversations de support dont il est membre.
    tenantFilter = 'AND COALESCE(c.is_support, FALSE) = TRUE';
  } else {
    const clientId = await clientIdOf(req.user.id);
    params.push(clientId);
    tenantFilter = 'AND c.client_id = $2';
  }
  const { rows } = await pool.query(
    `SELECT m.id AS message_id, m.conversation_id, m.body, m.created_at,
            u.full_name AS sender_name, u.login AS sender_login,
            CASE WHEN COALESCE(c.is_support, FALSE) THEN
              concat_ws(' — ', COALESCE(NULLIF(creator.full_name, ''), creator.login, 'Administrateur'), cl.name)
              ELSE c.title END AS conversation_title, COALESCE(c.is_support, FALSE) AS is_support
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id AND c.deleted_at IS NULL
       JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = $1
       JOIN users u ON u.id = m.sender_id
       LEFT JOIN clients cl ON cl.id = c.client_id
       LEFT JOIN users creator ON creator.id = c.created_by
       LEFT JOIN message_states ms ON ms.message_id = m.id AND ms.user_id = $1 AND ms.deleted_at IS NULL
      WHERE m.deleted_at IS NULL AND m.sender_id <> $1
        AND ms.read_at IS NULL ${tenantFilter}
      ORDER BY m.created_at ASC, m.id ASC
      LIMIT 100`,
    params
  );
  res.json(rows);
}));

/** Ouvrir ou créer une conversation individuelle */
r.post('/messaging/conversations/direct', body(z.object({
  user_id: z.number().int().positive()
})), wrap(async (req, res) => {
  await requireMessaging(req);
  const clientId = await clientIdOf(req.user.id);
  const otherId = req.body.user_id;
  if (otherId === req.user.id) throw new HttpError(400, 'Impossible de créer une conversation avec soi-même.');
  await assertSameClient(otherId, clientId);

  // Cherche une conversation directe existante (exactement 2 membres, non groupe)
  const { rows: existing } = await pool.query(
    `SELECT c.id FROM conversations c
       JOIN conversation_members a ON a.conversation_id = c.id AND a.user_id = $2
       JOIN conversation_members b ON b.conversation_id = c.id AND b.user_id = $3
      WHERE c.client_id = $1 AND c.is_group = FALSE AND c.is_broadcast = FALSE AND c.deleted_at IS NULL
        AND (SELECT COUNT(*) FROM conversation_members cm WHERE cm.conversation_id = c.id) = 2
      LIMIT 1`,
    [clientId, req.user.id, otherId]
  );
  if (existing.length) return res.json({ id: existing[0].id, created: false });

  const conv = await tx(async c => {
    const { rows: [cv] } = await c.query(
      `INSERT INTO conversations(client_id, is_group, created_by) VALUES ($1, FALSE, $2) RETURNING id`,
      [clientId, req.user.id]
    );
    await c.query(
      `INSERT INTO conversation_members(conversation_id, user_id) VALUES ($1,$2), ($1,$3)`,
      [cv.id, req.user.id, otherId]
    );
    return cv;
  });
  res.status(201).json({ id: conv.id, created: true });
}));

/** Créer une conversation de groupe */
r.post('/messaging/conversations/group', body(z.object({
  title: z.string().trim().min(1).max(120),
  user_ids: z.array(z.number().int().positive()).min(1).max(50)
})), wrap(async (req, res) => {
  await requireMessaging(req);
  if (!featureOn(req.contract, 'messaging_groups')) {
    throw new HttpError(403, 'Les conversations de groupe ne sont pas autorisées.', {
      code: 'FEATURE_DISABLED', feature: 'messaging_groups'
    });
  }
  const clientId = await clientIdOf(req.user.id);
  const ids = [...new Set(req.body.user_ids.filter(id => id !== req.user.id))];
  for (const uid of ids) await assertSameClient(uid, clientId);

  const conv = await tx(async c => {
    const { rows: [cv] } = await c.query(
      `INSERT INTO conversations(client_id, title, is_group, created_by) VALUES ($1,$2,TRUE,$3) RETURNING id, title`,
      [clientId, req.body.title, req.user.id]
    );
    const members = [req.user.id, ...ids];
    for (const uid of members) {
      await c.query(
        `INSERT INTO conversation_members(conversation_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [cv.id, uid]
      );
    }
    return cv;
  });
  await audit(pool, req, 'messagerie', 'Création groupe « ' + req.body.title + ' »', 'conversations', conv.id);
  res.status(201).json(conv);
}));

/* -------------------------------------------------------------------------- */
/* Messages                                                                   */
/* -------------------------------------------------------------------------- */

r.get('/messaging/conversations/:id/messages', wrap(async (req, res) => {
  await requireMessaging(req);
  const convId = parseInt(req.params.id, 10);
  if (!(await isMember(convId, req.user.id))) throw new HttpError(403, 'Conversation inaccessible.');
  const clientId = await clientIdForMessaging(req, convId);

  const { rows: [cv] } = await pool.query(
    'SELECT id FROM conversations WHERE id = $1 AND client_id = $2 AND deleted_at IS NULL',
    [convId, clientId]
  );
  if (!cv) throw new HttpError(404, 'Conversation introuvable.');

  const before = req.query.before ? parseInt(req.query.before, 10) : null;
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
  const params = [convId, clientId];
  let sql = `
    SELECT m.id, m.sender_id, u.login AS sender_login, u.full_name AS sender_name, (u.photo_path IS NOT NULL) AS sender_has_photo,
           m.body, m.is_system, m.system_kind, m.ref_table, m.ref_id, m.created_at,
           (SELECT json_agg(json_build_object(
              'id', a.id, 'file_name', a.file_name, 'mime_type', a.mime_type,
              'size_bytes', a.size_bytes
            ))
              FROM message_attachments a WHERE a.message_id = m.id
           ) AS attachments,
           ms.read_at
      FROM messages m
      JOIN users u ON u.id = m.sender_id
      LEFT JOIN message_states ms ON ms.message_id = m.id AND ms.user_id = $3
     WHERE m.conversation_id = $1 AND m.client_id = $2 AND m.deleted_at IS NULL`;
  params.push(req.user.id);
  if (before) {
    params.push(before);
    sql += ` AND m.id < $${params.length}`;
  }
  sql += ` ORDER BY m.created_at DESC LIMIT ${limit}`;

  const { rows } = await pool.query(sql, params);

  // « Vu » : pour MES messages, qui les a lus et quand (les accusés des messages des autres ne sont jamais exposés).
  const mineIds = rows.filter(m => Number(m.sender_id) === Number(req.user.id) && !m.is_system).map(m => m.id);
  if (mineIds.length) {
    const { rows: st } = await pool.query(
      `SELECT ms.message_id, ms.user_id, ms.read_at, COALESCE(NULLIF(u.full_name, ''), u.login) AS name
         FROM message_states ms JOIN users u ON u.id = ms.user_id
        WHERE ms.message_id = ANY($1::bigint[]) AND ms.user_id <> $2`, [mineIds, req.user.id]);
    const by = new Map();
    for (const x of st) { if (!by.has(String(x.message_id))) by.set(String(x.message_id), []); by.get(String(x.message_id)).push(x); }
    for (const m of rows) {
      if (!mineIds.includes(m.id)) continue;
      const list = by.get(String(m.id)) || [];
      const seen = list.filter(x => x.read_at);
      m.recipients_count = list.length;
      m.seen_count = seen.length;
      // Détail nominatif seulement pour les discussions de taille raisonnable (pas pour une annonce à tous).
      m.seen_by = list.length <= 20 ? seen.map(x => ({ user_id: Number(x.user_id), name: x.name, read_at: x.read_at })) : [];
    }
  }
  const hadUnread = rows.some(m => Number(m.sender_id) !== Number(req.user.id) && !m.read_at);

  // Marquer comme lus les messages reçus
  await pool.query(
    `INSERT INTO message_states(message_id, user_id, read_at)
     SELECT m.id, $2, now() FROM messages m
      WHERE m.conversation_id = $1 AND m.sender_id <> $2 AND m.deleted_at IS NULL
     ON CONFLICT (message_id, user_id) DO UPDATE SET read_at = COALESCE(message_states.read_at, now())`,
    [convId, req.user.id]
  );
  await pool.query(
    `UPDATE conversation_members SET last_read_at = now()
      WHERE conversation_id = $1 AND user_id = $2`,
    [convId, req.user.id]
  );
  if (hadUnread) realtime.notifyRead(convId, req.user.id);   // l'expéditeur voit « Vu » aussitôt

  res.json(rows.reverse());
}));

r.post('/messaging/conversations/:id/messages', body(z.object({
  body: z.string().trim().min(1).max(10000)
})), wrap(async (req, res) => {
  await requireMessaging(req);
  const convId = parseInt(req.params.id, 10);
  if (!(await isMember(convId, req.user.id))) throw new HttpError(403, 'Conversation inaccessible.');
  const clientId = await clientIdForMessaging(req, convId);

  const { rows: [cv] } = await pool.query(
    'SELECT id, is_broadcast FROM conversations WHERE id = $1 AND client_id = $2 AND deleted_at IS NULL',
    [convId, clientId]
  );
  if (!cv) throw new HttpError(404, 'Conversation introuvable.');

  const msg = await tx(async c => {
    const { rows: [m] } = await c.query(
      `INSERT INTO messages(client_id, conversation_id, sender_id, body)
       VALUES ($1,$2,$3,$4) RETURNING id, body, created_at, sender_id`,
      [clientId, convId, req.user.id, req.body.body]
    );
    // États pour tous les membres sauf l'expéditeur
    await c.query(
      `INSERT INTO message_states(message_id, user_id)
       SELECT $1, user_id FROM conversation_members
        WHERE conversation_id = $2 AND user_id <> $3`,
      [m.id, convId, req.user.id]
    );
    return m;
  });

  realtime.notifyConversation(convId, { message_id: msg.id, sender_id: req.user.id });
  res.status(201).json(msg);
}));

/* -------------------------------------------------------------------------- */
/* Broadcast « message à tous »                                               */
/* -------------------------------------------------------------------------- */

r.post('/messaging/broadcast', body(z.object({
  body: z.string().trim().min(1).max(5000),
  title: z.string().trim().max(120).optional()
})), wrap(async (req, res) => {
  await requireMessaging(req);
  const clientId = await clientIdOf(req.user.id);
  if (!(await canBroadcast(req, clientId))) {
    throw new HttpError(403, 'Vous n\'êtes pas autorisé à envoyer un message à tous les employés.', {
      code: 'FEATURE_DISABLED',
      feature: 'messaging_broadcast',
      why: 'Soit la fonctionnalité n\'est pas dans le contrat, soit votre rôle n\'y est pas autorisé par l\'administrateur local.',
      who: 'L\'Administrateur Principal active la fonction ; l\'administrateur local choisit les rôles autorisés.'
    });
  }

  const result = await tx(async c => {
    const { rows: users } = await c.query(
      `SELECT id FROM users WHERE client_id = $1 AND deleted_at IS NULL AND active AND id <> $2`,
      [clientId, req.user.id]
    );
    if (!users.length) throw new HttpError(400, 'Aucun autre employé à notifier.');

    const { rows: [cv] } = await c.query(
      `INSERT INTO conversations(client_id, title, is_group, is_broadcast, created_by)
       VALUES ($1,$2,TRUE,TRUE,$3) RETURNING id`,
      [clientId, req.body.title || 'Annonce à tous', req.user.id]
    );
    // Membres = expéditeur + tous
    await c.query(
      `INSERT INTO conversation_members(conversation_id, user_id) VALUES ($1,$2)`,
      [cv.id, req.user.id]
    );
    for (const u of users) {
      await c.query(
        `INSERT INTO conversation_members(conversation_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [cv.id, u.id]
      );
    }
    const { rows: [m] } = await c.query(
      `INSERT INTO messages(client_id, conversation_id, sender_id, body, is_system, system_kind)
       VALUES ($1,$2,$3,$4,TRUE,'broadcast') RETURNING id, created_at`,
      [clientId, cv.id, req.user.id, req.body.body]
    );
    for (const u of users) {
      await c.query(
        `INSERT INTO message_states(message_id, user_id) VALUES ($1,$2)`,
        [m.id, u.id]
      );
    }
    return { conversation_id: cv.id, message_id: m.id, recipients: users.length };
  });

  await audit(pool, req, 'messagerie', 'Broadcast à ' + result.recipients + ' employés', 'messages', result.message_id);
  realtime.notifyConversation(result.conversation_id, { message_id: result.message_id, sender_id: req.user.id });
  res.status(201).json(result);
}));

/* -------------------------------------------------------------------------- */
/* Pièces jointes                                                             */
/* -------------------------------------------------------------------------- */

r.post('/messaging/conversations/:id/attachments', wrap(async (req, res) => {
  await requireAttachments(req);
  const convId = parseInt(req.params.id, 10);
  // Superadmin (sans client lié) : le client est celui de la conversation dont il est membre.
  const clientId = await clientIdForMessaging(req, convId);
  if (!(await isMember(convId, req.user.id))) throw new HttpError(403, 'Conversation inaccessible.');

  // Réutilise le helper fichiers existant si disponible, sinon multipart simple via files module
  // Attendu : req.body déjà parsé ou middleware multer côté server — ici on accepte un upload via files.save
  if (!req.file && !req.body?.file_path && !req.body?.data_url) {
    throw new HttpError(400, 'Aucun fichier fourni.');
  }

  const bodyText = (req.body?.message || req.body?.body || 'Pièce jointe').toString().slice(0, 10000);
  let uploadBuffer = null;
  let fileMeta;
  if (req.body?.data_url) {
    const match = /^data:([a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body.data_url));
    if (!match) throw new HttpError(400, 'Contenu de fichier invalide.');
    const allowedMime = new Set(['application/pdf','image/jpeg','image/png','image/gif','image/webp','text/plain','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);
    if (!allowedMime.has(match[1].toLowerCase())) throw new HttpError(415, 'Type de fichier refusé. Utilisez PDF, image, texte, Word ou Excel.');
    uploadBuffer = Buffer.from(match[2], 'base64');
    if (!uploadBuffer.length || uploadBuffer.length > 10 * 1024 * 1024) throw new HttpError(413, 'La taille maximale est de 10 Mo par fichier.');
    fileMeta = { originalname: String(req.body.file_name || 'piece-jointe').slice(0, 240), mimetype: match[1].toLowerCase(), size: uploadBuffer.length };
  } else {
    fileMeta = req.file || {
      path: req.body.file_path,
      originalname: req.body.file_name || path.basename(req.body.file_path),
      mimetype: req.body.mime_type || 'application/octet-stream',
      size: req.body.size_bytes || 0
    };
    if (Number(fileMeta.size || 0) > 10 * 1024 * 1024) throw new HttpError(413, 'La taille maximale est de 10 Mo par fichier.');
  }

  // Déplace / enregistre sous messaging/{client_id}/
  const uploadDir = path.join(process.env.UPLOAD_DIR || './uploads', 'messaging', String(clientId));
  fs.mkdirSync(uploadDir, { recursive: true });
  const safeName = safeStoredName(fileMeta.originalname || 'file');
  const dest = path.join(uploadDir, safeName);

  if (uploadBuffer) {
    fs.writeFileSync(dest, uploadBuffer, { flag: 'wx' });
  } else if (req.file?.path && req.file.path !== dest) {
    // Le chemin temporaire de req.file est fourni par le middleware d'upload serveur.
    if (!fs.existsSync(req.file.path) || !fs.statSync(req.file.path).isFile()) throw new HttpError(400, 'Fichier source introuvable.');
    fs.renameSync(req.file.path, dest);
  } else if (req.body?.file_path) {
    // Les chemins reçus du client ne peuvent référencer que des fichiers sous UPLOAD_DIR.
    const source = resolveUploadSource(req.body.file_path);
    fs.copyFileSync(source.path, dest);
  } else if (!req.file) {
    throw new HttpError(400, 'Fichier source introuvable.');
  }

  const msg = await tx(async c => {
    const { rows: [m] } = await c.query(
      `INSERT INTO messages(client_id, conversation_id, sender_id, body)
       VALUES ($1,$2,$3,$4) RETURNING id, created_at`,
      [clientId, convId, req.user.id, bodyText]
    );
    const { rows: [att] } = await c.query(
      `INSERT INTO message_attachments(message_id, client_id, file_path, file_name, mime_type, size_bytes, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, file_name, mime_type, size_bytes`,
      [m.id, clientId, dest, fileMeta.originalname || safeName, fileMeta.mimetype, fileMeta.size || 0, req.user.id]
    );
    await c.query(
      `INSERT INTO message_states(message_id, user_id)
       SELECT $1, user_id FROM conversation_members
        WHERE conversation_id = $2 AND user_id <> $3`,
      [m.id, convId, req.user.id]
    );
    return { message_id: m.id, attachment: att, created_at: m.created_at };
  });

  realtime.notifyConversation(convId, { message_id: msg.message_id, sender_id: req.user.id });
  res.status(201).json(msg);
}));

/** Téléchargement sécurisé d'une pièce jointe */
r.get('/messaging/attachments/:id/download', wrap(async (req, res) => {
  await requireMessaging(req);
  const attId = parseInt(req.params.id, 10);

  // Superadmin : pas de client lié ; l'accès est contrôlé par l'appartenance à la conversation ci-dessous.
  let att;
  if (req.user.is_global) {
    ({ rows: [att] } = await pool.query(
      `SELECT a.*, m.conversation_id
         FROM message_attachments a
         JOIN messages m ON m.id = a.message_id AND m.deleted_at IS NULL
        WHERE a.id = $1`,
      [attId]
    ));
  } else {
    const clientId = await clientIdOf(req.user.id);
    ({ rows: [att] } = await pool.query(
      `SELECT a.*, m.conversation_id
         FROM message_attachments a
         JOIN messages m ON m.id = a.message_id AND m.deleted_at IS NULL
        WHERE a.id = $1 AND a.client_id = $2`,
      [attId, clientId]
    ));
  }
  if (!att) throw new HttpError(404, 'Pièce jointe introuvable.');
  if (!(await isMember(att.conversation_id, req.user.id))) {
    throw new HttpError(403, 'Accès refusé à cette pièce jointe.');
  }
  if (!fs.existsSync(att.file_path)) throw new HttpError(404, 'Fichier absent du serveur.');

  res.download(att.file_path, att.file_name);
}));

/* -------------------------------------------------------------------------- */
/* Envoi depuis un autre module (bulletin, rapport…)                          */
/* -------------------------------------------------------------------------- */

r.post('/messaging/send-document', body(z.object({
  user_id: z.number().int().positive(),
  file_path: z.string().min(1),
  file_name: z.string().min(1).max(255),
  mime_type: z.string().optional(),
  message: z.string().trim().max(2000).optional()
})), wrap(async (req, res) => {
  await requireAttachments(req);
  const clientId = await clientIdOf(req.user.id);
  await assertSameClient(req.body.user_id, clientId);

  const sourceFile = resolveUploadSource(req.body.file_path);

  // Ouvre / crée conversation directe
  const { rows: existing } = await pool.query(
    `SELECT c.id FROM conversations c
       JOIN conversation_members a ON a.conversation_id = c.id AND a.user_id = $2
       JOIN conversation_members b ON b.conversation_id = c.id AND b.user_id = $3
      WHERE c.client_id = $1 AND c.is_group = FALSE AND c.deleted_at IS NULL
        AND (SELECT COUNT(*) FROM conversation_members cm WHERE cm.conversation_id = c.id) = 2
      LIMIT 1`,
    [clientId, req.user.id, req.body.user_id]
  );

  const result = await tx(async c => {
    let convId = existing[0]?.id;
    if (!convId) {
      const { rows: [cv] } = await c.query(
        `INSERT INTO conversations(client_id, is_group, created_by) VALUES ($1,FALSE,$2) RETURNING id`,
        [clientId, req.user.id]
      );
      convId = cv.id;
      await c.query(
        `INSERT INTO conversation_members(conversation_id, user_id) VALUES ($1,$2),($1,$3)`,
        [convId, req.user.id, req.body.user_id]
      );
    }

    const uploadDir = path.join(process.env.UPLOAD_DIR || './uploads', 'messaging', String(clientId));
    fs.mkdirSync(uploadDir, { recursive: true });
    const safeName = safeStoredName(req.body.file_name);
    const dest = path.join(uploadDir, safeName);
    fs.copyFileSync(sourceFile.path, dest);
    const stat = fs.statSync(dest);

    const bodyText = req.body.message || ('Document : ' + req.body.file_name);
    const { rows: [m] } = await c.query(
      `INSERT INTO messages(client_id, conversation_id, sender_id, body)
       VALUES ($1,$2,$3,$4) RETURNING id, created_at`,
      [clientId, convId, req.user.id, bodyText]
    );
    const { rows: [att] } = await c.query(
      `INSERT INTO message_attachments(message_id, client_id, file_path, file_name, mime_type, size_bytes, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, file_name`,
      [m.id, clientId, dest, req.body.file_name, req.body.mime_type || 'application/octet-stream', stat.size, req.user.id]
    );
    await c.query(
      `INSERT INTO message_states(message_id, user_id) VALUES ($1,$2)`,
      [m.id, req.body.user_id]
    );
    return { conversation_id: convId, message_id: m.id, attachment_id: att.id };
  });

  realtime.notifyConversation(result.conversation_id, { message_id: result.message_id, sender_id: req.user.id });
  res.status(201).json(result);
}));

/* -------------------------------------------------------------------------- */
/* Alertes automatiques                                                       */
/* -------------------------------------------------------------------------- */

/** Appelé en interne par les modules métier (caisse, stock, quarts…) */

// ---- Diffusion interne des alertes / notifications système ----
async function clientAdminIds(clientId) {
  const { rows } = await pool.query(
    `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.client_id = $1 AND u.active AND u.deleted_at IS NULL AND COALESCE(u.is_global, FALSE) = FALSE AND r.code = 'ADMIN'`, [clientId]);
  return rows.map(x => Number(x.id));
}
// L'expéditeur d'un message système ne doit pas être un destinataire : la cloche et les compteurs excluent ses propres messages.
async function pickSystemSender(c, clientId, recipientIds) {
  const { rows: [u] } = await c.query(
    `SELECT u.id FROM users u LEFT JOIN roles r ON r.id = u.role_id
      WHERE u.client_id = $1 AND u.active AND u.deleted_at IS NULL AND COALESCE(u.is_global, FALSE) = FALSE AND NOT (u.id = ANY($2::bigint[]))
      ORDER BY CASE WHEN r.code = 'ADMIN' THEN 0 ELSE 1 END, u.id LIMIT 1`, [clientId, recipientIds]);
  return u ? Number(u.id) : null;
}
async function createSystemConversation({ clientId, title, body, kind, refTable = null, refId = null, recipientIds, preferredSenderId = null }) {
  const result = await tx(async c => {
    const { rows: [cv] } = await c.query(
      `INSERT INTO conversations(client_id, title, is_group, created_by) VALUES ($1,$2,TRUE,NULL) RETURNING id`, [clientId, title]);
    for (const uid of recipientIds) await c.query(`INSERT INTO conversation_members(conversation_id, user_id) VALUES ($1,$2)`, [cv.id, uid]);
    const picked = await pickSystemSender(c, clientId, recipientIds);
    const senderId = picked || (preferredSenderId && recipientIds.includes(Number(preferredSenderId)) ? Number(preferredSenderId) : recipientIds[0]);
    const { rows: [m] } = await c.query(
      `INSERT INTO messages(client_id, conversation_id, sender_id, body, is_system, system_kind, ref_table, ref_id)
       VALUES ($1,$2,$3,$4,TRUE,$5,$6,$7) RETURNING id`, [clientId, cv.id, senderId, body, kind, refTable, refId]);
    for (const uid of recipientIds) if (uid !== senderId) await c.query(`INSERT INTO message_states(message_id, user_id) VALUES ($1,$2)`, [m.id, uid]);
    return { conversation_id: cv.id, message_id: m.id, recipients: recipientIds.length };
  });
  realtime.notifyConversation(result.conversation_id, { message_id: result.message_id, system: true });
  return result;
}
/** Notification interne ciblée (règles de notification) : aucun seuil, aucun contrôle de configuration d'alerte. */
async function deliverSystemMessage({ clientId, userIds = [], title, body, kind = 'notification_rule', refTable = null, refId = null }) {
  let ids = [...new Set(userIds.map(Number).filter(Boolean))];
  if (!ids.length) ids = await clientAdminIds(clientId);
  if (!ids.length) return { sent: false, reason: 'no_recipients' };
  const { rows: valid } = await pool.query(
    `SELECT id FROM users WHERE client_id = $1 AND id = ANY($2::bigint[]) AND deleted_at IS NULL AND active`, [clientId, ids]);
  const validIds = valid.map(v => Number(v.id));
  if (!validIds.length) return { sent: false, reason: 'no_valid_recipients' };
  return { sent: true, ...await createSystemConversation({ clientId, title, body, kind, refTable, refId, recipientIds: validIds }) };
}

async function sendSystemAlert({ clientId, employeeUserId = null, actorUserId = null, kind, body, refTable = null, refId = null, stationId = null, metricValue = null, metricUnit = null, metricPercent = null }) {
  const contract = await loadContractForUser(actorUserId || employeeUserId, false).catch(swallow('messaging:883', null));
  if (!contract || contract.suspended || (!featureOn(contract, 'can_use_auto_alerts') && !featureOn(contract, 'module:auto_alerts'))) {
    return { sent: false, reason: contract?.suspended ? 'contract_suspended' : 'auto_alerts_disabled' };
  }

  // Config destinataires
  const { rows: [cfg] } = await pool.query(
    `SELECT * FROM alert_notify_config
      WHERE client_id = $1 AND alert_kind = $2 AND active
        AND (station_id IS NULL OR station_id = $3)
      ORDER BY station_id NULLS LAST LIMIT 1`,
    [clientId, kind, stationId]
  );

  if (!cfg) return { sent: false, reason: 'no_active_config' };
  if (refTable && refId != null) {
    const { rowCount } = await pool.query(
      `SELECT 1 FROM messages WHERE client_id = $1 AND is_system = TRUE AND system_kind = $2 AND ref_table = $3 AND ref_id = $4 AND deleted_at IS NULL AND created_at > now() - interval '24 hours' LIMIT 1`,
      [clientId, kind, refTable, refId]
    );
    if (rowCount) return { sent: false, reason: 'duplicate_event' };
  }
  if (THRESHOLD_KINDS.has(kind)) {
    if (!(Number.isFinite(Number(cfg.threshold_value)) && Number(cfg.threshold_value) > 0) || !cfg.threshold_unit) {
      return { sent: false, reason: 'threshold_not_configured' };
    }
    const measured = cfg.threshold_unit === 'percent' ? Number(metricPercent) : Number(metricValue);
    if (!Number.isFinite(measured) || metricUnit !== cfg.threshold_unit && cfg.threshold_unit !== 'percent') {
      return { sent: false, reason: 'threshold_metric_unavailable' };
    }
    if (Math.abs(measured) < Number(cfg.threshold_value)) return { sent: false, reason: 'below_threshold' };
    if (cfg.threshold_percent && Number.isFinite(Number(metricPercent)) && Number(metricPercent) < Number(cfg.threshold_percent)) {
      return { sent: false, reason: 'below_percent_threshold' };
    }
  }
  const copyIds = (cfg.copy_user_ids || []).map(Number).filter(id => id !== Number(employeeUserId));
  const notifyEmployee = !!cfg.notify_employee;
  const recipients = [];
  if (notifyEmployee && employeeUserId) recipients.push(employeeUserId);
  for (const id of copyIds) recipients.push(id);
  // Aucun destinataire configuré : l'alerte ne doit pas se perdre, elle est adressée aux administrateurs du compte.
  if (!recipients.length) recipients.push(...await clientAdminIds(clientId));
  if (!recipients.length) return { sent: false, reason: 'no_recipients' };

  // Vérifie que tous les destinataires appartiennent au client
  const { rows: valid } = await pool.query(
    `SELECT id FROM users WHERE client_id = $1 AND id = ANY($2) AND deleted_at IS NULL AND active`,
    [clientId, recipients]
  );
  const validIds = valid.map(v => v.id);
  if (!validIds.length) return { sent: false, reason: 'no_valid_recipients' };

  const result = await createSystemConversation({ clientId, title: 'Alerte : ' + kind, body, kind, refTable, refId, recipientIds: validIds, preferredSenderId: employeeUserId });
  realtime.notifyConversation(result.conversation_id, { message_id: result.message_id, system: true });
  // Canaux externes choisis dans la configuration (e-mail, SMS, WhatsApp) : l'échec d'un canal n'annule jamais l'alerte interne.
  let external = [];
  const extChannels = (cfg.channels || ['app']).filter(c => c !== 'app');
  if (extChannels.length) {
    const { rows: contacts } = await pool.query(
      `SELECT u.id, COALESCE(u.full_name, u.login) AS name, e.email, e.phone FROM users u
         LEFT JOIN employees e ON e.user_id = u.id AND e.deleted_at IS NULL WHERE u.id = ANY($1)`, [validIds]);
    external = await dispatchExternal({ channels: extChannels, recipients: contacts, subject: 'Alerte : ' + kind, text: body }).catch(swallow('messaging:external', []));
  }
  return { sent: true, ...result, external };
}

/** Centre de suivi des alertes — séparé de la messagerie générale. */
r.get('/messaging/system-alerts', need('settings.edit', 'user.manage'), wrap(async (req, res) => {
  if (req.user.is_global) throw new HttpError(403, 'Le centre client est réservé aux responsables du compte client.');
  const contract = await loadContractForUser(req.user.id, false);
  if (contract?.suspended || (!featureOn(contract, 'can_use_auto_alerts') && !featureOn(contract, 'module:auto_alerts'))) {
    throw new HttpError(403, 'Le centre d’alertes n’est pas autorisé pour ce compte.', { code: 'FEATURE_DISABLED' });
  }
  const clientId = await clientIdOf(req.user.id);
  const status = ['open', 'acknowledged', 'resolved'].includes(req.query.status) ? req.query.status : null;
  const params = [clientId, req.user.id];
  let statusFilter = '';
  if (status) { params.push(status); statusFilter = ` AND m.alert_status = $${params.length}`; }
  params.push(Math.max(1, Math.min(200, Number.parseInt(req.query.limit, 10) || 100)));
  const { rows } = await pool.query(
    `SELECT m.id, m.system_kind AS kind, m.body, m.ref_table, m.ref_id, m.created_at,
            m.alert_status, m.acknowledged_at, m.resolved_at, m.resolution_note,
            COALESCE(ack.full_name, ack.login) AS acknowledged_by_name,
            COALESCE(res.full_name, res.login) AS resolved_by_name,
            c.title AS conversation_title
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id AND c.deleted_at IS NULL
       JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = $2
       LEFT JOIN users ack ON ack.id = m.acknowledged_by
       LEFT JOIN users res ON res.id = m.resolved_by
      WHERE m.client_id = $1 AND m.is_system = TRUE AND m.deleted_at IS NULL${statusFilter}
      ORDER BY CASE m.alert_status WHEN 'open' THEN 0 WHEN 'acknowledged' THEN 1 ELSE 2 END, m.created_at DESC
      LIMIT $${params.length}`,
    params
  );
  res.json({ alerts: rows });
}));

r.patch('/messaging/system-alerts/:id', need('settings.edit', 'user.manage'), body(z.object({
  action: z.enum(['acknowledge', 'resolve']),
  note: z.string().trim().max(1000).optional().default('')
})), wrap(async (req, res) => {
  if (req.user.is_global) throw new HttpError(403, 'Le centre client est réservé aux responsables du compte client.');
  const contract = await loadContractForUser(req.user.id, false);
  if (contract?.suspended || (!featureOn(contract, 'can_use_auto_alerts') && !featureOn(contract, 'module:auto_alerts'))) {
    throw new HttpError(403, 'Le centre d’alertes n’est pas autorisé pour ce compte.', { code: 'FEATURE_DISABLED' });
  }
  const clientId = await clientIdOf(req.user.id);
  const alertId = Number(req.params.id);
  if (!Number.isSafeInteger(alertId) || alertId <= 0) throw new HttpError(400, 'Identifiant d’alerte invalide.');
  const { rows: [updated] } = await pool.query(
    `UPDATE messages m SET
       alert_status = CASE WHEN $4 = 'resolve' THEN 'resolved' ELSE 'acknowledged' END,
       acknowledged_by = COALESCE(m.acknowledged_by, $3),
       acknowledged_at = COALESCE(m.acknowledged_at, now()),
       resolved_by = CASE WHEN $4 = 'resolve' THEN $3 ELSE m.resolved_by END,
       resolved_at = CASE WHEN $4 = 'resolve' THEN now() ELSE m.resolved_at END,
       resolution_note = CASE WHEN $4 = 'resolve' THEN NULLIF($5, '') ELSE m.resolution_note END
     WHERE m.id = $1 AND m.client_id = $2 AND m.is_system = TRUE AND m.deleted_at IS NULL
       AND m.alert_status <> 'resolved'
       AND EXISTS (SELECT 1 FROM conversations c JOIN conversation_members cm ON cm.conversation_id = c.id
                    WHERE c.id = m.conversation_id AND c.client_id = $2 AND c.deleted_at IS NULL AND cm.user_id = $3)
     RETURNING m.id, m.alert_status, m.acknowledged_at, m.resolved_at, m.resolution_note`,
    [alertId, clientId, req.user.id, req.body.action, req.body.note]
  );
  if (!updated) throw new HttpError(404, 'Alerte introuvable, inaccessible ou déjà résolue.');
  await audit(pool, req, 'alertes', req.body.action === 'resolve' ? 'Alerte résolue' : 'Alerte prise en charge', 'messages', alertId,
    null, { action: req.body.action, note_present: !!req.body.note });
  res.json({ alert: updated });
}));

/** Config alertes (gérant) */
r.get('/messaging/alert-config', need('settings.edit', 'user.manage'), wrap(async (req, res) => {
  if (req.user.is_global) throw new HttpError(403, 'Réservé aux administrateurs de station.');
  const contract = await loadContractForUser(req.user.id, false);
  if (!featureOn(contract, 'can_use_auto_alerts') && !featureOn(contract, 'module:auto_alerts')) {
    return res.json(disabledPayload('can_use_auto_alerts'));
  }
  const clientId = await clientIdOf(req.user.id);
  const [{ rows: configs }, { rows: users }] = await Promise.all([
    pool.query(
      `SELECT * FROM alert_notify_config WHERE client_id = $1 ORDER BY alert_kind, station_id NULLS FIRST`,
      [clientId]
    ),
    pool.query(
      `SELECT u.id, u.login, u.full_name, u.job_title, r.code AS role, r.label AS role_label
         FROM users u JOIN roles r ON r.id = u.role_id
        WHERE u.client_id = $1 AND u.deleted_at IS NULL AND u.active
        ORDER BY COALESCE(u.full_name, u.login)`,
      [clientId]
    )
  ]);
  res.json({ enabled: true, configs, users, channels: require('./notify_channels').channelState() });
}));

const ALERT_KINDS = new Set([
  'cash_variance', 'shift_close', 'counter_anomaly', 'stock_anomaly', 'purchase_variance',
  'absence', 'late_arrival', 'account_inactive', 'account_locked',
  'payroll_anomaly', 'payroll_pending', 'incident_note', 'license_expiring', 'backup_failure', 'stock_low', 'tank_variance'
]);
const THRESHOLD_KINDS = new Set(['cash_variance', 'shift_close', 'counter_anomaly', 'stock_anomaly', 'purchase_variance', 'late_arrival']);
const CONFIG_THRESHOLD_KINDS = new Set([...THRESHOLD_KINDS, 'account_inactive', 'license_expiring']);
const ALERT_UNITS = new Set(['XOF', 'percent', 'litres', 'units', 'days', 'minutes']);

r.put('/messaging/alert-config', need('settings.edit', 'user.manage'), body(z.object({
  alert_kind: z.string().min(1).max(60),
  station_id: z.number().int().positive().nullable().optional(),
  notify_employee: z.boolean().default(false),
  copy_user_ids: z.array(z.number().int().positive()).default([]),
  threshold_value: z.number().positive().nullable().optional(),
  threshold_unit: z.enum(['XOF', 'percent', 'litres', 'units', 'days', 'minutes']).nullable().optional(),
  threshold_percent: z.number().positive().max(1000).nullable().optional(),
  channels: z.array(z.enum(['app', 'email', 'sms', 'whatsapp'])).min(1).max(4).default(['app']),
  active: z.boolean().default(true)
})), wrap(async (req, res) => {
  if (req.user.is_global) throw new HttpError(403, 'Réservé aux administrateurs du compte client.');
  const contract = await loadContractForUser(req.user.id, false);
  if (!featureOn(contract, 'can_use_auto_alerts') && !featureOn(contract, 'module:auto_alerts')) {
    throw new HttpError(403, 'Alertes automatiques non autorisées.', { code: 'FEATURE_DISABLED' });
  }
  const clientId = await clientIdOf(req.user.id);
  const b = req.body;
  if (!ALERT_KINDS.has(b.alert_kind)) throw new HttpError(400, 'Type d’alerte inconnu.');
  if (CONFIG_THRESHOLD_KINDS.has(b.alert_kind) && b.active) {
    if (!(Number.isFinite(b.threshold_value) && b.threshold_value > 0) || !b.threshold_unit || !ALERT_UNITS.has(b.threshold_unit)) {
      throw new HttpError(400, 'Un seuil strictement positif et son unité sont obligatoires pour activer ce type d’alerte.');
    }
    const allowedUnits = b.alert_kind === 'cash_variance' || b.alert_kind === 'shift_close' || b.alert_kind === 'purchase_variance'
      ? ['XOF', 'percent']
      : b.alert_kind === 'counter_anomaly' ? ['litres', 'percent']
      : b.alert_kind === 'stock_anomaly' ? ['units', 'litres', 'percent']
      : b.alert_kind === 'late_arrival' ? ['minutes'] : ['days'];
    if (!allowedUnits.includes(b.threshold_unit)) throw new HttpError(400, 'Unité incompatible avec ce type d’alerte.');
  } else {
    b.threshold_value = null;
    b.threshold_unit = null;
    b.threshold_percent = null;
  }
  if (!b.copy_user_ids.length && b.active) {
    throw new HttpError(400, 'Désignez au moins un destinataire pour activer cette alerte.');
  }
  if (b.station_id != null) {
    const { rowCount } = await pool.query('SELECT 1 FROM stations WHERE id = $1 AND client_id = $2', [b.station_id, clientId]);
    if (!rowCount) throw new HttpError(403, 'Station hors de votre compte client.');
  }
  for (const uid of b.copy_user_ids) await assertSameClient(uid, clientId);

  const { rows: [row] } = await pool.query(
    `INSERT INTO alert_notify_config
       (client_id, station_id, alert_kind, notify_employee, copy_user_ids, active, updated_by, threshold_value, threshold_unit, threshold_percent, channels)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (client_id, station_id, alert_kind) DO UPDATE SET
       notify_employee = EXCLUDED.notify_employee,
       copy_user_ids = EXCLUDED.copy_user_ids,
       active = EXCLUDED.active,
       updated_by = EXCLUDED.updated_by,
       threshold_value = EXCLUDED.threshold_value,
       threshold_unit = EXCLUDED.threshold_unit,
       threshold_percent = EXCLUDED.threshold_percent,
       channels = EXCLUDED.channels,
       updated_at = now()
     RETURNING *`,
    [clientId, b.station_id ?? null, b.alert_kind, b.notify_employee, b.copy_user_ids,
     b.active, req.user.id, b.threshold_value ?? null, b.threshold_unit ?? null, b.threshold_percent ?? null, [...new Set(['app', ...b.channels])]]
  );
  await audit(pool, req, 'alertes', `Configuration alerte ${b.alert_kind}`, 'alert_notify_config', row.id, null,
    { alert_kind: b.alert_kind, active: b.active, recipient_count: b.copy_user_ids.length,
      threshold_value: b.threshold_value ?? null, threshold_unit: b.threshold_unit ?? null });
  res.json(row);
}));

/** Activation / désactivation rapide d'une règle d'alerte */
r.patch('/messaging/alert-config/:id/active', need('settings.edit', 'user.manage'), body(z.object({
  active: z.boolean()
})), wrap(async (req, res) => {
  const contract = await loadContractForUser(req.user.id, false);
  if (!featureOn(contract, 'can_use_auto_alerts') && !featureOn(contract, 'module:auto_alerts')) {
    throw new HttpError(403, 'Alertes automatiques non autorisées par le contrat.', { code: 'FEATURE_DISABLED', feature: 'can_use_auto_alerts' });
  }
  const clientId = await clientIdOf(req.user.id);
  const id = +req.params.id;
  const { rows: [cur] } = await pool.query(
    `SELECT * FROM alert_notify_config WHERE id=$1 AND client_id=$2`, [id, clientId]
  );
  if (!cur) throw new HttpError(404, 'Configuration introuvable');
  if (req.body.active && (!(cur.copy_user_ids || []).length)) {
    throw new HttpError(400, 'Ajoutez au moins un destinataire avant d’activer cette alerte.');
  }
  const { rows: [row] } = await pool.query(
    `UPDATE alert_notify_config SET active=$2, updated_by=$3, updated_at=now()
     WHERE id=$1 AND client_id=$4 RETURNING *`,
    [id, req.body.active, req.user.id, clientId]
  );
  await audit(pool, req, 'alertes', `${req.body.active ? 'Activation' : 'Désactivation'} alerte ${row.alert_kind}`, 'alert_notify_config', row.id);
  res.json(row);
}));


/** Config rôles autorisés au broadcast (admin local) */
r.get('/messaging/broadcast-roles', need('settings.edit', 'user.manage'), wrap(async (req, res) => {
  const contract = await loadContractForUser(req.user.id, false);
  if (!featureOn(contract, 'messaging_broadcast')) {
    return res.json(disabledPayload('messaging_broadcast'));
  }
  const clientId = await clientIdOf(req.user.id);
  const { rows } = await pool.query(
    `SELECT role_code, allowed FROM messaging_broadcast_roles WHERE client_id = $1`,
    [clientId]
  );
  res.json({ enabled: true, roles: rows });
}));

r.put('/messaging/broadcast-roles', need('settings.edit', 'user.manage'), body(z.object({
  roles: z.array(z.object({
    role_code: z.string().min(1).max(30),
    allowed: z.boolean()
  }))
})), wrap(async (req, res) => {
  const contract = await loadContractForUser(req.user.id, false);
  if (!featureOn(contract, 'messaging_broadcast')) {
    throw new HttpError(403, 'Broadcast non autorisé dans le contrat.', { code: 'FEATURE_DISABLED' });
  }
  const clientId = await clientIdOf(req.user.id);
  await tx(async c => {
    for (const r of req.body.roles) {
      await c.query(
        `INSERT INTO messaging_broadcast_roles(client_id, role_code, allowed)
         VALUES ($1,$2,$3)
         ON CONFLICT (client_id, role_code) DO UPDATE SET allowed = EXCLUDED.allowed`,
        [clientId, r.role_code, r.allowed]
      );
    }
  });
  res.json({ ok: true });
}));

/* -------------------------------------------------------------------------- */
/* Marquer lu / archiver                                                      */
/* -------------------------------------------------------------------------- */

r.post('/messaging/messages/:id/read', wrap(async (req, res) => {
  await requireMessaging(req);
  const msgId = parseInt(req.params.id, 10);
  await pool.query(
    `INSERT INTO message_states(message_id, user_id, read_at) VALUES ($1,$2,now())
     ON CONFLICT (message_id, user_id) DO UPDATE SET read_at = COALESCE(message_states.read_at, now())`,
    [msgId, req.user.id]
  );
  res.json({ ok: true });
}));

r.post('/messaging/messages/:id/archive', wrap(async (req, res) => {
  await requireMessaging(req);
  const msgId = parseInt(req.params.id, 10);
  await pool.query(
    `INSERT INTO message_states(message_id, user_id, archived_at) VALUES ($1,$2,now())
     ON CONFLICT (message_id, user_id) DO UPDATE SET archived_at = now()`,
    [msgId, req.user.id]
  );
  res.json({ ok: true });
}));

/* -------------------------------------------------------------------------- */
/* Suppression d'un message (uniquement ses propres messages)                 */
/* -------------------------------------------------------------------------- */

r.delete('/messaging/messages/:id', wrap(async (req, res) => {
  await requireMessaging(req);
  const msgId = parseInt(req.params.id, 10);
  if (!Number.isInteger(msgId) || msgId <= 0) throw new HttpError(400, 'Message invalide.');

  const { rows: [m] } = await pool.query(
    'SELECT id, client_id, conversation_id, sender_id, is_system FROM messages WHERE id = $1 AND deleted_at IS NULL',
    [msgId]
  );
  if (!m) throw new HttpError(404, 'Message introuvable ou déjà supprimé.');
  if (!(await isMember(m.conversation_id, req.user.id))) throw new HttpError(403, 'Conversation inaccessible.');
  const clientId = await clientIdForMessaging(req, m.conversation_id);
  if (String(m.client_id) !== String(clientId)) throw new HttpError(403, 'Conversation inaccessible.');
  if (m.is_system) throw new HttpError(403, 'Les alertes système ne peuvent pas être supprimées.');
  if (String(m.sender_id) !== String(req.user.id)) throw new HttpError(403, 'Vous ne pouvez supprimer que vos propres messages.');

  await tx(async c => {
    await c.query('UPDATE messages SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL', [msgId]);
    await audit(c, req, 'messagerie', 'Suppression d\'un message', 'messages', msgId, { conversation_id: Number(m.conversation_id) });
  });

  // Les autres membres voient disparaître le message sans recharger la page.
  realtime.notifyConversation(m.conversation_id, { message_id: msgId, sender_id: req.user.id, deleted: true });
  res.json({ ok: true, id: msgId });
}));


/* -------------------------------------------------------------------------- */
/* Support SuperAdmin ↔ Client                                                */
/* -------------------------------------------------------------------------- */

/** Liste des clients pour ouvrir une conversation support (SuperAdmin). */
r.get('/messaging/support/clients', wrap(async (req, res) => {
  if (!req.user.is_global) throw new HttpError(403, 'Réservé au SuperAdmin');
  const { rows } = await pool.query(
    `SELECT c.id, c.name, c.code,
            (SELECT COUNT(*)::int FROM conversations cv
              WHERE cv.client_id = c.id AND cv.is_support = TRUE AND cv.deleted_at IS NULL) AS support_threads
     FROM clients c
     WHERE c.status <> 'archive'
     ORDER BY c.name
     LIMIT 200`
  ).catch(async () => {
    // fallback si colonne is_support absente
    return pool.query(
      `SELECT c.id, c.name, c.code, 0 AS support_threads
       FROM clients c WHERE c.status <> 'archive' ORDER BY c.name LIMIT 200`
    );
  });
  res.json(rows);
}));

/** Ouvrir / reprendre une conversation support avec le gérant d'un client. */
r.post('/messaging/support/open', body(z.object({
  client_id: z.number().int().positive(),
  subject: z.string().max(200).optional()
})), wrap(async (req, res) => {
  if (!req.user.is_global) throw new HttpError(403, 'Réservé au SuperAdmin');
  const clientId = req.body.client_id;
  // Trouver un admin/gérant du client
  const { rows: managers } = await pool.query(
    `SELECT u.id, u.login, u.full_name FROM users u
     JOIN roles r ON r.id = u.role_id
     WHERE u.client_id = $1 AND u.deleted_at IS NULL AND u.active
       AND r.code IN ('GERANT','ADMIN','SUPERVISEUR')
     ORDER BY CASE r.code WHEN 'GERANT' THEN 0 WHEN 'ADMIN' THEN 1 ELSE 2 END
     LIMIT 5`, [clientId]
  );
  if (!managers.length) {
    const { rows: any } = await pool.query(
      `SELECT id, login, full_name FROM users WHERE client_id = $1 AND deleted_at IS NULL AND active LIMIT 3`, [clientId]
    );
    if (!any.length) throw new HttpError(404, 'Aucun utilisateur actif pour ce client');
    managers.push(...any);
  }
  const otherId = managers[0].id;

  // Conversation support existante ?
  let convId;
  try {
    const { rows: [ex] } = await pool.query(
      `SELECT c.id FROM conversations c
         JOIN conversation_members a ON a.conversation_id = c.id AND a.user_id = $2
         JOIN conversation_members b ON b.conversation_id = c.id AND b.user_id = $3
       WHERE c.client_id = $1 AND c.is_support = TRUE AND c.deleted_at IS NULL
       LIMIT 1`, [clientId, req.user.id, otherId]
    );
    if (ex) convId = ex.id;
  } catch (_) { /* colonne is_support absente */ }

  if (!convId) {
    const title = req.body.subject || ('Support — ' + (managers[0].full_name || managers[0].login));
    try {
      const { rows: [c] } = await pool.query(
        `INSERT INTO conversations(client_id, title, is_group, is_support, created_by)
         VALUES ($1,$2,FALSE,TRUE,$3) RETURNING id`, [clientId, title, req.user.id]
      );
      convId = c.id;
    } catch (e) {
      // fallback sans is_support
      const { rows: [c] } = await pool.query(
        `INSERT INTO conversations(client_id, title, is_group, created_by)
         VALUES ($1,$2,FALSE,$3) RETURNING id`, [clientId, title, req.user.id]
      );
      convId = c.id;
    }
    await pool.query(
      `INSERT INTO conversation_members(conversation_id, user_id) VALUES ($1,$2), ($1,$3) ON CONFLICT DO NOTHING`,
      [convId, req.user.id, otherId]
    );
  }
  res.status(201).json({ id: convId, client_id: clientId, peer: managers[0] });
}));

/** Client : ouvrir une conversation avec le SuperAdmin (si messaging_support). */
r.post('/messaging/support/to-admin', body(z.object({
  subject: z.string().max(200).optional(),
  body: z.string().min(1).max(4000).optional()
})), wrap(async (req, res) => {
  if (req.user.is_global) throw new HttpError(400, 'Réservé aux comptes clients');
  // B5 — Seul l'administrateur local du compte client peut initier un contact support.
  // Le contrôle est côté serveur : masquer le bouton dans l'interface ne suffit pas.
  if (req.user.role !== 'ADMIN') {
    throw new HttpError(403, 'Seul l’administrateur local peut contacter le SuperAdmin.', {
      code: 'LOCAL_ADMIN_REQUIRED', feature: 'messaging_support'
    });
  }
  const contract = await loadContractForUser(req.user.id, false);
  // C2 : le support de renouvellement reste accessible à l'ADMIN local même après expiration.
  const renewalSupportException = !!(contract && (contract.license_expired || contract.license_status === 'EXPIREE' || contract.license_status === 'SUSPENDUE'));
  if (!clientCanSupport(contract) && !renewalSupportException && !req._subscription_renewal_support) {
    throw new HttpError(403, 'Support SuperAdmin non autorisé sur votre contrat.', {
      code: 'FEATURE_DISABLED', feature: 'messaging_support'
    });
  }
  const clientId = await clientIdOf(req.user.id);
  const { rows: [sa] } = await pool.query(
    `SELECT id FROM users WHERE is_global = TRUE AND deleted_at IS NULL AND active ORDER BY id LIMIT 1`
  );
  if (!sa) throw new HttpError(503, 'Aucun SuperAdmin disponible');

  let convId;
  try {
    const { rows: [ex] } = await pool.query(
      `SELECT c.id FROM conversations c
         JOIN conversation_members a ON a.conversation_id = c.id AND a.user_id = $2
         JOIN conversation_members b ON b.conversation_id = c.id AND b.user_id = $3
       WHERE c.client_id = $1 AND COALESCE(c.is_support, FALSE) = TRUE AND c.deleted_at IS NULL LIMIT 1`,
      [clientId, req.user.id, sa.id]
    );
    if (ex) convId = ex.id;
  } catch (e) { ignored('messaging:conversation-support', e); }

  if (!convId) {
    const title = req.body.subject || 'Demande de support';
    try {
      const { rows: [c] } = await pool.query(
        `INSERT INTO conversations(client_id, title, is_group, is_support, created_by) VALUES ($1,$2,FALSE,TRUE,$3) RETURNING id`,
        [clientId, title, req.user.id]
      );
      convId = c.id;
    } catch {
      const { rows: [c] } = await pool.query(
        `INSERT INTO conversations(client_id, title, is_group, created_by) VALUES ($1,$2,FALSE,$3) RETURNING id`,
        [clientId, title, req.user.id]
      );
      convId = c.id;
    }
    await pool.query(
      `INSERT INTO conversation_members(conversation_id, user_id) VALUES ($1,$2), ($1,$3) ON CONFLICT DO NOTHING`,
      [convId, req.user.id, sa.id]
    );
  }
  if (req.body.body) {
    const { rows: [m] } = await pool.query(
      `INSERT INTO messages(client_id, conversation_id, sender_id, body) VALUES ($1,$2,$3,$4) RETURNING id`,
      [clientId, convId, req.user.id, req.body.body]
    );
    await pool.query(`INSERT INTO message_states(message_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [m.id, sa.id]);
    realtime.notifyConversation(convId, { message_id: m.id, sender_id: req.user.id });
  }
  res.status(201).json({ id: convId });
}));



/** A9 : l'envoi d'e-mails est-il configuré sur le serveur ? (aucune valeur secrète n'est renvoyée) */
r.get('/messaging/email-status', need('settings.edit', 'user.manage'), wrap(async (req, res) => {
  res.json({ configured: !!(process.env.SMTP_HOST || process.env.MAIL_MODE === 'json') });
}));

r.get('/messaging/alert-health', need('settings.edit', 'user.manage'), wrap(async (req, res) => {
  let health = { enabled: process.env.ALERTS_AUTO !== '0' };
  try { health = { ...health, ...require('./alerts_scheduler').getAlertsHealth() }; } catch (e) {
    health.error = e.message;
  }
  // Compter règles actives pour ce client
  let clientId = null;
  try {
    if (req.user.is_global) clientId = req.query.client_id ? +req.query.client_id : null;
    else {
      const { rows: [u] } = await pool.query('SELECT client_id FROM users WHERE id = $1', [req.user.id]);
      clientId = u && u.client_id;
    }
  } catch (e) { ignored('messaging:client-id', e); }
  let rules = { active: 0, total: 0 };
  if (clientId) {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE active)::int AS active
         FROM alert_notify_config WHERE client_id = $1`, [clientId]
    ).catch(swallow('messaging:1408', { rows: [{ total: 0, active: 0 }] }));
    rules = rows[0] || rules;
  }
  // Dernières alertes système
  const { rows: recent } = await pool.query(
    `SELECT id, system_kind AS kind, body, created_at FROM messages
      WHERE is_system = TRUE AND deleted_at IS NULL AND ($1::bigint IS NULL OR client_id = $1)
      ORDER BY id DESC LIMIT 10`,
    [clientId]
  ).catch(swallow('messaging:1417', { rows: [] }));
  res.json({ ...health, rules, recent_alerts: recent, client_id: clientId });
}));

r.post('/messaging/alert-health/run', need('settings.edit', 'user.manage'), wrap(async (req, res) => {
  if (req.user && !req.user.is_global && !req.user.perms?.has('settings.edit')) {
    throw new HttpError(403, 'Permission insuffisante');
  }
  const result = await require('./alerts_scheduler').runAlertScan();
  res.json({ ok: true, result });
}));

module.exports = { r, sendSystemAlert, deliverSystemMessage, clientAdminIds, disabledPayload, resolveUploadSource, safeStoredName };
