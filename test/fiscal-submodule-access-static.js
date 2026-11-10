'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const contracts = fs.readFileSync(path.join(root, 'src/contracts.js'), 'utf8');
const fiscal = fs.readFileSync(path.join(root, 'src/fiscal.js'), 'utf8');
if (!contracts.includes('fiscalSubmoduleEnabled') || !contracts.includes('f.modules.fiscal = true')) {
  throw new Error('mergeFeatures doit ouvrir le module global lorsqu’un sous-module fiscal est activé');
}
if (!fiscal.includes('fiscalSubmoduleEnabled') || !fiscal.includes('features.can_access_fiscal = true')) {
  throw new Error('La sauvegarde des autorisations fiscales doit synchroniser l’accès global et les sous-modules');
}
console.log('OK fiscal-submodule-access-static');
