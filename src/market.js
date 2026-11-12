'use strict';
/** Fonctions « marché » (voir migrations/105_fonctions_marche.sql et src/market_logic.js) :
 *  GET  /money/sales-reconcile        rapprochement relevé Mobile Money ↔ paiements Mobile Money des ventes (lecture seule)
 *  GET/PUT /loyalty/settings · GET /loyalty/accounts · /loyalty/lookup · POST /loyalty/earn · /redeem · /adjust · /notify   fidélité par téléphone ou plaque
 *  GET  /risk/shifts                  score de risque (expliqué) des quarts clôturés
 *  GET  /stock/forecast               prévision de rupture et date de commande conseillée
 *  GET/POST /prices/board             prix du jour : tous les carburants, marges, changement groupé daté et historisé */
const express = require('express');
const { z } = require('zod');
const { pool, tx, HttpError, wrap, body, need, audit, canCost } = require('./core');
const { swallow } = require('./safe');
const { normalizePhone } = require('./phone');
const { matchLines } = require('./money_match_logic');
const { scoreShift, forecastProduct, r2, isoDay } = require('./market_logic');

const r = express.Router();
const q = async (sql, p) => (await pool.query(sql, p)).rows;
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const today = () => isoDay(new Date());
const addDays = (d, n) => isoDay(new Date(new Date(d + 'T00:00:00Z').getTime() + n * 864e5));
const range = req => {
  const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? req.query.to : today();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : addDays(to, -6);
  if (from > to) throw new HttpError(400, 'La date de début est après la date de fin');
  if ((new Date(to) - new Date(from)) / 864e5 > 120) throw new HttpError(400, 'Période maximale : 120 jours');
  return { from, to };
};

// ───────────────────────── 2. Rapprochement relevé Mobile Money ↔ ventes ─────────────────────────
r.get('/money/sales-reconcile', need('money.manage', 'finance.view', 'finance.report'), wrap(async (req, res) => {
  const accountId = Number(req.query.account_id);
  if (!Number.isInteger(accountId) || accountId <= 0) throw new HttpError(400, 'account_id requis (compte Mobile Money)');
  const [acc] = await q('SELECT id, name FROM money_accounts WHERE id=$1 AND station_id=$2', [accountId, req.sid]);
  if (!acc) throw new HttpError(404, 'Compte introuvable');
  const { from, to } = range(req);
  const methods = String(req.query.methods || 'mobile_money').split(',').map(s => s.trim()).filter(Boolean).slice(0, 6);
  const [lines, pays] = await Promise.all([
    q(`SELECT id, to_char(line_date,'YYYY-MM-DD') AS line_date, amount::float8 AS amount, reference, label FROM money_statement_lines
        WHERE station_id=$1 AND account_id=$2 AND amount > 0 AND status <> 'ignoree' AND line_date BETWEEN $3::date - 1 AND $4::date + 1`, [req.sid, accountId, from, to]),
    q(`SELECT p.id, to_char(p.paid_at,'YYYY-MM-DD') AS moved_on, p.amount::float8 AS amount, p.reference, p.method, p.shift_id, sh.number AS shift_number,
              sa.invoice_no, sa.employee_id, NULLIF(trim(coalesce(e.first_name,'') || ' ' || coalesce(e.last_name,'')), '') AS employee
         FROM payments p LEFT JOIN sales sa ON sa.id = p.sale_id LEFT JOIN employees e ON e.id = sa.employee_id LEFT JOIN shifts sh ON sh.id = p.shift_id
        WHERE p.station_id=$1 AND p.method = ANY($2::text[]) AND p.amount > 0 AND (sa.id IS NULL OR sa.status = 'valide')
          AND p.paid_at::date BETWEEN $3::date AND $4::date ORDER BY p.paid_at`, [req.sid, methods, from, to])
  ]);
  const m = matchLines(lines.map(l => ({ id: l.id, line_date: l.line_date, amount: l.amount, reference: l.reference })),
    pays.map(p => ({ id: p.id, moved_on: p.moved_on, amount: p.amount, reference: p.reference })), { maxDays: 1 });
  const paidOk = new Set(m.matches.map(x => x.movement_id)), lineOk = new Set(m.matches.map(x => x.line_id));
  const declaredNotReceived = pays.filter(p => !paidOk.has(p.id));
  const receivedNotDeclared = lines.filter(l => !lineOk.has(l.id) && l.line_date >= from && l.line_date <= to);
  const sum = a => r2(a.reduce((s, x) => s + x.amount, 0));
  const days = []; for (let d = from; d <= to; d = addDays(d, 1)) {
    const dec = pays.filter(p => p.moved_on === d), rec = lines.filter(l => l.line_date === d);
    days.push({ day: d, declared: sum(dec), received: sum(rec), gap: r2(sum(rec) - sum(dec)), declared_not_received: sum(declaredNotReceived.filter(p => p.moved_on === d)) });
  }
  const byEmp = new Map();
  for (const p of declaredNotReceived) { const k = p.employee || 'Non attribué'; const e = byEmp.get(k) || { employee: k, count: 0, amount: 0 }; e.count++; e.amount = r2(e.amount + p.amount); byEmp.set(k, e); }
  res.json({
    account: acc, from, to, methods,
    summary: { declared: sum(pays), received: sum(lines.filter(l => l.line_date >= from && l.line_date <= to)), matched_count: m.matches.length,
      declared_not_received_count: declaredNotReceived.length, declared_not_received: sum(declaredNotReceived),
      received_not_declared_count: receivedNotDeclared.length, received_not_declared: sum(receivedNotDeclared) },
    declared_not_received: declaredNotReceived, received_not_declared: receivedNotDeclared, by_day: days,
    by_employee: [...byEmp.values()].sort((a, b) => b.amount - a.amount)
  });
}));

// ───────────────────────── 3. Fidélité par téléphone ou plaque ─────────────────────────
const LOY_DEFAULT = { enabled: false, earn_per_amount: 1000, point_value: 10, min_redeem: 100, fuel_only: true };
async function loyaltySettings(db, sid) {
  const { rows: [s] } = await db.query('SELECT enabled, earn_per_amount::float8 AS earn_per_amount, point_value::float8 AS point_value, min_redeem, fuel_only FROM loyalty_settings WHERE station_id=$1', [sid]);
  return s || { ...LOY_DEFAULT };
}
const cleanPlate = p => { const s = String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); if (s && (s.length < 3 || s.length > 12)) throw new HttpError(400, 'Plaque invalide (3 à 12 caractères)'); return s || null; };
const cleanPhone = p => { const s = String(p || '').trim(); if (!s) return null; const n = normalizePhone(s); if (n.replace(/\D/g, '').length < 8) throw new HttpError(400, 'Numéro de téléphone invalide'); return n; };
async function findAccount(db, sid, phone, plate, lock) {
  const L = lock ? ' FOR UPDATE' : '';
  if (phone) { const { rows: [a] } = await db.query('SELECT * FROM loyalty_accounts WHERE station_id=$1 AND phone=$2 AND deleted_at IS NULL' + L, [sid, phone]); if (a) return a; }
  if (plate) { const { rows: [a] } = await db.query('SELECT * FROM loyalty_accounts WHERE station_id=$1 AND plate=$2 AND deleted_at IS NULL' + L, [sid, plate]); if (a) return a; }
  return null;
}
const loyAnswer = (a, s) => ({ id: a.id, phone: a.phone, plate: a.plate, name: a.name, points: a.points, lifetime_points: a.lifetime_points, value: r2(a.points * s.point_value) });
const LOY_VIEW = ['customer.view', 'sale.create'];

r.get('/loyalty/settings', need(...LOY_VIEW), wrap(async (req, res) => res.json(await loyaltySettings(pool, req.sid))));
r.put('/loyalty/settings', need('settings.edit'), body(z.object({
  enabled: z.boolean(), earn_per_amount: z.number().positive().max(1e9), point_value: z.number().min(0).max(1e6),
  min_redeem: z.number().int().min(1).max(1e6), fuel_only: z.boolean()
}).strict()), wrap(async (req, res) => {
  const b = req.body;
  await pool.query(`INSERT INTO loyalty_settings(station_id, enabled, earn_per_amount, point_value, min_redeem, fuel_only, updated_at) VALUES ($1,$2,$3,$4,$5,$6,now())
    ON CONFLICT (station_id) DO UPDATE SET enabled=$2, earn_per_amount=$3, point_value=$4, min_redeem=$5, fuel_only=$6, updated_at=now()`,
    [req.sid, b.enabled, b.earn_per_amount, b.point_value, b.min_redeem, b.fuel_only]);
  await audit(pool, req, 'fidelite', 'Réglages de fidélité modifiés', 'loyalty_settings', req.sid, null, b);
  res.json(await loyaltySettings(pool, req.sid));
}));

r.get('/loyalty/accounts', need(...LOY_VIEW), wrap(async (req, res) => {
  const s = await loyaltySettings(pool, req.sid), t = String(req.query.search || '').trim();
  const rows = await q(`SELECT * FROM loyalty_accounts WHERE station_id=$1 AND deleted_at IS NULL
      AND ($2 = '' OR coalesce(phone,'') ILIKE '%'||$2||'%' OR coalesce(plate,'') ILIKE '%'||upper(regexp_replace($2,'[^A-Za-z0-9]','','g'))||'%' OR coalesce(name,'') ILIKE '%'||$2||'%')
    ORDER BY updated_at DESC, id DESC LIMIT 200`, [req.sid, t]);
  const [tot] = await q('SELECT COUNT(*)::int AS n, COALESCE(SUM(points),0)::int AS points FROM loyalty_accounts WHERE station_id=$1 AND deleted_at IS NULL', [req.sid]);
  res.json({ settings: s, accounts: rows.map(a => loyAnswer(a, s)), total_accounts: tot.n, total_points: tot.points, total_value: r2(tot.points * s.point_value) });
}));
r.get('/loyalty/lookup', need(...LOY_VIEW), wrap(async (req, res) => {
  const s = await loyaltySettings(pool, req.sid);
  const a = await findAccount(pool, req.sid, cleanPhone(req.query.phone), cleanPlate(req.query.plate), false);
  res.json({ enabled: s.enabled, account: a ? loyAnswer(a, s) : null });
}));
r.get('/loyalty/accounts/:id', need(...LOY_VIEW), wrap(async (req, res) => {
  const s = await loyaltySettings(pool, req.sid);
  const [a] = await q('SELECT * FROM loyalty_accounts WHERE id=$1 AND station_id=$2 AND deleted_at IS NULL', [req.params.id, req.sid]);
  if (!a) throw new HttpError(404, 'Compte de fidélité introuvable');
  const events = await q(`SELECT e.id, e.kind, e.points, e.amount, e.sale_id, e.note, e.created_at, u.login FROM loyalty_events e LEFT JOIN users u ON u.id=e.created_by
    WHERE e.account_id=$1 ORDER BY e.id DESC LIMIT 60`, [a.id]);
  res.json({ account: loyAnswer(a, s), events });
}));

r.post('/loyalty/earn', need('sale.create'), body(z.object({
  sale_id: z.number().int().positive(), phone: z.string().max(30).optional().nullable(), plate: z.string().max(20).optional().nullable(), name: z.string().trim().max(120).optional().nullable()
}).strict()), wrap(async (req, res) => {
  const phone = cleanPhone(req.body.phone), plate = cleanPlate(req.body.plate);
  if (!phone && !plate) throw new HttpError(400, 'Indiquez un téléphone ou une plaque');
  const out = await tx(async c => {
    const s = await loyaltySettings(c, req.sid);
    if (!s.enabled) throw new HttpError(409, 'Le programme de fidélité est désactivé (Réglages › Fidélité)');
    const { rows: [sale] } = await c.query('SELECT id, total::float8 AS total, status FROM sales WHERE id=$1 AND station_id=$2', [req.body.sale_id, req.sid]);
    if (!sale) throw new HttpError(404, 'Vente introuvable');
    if (sale.status !== 'valide') throw new HttpError(409, 'Cette vente est annulée : aucun point');
    const { rows: [done] } = await c.query(`SELECT a.* FROM loyalty_events e JOIN loyalty_accounts a ON a.id = e.account_id WHERE e.sale_id=$1 AND e.kind='gain'`, [sale.id]);
    if (done) return { already: true, points_earned: 0, account: loyAnswer(done, s) };
    const { rows: [m] } = await c.query(`SELECT COALESCE(SUM(d.amount) FILTER (WHERE cat.has_meter),0)::float8 AS fuel, COALESCE(SUM(d.amount),0)::float8 AS tot
      FROM sale_details d JOIN products p ON p.id=d.product_id JOIN categories cat ON cat.id=p.category_id WHERE d.sale_id=$1`, [sale.id]);
    const basis = s.fuel_only ? m.fuel : (m.tot || sale.total), points = Math.floor(basis / s.earn_per_amount);
    let a = await findAccount(c, req.sid, phone, plate, true);
    if (!a) {
      const ins = await c.query(`INSERT INTO loyalty_accounts(station_id, phone, plate, name) VALUES ($1,$2,$3,$4) RETURNING *`, [req.sid, phone, plate, req.body.name || null]);
      a = ins.rows[0];
    } else {   // complète la fiche (téléphone ou plaque manquants, nom) sans écraser
      const up = await c.query(`UPDATE loyalty_accounts SET phone = COALESCE(phone, $2), plate = COALESCE(plate, $3), name = COALESCE(name, $4), updated_at = now() WHERE id=$1 RETURNING *`,
        [a.id, phone && !(await findAccount(c, req.sid, phone, null, false)) ? phone : null, plate && !(await findAccount(c, req.sid, null, plate, false)) ? plate : null, req.body.name || null]);
      a = up.rows[0];
    }
    if (points > 0) {
      const ev = await c.query(`INSERT INTO loyalty_events(station_id, account_id, kind, points, amount, sale_id, created_by) VALUES ($1,$2,'gain',$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING id`,
        [req.sid, a.id, points, basis, sale.id, req.user.id]);
      if (ev.rowCount) a = (await c.query('UPDATE loyalty_accounts SET points = points + $2, lifetime_points = lifetime_points + $2, updated_at = now() WHERE id=$1 RETURNING *', [a.id, points])).rows[0];
    }
    return { already: false, points_earned: points, basis: r2(basis), account: loyAnswer(a, s) };
  });
  res.status(201).json(out);
}));

r.post('/loyalty/accounts/:id/redeem', need('sale.create'), body(z.object({ points: z.number().int().positive().max(1e7), note: z.string().trim().max(200).optional().nullable() }).strict()), wrap(async (req, res) => {
  const out = await tx(async c => {
    const s = await loyaltySettings(c, req.sid);
    const { rows: [a] } = await c.query('SELECT * FROM loyalty_accounts WHERE id=$1 AND station_id=$2 AND deleted_at IS NULL FOR UPDATE', [req.params.id, req.sid]);
    if (!a) throw new HttpError(404, 'Compte de fidélité introuvable');
    if (req.body.points < s.min_redeem) throw new HttpError(409, `Minimum d'utilisation : ${s.min_redeem} points`);
    if (req.body.points > a.points) throw new HttpError(409, `Solde insuffisant : ${a.points} point(s)`);
    const value = r2(req.body.points * s.point_value);
    const { rows: [n] } = await c.query('UPDATE loyalty_accounts SET points = points - $2, updated_at = now() WHERE id=$1 RETURNING *', [a.id, req.body.points]);
    await c.query(`INSERT INTO loyalty_events(station_id, account_id, kind, points, amount, note, created_by) VALUES ($1,$2,'utilisation',$3,$4,$5,$6)`, [req.sid, a.id, -req.body.points, value, req.body.note || null, req.user.id]);
    await audit(c, req, 'fidelite', `Utilisation de ${req.body.points} points (${value})`, 'loyalty_accounts', a.id, { points: a.points }, { points: n.points });
    return { value, account: loyAnswer(n, s) };
  });
  res.json(out);
}));

r.post('/loyalty/accounts/:id/adjust', need('customer.edit'), body(z.object({ points: z.number().int().refine(v => v !== 0, 'Points nuls'), note: z.string().trim().min(3, 'Motif obligatoire').max(200) }).strict()), wrap(async (req, res) => {
  const out = await tx(async c => {
    const s = await loyaltySettings(c, req.sid);
    const { rows: [a] } = await c.query('SELECT * FROM loyalty_accounts WHERE id=$1 AND station_id=$2 AND deleted_at IS NULL FOR UPDATE', [req.params.id, req.sid]);
    if (!a) throw new HttpError(404, 'Compte de fidélité introuvable');
    if (a.points + req.body.points < 0) throw new HttpError(409, 'Le solde ne peut pas devenir négatif');
    const { rows: [n] } = await c.query('UPDATE loyalty_accounts SET points = points + $2, lifetime_points = lifetime_points + GREATEST($2,0), updated_at = now() WHERE id=$1 RETURNING *', [a.id, req.body.points]);
    await c.query(`INSERT INTO loyalty_events(station_id, account_id, kind, points, note, created_by) VALUES ($1,$2,'ajustement',$3,$4,$5)`, [req.sid, a.id, req.body.points, req.body.note, req.user.id]);
    await audit(c, req, 'fidelite', `Ajustement de ${req.body.points} points : ${req.body.note}`, 'loyalty_accounts', a.id, { points: a.points }, { points: n.points });
    return { account: loyAnswer(n, s) };
  });
  res.json(out);
}));

r.post('/loyalty/accounts/:id/notify', need(...LOY_VIEW), wrap(async (req, res) => {
  const s = await loyaltySettings(pool, req.sid);
  const [a] = await q('SELECT * FROM loyalty_accounts WHERE id=$1 AND station_id=$2 AND deleted_at IS NULL', [req.params.id, req.sid]);
  if (!a) throw new HttpError(404, 'Compte de fidélité introuvable');
  if (!a.phone) throw new HttpError(409, 'Ce compte n’a pas de numéro de téléphone');
  const [st] = await q('SELECT name FROM stations WHERE id=$1', [req.sid]);
  const v = loyAnswer(a, s);
  const text = `Bonjour${a.name ? ' ' + a.name : ''}, votre solde fidélité ${st ? st.name : ''} : ${v.points} point(s)${s.point_value ? ' (≈ ' + Math.round(v.value) + ' FCFA)' : ''}. Merci de votre fidélité !`;
  const { channelState, dispatchExternal } = require('./notify_channels');
  const link = 'https://wa.me/' + a.phone.replace(/\D/g, '') + '?text=' + encodeURIComponent(text);
  if (!channelState(process.env).whatsapp.available) return res.json({ sent: false, reason: 'WhatsApp automatique non configuré : utilisez le lien', text, wa_link: link });
  const out = await dispatchExternal({ channels: ['whatsapp'], recipients: [{ name: a.name, phone: a.phone }], text });
  res.json({ sent: out.some(x => x.sent), results: out, text, wa_link: link });
}));

// ───────────────────────── 4. Score de risque des quarts ─────────────────────────
r.get('/risk/shifts', need('report.view', 'shift.close'), wrap(async (req, res) => {
  const { from, to } = range({ query: { from: req.query.from, to: req.query.to || today() } });
  const rows = await q(`SELECT sh.id, sh.number, sh.kind, to_char(sh.shift_date,'YYYY-MM-DD') AS shift_date, sh.manager_id, u.login AS manager,
      sh.theoretical_cash::float8 AS theoretical_cash, sh.cash_gap::float8 AS cash_gap,
      (SELECT COUNT(*) FROM sales s WHERE s.shift_id = sh.id AND s.status = 'valide')::int AS sales_count,
      (SELECT COUNT(*) FROM sales s WHERE s.shift_id = sh.id AND s.status = 'annule')::int AS cancelled_count,
      (SELECT COUNT(*) FROM shift_anomalies a WHERE a.shift_id = sh.id AND a.kind NOT IN ('ecart_caisse'))::int AS anomaly_count,
      (SELECT string_agg(DISTINCT a.kind, ', ') FROM shift_anomalies a WHERE a.shift_id = sh.id AND a.kind NOT IN ('ecart_caisse')) AS anomaly_kinds,
      (SELECT COUNT(*) FROM (SELECT x.cash_gap FROM shifts x WHERE x.station_id = sh.station_id AND x.manager_id = sh.manager_id AND x.status = 'ferme' AND x.closed_at <= sh.closed_at
          ORDER BY x.closed_at DESC LIMIT 5) t WHERE t.cash_gap IS NOT NULL AND t.cash_gap <> 0)::int AS recent_gap_shifts
    FROM shifts sh LEFT JOIN users u ON u.id = sh.manager_id
    WHERE sh.station_id = $1 AND sh.status = 'ferme' AND sh.shift_date BETWEEN $2::date AND $3::date ORDER BY sh.shift_date DESC, sh.number DESC LIMIT 300`, [req.sid, from, to]);
  const shifts = rows.map(x => ({ ...x, ...scoreShift(x) }));
  const count = l => shifts.filter(x => x.level === l).length;
  res.json({ from, to, summary: { total: shifts.length, a_controler: count('a_controler'), a_surveiller: count('a_surveiller'), normal: count('normal') }, shifts });
}));

// ───────────────────────── 5. Prévision de rupture ─────────────────────────
async function forecastRows(sid, { lead = 2, days = 28, now = new Date() } = {}) {
  const prods = await q(`SELECT p.id, p.name, p.unit, cat.code AS category, COALESCE(st.quantity,0)::float8 AS stock, p.min_stock::float8 AS min_stock
      FROM products p JOIN categories cat ON cat.id = p.category_id LEFT JOIN stock st ON st.product_id = p.id
     WHERE p.station_id = $1 AND p.active AND p.deleted_at IS NULL ORDER BY p.name`, [sid]);
  const mv = await q(`SELECT product_id, created_at::date::text AS day, -SUM(quantity)::float8 AS qty FROM stock_movements
     WHERE station_id = $1 AND kind IN ('vente','retour') AND created_at >= (now()::date - $2::int) GROUP BY 1, 2`, [sid, days - 1]);
  const t0 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())), idx = new Map();
  for (const m of mv) { const k = Math.round((new Date(m.day + 'T00:00:00Z') - t0) / 864e5) + days - 1; if (k >= 0 && k < days) { const a = idx.get(m.product_id) || Array(days).fill(0); a[k] += m.qty; idx.set(m.product_id, a); } }
  return prods.map(p => ({ ...p, ...forecastProduct({ stock: p.stock, daily: (idx.get(p.id) || Array(days).fill(0)).map(v => Math.max(v, 0)), leadDays: lead, today: now }) }));
}
r.get('/stock/forecast', need('report.view', 'stock.adjust'), wrap(async (req, res) => {
  const lead = Math.min(30, Math.max(0, Number(req.query.lead) || 2)), days = Math.min(90, Math.max(14, Number(req.query.days) || 28));
  const rows = await forecastRows(req.sid, { lead, days });
  const order = { critique: 0, attention: 1, ok: 2 };
  const items = rows.filter(x => x.status === 'calcule').sort((a, b) => order[a.level] - order[b.level] || a.days_left - b.days_left);
  res.json({ lead_days: lead, window_days: days, critical: items.filter(x => x.level === 'critique').length, attention: items.filter(x => x.level === 'attention').length,
    items, no_sales: rows.filter(x => x.status === 'sans_vente').map(x => ({ id: x.id, name: x.name, stock: x.stock, unit: x.unit })) });
}));

// ───────────────────────── 8. Prix du jour ─────────────────────────
r.get('/prices/board', need('price.edit', 'report.view', 'sale.create'), wrap(async (req, res) => {
  const cost = canCost(req);
  const rows = await q(`SELECT p.id, p.name, p.unit, p.sell_price::float8 AS sell_price, p.buy_price::float8 AS buy_price,
      (SELECT to_char(h.effective_from,'YYYY-MM-DD HH24:MI') FROM price_history h WHERE h.station_id = p.station_id AND h.product_id = p.id AND h.price_type = 'sell' ORDER BY h.effective_from DESC LIMIT 1) AS changed_at,
      (SELECT h.old_price::float8 FROM price_history h WHERE h.station_id = p.station_id AND h.product_id = p.id AND h.price_type = 'sell' ORDER BY h.effective_from DESC LIMIT 1) AS previous_price,
      COALESCE((SELECT SUM(d.quantity) FROM sale_details d JOIN sales sa ON sa.id = d.sale_id WHERE d.product_id = p.id AND sa.status = 'valide' AND sa.sold_at >= now() - interval '7 days'),0)::float8 AS qty_7d
    FROM products p JOIN categories cat ON cat.id = p.category_id
   WHERE p.station_id = $1 AND p.active AND p.deleted_at IS NULL AND (cat.has_meter OR cat.code = 'CARBURANT') ORDER BY p.name`, [req.sid]);
  const [openShift] = await q(`SELECT number FROM shifts WHERE station_id=$1 AND status='ouvert'`, [req.sid]);
  res.json({ can_cost: cost, open_shift: openShift ? openShift.number : null, items: rows.map(p => {
    const margin = cost && p.buy_price != null ? r2(p.sell_price - p.buy_price) : null;
    return { id: p.id, name: p.name, unit: p.unit, sell_price: p.sell_price, previous_price: p.previous_price, changed_at: p.changed_at, qty_7d: p.qty_7d,
      ...(cost ? { buy_price: p.buy_price, margin, margin_pct: margin != null && p.sell_price > 0 ? r2(margin / p.sell_price * 100) : null, margin_7d: margin != null ? r2(margin * p.qty_7d) : null } : {}) };
  }) });
}));
r.post('/prices/board', need('price.edit'), body(z.object({
  changes: z.array(z.object({ product_id: z.number().int().positive(), price: z.number().min(0).max(1e9) })).min(1).max(20),
  note: z.string().trim().max(300).optional().nullable()
}).strict()), wrap(async (req, res) => {
  const { recordPriceChange } = require('./product_profile');
  const out = await tx(async c => {
    const done = [];
    for (const ch of req.body.changes) {
      const { rows: [p] } = await c.query(`SELECT p.id, p.name, p.sell_price FROM products p JOIN categories cat ON cat.id = p.category_id
        WHERE p.id=$1 AND p.station_id=$2 AND p.deleted_at IS NULL AND (cat.has_meter OR cat.code='CARBURANT') FOR UPDATE OF p`, [ch.product_id, req.sid]);
      if (!p) throw new HttpError(404, 'Produit carburant introuvable : ' + ch.product_id);
      if (Number(p.sell_price) === ch.price) continue;
      await recordPriceChange(c, { station: req.sid, product: p.id, type: 'sell', oldPrice: p.sell_price, newPrice: ch.price, by: req.user.id, note: req.body.note || 'Prix du jour' });
      await c.query('UPDATE products SET sell_price=$2 WHERE id=$1', [p.id, ch.price]);
      await audit(c, req, 'prix', `Prix du jour ${p.name} : ${p.sell_price} → ${ch.price}`, 'products', p.id, { sell_price: Number(p.sell_price) }, { sell_price: ch.price });
      done.push({ product_id: p.id, name: p.name, old_price: Number(p.sell_price), new_price: ch.price });
    }
    if (!done.length) throw new HttpError(400, 'Aucun changement : les prix saisis sont identiques aux prix actuels');
    const { rows: [sh] } = await c.query(`SELECT number FROM shifts WHERE station_id=$1 AND status='ouvert'`, [req.sid]);
    return { changed: done, open_shift: sh ? sh.number : null };
  });
  res.status(201).json(out);
}));

module.exports = r;
module.exports.forecastRows = forecastRows;
