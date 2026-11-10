// Envoi d'emails (SMTP). MAIL_MODE=json : simulation sans réseau (tests).
const nodemailer = require('nodemailer');
const { swallow } = require('./safe');
const { HttpError } = require('./core');
function transport() {
  if (process.env.MAIL_MODE === 'json') return nodemailer.createTransport({ jsonTransport: true });
  if (!process.env.SMTP_HOST) return null;
  const port = +process.env.SMTP_PORT || 587;
  return nodemailer.createTransport({ host: process.env.SMTP_HOST, port, secure: port === 465, auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined });
}
async function sendMail({ to, subject, text, attachments }) {
  const t = transport();
  if (!t) throw new HttpError(501, "Email non configuré : renseignez SMTP_HOST (et SMTP_USER / SMTP_PASS) dans .env");
  const appName = (await require('./branding').load().catch(swallow('mailer:13', null)))?.name || 'Manager PRO';   // nom d'application administrable
  try { return await t.sendMail({ from: process.env.MAIL_FROM || `${appName.replace(/[<>"]/g, '')} <no-reply@localhost>`, to, subject, text, attachments }); }
  catch (e) { throw new HttpError(502, "L'envoi de l'email a échoué : " + e.message); }
}
module.exports = { sendMail };
