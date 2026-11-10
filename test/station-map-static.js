'use strict';
// Carte Mapbox + coordonnées des stations : contrôles statiques (sans base de données).
const fs = require('fs'), assert = require('assert');
const rd = p => fs.readFileSync(p, 'utf8');
const admin = rd('src/admin.js'), server = rd('src/server.js'), map = rd('public/ext-map.js'), idx = rd('public/index.html');
const mig = rd('migrations/066_station_geolocation.sql');
let n = 0; const check = (l, f) => { f(); n++; console.log('✔ ' + l); };
check('migration : colonnes latitude/longitude + bornes + paire', () => { assert.match(mig, /ADD COLUMN IF NOT EXISTS latitude/); assert.match(mig, /ADD COLUMN IF NOT EXISTS longitude/); assert.match(mig, /BETWEEN -90 AND 90/); assert.match(mig, /BETWEEN -180 AND 180/); assert.match(mig, /stations_geo_pair/); });
check('API : PATCH /stations/current accepte latitude et longitude (validées)', () => { assert.match(admin, /geoNum\(-90, 90/); assert.match(admin, /geoNum\(-180, 180/); assert.match(admin, /\.\.\.GEO_SCHEMA/); });
check('API : /stations/map est limité aux stations accessibles (ou Super Admin)', () => { assert.match(admin, /r\.get\('\/stations\/map'/); assert.match(admin, /JOIN user_stations us ON us\.station_id = s\.id LEFT JOIN clients/); });
check('API : un jeton secret Mapbox (sk.) est refusé', () => assert.match(admin, /startsWith\('sk\.'\)/));
check('CSP : Mapbox autorisé (script, connect, img, worker blob)', () => { for (const k of ['https://api.mapbox.com', 'https://events.mapbox.com', "'worker-src': [\"'self'\", 'blob:']", "'connect-src'"]) assert(server.includes(k), k); });
check('UI : ext-map.js chargé et vue carte déclarée', () => { assert.match(idx, /ext-map\.js/); assert.match(map, /V\.carte\s*=/); assert.match(map, /VM\.carte\s*=/); });
check('UI : popup construit par DOM (pas d\'HTML brut)', () => { assert.match(map, /setDOMContent/); assert(!/setHTML/.test(map)); });
check('UI : formulaires Général / Station / création exposent latitude et longitude', () => { for (const f of ['public/ext-fin.js', 'public/ext-p12.js', 'public/ext-multistation.js']) assert.match(rd(f), /latitude/, f); });
const platform = rd('src/platform.js');
check('Super Admin : /admin/platform/clients-map réservé au Super Admin, sans table métier', () => {
  assert.match(platform, /r\.get\('\/admin\/platform\/clients-map', needPrincipal/);
  const block = platform.slice(platform.indexOf("'/admin/platform/clients-map'"), platform.indexOf('// ---------- Synthèse'));
  for (const t of ['sales', 'cash_', 'stock_', 'payroll', 'shifts']) assert(!block.includes(t), t);
  assert.match(block, /revoked_at IS NULL AND expires_at > now\(\)/);
  assert.match(block, /u\.active = TRUE AND u\.deleted_at IS NULL/);
});
check('UI : la carte du Super Admin utilise /admin/platform/clients-map (route autorisée par le garde-fou)', () => {
  assert.match(map, /G\('\/admin\/platform\/clients-map'\)/);
  assert.match(server, /const allowed = \['\/admin'/);
});
check('Super Admin : /config/map (jeton public Mapbox) autorisé par le garde-fou, sans ouvrir /config/*', () => {
  assert.match(server, /'\/messaging', '\/config\/map'\]/); assert(!/'\/config'[,\]]/.test(server));
});
console.log(`\n${n}/11 contrôles statiques réussis.`);
