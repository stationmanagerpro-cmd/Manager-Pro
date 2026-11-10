// Séparation identité plateforme (Manager Pro) vs comptes clients / stations.
const fs = require('fs');
const assert = require('assert');
const path = require('path');
const root = path.join(__dirname, '..');

let n = 0;
const ok = (c, m) => { assert(c, m); n++; console.log('  ✔ ' + m); };

const shell = fs.readFileSync(path.join(root, 'public/ext-shell.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
const docs = fs.readFileSync(path.join(root, 'src/docs.js'), 'utf8');
const branding = fs.readFileSync(path.join(root, 'src/branding.js'), 'utf8');
const auth = fs.readFileSync(path.join(root, 'src/auth.js'), 'utf8');

console.log('=== Isolation branding plateforme / clients ===');

// Backend : écriture branding = SuperAdmin only
ok(/Seul l'administrateur principal peut modifier l'identité de l'application/.test(branding),
  'Modification branding réservée au SuperAdmin');
ok(/app_logo_path/.test(branding), 'Logo site stocké dans app_settings (app_logo_path)');

// Photo personnelle : scoped user id
ok(/UPDATE users SET photo_path = \$2 WHERE id = \$1/.test(auth),
  'Photo profil utilisateur = users.photo_path de l’utilisateur connecté uniquement');
ok(/PUT.*\/me\/photo|priv\.put\('\/me\/photo'/.test(auth), 'Route PUT /me/photo dédiée');

// PDF : plus de repli sur logo Manager Pro
ok(!/\|\|\s*\(await files\.read\(app\.logo_path\)\)/.test(docs),
  'docs.branding ne replie plus sur app.logo_path');
ok(/stationLogo|st\?\.photo_path \? await files\.read\(st\.photo_path\)/.test(docs) ||
   /logo: stationLogo \|\| null/.test(docs),
  'Logo PDF = logo station uniquement (ou null)');

// UI : pas de brandMarkInner en repli client
ok(!/catch \(_\) \{ logoHtml = brandMarkInner\(\); \}/.test(shell),
  'refreshTenantBrand n’utilise plus brandMarkInner en cas d’échec logo station');
ok(/jamais le logo Manager Pro|pas le logo Manager Pro|repli neutre/.test(shell),
  'Commentaire / logique explicite : pas de logo plateforme pour le tenant');
ok(/data-brand-scope/.test(shell), 'Menu latéral marque platform vs tenant');
ok(/platformOnly|data-brand-scope !== 'tenant'/.test(app),
  'applyBrand n’écrase pas les éléments data-brand-scope=tenant');

console.log(`\n✔ Isolation branding : ${n}/${n}`);
