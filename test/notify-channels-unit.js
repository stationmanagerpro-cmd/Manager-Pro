'use strict';
// CORR-039 : envoi multi-canaux. Le vrai code de src/notify_channels.js est exécuté avec un réseau et un e-mail simulés.
const assert = require('assert');
const { normalizePhone, channelState, dispatchExternal } = require('../src/notify_channels');
let n = 0; const check = async (l, fn) => { await fn(); n++; console.log('✓ ' + l); };
const calls = []; const fetchImpl = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200 }; };
const mails = []; const sendMail = async m => { mails.push(m); };
const R = [{ name: 'Gérant', email: 'g@x.ml', phone: '76 12 34 56' }];
const SMS = { SMS_ENABLED: '1', SMS_PROVIDER: 'twilio', SMS_API_KEY: 'tok', SMS_ACCOUNT_SID: 'AC1', SMS_FROM: '+15550001' };
(async () => {
  await check('numéros : indicatif Mali par défaut, +, 00, espaces, zéros initiaux, invalides refusés', () => {
    assert.strictEqual(normalizePhone('76 12 34 56', {}), '22376123456');
    assert.strictEqual(normalizePhone('+223 76123456', {}), '22376123456');
    assert.strictEqual(normalizePhone('00221771234567', {}), '221771234567');
    assert.strictEqual(normalizePhone('076123456', {}), '22376123456');
    assert.strictEqual(normalizePhone('76123456', { DEFAULT_COUNTRY_CODE: '221' }), '22176123456');
    assert.strictEqual(normalizePhone('12', {}), null); assert.strictEqual(normalizePhone(null, {}), null);
  });
  await check('par défaut : SMS et WhatsApp DÉSACTIVÉS, app toujours disponible', () => {
    const s = channelState({}); assert.strictEqual(s.app.available, true);
    assert.strictEqual(s.sms.available, false); assert.match(s.sms.reason, /Désactivé/);
    assert.strictEqual(s.whatsapp.available, false);
  });
  await check('activé mais fournisseur incomplet : indisponible avec raison explicite', () => {
    const s = channelState({ SMS_ENABLED: '1', SMS_PROVIDER: 'twilio', SMS_API_KEY: 'k' });
    assert.strictEqual(s.sms.available, false); assert.match(s.sms.reason, /incomplet/);
  });
  await check('canaux désactivés : aucun appel réseau, raison renvoyée, jamais d\'exception', async () => {
    const out = await dispatchExternal({ channels: ['app', 'sms', 'whatsapp'], recipients: R, subject: 'S', text: 'T' }, { env: {}, fetchImpl, sendMail });
    assert.strictEqual(calls.length, 0); assert.deepStrictEqual(out.map(o => [o.channel, o.sent]), [['sms', false], ['whatsapp', false]]);
  });
  await check('e-mail : envoyé à l\'adresse de la fiche ; adresse absente signalée', async () => {
    const env = { SMTP_HOST: 'smtp' };
    const out = await dispatchExternal({ channels: ['email'], recipients: [...R, { name: 'Sans mail' }], subject: 'Alerte', text: 'Corps' }, { env, fetchImpl, sendMail });
    assert.strictEqual(mails.length, 1); assert.strictEqual(mails[0].to, 'g@x.ml');
    assert.deepStrictEqual(out.map(o => o.sent), [true, false]); assert.match(out[1].reason, /e-mail absent/);
  });
  await check('SMS Twilio : requête POST authentifiée, numéro international, texte tronqué à 600 caractères', async () => {
    calls.length = 0;
    const out = await dispatchExternal({ channels: ['sms'], recipients: R, subject: 'Alerte', text: 'x'.repeat(900) }, { env: SMS, fetchImpl, sendMail });
    assert.strictEqual(out[0].sent, true); assert.strictEqual(calls.length, 1);
    const c = calls[0]; assert.match(c.url, /api\.twilio\.com\/.*\/Accounts\/AC1\/Messages\.json/);
    assert.strictEqual(c.init.headers.Authorization, 'Basic ' + Buffer.from('AC1:tok').toString('base64'));
    const p = new URLSearchParams(c.init.body); assert.strictEqual(p.get('To'), '+22376123456'); assert.strictEqual(p.get('From'), '+15550001'); assert.ok(p.get('Body').length <= 600);
  });
  await check('WhatsApp Twilio : préfixe whatsapp: sur l\'expéditeur et le destinataire', async () => {
    calls.length = 0;
    await dispatchExternal({ channels: ['whatsapp'], recipients: R, subject: 'A', text: 'B' }, { env: { WHATSAPP_ENABLED: 'oui', WHATSAPP_PROVIDER: 'twilio', WHATSAPP_API_KEY: 'k', WHATSAPP_ACCOUNT_SID: 'AC2', WHATSAPP_FROM: '+14155238886' }, fetchImpl, sendMail });
    const p = new URLSearchParams(calls[0].init.body); assert.strictEqual(p.get('To'), 'whatsapp:+22376123456'); assert.strictEqual(p.get('From'), 'whatsapp:+14155238886');
  });
  await check('fournisseur générique : POST JSON avec jeton Bearer vers l\'URL configurée', async () => {
    calls.length = 0;
    await dispatchExternal({ channels: ['sms'], recipients: R, subject: 'A', text: 'B' }, { env: { SMS_ENABLED: '1', SMS_PROVIDER: 'generic', SMS_API_KEY: 'k', SMS_API_URL: 'https://sms.example/send' }, fetchImpl, sendMail });
    assert.strictEqual(calls[0].url, 'https://sms.example/send'); assert.strictEqual(calls[0].init.headers.Authorization, 'Bearer k');
    assert.strictEqual(JSON.parse(calls[0].init.body).to, '+22376123456');
  });
  await check('échec réseau ou HTTP : capturé par destinataire, pas d\'exception, autres canaux poursuivis', async () => {
    const bad = async () => ({ ok: false, status: 401 });
    const out = await dispatchExternal({ channels: ['sms', 'email'], recipients: R, subject: 'A', text: 'B' }, { env: { ...SMS, SMTP_HOST: 'h' }, fetchImpl: bad, sendMail });
    assert.strictEqual(out.find(o => o.channel === 'sms').sent, false); assert.match(out.find(o => o.channel === 'sms').reason, /401/);
    assert.strictEqual(out.find(o => o.channel === 'email').sent, true);
  });
  await check('numéro invalide : signalé sans appel réseau', async () => {
    calls.length = 0;
    const out = await dispatchExternal({ channels: ['sms'], recipients: [{ name: 'X', phone: '12' }], subject: 'A', text: 'B' }, { env: SMS, fetchImpl, sendMail });
    assert.strictEqual(calls.length, 0); assert.match(out[0].reason, /numéro/);
  });
  console.log(`\n${n}/${n} contrôles réussis.`);
})().catch(e => { console.error(e); process.exit(1); });
