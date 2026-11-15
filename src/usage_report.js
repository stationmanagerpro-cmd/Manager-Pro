'use strict';
/** Rapport d'utilisation de la plateforme : calcul, PDF, envoi mensuel automatique (Superadmin). */
const express = require('express');
const { z } = require('zod');
const { pool, HttpError, wrap, body: zbody } = require('./core');
const { swallow } = require('./safe');

const r = express.Router();
const needPrincipal = (req, res, next) =>
  req.user && req.user.is_global ? next() : next(new HttpError(403, 'Réservé à l\'Administrateur Principal'));

async function computeUsage(days) {
  const { rows: users } = await pool.query(
    `SELECT u.id, u.login, c.id AS client_id, c.name AS client_name,
            COALESCE(NULLIF(trim(e.first_name || ' ' || e.last_name), ''), u.login) AS display_name,
            (SELECT COUNT(*)::int FROM user_sessions s WHERE s.user_id = u.id AND s.created_at >= now() - make_interval(days => $1::int)) AS logins,
            COALESCE((SELECT SUM(seconds)::int FROM user_usage x WHERE x.user_id = u.id AND x.day > CURRENT_DATE - $1::int), 0) AS seconds,
            COALESCE((SELECT COUNT(*)::int FROM user_usage x WHERE x.user_id = u.id AND x.day > CURRENT_DATE - $1::int AND x.pings > 0), 0) AS active_days,
            GREATEST(u.last_login_at, (SELECT MAX(last_ping_at) FROM user_usage x WHERE x.user_id = u.id)) AS last_activity
       FROM users u JOIN clients c ON c.id = u.client_id
       LEFT JOIN employees e ON e.user_id = u.id
      WHERE u.is_global = false AND u.deleted_at IS NULL
      ORDER BY seconds DESC, logins DESC, u.login`, [days]);
  const byClient = new Map();
  for (const u of users) {
    const c = byClient.get(u.client_id) || { client_id: u.client_id, client_name: u.client_name, users: 0, active_users: 0, logins: 0, seconds: 0, last_activity: null };
    c.users++; if (u.logins > 0 || u.seconds > 0) c.active_users++;
    c.logins += u.logins; c.seconds += u.seconds;
    if (u.last_activity && (!c.last_activity || new Date(u.last_activity) > new Date(c.last_activity))) c.last_activity = u.last_activity;
    byClient.set(u.client_id, c);
  }
  const clients = [...byClient.values()].sort((a, b) => b.seconds - a.seconds || b.logins - a.logins);
  const { rows: daily } = await pool.query(
    `WITH d AS (SELECT generate_series(CURRENT_DATE - ($1::int - 1), CURRENT_DATE, interval '1 day')::date AS day)
     SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
            COALESCE((SELECT COUNT(*)::int FROM user_sessions s JOIN users u ON u.id = s.user_id WHERE s.created_at::date = d.day AND u.is_global = false), 0) AS logins,
            COALESCE((SELECT ROUND(SUM(x.seconds) / 3600.0, 2)::float FROM user_usage x WHERE x.day = d.day), 0) AS hours
       FROM d ORDER BY d.day`, [Math.min(days, 90)]);
  const { rows: [tr] } = await pool.query(`SELECT MIN(day) AS since FROM user_usage`);
  // Période précédente (même durée) pour l'évolution en %
  const { rows: prev } = await pool.query(
    `SELECT u.client_id,
            COALESCE((SELECT SUM(x.seconds) FROM user_usage x JOIN users uu ON uu.id = x.user_id WHERE uu.client_id = u.client_id AND x.day <= CURRENT_DATE - $1::int AND x.day > CURRENT_DATE - 2 * $1::int), 0)::int AS seconds,
            COALESCE((SELECT COUNT(*) FROM user_sessions s JOIN users uu ON uu.id = s.user_id WHERE uu.client_id = u.client_id AND s.created_at < now() - make_interval(days => $1::int) AND s.created_at >= now() - make_interval(days => 2 * $1::int)), 0)::int AS logins
       FROM users u WHERE u.client_id IS NOT NULL GROUP BY u.client_id`, [days]);
  const pm = new Map(prev.map(p => [Number(p.client_id), p]));
  const pct = (a, b) => b > 0 ? Math.round((a - b) * 100 / b) : null;
  for (const c of clients) {
    const p = pm.get(Number(c.client_id)) || { seconds: 0, logins: 0 };
    c.prev_seconds = p.seconds; c.prev_logins = p.logins;
    c.seconds_change_pct = pct(c.seconds, p.seconds); c.logins_change_pct = pct(c.logins, p.logins);
    c.days_since_activity = c.last_activity ? Math.floor((Date.now() - new Date(c.last_activity)) / 86400000) : null;
    c.inactive = c.days_since_activity == null || c.days_since_activity >= 7;
  }
  const { rows: hourly } = await pool.query(
    `SELECT EXTRACT(HOUR FROM s.created_at AT TIME ZONE 'UTC')::int AS h, COUNT(*)::int AS n
       FROM user_sessions s JOIN users u ON u.id = s.user_id
      WHERE u.is_global = false AND s.created_at >= now() - make_interval(days => $1::int) GROUP BY 1`, [days]);
  const hours = Array.from({ length: 24 }, (_, h) => (hourly.find(x => x.h === h) || { n: 0 }).n);
  const { rows: views } = await pool.query(
    `SELECT view, SUM(minutes)::int AS minutes FROM view_usage WHERE day > CURRENT_DATE - $1::int GROUP BY view ORDER BY 2 DESC LIMIT 12`, [days]).catch(swallow('platform:views', { rows: [] }));
  return { days, clients, users, daily, hours, views, tracking_since: tr && tr.since };
}

const lat = t => String(t == null ? '' : t).replace(/[^\x20-\x7E\u00A0-\u00FF]/g, '?');
const hm = s => { s = Number(s) || 0; const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? h + ' h ' + String(m).padStart(2, '0') : m + ' min'; };

/** PDF du rapport (A4, tableaux simples). */
function renderPdf(d, label) {
  const PDFDocument = require('pdfkit');
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true, info: { Title: 'Rapport d\'utilisation - ' + label } });
    const chunks = []; doc.on('data', c => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    const W = doc.page.width - 80;
    doc.font('Helvetica-Bold').fontSize(18).fillColor('#0A6B5C').text('Manager PRO - Rapport d\'utilisation');
    doc.font('Helvetica').fontSize(10).fillColor('#444').text(lat(label) + ' - periode de ' + d.days + ' jours - genere le ' + new Date().toLocaleDateString('fr-FR')).moveDown(.8);
    const totS = d.clients.reduce((a, c) => a + c.seconds, 0), totL = d.clients.reduce((a, c) => a + c.logins, 0);
    const act = d.users.filter(u => u.logins > 0 || u.seconds > 0).length;
    doc.fillColor('#111').font('Helvetica-Bold').fontSize(11).text('Synthese');
    doc.font('Helvetica').fontSize(10).text(`Temps total : ${hm(totS)}   |   Connexions : ${totL}   |   Utilisateurs actifs : ${act} / ${d.users.length}   |   Clients inactifs (7 j+) : ${d.clients.filter(c => c.inactive).length}`).moveDown(.8);
    const table = (title, cols, widths, rows) => {
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#111').text(title).moveDown(.3);
      const row = (cells, bold, fill) => {
        if (doc.y > doc.page.height - 70) doc.addPage();
        const y = doc.y; let x = 40;
        if (fill) doc.rect(40, y - 2, W, 15).fill(fill);
        doc.fillColor('#111').font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5);
        cells.forEach((c, i) => { doc.text(lat(c), x + 2, y, { width: widths[i] * W - 4, height: 12, ellipsis: true, lineBreak: false }); x += widths[i] * W; });
        doc.y = y + 15;
      };
      row(cols, true, '#E8F3F0'); rows.forEach(c => row(c, false)); doc.moveDown(.8);
    };
    table('Classement des clients', ['#', 'Client', 'Temps', 'Evol.', 'Connexions', 'Actifs', 'Derniere activite'], [.05, .27, .12, .1, .12, .1, .24],
      d.clients.map((c, i) => [i + 1, c.client_name + (c.inactive ? ' (inactif)' : ''), hm(c.seconds), c.seconds_change_pct == null ? '-' : (c.seconds_change_pct >= 0 ? '+' : '') + c.seconds_change_pct + '%', c.logins, c.active_users + '/' + c.users, c.last_activity ? new Date(c.last_activity).toLocaleDateString('fr-FR') : 'jamais']));
    table('Utilisateurs, du plus frequent au moins frequent', ['#', 'Utilisateur', 'Client', 'Temps', 'Connexions', 'Jours actifs'], [.05, .28, .27, .14, .13, .13],
      d.users.map((u, i) => [i + 1, u.display_name, u.client_name, hm(u.seconds), u.logins, u.active_days]));
    if (d.views && d.views.length) table('Ecrans les plus utilises (minutes)', ['Ecran', 'Minutes'], [.6, .4], d.views.map(v => [v.view, v.minutes]));
    doc.end();
  });
}

const getSettings = async () => {
  const { rows: [x] } = await pool.query(`SELECT value FROM app_settings WHERE key = 'usage_report'`).catch(swallow('usage_report:get', { rows: [] }));
  return Object.assign({ enabled: false, day: 1, hour: 8, email: '', last_sent: null }, (x && x.value) || {});
};

/** Génère, enregistre et (si possible) envoie par e-mail le rapport. */
async function generateAndSend(trigger) {
  const cfg = await getSettings();
  const d = await computeUsage(30);
  const label = new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  const pdf = await renderPdf(d, label);
  let emailed = null, mailError = null;
  if (cfg.email) {
    try {
      await require('./mailer').sendMail({ to: cfg.email, subject: 'Manager PRO - Rapport d\'utilisation (' + label + ')',
        text: 'Veuillez trouver ci-joint le rapport d\'utilisation de la plateforme sur les 30 derniers jours.',
        attachments: [{ filename: 'rapport_utilisation_' + new Date().toISOString().slice(0, 7) + '.pdf', content: pdf, contentType: 'application/pdf' }] });
      emailed = cfg.email;
    } catch (e) { mailError = e.message; }
  }
  const { rows: [row] } = await pool.query('INSERT INTO usage_reports(label, days, pdf, emailed_to) VALUES ($1,30,$2,$3) RETURNING id', [label, pdf, emailed]);
  return { id: row.id, label, emailed, mail_error: mailError, trigger };
}

/** Appelé toutes les 5 min : envoie le rapport du mois dès que le jour/l'heure choisis sont atteints (une seule fois par mois). */
async function monthlyTick() {
  const cfg = await getSettings();
  if (!cfg.enabled) return null;
  const now = new Date(), ym = now.toISOString().slice(0, 7);
  if (cfg.last_sent === ym) return null;
  if (now.getUTCDate() < cfg.day || (now.getUTCDate() === cfg.day && now.getUTCHours() < cfg.hour)) return null;
  // Réservation atomique : une seule instance du serveur envoie.
  const { rowCount } = await pool.query(
    `UPDATE app_settings SET value = jsonb_set(value, '{last_sent}', to_jsonb($1::text)), updated_at = now()
      WHERE key = 'usage_report' AND COALESCE(value->>'last_sent', '') <> $1`, [ym]);
  if (!rowCount) return null;
  return generateAndSend('auto');
}

r.get('/admin/platform/usage-report/settings', needPrincipal, wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT id, label, days, emailed_to, created_at FROM usage_reports ORDER BY id DESC LIMIT 12').catch(swallow('usage_report:list', { rows: [] }));
  const { channelState } = require('./notify_channels');
  res.json({ settings: await getSettings(), reports: rows, email_available: channelState().email.available });
}));

r.put('/admin/platform/usage-report/settings', needPrincipal, zbody(z.object({
  enabled: z.boolean(), day: z.number().int().min(1).max(28), hour: z.number().int().min(0).max(23), email: z.string().max(200).email().or(z.literal(''))
})), wrap(async (req, res) => {
  const { enabled, day, hour, email } = req.body;
  const prev = await getSettings();
  const v = { enabled, day, hour, email, last_sent: prev.last_sent };
  await pool.query(`INSERT INTO app_settings(key, value, updated_by) VALUES ('usage_report', $1::jsonb, $2)
                    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`, [JSON.stringify(v), req.user.id]);
  res.json({ ok: true });
}));

r.post('/admin/platform/usage-report/send-now', needPrincipal, wrap(async (req, res) => { res.json(await generateAndSend('manual')); }));

r.get('/admin/platform/usage.pdf', needPrincipal, wrap(async (req, res) => {
  const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));
  const pdf = await renderPdf(await computeUsage(days), 'Periode de ' + days + ' jours');
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="rapport_utilisation_' + days + 'j.pdf"' }).send(pdf);
}));

r.get('/admin/platform/usage-report/:id.pdf', needPrincipal, wrap(async (req, res) => {
  const { rows: [x] } = await pool.query('SELECT pdf, label FROM usage_reports WHERE id = $1', [parseInt(req.params.id, 10) || 0]);
  if (!x) throw new HttpError(404, 'Rapport introuvable');
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="rapport_utilisation_' + req.params.id + '.pdf"' }).send(x.pdf);
}));

module.exports = { r, computeUsage, renderPdf, monthlyTick, generateAndSend };
