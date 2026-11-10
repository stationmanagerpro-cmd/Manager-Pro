const fs = require('fs');
const premium = fs.readFileSync('src/premium.js','utf8');
const ui = fs.readFileSync('public/ext-premium.js','utf8');
const checks = [
  ['route modification pack', /r\.put\('\/admin\/packs\/:code'/.test(premium)],
  ['route création pack', /r\.post\('\/admin\/packs'/.test(premium)],
  ['validation du code unique', /code: z\.string\(\)\.min\(2\)/.test(premium)],
  ['modules encodés dans features', /packFeatures\(d\.modules\)/.test(premium)],
  ['modules du pack désactivés explicitement', /known\.map\(m => \[m, false\]\)/.test(premium)],
  ['application pack avec fusion des modules', /features\.modules = \{ \.\.\.oldModules, \.\.\.packModules \}/.test(premium)],
  ['bouton modifier par ligne', /editSubscriptionPack\('\$\{esc\(p\.code\)\}'\)/.test(ui)],
  ['bouton ajouter formule', /createSubscriptionPack\(\)/.test(ui)],
  ['formulaire modifiable modules', /Modules activés \(séparés par des virgules\)/.test(ui)],
  ['sauvegarde modification API', /api\('PUT','\/admin\/packs\//.test(ui)],
  ['création API', /api\('POST','\/admin\/packs'/.test(ui)],
  ['renouvellement conservé', /handleRenewal/.test(ui)]
];
const failed = checks.filter(x=>!x[1]);
if (failed.length) { console.error('ÉCHEC:', failed.map(x=>x[0]).join(', ')); process.exit(1); }
console.log(`OK — ${checks.length} contrôles statiques des formules d’abonnement`);
