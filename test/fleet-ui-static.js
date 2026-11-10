'use strict';
// CORR-040/041 : écran Cartes flotte et champs carte dans la vente carburant — cohérents avec les routes serveur et le schéma.
const fs = require('fs'); const path = require('path'); const assert = require('assert');
const rd = f => fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8');
const ui = rd('public/ext-fleet.js'), sale = rd('public/ext-sale-shift.js'), idx = rd('public/index.html'), shell = rd('public/ext-shell.js'), fleet = rd('src/fleet.js');
let n = 0; const check = (l, fn) => { fn(); n++; console.log('✓ ' + l); };
check('écran branché : script, vue, menu Gestion commerciale', () => { assert.match(idx, /src="\/ext-fleet\.js(\?v=\d+)?"/); assert.match(ui, /V\.flotte = \[/); assert.match(ui, /VM\.flotte = vFleet/); assert.match(shell, /'cli', 'flotte'/); });
check('l\'écran n\'appelle que des routes qui existent côté serveur', () => {
  const routes = [...ui.matchAll(/(?:G|Po|api\('PATCH',)\(?\s*'(\/fleet\/[^'?]*)/g)].map(m => m[1].replace(/\/$/, ''));
  assert.ok(routes.length >= 7, 'routes trouvées : ' + routes.length);
  const server = [...fleet.matchAll(/^r\.(?:get|post|patch)\('([^']+)'/gm)].map(m => new RegExp('^' + m[1].replace(/:\w+/g, '[^/]+') + '$'));
  for (const r of routes) { const probe = r.endsWith('/') ? r : r; assert.ok(server.some(re => re.test(probe) || re.test(probe.replace(/\/$/, '')) || re.test(probe + '1') || re.test(probe + '1/block') || re.test(probe + '1/unblock') || re.test(probe + '1/events')), 'route inconnue : ' + r); }
});
check('création : champs envoyés = champs acceptés par le serveur', () => {
  const sent = ui.match(/var b = \{([^}]*)\}/)[1].match(/(\w+):/g).map(x => x.slice(0, -1));
  for (const k of sent) assert.match(fleet, new RegExp('\\b' + k + '\\b'), k);
  assert.match(ui, /b\.customer_id = Number\(d\.customer_id\)/); assert.match(ui, /b\.pin = /);
});
check('vente carburant : champs carte, objet fleet_card conforme au schéma serveur, client et paiement neutralisés', () => {
  assert.match(sale, /id="fcard"/); assert.match(sale, /id="fpin"/); assert.match(sale, /id="fodo"/);
  assert.match(sale, /body\.fleet_card = \{ number: cardNo, pin: .*odometer_km:/s); assert.match(sale, /\$\('#fp'\)\.disabled = on; \$\('#fu'\)\.disabled = on/);
  assert.match(rd('src/fuelsales.js'), /fleet_card: z\.object\(\{ number: .*pin: .*odometer_km: z\.number\(\)/);
  assert.match(sale, /!body\.customer_id && !body\.fleet_card/);
});
check('CORR-041 : la confirmation des avertissements lit « details » (envoyé par le serveur)', () => {
  assert.match(sale, /e\.details \|\| e\.warnings \|\| e\.body\?\.warnings/); assert.match(rd('src/core.js'), /json\(\{ error: e\.message, details: e\.details \}\)/);
  assert.match(rd('public/app.js'), /details: j && j\.details/);
});
check('motifs de refus affichés = codes produits par la logique de contrôle', () => {
  const codes = [...rd('src/fleet_logic.js').matchAll(/'([A-Z]{2,}(?:_[A-Z0-9]+)+)'/g)].map(m => m[1]); assert.strictEqual(new Set(codes).size, 15);
  for (const c of new Set(codes)) assert.ok(ui.includes(c + ':'), 'motif non traduit : ' + c);
});
console.log(`\n${n}/${n} contrôles réussis.`);
