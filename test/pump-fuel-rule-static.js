// Règle serveur : un compteur de pompe ne peut être relié qu'à un produit de la catégorie CARBURANT.
// Test statique (lecture du code) : ne nécessite pas les dépendances serveur.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'catalog.js'), 'utf8');
const checks = [];
const ok = (name, cond) => checks.push([name, !!cond]);

ok("fonction assertFuelProduct définie", /async function assertFuelProduct\(/.test(src));
ok("contrôle de catégorie CARBURANT dans la fonction", /p\.code !== 'CARBURANT'/.test(src));
ok("jointure produit → catégorie avec filtre de station",
  /JOIN categories cat ON cat\.id = p\.category_id WHERE p\.id = \$1 AND p\.station_id = \$2/.test(src));
const calls = src.match(/await assertFuelProduct\(/g) || [];
ok("appelée sur les 3 routes (création, modification, compteur)", calls.length === 3);
ok("POST /pumps contrôle avant insertion",
  /for \(const k of b\.counters\) \{\s*await assertFuelProduct\(c, k\.product_id/.test(src));
ok("PATCH contrôle seulement si le produit change",
  /if \(!cur \|\| cur\.product_id !== np\.id\) await assertFuelProduct/.test(src));
ok("PUT /counters/:n contrôle avant mise à jour",
  /await assertFuelProduct\(c, req\.body\.product_id, req\.sid, req\.params\.n\);\s*await c\.query\('UPDATE pump_counters SET product_id/.test(src));

let fails = 0;
for (const [name, pass] of checks) { if (!pass) fails++; console.log((pass ? '✓ ' : '✗ ') + name); }
if (fails) { console.error(fails + ' contrôle(s) en échec'); process.exit(1); }
console.log(checks.length + '/' + checks.length + ' contrôles réussis');
