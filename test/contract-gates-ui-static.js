/**
 * Test statique : chaque featureOn / FEATURE_DISABLED du serveur
 * doit avoir un champ correspondant dans featureFormFields (ext-contracts).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'src/server.js'), 'utf8');
const contracts = fs.readFileSync(path.join(root, 'src/contracts.js'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'public/ext-contracts.js'), 'utf8');

const flags = new Set();
const re = /featureOn\([^,]+,\s*['"]([^'"]+)['"]\)/g;
let m;
for (const src of [server, contracts, fs.readFileSync(path.join(root, 'src/messaging.js'), 'utf8'),
  fs.readFileSync(path.join(root, 'src/billing.js'), 'utf8'),
  fs.readFileSync(path.join(root, 'src/fiscal.js'), 'utf8')]) {
  while ((m = re.exec(src))) flags.add(m[1]);
}
// Normalize module:x -> need module_x or related can_
const formKeys = [...ui.matchAll(/\[['\']([a-z_]+)['\']/g)].map(x => x[1]);
const formSet = new Set(formKeys);

let missing = [];
for (const f of flags) {
  if (f.startsWith('module:')) {
    const mod = f.slice(7);
    const ok = formSet.has('module_' + mod) || formSet.has('can_access_' + mod) ||
      formSet.has('can_use_' + mod) || formSet.has(mod) ||
      (mod === 'auto_alerts' && formSet.has('module_auto_alerts')) ||
      (mod === 'messaging' && formSet.has('can_use_messaging')) ||
      (mod === 'hr' && formSet.has('can_access_hr')) ||
      (mod === 'finance' && formSet.has('can_access_finance')) ||
      (mod === 'reports' && formSet.has('can_view_reports')) ||
      (mod === 'fiscal' && formSet.has('can_access_fiscal')) ||
      (mod === 'sales' && formSet.has('module_sales')) ||
      (mod === 'stock' && formSet.has('module_stock')) ||
      mod.startsWith('fiscal_');
    if (!ok) missing.push(f);
  } else {
    const ok = formSet.has(f) ||
      (f === 'can_access_personalization' && formSet.has('can_personalize')) ||
      (f === 'can_use_auto_alerts' && formSet.has('module_auto_alerts'));
    if (!ok) missing.push(f);
  }
}

console.log('Flags détectés:', flags.size);
console.log('Champs formulaire:', formSet.size);
if (missing.length) {
  console.error('MANQUANTS dans le formulaire Superadmin:', missing);
  process.exit(1);
}
console.log('OK — toutes les features gateées ont un champ UI correspondant.');
