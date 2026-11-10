'use strict';
const fs = require('fs');
const assert = require('assert');
const app = fs.readFileSync('public/app.js', 'utf8');
const files = Object.fromEntries(['public/ext-fin.js', 'public/ext-core.js', 'public/ext-p12.js', 'public/ext-p10.js'].map(p => [p, fs.readFileSync(p, 'utf8')]));
let passed = 0;
function check(label, fn) { fn(); passed++; console.log('✔ ' + label); }
check('un helper sérialise les chaînes en littéraux JavaScript puis échappe le HTML', () => assert.match(app, /jsArg\s*=\s*s\s*=>\s*esc\(JSON\.stringify\(String\(s \?\? ''\)\)/));
check('le helper neutralise les caractères < et les séparateurs Unicode dangereux', () => assert.match(app, /replace\(\/<\/g, '\\\\u003c'\).*replace\(\/\\u2028\/g, '\\\\u2028'\).*replace\(\/\\u2029\/g, '\\\\u2029'/));
check('le nom de sauvegarde est encodé dans le chemin et sérialisé comme argument JS', () => assert.match(files['public/ext-fin.js'], /dlFile\('\/admin\/backups\/\$\{encodeURIComponent\(b\.name\)\}',\$\{jsArg\(b\.name\)\}\)/));
check('les numéros de reçus et de bulletins passent par le sérialiseur JS', () => assert.match(files['public/ext-core.js'], /receipt\.pdf',\$\{jsArg\(p\.receipt_no\)\}\)/) && assert.match(files['public/ext-core.js'], /payroll\/\$\{s\.id\}\/pdf',\$\{jsArg\(s\.number\)\}\)/));
check('les clés de paramètres dynamiques ne sont plus concaténées dans des chaînes JS', () => assert.match(files['public/ext-p12.js'], /editSettingKey\(\$\{jsArg\(k\)\}\)/) && assert.match(files['public/ext-p12.js'], /resetSettingKey\(\$\{jsArg\(k\)\}\)/));
check('les raccourcis du dashboard utilisent le sérialiseur JS', () => assert.match(files['public/ext-p10.js'], /onclick="go\(\$\{jsArg\(k\)\}\)"/));
// ANO-05 : interpolations non échappées signalées par l'audit du 09/11/2026
const rd = f => fs.readFileSync(f, 'utf8');
check('ANO-05 : le nom de fichier de sauvegarde client passe par jsArg dans le onclick', () => {
  const s = rd('public/ext-detail-pages.js');
  assert.match(s, /downloadClientBackup\(\$\{Number\(id\)\},\$\{jsArg\(x\.name\)\}\)/);
  assert.doesNotMatch(s, /downloadClientBackup\(\$\{id\},'\$\{x\.name\}'\)/);
});
check('ANO-05 : titre, libellé de compteur et texte vide de ext-parties.js sont échappés', () => {
  const s = rd('public/ext-parties.js');
  assert.match(s, /\$\{esc\(c\.title\)\}/); assert.match(s, /data-label="\$\{esc\(c\.countLabel\)\}"/); assert.match(s, /\$\{esc\(c\.emptyText\)\}/);
  assert.doesNotMatch(s, /\$\{c\.title\}|\$\{c\.emptyText\}/);
});
check('ANO-05 : le libellé de groupe (def.label) de ext-p12.js est échappé et la clé sérialisée', () => {
  const s = rd('public/ext-p12.js');
  assert.match(s, /goAdminGroup\(\$\{jsArg\(g\)\}\)">\$\{esc\(def\.label\)\}/);
});
check('ANO-05 : aucun nom saisi ne passe par un échappement partiel dans un onclick (archSet, mpReject)', () => {
  for (const f of ['public/ext-archive.js', 'public/ext-product-profile.js']) assert.doesNotMatch(rd(f), /archSet\([^)]*String\((name|p\.name)\)\.replace/, f);
  assert.match(rd('public/ext-archive.js'), /archSet\('\$\{kind\}',\$\{id\},\$\{active\},\$\{jsArg\(name\)\}\)/);
  assert.match(rd('public/ext-my-profile.js'), /mpReject\(\$\{jsArg\(x\.ref\)\}\)/);
});
console.log(`\n${passed}/${passed} contrôles statiques réussis.`);
