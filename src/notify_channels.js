'use strict';
/** Envoi des alertes sur plusieurs canaux : app (messagerie interne), e-mail, SMS, WhatsApp.
 *  SMS et WhatsApp sont CODÉS MAIS DÉSACTIVÉS par défaut (ils coûtent par message) : activation ultérieure en renseignant .env,
 *  sans modifier le code. Le service ne lève jamais d'exception : chaque canal renvoie { channel, sent, reason }.
 *
 *  Activation SMS      : SMS_ENABLED=1, SMS_PROVIDER=twilio|generic, SMS_API_KEY, + selon le fournisseur (voir .env.example)
 *  Activation WhatsApp : WHATSAPP_ENABLED=1, WHATSAPP_PROVIDER=twilio|generic, WHATSAPP_API_KEY, + idem
 *  Numéros : normalisés au format international ; indicatif par défaut DEFAULT_COUNTRY_CODE (223 = Mali). */
const CHANNELS = ['app', 'email', 'sms', 'whatsapp'];

/** Numéro → chiffres internationaux (sans +). Retourne null si inexploitable. */
function normalizePhone(raw, env = process.env) {
  if (raw == null) return null;
  let d = String(raw).replace(/[^\d+]/g, '');
  if (!d) return null;
  if (d.startsWith('+')) d = d.slice(1);
  else if (d.startsWith('00')) d = d.slice(2);
  else {
    const cc = String(env.DEFAULT_COUNTRY_CODE || '223').replace(/\D/g, '');
    d = d.replace(/^0+/, '');
    if (!d.startsWith(cc)) d = cc + d;
  }
  return d.length >= 8 && d.length <= 15 ? d : null;
}

/** État de chaque canal : disponible seulement si activé explicitement ET entièrement configuré. */
function channelState(env = process.env) {
  const on = v => ['1', 'true', 'oui', 'yes'].includes(String(v || '').toLowerCase());
  const prov = p => ['twilio', 'generic'].includes(String(env[p + '_PROVIDER'] || '').toLowerCase());
  const cfgOk = p => prov(p) && !!env[p + '_API_KEY'] && (String(env[p + '_PROVIDER']).toLowerCase() === 'twilio' ? !!(env[p + '_ACCOUNT_SID'] && env[p + '_FROM']) : !!env[p + '_API_URL']);
  const sms = on(env.SMS_ENABLED), wa = on(env.WHATSAPP_ENABLED);
  const mail = !!env.SMTP_HOST || env.MAIL_MODE === 'json';
  return {
    app: { available: true, reason: null },
    email: { available: mail, reason: mail ? null : 'SMTP non configuré' },
    sms: { available: sms && cfgOk('SMS'), reason: !sms ? 'Désactivé (SMS_ENABLED non activé)' : cfgOk('SMS') ? null : 'Fournisseur SMS incomplet dans .env' },
    whatsapp: { available: wa && cfgOk('WHATSAPP'), reason: !wa ? 'Désactivé (WHATSAPP_ENABLED non activé)' : cfgOk('WHATSAPP') ? null : 'Fournisseur WhatsApp incomplet dans .env' }
  };
}

async function viaProvider(kind, { to, text }, { env, fetchImpl }) {
  const P = kind.toUpperCase(), prov = String(env[P + '_PROVIDER']).toLowerCase(), key = env[P + '_API_KEY'];
  let url, init;
  if (prov === 'twilio') {
    const sid = env[P + '_ACCOUNT_SID'], pre = kind === 'whatsapp' ? 'whatsapp:' : '';
    url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`;
    init = { method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from(sid + ':' + key).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: pre + '+' + to, From: pre + env[P + '_FROM'], Body: text }).toString() };
  } else {   // « generic » : POST JSON vers SMS_API_URL / WHATSAPP_API_URL, jeton Bearer (agrégateur SMS local, passerelle WhatsApp…)
    url = env[P + '_API_URL'];
    init = { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: '+' + to, text, from: env[P + '_FROM'] || undefined }) };
  }
  const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(Number(env.NOTIFY_TIMEOUT_MS) || 10000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

/** channels : sous-ensemble de CHANNELS ; recipients : [{ name, email, phone }] ; retourne un résultat par canal et destinataire. */
async function dispatchExternal({ channels, recipients, subject, text }, deps = {}) {
  const env = deps.env || process.env, fetchImpl = deps.fetchImpl || globalThis.fetch;
  const sendMail = deps.sendMail || ((...a) => require('./mailer').sendMail(...a));
  const state = channelState(env), out = [];
  for (const ch of new Set((channels || []).filter(c => c !== 'app'))) {
    if (!CHANNELS.includes(ch)) { out.push({ channel: ch, sent: false, reason: 'canal inconnu' }); continue; }
    if (!state[ch].available) { out.push({ channel: ch, sent: false, reason: state[ch].reason }); continue; }
    for (const rc of recipients || []) {
      const who = rc.name || rc.email || rc.phone || '?';
      try {
        if (ch === 'email') {
          if (!rc.email) { out.push({ channel: ch, to: who, sent: false, reason: 'e-mail absent sur la fiche' }); continue; }
          await sendMail({ to: rc.email, subject, text });
        } else {
          const to = normalizePhone(rc.phone, env);
          if (!to) { out.push({ channel: ch, to: who, sent: false, reason: 'numéro absent ou invalide sur la fiche' }); continue; }
          await viaProvider(ch, { to, text: `${subject}\n${text}`.slice(0, 600) }, { env, fetchImpl });
        }
        out.push({ channel: ch, to: who, sent: true });
      } catch (e) { out.push({ channel: ch, to: who, sent: false, reason: String(e.message || e).slice(0, 120) }); }
    }
  }
  return out;
}

module.exports = { CHANNELS, normalizePhone, channelState, dispatchExternal };
