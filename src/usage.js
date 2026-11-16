'use strict';
/** Mesure du temps d'utilisation : l'application ouverte et visible envoie un battement toutes les 60 s. */
const express = require('express');
const { pool, wrap } = require('./core');

const r = express.Router();

r.post('/usage/ping', wrap(async (req, res) => {
  if (!req.user || req.user.is_global) return res.json({ ok: true });
  // Le client envoie le nom de l'écran courant ; seule une chaîne simple est retenue (window.__smpView peut être un objet ailleurs).
  const raw = req.body && req.body.view;
  const view = typeof raw === 'string' && /^[a-z0-9_]{1,30}$/i.test(raw) ? raw : '';
  if (view) {
    await pool.query(`INSERT INTO view_usage(day, view, minutes) VALUES (CURRENT_DATE, $1, 1) ON CONFLICT (day, view) DO UPDATE SET minutes = view_usage.minutes + 1`, [view]).catch(() => {});
  }
  // Détail par client, heure (fuseau Bamako), compte et écran : alimente les agrégats par client.
  // La station est retenue seulement si elle est affectée au compte et rattachée au même client ; sinon 0 (non identifiée).
  const sid = parseInt(req.headers['x-station-id'], 10) || null;
  await pool.query(
    `INSERT INTO usage_detail(day, hour, client_id, user_id, view, station_id, minutes)
     SELECT CURRENT_DATE, EXTRACT(HOUR FROM (now() AT TIME ZONE 'Africa/Bamako'))::int, $1, $2, $3,
            COALESCE((SELECT st.id FROM user_stations us JOIN stations st ON st.id = us.station_id JOIN users u ON u.id = us.user_id
                       WHERE us.user_id = $2 AND st.id = $4 AND st.active = true AND (u.client_id IS NULL OR st.client_id = u.client_id)), 0), 1
     ON CONFLICT (day, hour, user_id, view, station_id) DO UPDATE SET minutes = usage_detail.minutes + 1`,
    [req.user.client_id || null, req.user.id, view, sid]).catch(() => {});
  // Ajoute le temps écoulé depuis le battement précédent (plafonné à 120 s ; au-delà, l'application était fermée).
  await pool.query(
    `INSERT INTO user_usage(user_id, day, seconds, pings, last_ping_at) VALUES ($1, CURRENT_DATE, 0, 1, now())
     ON CONFLICT (user_id, day) DO UPDATE SET
       seconds = user_usage.seconds + CASE WHEN now() - user_usage.last_ping_at <= interval '150 seconds'
                 THEN LEAST(EXTRACT(EPOCH FROM now() - user_usage.last_ping_at), 120)::int ELSE 0 END,
       pings = user_usage.pings + 1, last_ping_at = now()`, [req.user.id]);
  res.json({ ok: true });
}));

// Activité de l'équipe : réservé à l'administrateur local, limité à son propre client.
r.get('/usage/team', wrap(async (req, res) => {
  if (!req.user || req.user.is_global || req.user.role !== 'ADMIN' || !req.user.client_id) return res.status(403).json({ error: 'Réservé à l’administrateur du compte.' });
  const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));
  const { rows } = await pool.query(
    `SELECT u.id, u.login, COALESCE(NULLIF(trim(e.first_name || ' ' || e.last_name), ''), u.login) AS display_name,
            (SELECT COUNT(*)::int FROM user_sessions s WHERE s.user_id = u.id AND s.created_at >= now() - make_interval(days => $2::int)) AS logins,
            COALESCE((SELECT SUM(seconds)::int FROM user_usage x WHERE x.user_id = u.id AND x.day > CURRENT_DATE - $2::int), 0) AS seconds,
            GREATEST(u.last_login_at, (SELECT MAX(last_ping_at) FROM user_usage x WHERE x.user_id = u.id)) AS last_activity
       FROM users u LEFT JOIN employees e ON e.user_id = u.id
      WHERE u.client_id = $1 AND u.deleted_at IS NULL AND u.is_global = false
      ORDER BY seconds DESC, logins DESC, u.login`, [req.user.client_id, days]);
  res.json({ days, users: rows });
}));

module.exports = { r };
