'use strict';
/** Mesure du temps d'utilisation : l'application ouverte et visible envoie un battement toutes les 60 s. */
const express = require('express');
const { pool, wrap } = require('./core');

const r = express.Router();

r.post('/usage/ping', wrap(async (req, res) => {
  if (!req.user || req.user.is_global) return res.json({ ok: true });
  // Ajoute le temps écoulé depuis le battement précédent (plafonné à 120 s ; au-delà, l'application était fermée).
  await pool.query(
    `INSERT INTO user_usage(user_id, day, seconds, pings, last_ping_at) VALUES ($1, CURRENT_DATE, 0, 1, now())
     ON CONFLICT (user_id, day) DO UPDATE SET
       seconds = user_usage.seconds + CASE WHEN now() - user_usage.last_ping_at <= interval '150 seconds'
                 THEN LEAST(EXTRACT(EPOCH FROM now() - user_usage.last_ping_at), 120)::int ELSE 0 END,
       pings = user_usage.pings + 1, last_ping_at = now()`, [req.user.id]);
  res.json({ ok: true });
}));

module.exports = { r };
