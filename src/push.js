'use strict';
/** Notifications push (application fermée) : abonnement des appareils + envoi sans contenu via les services push des navigateurs. */
const express = require('express');
const https = require('https');
const { z } = require('zod');
const { pool, HttpError, wrap, body } = require('./core');
const { swallow } = require('./safe');
const vapid = require('./push_vapid');
const pcrypto = require('./push_crypto');

const r = express.Router();
const SUBJECT = () => process.env.VAPID_SUBJECT || ('mailto:' + (process.env.SMTP_FROM || 'admin@manager-pro.local').replace(/^.*<|>.*$/g, ''));
let keysCache = null;

async function getKeys() {
  if (keysCache) return keysCache;
  const { rows: [row] } = await pool.query(`SELECT value FROM app_settings WHERE key = 'vapid_keys'`);
  if (row && row.value && row.value.publicKey) return (keysCache = row.value);
  const k = vapid.generateVapidKeys();
  await pool.query(`INSERT INTO app_settings(key, value) VALUES ('vapid_keys', $1::jsonb) ON CONFLICT (key) DO NOTHING`, [JSON.stringify(k)]);
  const { rows: [again] } = await pool.query(`SELECT value FROM app_settings WHERE key = 'vapid_keys'`);
  return (keysCache = again.value);
}

r.get('/push/key', wrap(async (req, res) => { res.json({ key: (await getKeys()).publicKey }); }));

r.post('/push/subscribe', body(z.object({ endpoint: z.string().url().max(2000), user_agent: z.string().max(300).optional(), p256dh: z.string().max(200).optional(), auth: z.string().max(100).optional() })), wrap(async (req, res) => {
  const ep = req.body.endpoint;
  if (!/^https:\/\//i.test(ep)) throw new HttpError(400, 'Adresse de notification invalide');
  await pool.query(
    `INSERT INTO push_subscriptions(user_id, endpoint, user_agent, p256dh, auth_secret) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, user_agent = EXCLUDED.user_agent,
       p256dh = COALESCE(EXCLUDED.p256dh, push_subscriptions.p256dh), auth_secret = COALESCE(EXCLUDED.auth_secret, push_subscriptions.auth_secret)`,
    [req.user.id, ep, req.body.user_agent || null, req.body.p256dh || null, req.body.auth || null]);
  res.json({ ok: true });
}));

r.post('/push/unsubscribe', body(z.object({ endpoint: z.string().max(2000) })), wrap(async (req, res) => {
  await pool.query('DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2', [req.user.id, req.body.endpoint]);
  res.json({ ok: true });
}));

function send(endpoint, keys, sub, payload) {
  return new Promise(resolve => {
    try {
      const u = new URL(endpoint);
      let data = null;
      if (payload && sub && sub.p256dh && sub.auth_secret) { try { data = pcrypto.encrypt(JSON.stringify(payload), sub.p256dh, sub.auth_secret); } catch (_) { data = null; } }
      const headers = { TTL: '86400', Urgency: 'normal', 'Content-Length': String(data ? data.length : 0), Authorization: vapid.authorizationHeader(keys, endpoint, SUBJECT()) };
      if (data) { headers['Content-Encoding'] = 'aes128gcm'; headers['Content-Type'] = 'application/octet-stream'; }
      const req = https.request({ method: 'POST', hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, timeout: 8000, headers },
      res => { res.resume(); resolve(res.statusCode); });
      req.on('timeout', () => { req.destroy(); resolve(0); });
      req.on('error', () => resolve(0));
      if (data) req.write(data);
      req.end();
    } catch (_) { resolve(0); }
  });
}

const lastSent = new Map();   // anti-rafale : un push par utilisateur et par 20 s
/** Envoie un push (sans contenu) aux appareils des utilisateurs donnés. N'échoue jamais. */
async function pushToUsers(userIds, payload) {
  try {
    const now = Date.now();
    const ids = [...new Set((userIds || []).map(Number).filter(Boolean))].filter(id => now - (lastSent.get(id) || 0) > 20000);
    if (!ids.length) return;
    ids.forEach(id => lastSent.set(id, now));
    if (lastSent.size > 5000) for (const [k, t] of lastSent) if (now - t > 60000) lastSent.delete(k);
    const { rows } = await pool.query('SELECT id, endpoint, p256dh, auth_secret FROM push_subscriptions WHERE user_id = ANY($1::bigint[])', [ids]);
    if (!rows.length) return;
    const keys = await getKeys();
    for (const s of rows) {
      const code = await send(s.endpoint, keys, s, payload);
      if (code === 404 || code === 410) await pool.query('DELETE FROM push_subscriptions WHERE id = $1', [s.id]).catch(swallow('push:purge', undefined));
      else if (code >= 200 && code < 300) await pool.query('UPDATE push_subscriptions SET last_ok_at = now() WHERE id = $1', [s.id]).catch(swallow('push:ok', undefined));
    }
  } catch (_) { /* l'envoi push ne doit jamais perturber la messagerie */ }
}

module.exports = { r, pushToUsers };
