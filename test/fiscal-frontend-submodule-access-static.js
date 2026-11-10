'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
const fiscal = fs.readFileSync(path.join(root, 'public/ext-fiscal.js'), 'utf8');
if (!app.includes("name.startsWith('fiscal_')") || !app.includes('submoduleOn')) {
  throw new Error('Le menu et le contrôle fiscal.access doivent reconnaître les sous-modules autorisés');
}
if (!fiscal.includes("name.startsWith('fiscal_')") || !fiscal.includes('fiscalSubmoduleOn')) {
  throw new Error('Le parcours fiscal doit reconnaître les sous-modules autorisés');
}
console.log('OK fiscal-frontend-submodule-access-static');
