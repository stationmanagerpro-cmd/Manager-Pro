'use strict';
// « En ligne » + « Vu » de la messagerie : contrôles statiques et test du module temps réel avec une base simulée.
const fs = require('fs'), assert = require('assert'), Module = require('module');
const rd = p => fs.readFileSync(p, 'utf8');
let n = 0; const check = async (l, f) => { await f(); n++; console.log('✔ ' + l); };

(async () => {
  const msg = rd('src/messaging.js'), ui = rd('public/ext-messaging.js'), css = rd('public/design-v2.css'), mig = rd('migrations/087_messaging_presence.sql');
  await check('migration 087 : table user_presence idempotente', () => { assert.match(mig, /CREATE TABLE IF NOT EXISTS user_presence/); });
  await check('serveur : /messaging/presence limité aux personnes avec qui on partage une conversation', () => {
    assert.match(msg, /r\.get\('\/messaging\/presence'/); assert.match(msg, /JOIN conversation_members b ON b\.conversation_id = a\.conversation_id/);
  });
  await check('serveur : accusés « Vu » seulement pour MES messages + évènement « read »', () => {
    assert.match(msg, /Number\(m\.sender_id\) === Number\(req\.user\.id\) && !m\.is_system/); assert.match(msg, /realtime\.notifyRead/);
  });
  await check('interface : pastille En ligne, libellé « Vu à… », ✓/✓✓, évènements presence/read, sig de repeinture', () => {
    for (const k of ['wa-online', 'lastSeenLabel', 'seenHtml', "ev === 'presence'", "ev === 'read'", 'seen_count']) assert.ok(ui.includes(k), k);
    assert.match(css, /\.wa-av\.wa-online::after/); assert.match(css, /\.msg-tick\.seen/);
  });
  await check('temps réel : connexion → « en ligne » annoncé aux contacts, dernière déconnexion → hors ligne', async () => {
    const sent = [];
    const pool = { query: async (sql, p) => /user_presence/.test(sql) ? { rows: [{ last_seen_at: '2026-11-01T10:00:00Z' }] } : { rows: [{ user_id: Number(p[0]) === 1 ? 2 : 1 }] } };   // 1 et 2 partagent une conversation
    const orig = Module._load;
    Module._load = function (req, ...a) { return req === './core' ? { pool } : orig.call(this, req, ...a); };
    delete require.cache[require.resolve('../src/realtime')];
    const rt = require('../src/realtime'); Module._load = orig;
    const res2 = { write: x => sent.push(x), end() {} }, res1 = { write: () => {}, end() {} };
    rt.subscribe(2, res2);                       // le contact écoute
    const off1 = rt.subscribe(1, res1), off1b = rt.subscribe(1, { write() {}, end() {} });
    await new Promise(r => setTimeout(r, 20));
    assert.ok(rt.isOnline(1)); assert.strictEqual(sent.filter(x => /event: presence/.test(x) && /"user_id":1,"online":true/.test(x)).length, 1, 'une seule annonce en ligne');
    off1(); await new Promise(r => setTimeout(r, 20)); assert.ok(rt.isOnline(1), 'encore une connexion ouverte');
    off1b(); await new Promise(r => setTimeout(r, 20)); assert.ok(!rt.isOnline(1));
    assert.ok(sent.some(x => /"online":false/.test(x) && /last_seen_at/.test(x)), 'hors ligne annoncé avec dernière activité');
  });
  console.log('\n' + n + ' contrôles OK');
})().catch(e => { console.error('✘', e.message); process.exit(1); });
