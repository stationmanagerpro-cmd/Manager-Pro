'use strict';
// CORR-038/039 : écran des cuves, canaux d'alerte, type d'alerte tank_variance, migration 094 — cohérence serveur/écran/migrations.
const fs = require('fs'); const path = require('path'); const assert = require('assert');
const rd = f => fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8');
const ui = rd('public/ext-tanks.js'), idx = rd('public/index.html'), shell = rd('public/ext-shell.js'), cfgUi = rd('public/ext-alert-config.js');
const msg = rd('src/messaging.js'), tanks = rd('src/tanks.js'), mig = rd('migrations/094_alert_channels.sql'), nr = rd('src/notification_rules.js'), env = rd('.env.example');
let n = 0; const check = (l, fn) => { fn(); n++; console.log('✓ ' + l); };
check('écran cuves : script chargé, vue déclarée, présent dans le menu Exploitation', () => {
  assert.match(idx, /src="\/ext-tanks\.js"/); assert.match(ui, /V\.cuves = \[/); assert.match(ui, /VM\.cuves = vCuves/); assert.match(shell, /'pompes', 'cuves'/);
});
check('écran cuves : appelle uniquement des routes qui existent côté serveur', () => {
  for (const [m, p] of [['G', "'/tanks'"], ['G', "'/tanks/reconcile?"], ['Po', "'/tanks'"], ['Po', "'/tanks/' + id + '/measurements'"], ['G', "'/tanks/' + id + '/measurements?"]]) assert.ok(ui.includes(m + '(' + p), p);
  assert.match(tanks, /r\.get\('\/tanks\/reconcile'/); assert.match(tanks, /r\.post\('\/tanks\/:id\/measurements'/); assert.match(tanks, /r\.get\('\/tanks\/:id\/measurements'/);
});
check('écran cuves : alerte sans blocage (la saisie réussit même si l\'alerte échoue)', () => {
  assert.match(tanks, /try \{[\s\S]*alertVariance[\s\S]*\} catch \(e\) \{ console\.warn/); assert.match(tanks, /res\.status\(201\)\.json\(\{ \.\.\.m, reconciliation, alert \}\)/);
});
check('alerte tank_variance : type connu du serveur et de l\'écran, sans seuil numérique obligatoire', () => {
  assert.match(msg, /'stock_low', 'tank_variance'/); assert.match(cfgUi, /id: 'tank_variance'[^}]*needsThreshold: false/);
  assert.ok(!/THRESHOLD_KINDS = new Set\([^)]*tank_variance/.test(msg));
});
check('canaux : migration 094, enregistrement, envoi externe après l\'alerte interne, échec isolé', () => {
  assert.match(mig, /ADD COLUMN IF NOT EXISTS channels TEXT\[\] NOT NULL DEFAULT '\{app\}'/);
  assert.match(msg, /channels = EXCLUDED\.channels/); assert.match(msg, /dispatchExternal\(\{ channels: extChannels/); assert.match(msg, /\.catch\(swallow\('messaging:external'/);
  assert.match(msg, /channels: require\('\.\/notify_channels'\)\.channelState\(\)/);
});
check('écran de configuration : cases canaux, SMS/WhatsApp affichés « désactivé » tant que .env ne les active pas', () => {
  assert.match(cfgUi, /ac-ch-/); assert.match(cfgUi, /channels: \['app'\]\.concat/); assert.match(cfgUi, /désactivé : /);
});
check('disponibilité des canaux : source unique (notify_channels) pour les règles de rapports', () => assert.match(nr, /require\('\.\/notify_channels'\)\.channelState\(\)/));
check('.env.example documente l\'activation SMS et WhatsApp (désactivés par défaut)', () => { assert.match(env, /SMS_ENABLED=0/); assert.match(env, /WHATSAPP_ENABLED=0/); assert.match(env, /DEFAULT_COUNTRY_CODE/); });
console.log(`\n${n}/${n} contrôles réussis.`);
