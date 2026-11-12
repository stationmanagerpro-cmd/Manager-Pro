'use strict';
/** Espace client : lien privé en lecture seule (solde, factures, achats, règlements) pour un client à crédit / entreprise.
 *  - Côté gestion (connecté) : POST /portal/links · GET /portal/links · POST /portal/links/:id/revoke
 *  - Côté client (sans connexion) : GET /api/public/portal/:token  → jamais d'identifiant interne, jeton stocké haché, révocable, expirant.
 *  Page : /c/<jeton> (public/espace-client.html). */
const express = require('express');
const crypto = require('crypto');
const { z } = require('zod');
const rateLimit = require('express-rate-limit');
const { pool, HttpError, wrap, body, need, audit } = require('./core');

const r = express.Router(), pub = express.Router();
const q = async (sql, p) => (await pool.query(sql, p)).rows;
const hash = t => crypto.createHash('sha256').update(String(t)).digest('hex');

r.post('/portal/links', need('customer.edit'), body(z.object({ customer_id: z.number().int().positive(), days: z.number().int().min(1).max(365).optional() }).strict()), wrap(async (req, res) => {
  const [c] = await q('SELECT id, name FROM customers WHERE id=$1 AND station_id=$2 AND deleted_at IS NULL', [req.body.customer_id, req.sid]);
  if (!c) throw new HttpError(404, 'Client introuvable');
  const token = crypto.randomBytes(24).toString('base64url'), days = req.body.days || 30;
  const [l] = await q(`INSERT INTO client_portal_links(station_id, customer_id, token_hash, created_by, expires_at) VALUES ($1,$2,$3,$4, now() + ($5 || ' days')::interval)
    RETURNING id, to_char(expires_at,'YYYY-MM-DD') AS expires_on`, [req.sid, c.id, hash(token), req.user.id, String(days)]);
  await audit(pool, req, 'client', `Lien d'espace client créé pour ${c.name} (${days} j)`, 'customers', c.id);
  const base = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  res.status(201).json({ id: l.id, customer: c.name, url: `${base}/c/${token}`, expires_on: l.expires_on });   // le jeton n'est montré qu'une seule fois
}));

r.get('/portal/links', need('customer.view', 'customer.edit'), wrap(async (req, res) => {
  const rows = await q(`SELECT l.id, l.customer_id, c.name AS customer, to_char(l.created_at,'YYYY-MM-DD') AS created_on, to_char(l.expires_at,'YYYY-MM-DD') AS expires_on,
      l.revoked_at IS NOT NULL AS revoked, (l.revoked_at IS NULL AND l.expires_at > now()) AS active, l.views, to_char(l.last_seen_at,'YYYY-MM-DD HH24:MI') AS last_seen
    FROM client_portal_links l JOIN customers c ON c.id = l.customer_id WHERE l.station_id=$1 ORDER BY l.id DESC LIMIT 200`, [req.sid]);
  res.json(rows);
}));

r.post('/portal/links/:id/revoke', need('customer.edit'), wrap(async (req, res) => {
  const [l] = await q(`UPDATE client_portal_links SET revoked_at = now() WHERE id=$1 AND station_id=$2 AND revoked_at IS NULL RETURNING id, customer_id`, [req.params.id, req.sid]);
  if (!l) throw new HttpError(404, 'Lien introuvable ou déjà révoqué');
  await audit(pool, req, 'client', "Lien d'espace client révoqué", 'customers', l.customer_id);
  res.json({ ok: true });
}));

pub.use('/portal', rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Trop de requêtes, réessayez dans une minute.' } }));
pub.get('/portal/:token', wrap(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  const tok = String(req.params.token || '');
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(tok)) throw new HttpError(404, 'Lien invalide ou expiré');
  const [l] = await q(`UPDATE client_portal_links SET views = views + 1, last_seen_at = now() WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at > now() RETURNING id, station_id, customer_id, expires_at`, [hash(tok)]);
  if (!l) throw new HttpError(404, 'Lien invalide ou expiré');
  const [c] = await q('SELECT name, kind, balance::float8 AS balance, credit_limit::float8 AS credit_limit FROM customers WHERE id=$1 AND station_id=$2', [l.customer_id, l.station_id]);
  const [st] = await q('SELECT name, phone, currency FROM stations WHERE id=$1', [l.station_id]);
  const [invoices, purchases, payments] = await Promise.all([
    q(`SELECT invoice_no, to_char(issued_on,'YYYY-MM-DD') AS issued_on, to_char(due_date,'YYYY-MM-DD') AS due_date, total_ttc::float8 AS total, amount_paid::float8 AS paid, status
         FROM invoices WHERE station_id=$1 AND customer_id=$2 AND status IN ('emise','partielle','payee') ORDER BY issued_on DESC NULLS LAST, id DESC LIMIT 30`, [l.station_id, l.customer_id]),
    q(`SELECT to_char(sa.sold_at,'YYYY-MM-DD HH24:MI') AS at, sa.invoice_no, sa.total::float8 AS total,
              (SELECT json_agg(json_build_object('product', p.name, 'qty', d.quantity::float8, 'unit', p.unit, 'amount', d.amount::float8) ORDER BY d.id)
                 FROM sale_details d JOIN products p ON p.id = d.product_id WHERE d.sale_id = sa.id) AS lines
         FROM sales sa WHERE sa.station_id=$1 AND sa.customer_id=$2 AND sa.status='valide' AND sa.sold_at >= now() - interval '90 days' ORDER BY sa.sold_at DESC LIMIT 80`, [l.station_id, l.customer_id]),
    q(`SELECT to_char(paid_at,'YYYY-MM-DD') AS at, amount::float8 AS amount, method FROM customer_payments WHERE customer_id=$1 ORDER BY paid_at DESC LIMIT 30`, [l.customer_id])
  ]);
  res.json({ customer: { name: c.name, kind: c.kind }, station: { name: st.name, phone: st.phone, currency: (st.currency || 'FCFA').trim() },
    balance: c.balance, credit_limit: c.credit_limit, available: c.credit_limit > 0 ? Math.max(0, Math.round((c.credit_limit - c.balance) * 100) / 100) : null,
    expires_on: new Date(l.expires_at).toISOString().slice(0, 10), invoices, purchases, payments });
}));

module.exports = r; module.exports.pub = pub;
