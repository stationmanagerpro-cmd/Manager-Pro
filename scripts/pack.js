#!/usr/bin/env node
// Emballage sûr du projet (audit 2026-11-03, réf. A1) : exclut .env, node_modules, backups, uploads, .git.
// Usage : npm run pack  → crée ../ManagePro_V<version>_<date>.zip (aucun secret dedans)
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const EXCLUDE_DIRS = new Set(['node_modules', 'backups', 'uploads', '.git', 'dist']);
const EXCLUDE_FILES = [/^\.env$/i, /^\.env\.(?!example$|pc\.example$).+/i, /\.pem$/i, /\.key$/i, /\.(dump|sql\.gz|bak)$/i];

// ANO-10 : le cache du service worker est dérivé du contenu de l'interface ; on le régénère avant tout empaquetage.
if (spawnSync(process.execPath, [path.join(__dirname, 'build-sw.js')], { stdio: 'inherit' }).status !== 0) { console.error('Échec de la génération de public/sw.js.'); process.exit(1); }

const version = require(path.join(root, 'package.json')).version;
const stamp = new Date().toISOString().slice(0, 10);
const name = `ManagePro_V${version}_${stamp}`;
const stage = path.join(require('os').tmpdir(), `${name}_stage`, name);
fs.rmSync(path.dirname(stage), { recursive: true, force: true });

let copied = 0, skipped = [];
(function walk(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (EXCLUDE_DIRS.has(e.name)) { skipped.push(path.relative(root, path.join(src, e.name)) + '/'); continue; }
      walk(path.join(src, e.name), path.join(dst, e.name));
    } else if (EXCLUDE_FILES.some(re => re.test(e.name))) {
      skipped.push(path.relative(root, path.join(src, e.name)));
    } else {
      fs.copyFileSync(path.join(src, e.name), path.join(dst, e.name)); copied++;
    }
  }
})(root, stage);

const out = path.resolve(root, '..', `${name}.zip`);
fs.rmSync(out, { force: true });
const r = process.platform === 'win32'
  ? spawnSync('tar', ['-a', '-c', '-f', out, '-C', path.dirname(stage), name], { stdio: 'inherit' })
  : spawnSync('zip', ['-qr', out, name], { cwd: path.dirname(stage), stdio: 'inherit' });
fs.rmSync(path.dirname(stage), { recursive: true, force: true });
if (r.status !== 0) { console.error('Échec de la création du ZIP.'); process.exit(1); }
console.log(`OK : ${out}\n${copied} fichiers. Exclus : ${skipped.join(', ') || 'rien'}`);
