'use strict';
// CORR-038 : routes cuves — colonnes lues présentes dans les migrations, isolation par station, branchement du module.
const fs = require('fs'); const path = require('path'); const assert = require('assert');
const src = fs.readFileSync(path.resolve(__dirname, '../src/tanks.js'), 'utf8');
const srv = fs.readFileSync(path.resolve(__dirname, '../src/server.js'), 'utf8');
const mig = fs.readdirSync(path.resolve(__dirname, '../migrations')).filter(f => f.endsWith('.sql')).map(f => fs.readFileSync(path.resolve(__dirname, '../migrations', f), 'utf8')).join('\n');
let n = 0; const check = (l, fn) => { fn(); n++; console.log('✓ ' + l); };
check('module branché dans server.js', () => assert.match(srv, /require\('\.\/tanks'\)\.r/));
check('toutes les routes cuves sont protégées par need()', () => {
  const routes = src.match(/^r\.(get|post)\('[^']+'/gm); assert.strictEqual(routes.length, 5);
  for (const m of src.matchAll(/^r\.(get|post)\('[^']+',\s*([^\n]*)/gm)) assert.match(m[2], /^need\(/, m[0]);
});
check('toutes les requêtes cuves sont filtrées par station', () => {
  const q = src.match(/FROM tanks t[\s\S]*?(?=`)/g).concat(src.match(/FROM tank_measurements m JOIN tanks t[\s\S]*?(?=`)/g));
  for (const s of q) assert.match(s, /station_id = \$/, s.slice(0, 60));
  assert.match(src, /FROM tanks WHERE id = \$1 AND station_id = \$2/);
});
check('colonnes lues/écrites existent (tanks, tank_measurements)', () => {
  const t = mig.match(/CREATE TABLE IF NOT EXISTS tanks \(([\s\S]*?)\n\);/)[1], m = mig.match(/CREATE TABLE IF NOT EXISTS tank_measurements \(([\s\S]*?)\n\);/)[1];
  for (const c of ['station_id', 'product_id', 'name', 'capacity_liters', 'alert_threshold', 'active', 'deleted_at']) assert.match(t, new RegExp('\\b' + c + '\\b'), c);
  for (const c of ['tank_id', 'station_id', 'measured_at', 'quantity', 'measured_by', 'notes']) assert.match(m, new RegExp('\\b' + c + '\\b'), c);
});
check('stock_movements : types utilisés autorisés par la contrainte', () => {
  const k = mig.match(/CREATE TABLE(?: IF NOT EXISTS)? stock_movements[\s\S]*?kind\s+TEXT NOT NULL CHECK \(kind IN \(([^)]*)\)/)[1];
  for (const v of ['achat', 'entree', 'perte', 'casse', 'correction', 'transfert', 'retour']) assert.ok(k.includes(`'${v}'`), v);
});
check('écriture de jauge refusée au-delà de 102 % de la capacité et dans le futur', () => {
  assert.match(src, /capacity_liters\) \* 1\.02/); assert.match(src, /Date de jauge dans le futur/);
});
console.log(`\n${n}/${n} contrôles réussis.`);
