'use strict';
// ANO-01 / RG-03 : prix d'achat, marges et valeur d'achat réservés à « cost.view » ; ANO-02 : aucune sauvegarde dans l'archive.
// Test statique : lit le code source (aucune base ni dépendance requise).
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
let passed = 0;
function check(label, fn) { fn(); passed++; console.log('✓ ' + label); }

check('migration 102 crée cost.view et l’accorde à ADMIN, GERANT, COMPTABLE uniquement', () => {
  const sql = read('migrations/102_cost_view_permission.sql');
  assert.match(sql, /'cost\.view'/);
  assert.match(sql, /r\.code IN \('ADMIN','GERANT','COMPTABLE'\)/);
  assert.doesNotMatch(sql, /POMPISTE|CAISSIER|SUPERVISEUR|MAGASINIER/);
});
check('setup.js donne cost.view au gérant et au comptable, jamais au pompiste/caissier', () => {
  const s = read('src/setup.js');
  const block = n => s.slice(s.indexOf('  ' + n + ': ['), s.indexOf('],', s.indexOf('  ' + n + ': [')));
  assert.match(block('GERANT'), /cost\.view/);
  assert.match(block('COMPTABLE'), /cost\.view/);
  for (const r of ['POMPISTE', 'CAISSIER', 'SUPERVISEUR', 'MAGASINIER']) assert.doesNotMatch(block(r), /cost\.view/, r);
});
check('maskCost retire buy_price sans cost.view et le conserve avec', () => {
  const src = read('src/core.js');
  const code = src.slice(src.indexOf('const canCost'), src.indexOf('// Station courante'));
  const ctx = {}; vm.createContext(ctx); vm.runInContext(code + ';this.maskCost=maskCost;this.canCost=canCost;', ctx);
  const row = { id: 1, buy_price: '900', sell_price: '1000', margin_pct: 10 };
  const pompiste = { user: { perms: new Set(['sale.create']) } }, gerant = { user: { perms: new Set(['cost.view']) } };
  assert.deepStrictEqual({ ...ctx.maskCost(pompiste, row) }, { id: 1, sell_price: '1000' });
  assert.strictEqual(ctx.maskCost(pompiste, [row])[0].buy_price, undefined);
  assert.strictEqual(ctx.maskCost(gerant, row).buy_price, '900');
});
check('GET /products, POST/PATCH /products masquent buy_price', () => {
  const s = read('src/catalog.js');
  assert.match(s, /res\.json\(maskCost\(req, rows\)\)/);
  assert.match(s, /res\.status\(201\)\.json\(maskCost\(req, p\)\)/);
  assert.match(s, /res\.json\(maskCost\(req, out\)\)/);
  assert.ok((s.match(/!canCost\(req\)\) throw new HttpError\(403/g) || []).length >= 2, 'écriture de buy_price refusée sans cost.view');
});
check('GET /stock/overview ne renvoie ni buy_price ni valeur d’achat sans cost.view', () => {
  const s = read('src/operations.js');
  assert.match(s, /low_stock: maskCost\(req, low\)/);
  assert.match(s, /\.\.\.\(canCost\(req\) \? \{ stock_value_buy: valueBuy \} : \{\}\)/);
});
check('exports Produits et Stocks : colonnes de coût retirées sans cost.view', () => {
  const s = read('src/exports.js');
  assert.ok((s.match(/perms\.has\('cost\.view'\) \? d(prod|stock) : dropCols\(d(prod|stock), \[5, 7\]\)/g) || []).length === 2);
});
check('fiche produit : coût réservé à cost.view (plus report.view / price.edit)', () => {
  const s = read('src/product_profile.js');
  assert.doesNotMatch(s, /const canCost = req => \['price\.edit'/);
  assert.match(s, /buy_price: cost \? n2\(buyP\) : null/);
  assert.match(s, /buy_price: cost \? n2\(buy\) : null/);
  assert.match(s, /cost\.view/);
});
check('interface : colonnes de coût conditionnées à can(\'cost.view\')', () => {
  for (const f of ['public/ext-product-catalog.js', 'public/ext-stock-reports.js', 'public/app.js']) assert.match(read(f), /cost\.view/, f);
});
check('ANO-02 : aucune sauvegarde dans l’archive et .gitignore protège backups/ et uploads/', () => {
  assert.ok(!fs.existsSync(path.join(root, 'backups')) || fs.readdirSync(path.join(root, 'backups')).filter(f => /\.(sql\.gz|dump|bak)$/.test(f)).length === 0, 'backups/*.sql.gz présent');
  const gi = read('.gitignore').split(/\r?\n/).map(x => x.trim());
  for (const e of ['backups/', 'uploads/', '.env', 'node_modules/']) assert.ok(gi.includes(e), e + ' absent de .gitignore');
  assert.ok(gi.includes('*.sql.gz'));
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.name === 'node_modules' ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  const leaks = walk(root).filter(f => /\.(sql\.gz|dump|bak|pem|key)$/i.test(f) || /(^|[\\/])\.env$/.test(f));
  assert.deepStrictEqual(leaks, [], 'fichiers sensibles : ' + leaks.join(', '));
});
console.log(`${passed}/${passed} contrôles réussis`);
