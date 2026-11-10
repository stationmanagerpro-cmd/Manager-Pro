'use strict';
// ANO-11, 12, 13, 14, 16 (RG-06, RG-09, RG-11) : hygiène du dépôt, fins de ligne, numérotation, version unique, domaine Caddy.
const fs = require('fs'), path = require('path'), assert = require('assert'), { spawnSync } = require('child_process');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
let passed = 0; function check(l, fn) { fn(); passed++; console.log('✓ ' + l); }
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => ['node_modules', '.git', 'backups', 'uploads'].includes(e.name) ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);

check('ANO-11 : aucun script de dépannage ni capture à la racine ; ils vivent dans scripts/dev/', () => {
  const rootFiles = fs.readdirSync(root).filter(f => fs.statSync(path.join(root, f)).isFile());
  assert.deepStrictEqual(rootFiles.filter(f => /^(check-.*\.js|fix-.*\.cjs|forms_report\.json|shot-.*\.png)$/.test(f)), []);
  assert.ok(fs.existsSync(path.join(root, 'scripts/dev/check-db.js')) && fs.existsSync(path.join(root, 'scripts/dev/README.md')));
});
check('ANO-11 : .dockerignore exclut scripts/dev, check-*, fix-*, forms_report.json', () => {
  const d = read('.dockerignore').split(/\r?\n/);
  for (const e of ['scripts/dev', 'check-*.js', 'fix-*.cjs', 'forms_report.json', 'node_modules', '.env', 'backups', 'uploads']) assert.ok(d.includes(e), e);
});
check('ANO-12 : .gitattributes impose LF (sauf .bat/.ps1) et aucun CRLF dans le code, les migrations, la doc', () => {
  const g = read('.gitattributes'); assert.match(g, /\* text=auto eol=lf/); assert.match(g, /\*\.bat text eol=crlf/);
  const crlf = walk(root).filter(f => /\.(js|cjs|css|html|sql|md|json)$/.test(f) && !f.includes(path.join('scripts', 'windows')) && fs.readFileSync(f, 'utf8').includes('\r\n'));
  assert.deepStrictEqual(crlf.map(f => path.relative(root, f)), []);
});
check('ANO-13 : exceptions de numérotation documentées ; nouveaux numéros uniques et croissants', () => {
  const doc = read('docs/MIGRATIONS_NUMEROTATION.md');
  for (const n of ['027', '040', '059', '056', '067']) assert.ok(doc.includes(n), n);
  const nums = fs.readdirSync(path.join(root, 'migrations')).filter(f => f.endsWith('.sql')).map(f => +f.split('_')[0]);
  for (const n of [102, 103]) assert.strictEqual(nums.filter(x => x === n).length, 1);
});
check('ANO-14 : une seule version (package.json = package-lock = application = archive)', () => {
  const v = JSON.parse(read('package.json')).version;
  assert.match(v, /^1\.11\.\d+$/);
  const lock = JSON.parse(read('package-lock.json')); assert.strictEqual(lock.version, v); assert.strictEqual(lock.packages[''].version, v);
  assert.match(read('src/admin.js'), /app_version/); assert.match(read('public/ext-p12.js'), /ov\.app_version/);
  assert.match(read('src/server.js'), /require\('\.\.\/package\.json'\)\.version/);
});
check('ANO-16 : Caddyfile sans domaine fictif (variable APP_DOMAIN) et contrôle par npm run doctor', () => {
  const c = read('Caddyfile'); assert.ok(!/votredomaine/i.test(c)); assert.match(c, /^\{\$APP_DOMAIN\} \{/m);
  assert.match(read('.env.example'), /^APP_DOMAIN=/m); assert.match(read('scripts/doctor.js'), /APP_DOMAIN non renseigné/);
});
check('ANO-15 : outil de mesure fourni, aucun cache de permissions ajouté sans mesure', () => {
  assert.ok(fs.existsSync(path.join(root, 'scripts/bench-auth.js')));
  assert.doesNotMatch(read('src/core.js'), /permCache|PERM_CACHE|permissionsCache/i);
});
console.log(`${passed}/${passed} contrôles réussis`);
