'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const core = fs.readFileSync(path.join(root, 'public/ext-core.js'), 'utf8');
const hr = fs.readFileSync(path.join(root, 'src/hr.js'), 'utf8');
for (const label of ['Indemnités et autres gains', 'AMO salarié / employeur', 'INPS salarié / employeur', 'Autres charges patronales']) {
  if (!core.includes(label)) throw new Error(`Aide de diagnostic manquante : ${label}`);
}
if (!core.includes('p.feature_flags && p.feature_flags[flag]')) throw new Error('Le diagnostic doit tenir compte de l’état des feature flags');
if (!core.includes('N’activez le module qu’après validation')) throw new Error('Le diagnostic doit rappeler de ne pas activer des taux non validés');
if (!hr.includes("Feature flag payroll_amo_enabled = OFF") || !hr.includes("Feature flag payroll_inps_enabled = OFF") || !hr.includes("Feature flag payroll_its_enabled = OFF")) {
  throw new Error('Les raisons des calculs sociaux/fiscaux désactivés doivent rester explicites côté serveur');
}
console.log('OK payroll-zero-amount-guidance-static');
