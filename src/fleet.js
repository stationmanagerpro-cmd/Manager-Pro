'use strict';
/** Cartes carburant / flottes : gestion des cartes (client entreprise, véhicule), plafonds, blocage, contrôle à la vente, relevé mensuel.
 *  Le contrôle d'une prise (fleetCheck + fleetRecordUse) est appelé DANS la transaction de la vente carburant (fuelsales.js) :
 *  une carte refusée ne produit aucune vente ; le refus et les essais de PIN ratés sont journalisés HORS transaction (fleetGuard). */
const express = require('express');
const crypto = require('crypto');
const { z } = require('zod');
const { pool, tx, HttpError, wrap, body, need, audit } = require('./core');
const { evaluateCard, consumption } = require('./fleet_logic');
const { buildFleetInvoiceLines, addDays, canInvoiceMonth } = require('./fleet_invoice_logic');

const r = express.Router();
const TZ = () => process.env.FLEET_TZ || 'Africa/Bamako';
const MAX_PIN_FAILURES = 5;
const normNumber = s => String(s || '').trim().toUpperCase().replace(/\s+/g, '');

function hashPin(pin) { const salt = crypto.randomBytes(16); return salt.toString('hex') + ':' + crypto.scryptSync(String(pin), salt, 32).toString('hex'); }
function verifyPin(pin, stored) {
  if (!stored || pin == null || pin === '') return false;
  const [s, h] = String(stored).split(':'); if (!s || !h) return false;
  const a = crypto.scryptSync(String(pin), Buffer.from(s, 'hex'), 32), b = Buffer.from(h, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Cumuls de la carte (jour et mois en heure locale), hors ventes annulées. */
async function cardUsage(c, cardId) {
  const { rows: [u] } = await c.query(
    `SELECT COALESCE(SUM(e.liters) FILTER (WHERE (e.created_at AT TIME ZONE $2)::date = (now() AT TIME ZONE $2)::date), 0) AS day_liters,
            COALESCE(SUM(e.amount) FILTER (WHERE (e.created_at AT TIME ZONE $2)::date = (now() AT TIME ZONE $2)::date), 0) AS day_amount,
            COUNT(*) FILTER (WHERE (e.created_at AT TIME ZONE $2)::date = (now() AT TIME ZONE $2)::date) AS day_count,
            COALESCE(SUM(e.liters), 0) AS month_liters, COALESCE(SUM(e.amount), 0) AS month_amount
       FROM fleet_card_events e JOIN sales s ON s.id = e.sale_id AND s.status = 'valide'
      WHERE e.card_id = $1 AND e.kind = 'use' AND date_trunc('month', e.created_at AT TIME ZONE $2) = date_trunc('month', now() AT TIME ZONE $2)`, [cardId, TZ()]);
  return { dayLiters: Number(u.day_liters), dayAmount: Number(u.day_amount), dayCount: Number(u.day_count), monthLiters: Number(u.month_liters), monthAmount: Number(u.month_amount) };
}

/** Contrôle une prise. Lève HttpError(403, …, { fleet_decline }) si refusée. Retourne { card, creditMethod, evaluation }. */
async function fleetCheck(c, { sid, number, pin, productId, liters, amount, odometer, userId }) {
  const { rows: [card] } = await c.query('SELECT * FROM fleet_cards WHERE station_id = $1 AND card_number = $2 AND deleted_at IS NULL FOR UPDATE', [sid, normNumber(number)]);
  if (!card) throw new HttpError(404, 'Carte inconnue');
  const pinOk = !card.pin_hash || verifyPin(pin, card.pin_hash);
  const usage = await cardUsage(c, card.id);
  const ev = evaluateCard({ card, timeZone: TZ(), tx: { productId, liters, amount, pinOk, odometer }, usage });
  if (!ev.ok) {
    throw new HttpError(403, 'Carte refusée : ' + ev.reasons.map(x => x.message).join(' ; '), {
      fleet_decline: { card_id: card.id, station_id: sid, codes: ev.reasons.map(x => x.code), product_id: productId, liters, amount, odometer: odometer ?? null, pin_failed: !pinOk && !!card.pin_hash, user_id: userId }
    });
  }
  const { rows: [pm] } = await c.query("SELECT code FROM payment_methods WHERE station_id = $1 AND kind = 'credit' AND active ORDER BY code LIMIT 1", [sid]);
  if (!pm) throw new HttpError(409, "Aucun moyen de paiement « crédit » actif : une vente par carte flotte est facturée au client.");
  return { card, creditMethod: pm.code, evaluation: ev, pinned: !!card.pin_hash };
}

/** Enregistre la prise (dans la même transaction que la vente), met à jour le dernier kilométrage et remet les échecs PIN à zéro. */
async function fleetRecordUse(c, f, { saleId, productId, liters, amount, odometer, userId }) {
  await c.query('INSERT INTO fleet_card_events(card_id, station_id, kind, sale_id, product_id, liters, amount, odometer_km, created_by) VALUES ($1,$2,\'use\',$3,$4,$5,$6,$7,$8)',
    [f.card.id, f.card.station_id, saleId, productId, liters, amount, odometer ?? null, userId]);
  await c.query('UPDATE fleet_cards SET pin_failures = 0, last_odometer = COALESCE($2, last_odometer), updated_at = now() WHERE id = $1 AND station_id = $3', [f.card.id, odometer ?? null, f.card.station_id]);
}

/** Journalise un refus (hors transaction) ; bloque la carte après MAX_PIN_FAILURES codes PIN erronés consécutifs. */
async function logDecline(d) {
  await pool.query('INSERT INTO fleet_card_events(card_id, station_id, kind, product_id, liters, amount, odometer_km, reasons, created_by) VALUES ($1,$2,\'decline\',$3,$4,$5,$6,$7,$8)',
    [d.card_id, d.station_id, d.product_id ?? null, d.liters ?? null, d.amount ?? null, d.odometer, d.codes, d.user_id ?? null]);
  if (d.pin_failed) {
    await pool.query(
      `UPDATE fleet_cards SET pin_failures = pin_failures + 1,
              status = CASE WHEN pin_failures + 1 >= $3 AND status = 'active' THEN 'blocked' ELSE status END,
              blocked_reason = CASE WHEN pin_failures + 1 >= $3 AND status = 'active' THEN 'Trop d''essais de PIN erronés' ELSE blocked_reason END, updated_at = now()
        WHERE id = $1 AND station_id = $2`, [d.card_id, d.station_id, MAX_PIN_FAILURES]);
  }
}
/** Enveloppe la transaction de vente : journalise le refus de carte puis relance l'erreur telle quelle. */
async function fleetGuard(promise) {
  try { return await promise; }
  catch (e) { if (e && e.details && e.details.fleet_decline) await logDecline(e.details.fleet_decline).catch(err => console.warn('[fleet] journal du refus impossible :', err.message)); throw e; }
}

// ---------- Routes ----------
const num = z.coerce.number().positive().nullable().optional();
const limits = {
  max_liters_tx: num, max_amount_tx: num, max_liters_day: num, max_amount_day: num, max_liters_month: num, max_amount_month: num,
  max_tx_day: z.coerce.number().int().positive().nullable().optional()
};
const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Heure au format HH:MM').nullable().optional();
const rules = {
  allowed_product_ids: z.array(z.coerce.number().int().positive()).max(20).optional(),
  allowed_days: z.array(z.coerce.number().int().min(1).max(7)).max(7).optional(),
  hours_from: timeStr, hours_to: timeStr, requires_odometer: z.boolean().optional(),
  expires_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  driver_name: z.string().trim().max(120).nullable().optional()
};
const pinSchema = z.string().regex(/^\d{4,6}$/, 'Le PIN doit comporter 4 à 6 chiffres');
const FIELDS = ['max_liters_tx', 'max_amount_tx', 'max_liters_day', 'max_amount_day', 'max_liters_month', 'max_amount_month', 'max_tx_day', 'allowed_product_ids', 'allowed_days', 'hours_from', 'hours_to', 'requires_odometer', 'expires_on', 'driver_name', 'label'];

function checkHours(b) { if ((b.hours_from == null) !== (b.hours_to == null) && (b.hours_from !== undefined || b.hours_to !== undefined)) throw new HttpError(400, 'Renseignez l\'heure de début ET l\'heure de fin'); }
async function checkProducts(sid, ids) {
  if (!ids || !ids.length) return;
  const { rows } = await pool.query('SELECT id FROM products WHERE station_id = $1 AND id = ANY($2) AND deleted_at IS NULL', [sid, ids]);
  if (rows.length !== new Set(ids).size) throw new HttpError(400, 'Produit inconnu dans la liste des produits autorisés');
}
const publicCard = c => { const { pin_hash, ...rest } = c; return { ...rest, has_pin: !!pin_hash }; };

r.get('/fleet/cards', need('customer.view', 'sale.create'), wrap(async (req, res) => {
  const params = [req.sid]; let w = 'c.station_id = $1 AND c.deleted_at IS NULL';
  if (req.query.customer_id) { params.push(Number(req.query.customer_id)); w += ` AND c.customer_id = $${params.length}`; }
  if (req.query.status) { params.push(String(req.query.status)); w += ` AND c.status = $${params.length}`; }
  // Période optionnelle (du … au …, jours inclus, heure locale FLEET_TZ) : ajoute `period` à chaque carte (prises, litres, montant, refus).
  // Mêmes règles que le relevé mensuel : seules les prises dont la vente est valide sont comptées. active_only=1 masque les cartes sans activité.
  const DAY = /^\d{4}-\d{2}-\d{2}$/, from = String(req.query.from || ''), to = String(req.query.to || '');
  const ranged = !!(from || to);
  if (ranged) {
    if (!DAY.test(from) || !DAY.test(to)) throw new HttpError(400, 'Période invalide : renseignez la date de début ET la date de fin (AAAA-MM-JJ)');
    if (from > to) throw new HttpError(400, 'La date de début ne peut pas être postérieure à la date de fin');
  }
  const { rows } = await pool.query(
    `SELECT c.*, cu.name AS customer_name FROM fleet_cards c JOIN customers cu ON cu.id = c.customer_id AND cu.station_id = c.station_id WHERE ${w} ORDER BY cu.name, c.label LIMIT 500`, params);
  let byCard = new Map();
  if (ranged) {
    const { rows: pr } = await pool.query(
      `SELECT e.card_id,
              COUNT(*) FILTER (WHERE e.kind = 'use' AND s.id IS NOT NULL)::int AS uses,
              COALESCE(SUM(e.liters) FILTER (WHERE e.kind = 'use' AND s.id IS NOT NULL), 0) AS liters,
              COALESCE(SUM(e.amount) FILTER (WHERE e.kind = 'use' AND s.id IS NOT NULL), 0) AS amount,
              COUNT(*) FILTER (WHERE e.kind = 'decline')::int AS declines
         FROM fleet_card_events e
         JOIN fleet_cards c ON c.id = e.card_id AND c.station_id = $1
         LEFT JOIN sales s ON s.id = e.sale_id AND s.status = 'valide'
        WHERE e.kind IN ('use', 'decline') AND (e.created_at AT TIME ZONE $4)::date BETWEEN $2::date AND $3::date
        GROUP BY e.card_id`, [req.sid, from, to, TZ()]);
    byCard = new Map(pr.map(x => [x.card_id, { uses: x.uses, liters: Math.round(Number(x.liters) * 1000) / 1000, amount: Math.round(Number(x.amount) * 100) / 100, declines: x.declines }]));
  }
  const out = [];
  for (const c of rows) {
    const period = ranged ? { from, to, ...(byCard.get(c.id) || { uses: 0, liters: 0, amount: 0, declines: 0 }) } : undefined;
    if (ranged && String(req.query.active_only) === '1' && !period.uses && !period.declines) continue;
    out.push({ ...publicCard(c), usage: await cardUsage(pool, c.id), ...(period ? { period } : {}) });
  }
  res.json(out);
}));

r.post('/fleet/cards', need('customer.edit'), body(z.object({
  customer_id: z.coerce.number().int().positive(), label: z.string().trim().min(1).max(80), card_number: z.string().trim().min(4).max(40).optional(),
  pin: pinSchema.optional(), ...limits, ...rules
})), wrap(async (req, res) => {
  const b = req.body; checkHours(b); await checkProducts(req.sid, b.allowed_product_ids);
  const { rows: [cu] } = await pool.query('SELECT id, name FROM customers WHERE id = $1 AND station_id = $2 AND deleted_at IS NULL', [b.customer_id, req.sid]);
  if (!cu) throw new HttpError(404, 'Client introuvable');
  const number = b.card_number ? normNumber(b.card_number) : 'FC' + crypto.randomInt(10000000, 99999999);
  const { rows: [card] } = await pool.query(
    `INSERT INTO fleet_cards(station_id, customer_id, card_number, label, driver_name, pin_hash, requires_odometer, allowed_product_ids, allowed_days, hours_from, hours_to, expires_on,
        max_liters_tx, max_amount_tx, max_liters_day, max_amount_day, max_liters_month, max_amount_month, max_tx_day, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
     ON CONFLICT (station_id, card_number) DO NOTHING RETURNING *`,
    [req.sid, cu.id, number, b.label, b.driver_name ?? null, b.pin ? hashPin(b.pin) : null, !!b.requires_odometer, b.allowed_product_ids || [], b.allowed_days || [], b.hours_from ?? null, b.hours_to ?? null, b.expires_on ?? null,
     b.max_liters_tx ?? null, b.max_amount_tx ?? null, b.max_liters_day ?? null, b.max_amount_day ?? null, b.max_liters_month ?? null, b.max_amount_month ?? null, b.max_tx_day ?? null, req.user.id]);
  if (!card) throw new HttpError(409, 'Ce numéro de carte existe déjà');
  await pool.query('INSERT INTO fleet_card_events(card_id, station_id, kind, created_by) VALUES ($1,$2,\'create\',$3)', [card.id, req.sid, req.user.id]);
  await audit(pool, req, 'clients', `Carte flotte ${card.card_number} (${card.label}) créée pour ${cu.name}`, 'fleet_cards', card.id);
  res.status(201).json(publicCard(card));
}));

r.patch('/fleet/cards/:id', need('customer.edit'), body(z.object({ label: z.string().trim().min(1).max(80).optional(), pin: pinSchema.optional(), clear_pin: z.boolean().optional(), ...limits, ...rules })), wrap(async (req, res) => {
  const b = req.body; checkHours(b); await checkProducts(req.sid, b.allowed_product_ids);
  const sets = [], vals = [req.params.id, req.sid];
  for (const f of FIELDS) if (b[f] !== undefined) { vals.push(b[f]); sets.push(`${f} = $${vals.length}`); }
  if (b.pin) { vals.push(hashPin(b.pin)); sets.push(`pin_hash = $${vals.length}`, 'pin_failures = 0'); }
  if (b.clear_pin) sets.push('pin_hash = NULL', 'pin_failures = 0');
  if (!sets.length) throw new HttpError(400, 'Aucune modification');
  const { rows: [card] } = await pool.query(`UPDATE fleet_cards SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 AND station_id = $2 AND deleted_at IS NULL RETURNING *`, vals);
  if (!card) throw new HttpError(404, 'Carte introuvable');
  await pool.query('INSERT INTO fleet_card_events(card_id, station_id, kind, note, created_by) VALUES ($1,$2,\'update\',$3,$4)', [card.id, req.sid, Object.keys(b).filter(k => k !== 'pin').join(', ') + (b.pin ? ', pin' : ''), req.user.id]);
  await audit(pool, req, 'clients', `Carte flotte ${card.card_number} modifiée`, 'fleet_cards', card.id);
  res.json(publicCard(card));
}));

r.post('/fleet/cards/:id/block', need('customer.edit'), body(z.object({ status: z.enum(['blocked', 'lost']).default('blocked'), reason: z.string().trim().max(200).optional() })), wrap(async (req, res) => {
  const { rows: [card] } = await pool.query(
    'UPDATE fleet_cards SET status = $3, blocked_reason = $4, updated_at = now() WHERE id = $1 AND station_id = $2 AND deleted_at IS NULL RETURNING *', [req.params.id, req.sid, req.body.status, req.body.reason || null]);
  if (!card) throw new HttpError(404, 'Carte introuvable');
  await pool.query('INSERT INTO fleet_card_events(card_id, station_id, kind, note, created_by) VALUES ($1,$2,\'block\',$3,$4)', [card.id, req.sid, `${req.body.status}${req.body.reason ? ' : ' + req.body.reason : ''}`, req.user.id]);
  await audit(pool, req, 'clients', `Carte flotte ${card.card_number} ${req.body.status === 'lost' ? 'déclarée perdue' : 'bloquée'}`, 'fleet_cards', card.id);
  res.json(publicCard(card));
}));

r.post('/fleet/cards/:id/unblock', need('customer.edit'), wrap(async (req, res) => {
  const { rows: [card] } = await pool.query(
    "UPDATE fleet_cards SET status = 'active', blocked_reason = NULL, pin_failures = 0, updated_at = now() WHERE id = $1 AND station_id = $2 AND deleted_at IS NULL AND status IN ('blocked','lost') RETURNING *", [req.params.id, req.sid]);
  if (!card) throw new HttpError(404, 'Carte introuvable ou déjà active');
  await pool.query('INSERT INTO fleet_card_events(card_id, station_id, kind, created_by) VALUES ($1,$2,\'unblock\',$3)', [card.id, req.sid, req.user.id]);
  await audit(pool, req, 'clients', `Carte flotte ${card.card_number} réactivée`, 'fleet_cards', card.id);
  res.json(publicCard(card));
}));

// Pré-contrôle au pistolet, sans vente : la prise n'est pas enregistrée ; un refus est journalisé (et compte pour le PIN).
r.post('/fleet/authorize', need('sale.create'), body(z.object({
  card_number: z.string().trim().min(1).max(40), pin: z.string().max(12).optional(), product_id: z.coerce.number().int().positive(),
  liters: z.coerce.number().positive(), amount: z.coerce.number().positive().optional(), odometer_km: z.coerce.number().min(0).optional()
})), wrap(async (req, res) => {
  const b = req.body;
  const { rows: [p] } = await pool.query('SELECT sell_price FROM products WHERE id = $1 AND station_id = $2 AND deleted_at IS NULL', [b.product_id, req.sid]);
  if (!p) throw new HttpError(404, 'Produit introuvable');
  const amount = b.amount ?? Math.round(b.liters * Number(p.sell_price));
  let result;
  try {
    result = await fleetGuard(tx(async c => {
      const f = await fleetCheck(c, { sid: req.sid, number: b.card_number, pin: b.pin, productId: b.product_id, liters: b.liters, amount, odometer: b.odometer_km, userId: req.user.id });
      return { authorized: true, card: { id: f.card.id, label: f.card.label, customer_id: f.card.customer_id }, amount, remaining: f.evaluation.remaining };
    }));
  } catch (e) {
    if (e instanceof HttpError && e.details && e.details.fleet_decline) return res.json({ authorized: false, reasons: e.details.fleet_decline.codes, message: e.message });
    throw e;
  }
  res.json(result);
}));

r.get('/fleet/cards/:id/events', need('customer.view'), wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT e.id, e.kind, e.created_at, e.liters, e.amount, e.odometer_km, e.reasons, e.note, e.sale_id, p.name AS product_name
       FROM fleet_card_events e JOIN fleet_cards c ON c.id = e.card_id LEFT JOIN products p ON p.id = e.product_id
      WHERE c.id = $1 AND c.station_id = $2 ORDER BY e.created_at DESC, e.id DESC LIMIT 100`, [req.params.id, req.sid]);
  res.json(rows);
}));

// Relevé mensuel d'un client : prises par carte (hors ventes annulées), totaux et consommation L/100 km.
r.get('/fleet/statement', need('customer.view', 'report.view'), wrap(async (req, res) => {
  const month = String(req.query.month || new Date().toISOString().slice(0, 7));
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new HttpError(400, 'Mois invalide (AAAA-MM)');
  const customerId = Number(req.query.customer_id); if (!customerId) throw new HttpError(400, 'Client requis');
  const { rows: [cu] } = await pool.query('SELECT id, name FROM customers WHERE id = $1 AND station_id = $2', [customerId, req.sid]);
  if (!cu) throw new HttpError(404, 'Client introuvable');
  const { rows } = await pool.query(
    `SELECT e.created_at, c.id AS card_id, c.card_number, c.label, c.driver_name, p.name AS product_name, e.liters, e.amount, e.odometer_km, e.sale_id
       FROM fleet_card_events e JOIN fleet_cards c ON c.id = e.card_id JOIN sales s ON s.id = e.sale_id AND s.status = 'valide' LEFT JOIN products p ON p.id = e.product_id
      WHERE c.station_id = $1 AND c.customer_id = $2 AND e.kind = 'use' AND date_trunc('month', e.created_at AT TIME ZONE $4) = date_trunc('month', ($3 || '-01')::date)
      ORDER BY c.label, e.created_at`, [req.sid, customerId, month, TZ()]);
  const byCard = new Map();
  for (const x of rows) {
    if (!byCard.has(x.card_id)) byCard.set(x.card_id, { card_id: x.card_id, card_number: x.card_number, label: x.label, driver_name: x.driver_name, liters: 0, amount: 0, lines: [] });
    const g = byCard.get(x.card_id); g.liters += Number(x.liters); g.amount += Number(x.amount);
    g.lines.push({ date: x.created_at, product: x.product_name, liters: Number(x.liters), amount: Number(x.amount), odometer_km: x.odometer_km == null ? null : Number(x.odometer_km), sale_id: x.sale_id });
  }
  const cards = [...byCard.values()].map(g => ({ ...g, liters: Math.round(g.liters * 1000) / 1000, amount: Math.round(g.amount * 100) / 100, consumption: consumption(g.lines.map(l => ({ liters: l.liters, odometer: l.odometer_km }))) }));
  const total = { liters: Math.round(cards.reduce((a, c) => a + c.liters, 0) * 1000) / 1000, amount: Math.round(cards.reduce((a, c) => a + c.amount, 0) * 100) / 100, transactions: rows.length };
  if (req.query.format === 'csv') {
    const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const csv = ['Carte;Véhicule;Date;Produit;Litres;Montant;Kilométrage'].concat(cards.flatMap(c => c.lines.map(l => [q(c.card_number), q(c.label), q(new Date(l.date).toISOString().slice(0, 16).replace('T', ' ')), q(l.product), String(l.liters).replace('.', ','), String(l.amount).replace('.', ','), l.odometer_km ?? ''].join(';')))).join('\r\n');
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="releve-flotte-${month}.csv"` });
    return res.send('﻿' + csv);
  }
  res.json({ customer: cu, month, cards, total });
}));

/** Facture mensuelle flotte : une facture par client et par mois (prises validées non encore facturées), une ligne par carte et produit.
 *  Les ventes sont déjà en créance (solde client) : la facture ne crée pas de chiffre d'affaires (source = 'fleet'), le paiement baisse le solde. */
r.post('/fleet/invoices/generate', need('sale.create', 'customer.edit', 'finance.view'), body(z.object({
  customer_id: z.number().int().positive(),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  due_days: z.number().int().min(0).max(120).optional(),
  force: z.boolean().optional()
})), wrap(async (req, res) => {
  const { assertBilling, nextInvoiceNo } = require('./billing');
  await assertBilling(req);
  const b = req.body, today = new Date().toISOString().slice(0, 10);
  const chk = canInvoiceMonth(b.month, today, b.force); if (!chk.ok) throw new HttpError(400, chk.reason);
  const inv = await tx(async c => {
    const { rows: [cu] } = await c.query('SELECT id, name FROM customers WHERE id=$1 AND station_id=$2 AND deleted_at IS NULL FOR UPDATE', [b.customer_id, req.sid]);
    if (!cu) throw new HttpError(404, 'Client introuvable');
    const { rows: dup } = await c.query(`SELECT invoice_no FROM invoices WHERE station_id=$1 AND customer_id=$2 AND source='fleet' AND period_month=$3 AND status <> 'annulee'`, [req.sid, b.customer_id, b.month]);
    if (dup.length) throw new HttpError(409, `Le mois ${b.month} est déjà facturé (${dup[0].invoice_no}). Annulez cette facture pour la régénérer.`);
    const { rows: events } = await c.query(
      `SELECT e.id, e.card_id, e.product_id, e.liters, e.amount, k.label, k.card_number, p.name AS product_name
         FROM fleet_card_events e JOIN fleet_cards k ON k.id = e.card_id JOIN sales s ON s.id = e.sale_id AND s.status = 'valide' LEFT JOIN products p ON p.id = e.product_id
        WHERE e.station_id = $1 AND k.customer_id = $2 AND e.kind = 'use' AND e.invoice_id IS NULL
          AND date_trunc('month', e.created_at AT TIME ZONE $4) = date_trunc('month', ($3 || '-01')::date)
        ORDER BY k.label, e.created_at FOR UPDATE OF e`, [req.sid, b.customer_id, b.month, TZ()]);
    if (!events.length) throw new HttpError(409, 'Aucune prise carte à facturer pour ce client sur ce mois.');
    const { lines, total } = buildFleetInvoiceLines(events);
    const no = await nextInvoiceNo(c, req.sid);
    const due = addDays(today, b.due_days == null ? 30 : b.due_days);
    const { rows: [row] } = await c.query(
      `INSERT INTO invoices(station_id, customer_id, invoice_no, status, issued_on, due_date, tax_rate, total_ht, total_tax, total_ttc, notes, created_by, source, period_month)
       VALUES ($1,$2,$3,'emise',CURRENT_DATE,$4,0,$5,0,$5,$6,$7,'fleet',$8) RETURNING *`,
      [req.sid, b.customer_id, no, due, total, `Relevé carburant flotte ${b.month}`, req.user.id, b.month]);
    for (const l of lines) {
      await c.query('INSERT INTO invoice_lines(invoice_id, product_id, description, quantity, unit_price, amount) VALUES ($1,$2,$3,$4,$5,$6)', [row.id, l.product_id, l.description, l.quantity, l.unit_price, l.amount]);
    }
    await c.query('UPDATE fleet_card_events SET invoice_id = $1 WHERE id = ANY($2::bigint[]) AND station_id = $3', [row.id, events.map(e => e.id), req.sid]);
    await audit(c, req, 'flotte', `Facture flotte ${no} (${cu.name}, ${b.month})`, 'invoices', row.id, null, { total, events: events.length });
    return { ...row, lines_count: lines.length, events_count: events.length };
  });
  res.status(201).json(inv);
}));

// Aperçu des mois à facturer : clients flotte ayant des prises non facturées par mois terminé.
r.get('/fleet/invoices/pending', need('sale.create', 'customer.edit', 'finance.view'), wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT k.customer_id, cu.name AS customer_name, to_char(date_trunc('month', e.created_at AT TIME ZONE $2), 'YYYY-MM') AS month,
            COUNT(*)::int AS transactions, SUM(e.liters) AS liters, SUM(e.amount) AS amount
       FROM fleet_card_events e JOIN fleet_cards k ON k.id = e.card_id JOIN customers cu ON cu.id = k.customer_id
       JOIN sales s ON s.id = e.sale_id AND s.status = 'valide'
      WHERE e.station_id = $1 AND e.kind = 'use' AND e.invoice_id IS NULL
        AND date_trunc('month', e.created_at AT TIME ZONE $2) < date_trunc('month', now() AT TIME ZONE $2)
      GROUP BY 1,2,3 ORDER BY 3, 2`, [req.sid, TZ()]);
  res.json(rows);
}));

module.exports = { r, fleetCheck, fleetRecordUse, fleetGuard, logDecline, hashPin, verifyPin, MAX_PIN_FAILURES };
