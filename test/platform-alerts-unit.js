'use strict';
// Règles d'alerte du Superadmin (src/platform_alerts.js) : évaluation, anti-doublon, échec d'envoi, seuils, garde Superadmin,
// stockage séparé des règles client. Base et e-mail simulés : aucune connexion réelle.
const assert = require('assert'), Module = require('module'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const sent = [], updates = [];
let mailFails = false, handler = () => ({ rows: [], rowCount: 0 });
const fakePool = { query: async (sql, p) => handler(sql, p) };
const routes = {};
const fakeRouter = () => { const r = {}; for (const m of ['get', 'post', 'put']) r[m] = (p, ...h) => { routes[m + ' ' + p] = h; return r; }; r.use = () => r; return r; };
const chain = () => new Proxy(function () {}, { get: (_t, k) => (k === 'then' ? undefined : chain()), apply: () => chain() });
const orig = Module._load;
Module._load = function (req, parent, ...a) {
  if (parent && /platform_alerts\.js$/.test(parent.filename)) {
    if (req === 'express') { const e = () => fakeRouter(); e.Router = fakeRouter; return e; }
    if (req === 'zod') return { z: chain() };
    if (req === './core') return { pool: fakePool, HttpError: class extends Error { constructor(s, m) { super(m); this.status = s; } }, wrap: f => f, body: () => (q, s, nx) => nx(), audit: async () => {} };
    if (req === './contracts') return { needPrincipal: (q, s, nx) => { if (!q.user.is_global) throw new Error('403 Réservé'); return nx(); }, daysRemaining: (e, now) => Math.ceil((new Date(e) - now) / 864e5) };
    if (req === './task_lock') return { TASK_LOCKS: { PLATFORM_ALERTS: 1 }, withTaskLock: async (id, fn) => fn() };
    if (req === './notify_channels') return { channelState: () => ({ email: { available: true } }) };
    if (req === './mailer') return { sendMail: async m => { if (mailFails) throw new Error('SMTP KO'); sent.push(m); } };
  }
  return orig.call(this, req, parent, ...a);
};
const PA = require('../src/platform_alerts');
// Le simulateur reste actif : les imports paresseux de platform_alerts.js (mailer) doivent aussi être simulés.

let n = 0;
const check = async (label, fn) => { await fn(); n++; console.log('✓ ' + label); };
const HOUR = 3600e3;
function setup({ rules, data = {} }) {
  sent.length = 0; updates.length = 0;
  handler = (sql, p) => {
    if (/FROM platform_alert_rules WHERE active/.test(sql)) return { rows: rules };
    if (/^\s*UPDATE platform_alert_rules SET last_value/.test(sql)) { updates.push(p); return { rows: [], rowCount: 1 }; }
    if (/^\s*INSERT INTO platform_alert_rules/.test(sql)) return { rows: [{ alert_kind: p[0], active: p[1], threshold_value: p[2], email: p[3] }] };
    if (/FROM clients WHERE created_at/.test(sql)) return { rows: data.clients || [] };
    if (/FROM stations WHERE client_id IS NULL/.test(sql)) return { rows: data.stations || [] };
    if (/FROM error_log/.test(sql)) return { rows: data.errors || [] };
    if (/FROM license_reminders/.test(sql)) return { rows: data.reminders || [] };
    if (/FROM backup_logs/.test(sql)) return { rows: data.backups || [] };
    if (/FROM clients c JOIN client_contracts/.test(sql)) return { rows: data.licences || [] };
    return { rows: [], rowCount: 0 };
  };
}
async function call(key, req) {
  const hs = routes[key]; let out;
  const res = { json: v => { out = v; return v; } };
  const run = async i => { if (i === hs.length - 1) return hs[i](req, res); return hs[i](req, res, () => run(i + 1)); };
  await run(0); return out;
}
const rule = (kind, extra = {}) => ({ alert_kind: kind, active: true, email: 'sa@exemple.fr', threshold_value: null, last_checked_at: null, last_fired_at: null, ...extra });
const SA = { user: { is_global: true, id: 1 } }, CLIENT = { user: { is_global: false, id: 9 } };

(async () => {
  await check('six types d’alerte, identiques entre le code et la migration 118', () => {
    const kinds = Object.keys(PA.KINDS).sort();
    assert.deepStrictEqual(kinds, ['backup_failed', 'client_created', 'client_licence_expiring', 'licence_reminder_sent', 'server_errors_500', 'station_without_client']);
    const mig = fs.readFileSync(path.join(root, 'migrations/118_platform_alert_rules.sql'), 'utf8');
    for (const k of kinds) assert.ok(mig.includes("'" + k + "'"), k);
  });
  await check('stockage séparé : le module ne touche jamais alert_notify_config (règles client)', () => {
    assert.ok(!/alert_notify_config/.test(fs.readFileSync(path.join(root, 'src/platform_alerts.js'), 'utf8')));
  });
  await check('événement : nouveau client → un e-mail, événement consommé', async () => {
    setup({ rules: [rule('client_created')], data: { clients: [{ name: 'Client A', created_at: new Date() }] } });
    const out = await PA.runPlatformAlerts();
    assert.strictEqual(sent.length, 1); assert.strictEqual(sent[0].to, 'sa@exemple.fr'); assert.match(sent[0].text, /Client A/);
    assert.strictEqual(updates[0][3], true, 'last_checked_at avancé'); assert.strictEqual(updates[0][5], true, 'envoi enregistré');
    assert.strictEqual(out[0].sent, true);
  });
  await check('événement : rien de nouveau → aucun e-mail, la fenêtre avance quand même', async () => {
    setup({ rules: [rule('backup_failed')], data: { backups: [] } });
    await PA.runPlatformAlerts();
    assert.strictEqual(sent.length, 0); assert.strictEqual(updates[0][3], true); assert.strictEqual(updates[0][5], false);
  });
  await check('situation : station sans client → rappel au plus une fois par 24 h', async () => {
    setup({ rules: [rule('station_without_client', { last_fired_at: new Date(Date.now() - HOUR) })], data: { stations: [{ name: 'S1' }] } });
    await PA.runPlatformAlerts();
    assert.strictEqual(sent.length, 0, 'anti-doublon : dernier envoi il y a 1 h');
    setup({ rules: [rule('station_without_client', { last_fired_at: new Date(Date.now() - 25 * HOUR) })], data: { stations: [{ name: 'S1' }] } });
    await PA.runPlatformAlerts();
    assert.strictEqual(sent.length, 1, 'après 24 h : rappel');
  });
  await check('échec d’envoi : l’événement n’est pas consommé (renvoyé au passage suivant)', async () => {
    mailFails = true;
    setup({ rules: [rule('client_created')], data: { clients: [{ name: 'Client B', created_at: new Date() }] } });
    const out = await PA.runPlatformAlerts();
    mailFails = false;
    assert.strictEqual(sent.length, 0); assert.strictEqual(updates[0][3], false, 'fenêtre non avancée'); assert.strictEqual(updates[0][2], 'SMTP KO');
    assert.strictEqual(out[0].error, 'SMTP KO'); assert.strictEqual(out[0].sent, false);
  });
  await check('seuils : erreurs 500 (seuil 10) et licences (≤ 15 j)', async () => {
    setup({ rules: [rule('server_errors_500', { threshold_value: 10 })], data: { errors: [{ message: 'boom', n: 5 }] } });
    await PA.runPlatformAlerts(); assert.strictEqual(sent.length, 0, '5 < 10');
    setup({ rules: [rule('server_errors_500', { threshold_value: 10 })], data: { errors: [{ message: 'boom', n: 12 }] } });
    await PA.runPlatformAlerts(); assert.strictEqual(sent.length, 1, '12 ≥ 10');
    const soon = new Date(Date.now() + 10 * 864e5).toISOString(), far = new Date(Date.now() + 40 * 864e5).toISOString();
    setup({ rules: [rule('client_licence_expiring', { threshold_value: 15 })], data: { licences: [{ name: 'Proche', expires_at: far, end_date: null, is_indefinite: false }] } });
    await PA.runPlatformAlerts(); assert.strictEqual(sent.length, 0, '40 j > 15 j');
    setup({ rules: [rule('client_licence_expiring', { threshold_value: 15 })], data: { licences: [{ name: 'Proche', expires_at: soon, end_date: null, is_indefinite: false }] } });
    await PA.runPlatformAlerts(); assert.strictEqual(sent.length, 1); assert.match(sent[0].text, /Proche/);
  });
  await check('règle inactive ou sans destinataire : ignorée', async () => {
    setup({ rules: [rule('client_created', { email: '' })], data: { clients: [{ name: 'C', created_at: new Date() }] } });
    await PA.runPlatformAlerts(); assert.strictEqual(sent.length, 0);
  });
  await check('garde Superadmin : un compte client ne lit ni ne modifie les règles plateforme', async () => {
    await assert.rejects(call('get /admin/platform/alert-rules', CLIENT), /Réservé/);
    await assert.rejects(call('put /admin/platform/alert-rules/:kind', { ...CLIENT, params: { kind: 'client_created' }, body: { active: false, email: '' } }), /Réservé/);
    await assert.rejects(call('post /admin/platform/alert-rules/run', CLIENT), /Réservé/);
  });
  await check('enregistrement : e-mail obligatoire pour activer, seuil borné, type inconnu refusé', async () => {
    setup({ rules: [] });
    await assert.rejects(call('put /admin/platform/alert-rules/:kind', { ...SA, params: { kind: 'client_created' }, body: { active: true, email: '' } }), /e-mail/);
    await assert.rejects(call('put /admin/platform/alert-rules/:kind', { ...SA, params: { kind: 'server_errors_500' }, body: { active: true, email: 'a@b.fr', threshold_value: 0 } }), /entre 1 et 10000/);
    await assert.rejects(call('put /admin/platform/alert-rules/:kind', { ...SA, params: { kind: 'inconnu' }, body: { active: true, email: 'a@b.fr' } }), /inconnu/);
    const row = await call('put /admin/platform/alert-rules/:kind', { ...SA, params: { kind: 'server_errors_500' }, body: { active: true, email: 'a@b.fr', threshold_value: 25 } });
    assert.strictEqual(row.active, true); assert.strictEqual(row.threshold_value, 25);
  });
  console.log(`\n${n} contrôles réussis.`);
})().catch(e => { console.error('ÉCHEC', e); process.exit(1); });
