'use strict';
// Couche d'alertes e-mail multi-destinataires. L'échec SMTP ne doit jamais
// annuler une opération métier déjà enregistrée.
const { sendMail } = require('../src/mailer');
const { pool } = require('../src/core');
const crypto = require('crypto');

// Empreinte stable : une alerte identique ne peut être envoyée qu'une fois par fenêtre de 24 h.
function fingerprint(value) { return crypto.createHash('sha256').update(String(value || '').trim().toLowerCase().replace(/\s+/g, ' ')).digest('hex'); }
async function claimAlert(key) {
  const result = await pool.query(
    `INSERT INTO email_alert_dedupe (fingerprint, last_sent_at) VALUES ($1, now())
     ON CONFLICT (fingerprint) DO UPDATE SET last_sent_at = now()
     WHERE email_alert_dedupe.last_sent_at <= now() - interval '24 hours'
     RETURNING fingerprint`, [key]);
  return result.rowCount > 0;
}
async function releaseAlert(key) { await pool.query('DELETE FROM email_alert_dedupe WHERE fingerprint = $1', [key]).catch(() => {}); }

function parseRecipients(value) {
  return [...new Set(String(value || '').split(/[;,\s]+/).map(x => x.trim()).filter(Boolean)
    .filter(x => /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(x)))];
}
function recipients(customRecipients) {
  return [...new Set([
    ...parseRecipients(process.env.ADMIN_EMAIL),
    ...parseRecipients(customRecipients)
  ])];
}
async function sendAlertEmail(subject, messageBody, recipientEmail, options = {}) {
  const to = recipients(recipientEmail);
  if (!to.length) return { sent: false, reason: 'no_recipients' };
  if (!process.env.SMTP_HOST && process.env.MAIL_MODE !== 'json') return { sent: false, reason: 'smtp_not_configured' };
  const key = fingerprint(options.dedupeKey || `${subject || 'Alerte'}|${messageBody || ''}|${to.map(x => x.toLowerCase()).sort().join(',')}`);
  if (!(await claimAlert(key))) return { sent: false, reason: 'duplicate_within_24h' };
  try {
    await sendMail({ to, subject: `[Station Manager Pro] ${String(subject || 'Alerte').slice(0, 180)}`, text: String(messageBody || '').slice(0, 12000) });
    return { sent: true, recipients: to.length, deduplicated: true };
  } catch (error) { await releaseAlert(key); throw error; }
}
async function notifyQuartEvent(type, stationName, details = {}, customRecipients) {
  const label = String(type || '').toLowerCase().includes('fer') ? 'Fermeture' : 'Ouverture';
  const lines = [
    `Événement : ${label} du quart`, `Station : ${stationName || 'Station non précisée'}`,
    `Quart : ${details.number ?? details.shiftNumber ?? '—'}`,
    `Utilisateur : ${details.user || details.manager || '—'}`,
    `Date : ${details.date || new Date().toISOString()}`
  ];
  if (details.cashGap != null) lines.push(`Écart de caisse : ${details.cashGap}`);
  if (details.details) lines.push(`Détails : ${details.details}`);
  const shift = details.number ?? details.shiftNumber ?? 'sans-numero';
  return sendAlertEmail(`${label} de quart — ${stationName || 'station'}`, lines.join('\n'), customRecipients, { dedupeKey: `quart|${label}|${stationName || ''}|${shift}` });
}
async function notifyAnomalie(stationName, description, customRecipients) {
  const normalized = String(description || 'Non précisée').trim().toLowerCase().replace(/\s+/g, ' ');
  return sendAlertEmail(`Anomalie détectée — ${stationName || 'station'}`,
    `Station : ${stationName || 'Station non précisée'}\nDate : ${new Date().toISOString()}\nAnomalie : ${String(description || 'Non précisée')}`,
    customRecipients, { dedupeKey: `anomalie|${stationName || ''}|${normalized}` });
}
module.exports = { sendAlertEmail, notifyQuartEvent, notifyAnomalie, parseRecipients, fingerprint, claimAlert };
