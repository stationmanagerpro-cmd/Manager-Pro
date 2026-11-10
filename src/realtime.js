'use strict';
/**
 * Temps réel de la messagerie (Server-Sent Events).
 * Chaque utilisateur connecté garde une connexion ouverte ; dès qu'un message est enregistré,
 * les membres de la conversation reçoivent immédiatement un évènement « message ».
 * Remarque : les connexions sont en mémoire (un seul processus serveur). Avec plusieurs
 * instances, le rafraîchissement périodique côté interface prend le relais.
 */
const { pool } = require('./core');

const MAX_CONN_PER_USER = 5;
const conns = new Map(); // String(userId) -> Set<res>

function subscribe(userId, res) {
  const key = String(userId);
  let set = conns.get(key);
  if (!set) { set = new Set(); conns.set(key, set); }
  while (set.size >= MAX_CONN_PER_USER) {          // limite : on ferme la plus ancienne
    const oldest = set.values().next().value;
    set.delete(oldest);
    try { oldest.end(); } catch (_) { /* déjà fermée */ }
  }
  const wasOffline = set.size === 0;
  set.add(res);
  if (wasOffline) announcePresence(userId, true);
  return function unsubscribe() {
    set.delete(res);
    if (!set.size && conns.get(key) === set) { conns.delete(key); announcePresence(userId, false); }
  };
}

/** Présence : enregistre la dernière activité et prévient les personnes qui partagent une conversation avec cet utilisateur. */
async function announcePresence(userId, online) {
  try {
    let last = new Date().toISOString();
    try {
      const { rows: [p] } = await pool.query(
        `INSERT INTO user_presence(user_id, last_seen_at) VALUES ($1, now())
         ON CONFLICT (user_id) DO UPDATE SET last_seen_at = now() RETURNING last_seen_at`, [userId]);
      if (p) last = p.last_seen_at;
    } catch (_) { /* migration 087 non appliquée : la présence en ligne fonctionne quand même */ }
    const { rows } = await pool.query(
      `SELECT DISTINCT b.user_id FROM conversation_members a
         JOIN conversation_members b ON b.conversation_id = a.conversation_id AND b.user_id <> a.user_id
        WHERE a.user_id = $1`, [userId]);
    publish(rows.map(r => r.user_id), 'presence', { user_id: Number(userId), online: !!online, last_seen_at: last });
  } catch (_) { /* le rafraîchissement périodique rattrape un évènement manqué */ }
}

function publish(userIds, event, data) {
  const payload = 'event: ' + event + '\ndata: ' + JSON.stringify(data || {}) + '\n\n';
  for (const id of new Set((userIds || []).map(String))) {
    const set = conns.get(id);
    if (!set) continue;
    for (const res of set) { try { res.write(payload); } catch (_) { set.delete(res); } }
  }
}

const isOnline = userId => (conns.get(String(userId)) || { size: 0 }).size > 0;

/** Prévient tous les membres d'une conversation qu'un message vient d'arriver (à appeler après validation de la transaction). */
async function notifyConversation(convId, extra) {
  try {
    const { rows } = await pool.query('SELECT user_id FROM conversation_members WHERE conversation_id = $1', [convId]);
    publish(rows.map(r => r.user_id), 'message', Object.assign({ conversation_id: Number(convId) }, extra || {}));
  } catch (_) { /* le rafraîchissement périodique rattrape un évènement manqué */ }
}

/** Prévient l'expéditeur (et les autres membres) que des messages viennent d'être lus (accusé « Vu »). */
async function notifyRead(convId, readerId) {
  try {
    const { rows } = await pool.query('SELECT user_id FROM conversation_members WHERE conversation_id = $1 AND user_id <> $2', [convId, readerId]);
    publish(rows.map(r => r.user_id), 'read', { conversation_id: Number(convId), reader_id: Number(readerId) });
  } catch (_) { /* le rafraîchissement périodique rattrape un évènement manqué */ }
}

module.exports = { subscribe, publish, isOnline, notifyConversation, notifyRead };
