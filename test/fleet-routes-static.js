'use strict';
// CORR-040 : cartes flotte — migration 095, routes protégées et filtrées par station, PIN jamais renvoyé, branchement dans la vente carburant.
const fs = require('fs'); const path = require('path'); const assert = require('assert');
const rd = f => fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8');
const fleet = rd('src/fleet.js'), fs2 = rd('src/fuelsales.js'), srv = rd('src/server.js'), mig = rd('migrations/095_fleet_cards.sql');
let n = 0; const check = (l, fn) => { fn(); n++; console.log('✓ ' + l); };
const cols = t => mig.match(new RegExp('CREATE TABLE IF NOT EXISTS ' + t + ' \\(([\\s\\S]*?)\\n\\);'))[1];
check('migration 095 : colonnes écrites par fleet.js présentes', () => {
  const c = cols('fleet_cards');
  for (const k of ['station_id', 'customer_id', 'card_number', 'label', 'driver_name', 'pin_hash', 'pin_failures', 'requires_odometer', 'last_odometer', 'allowed_product_ids', 'allowed_days', 'hours_from', 'hours_to', 'expires_on', 'max_liters_tx', 'max_amount_tx', 'max_liters_day', 'max_amount_day', 'max_liters_month', 'max_amount_month', 'max_tx_day', 'status', 'blocked_reason', 'created_by', 'deleted_at']) assert.match(c, new RegExp('\\b' + k + '\\b'), k);
  assert.match(c, /UNIQUE \(station_id, card_number\)/);
  const e = cols('fleet_card_events'); for (const k of ['card_id', 'station_id', 'kind', 'sale_id', 'product_id', 'liters', 'amount', 'odometer_km', 'reasons', 'note', 'created_by']) assert.match(e, new RegExp('\\b' + k + '\\b'), k);
});
check('types d\'événements écrits par fleet.js autorisés par la contrainte', () => {
  const k = cols('fleet_card_events').match(/CHECK \(kind IN \(([^)]*)\)/)[1];
  for (const v of ['use', 'decline', 'block', 'unblock', 'create', 'update']) assert.ok(k.includes(`'${v}'`), v);
});
check('les champs modifiables par PATCH existent tous dans la table (liste blanche)', () => {
  const list = fleet.match(/const FIELDS = \[([^\]]*)\]/)[1].match(/'(\w+)'/g).map(x => x.slice(1, -1)); const c = cols('fleet_cards');
  for (const f of list) assert.match(c, new RegExp('\\b' + f + '\\b'), f);
});
check('toutes les routes cartes sont protégées par need()', () => {
  const routes = [...fleet.matchAll(/^r\.(get|post|patch)\('([^']+)',\s*([^\n]*)/gm)]; assert.strictEqual(routes.length, 10);
  for (const m of routes) assert.match(m[3], /^need\(/, m[2]);
});
check('requêtes filtrées par station_id (cartes, clients, produits, événements, relevé)', () => {
  const lits = fleet.match(/`(?:[^`\\]|\\.)*`|'(?:[^'\\\n]|\\.)*'/g);
  const sqls = lits.filter(x => /UPDATE fleet_cards|FROM fleet_cards |FROM customers WHERE|FROM products WHERE/.test(x)); assert.ok(sqls.length >= 9, 'requêtes trouvées : ' + sqls.length);
  for (const q of sqls) assert.match(q, /station_id/, q.slice(0, 80));
  assert.match(fleet, /WHERE c\.id = \$1 AND c\.station_id = \$2/); assert.match(fleet, /WHERE c\.station_id = \$1 AND c\.customer_id = \$2/);
});
check('le hachage du PIN n\'est jamais renvoyé : toute réponse carte passe par publicCard', () => {
  assert.match(fleet, /const \{ pin_hash, \.\.\.rest \} = c; return \{ \.\.\.rest, has_pin: !!pin_hash \}/);
  assert.strictEqual((fleet.match(/json\(publicCard\(card\)\)/g) || []).length, 4);   // création, modification, blocage, réactivation
  assert.match(fleet, /out\.push\(\{ \.\.\.publicCard\(c\), usage/);                  // liste
  assert.ok(!/res\.(status\(\d+\)\.)?json\(card\)/.test(fleet));
});
check('vente carburant : contrôle de carte AVANT la demande de confirmation, dans la transaction protégée par fleetGuard', () => {
  assert.match(fs2, /fleet_card: z\.object/); assert.match(fs2, /fleetGuard\(tx\(async c => \{/);
  assert.ok(fs2.indexOf('fleetCheck(c,') > 0 && fs2.indexOf('fleetCheck(c,') < fs2.indexOf("'Confirmation requise'"));
  assert.match(fs2, /\}\)\);\n  const replay/);
});
check('vente par carte : paiement crédit imposé, client = titulaire, droit « vendre à crédit » non requis (la carte autorise)', () => {
  assert.match(fs2, /const pays = fleet \? \[\{ method: fleet\.creditMethod, amount \}\]/);
  assert.match(fs2, /b\.customer_id = fleet\.card\.customer_id/); assert.match(fs2, /if \(!fleet && !req\.user\.perms\.has\('sale\.credit'\)\)/);
  assert.match(fs2, /correspond pas au titulaire de la carte/);
});
check('usage enregistré dans la même transaction que la vente, avant le numéro de facture', () => {
  assert.ok(fs2.indexOf('fleetRecordUse(c, fleet') > fs2.indexOf("INSERT INTO sales(") && fs2.indexOf('fleetRecordUse(c, fleet') < fs2.indexOf('UPDATE sales SET invoice_no'));
});
check('cumuls hors ventes annulées ; module branché ; fuseau paramétrable', () => {
  assert.match(fleet, /JOIN sales s ON s\.id = e\.sale_id AND s\.status = 'valide'/); assert.match(srv, /require\('\.\/fleet'\)\.r/); assert.match(fleet, /process\.env\.FLEET_TZ \|\| 'Africa\/Bamako'/);
});
console.log(`\n${n}/${n} contrôles réussis.`);
