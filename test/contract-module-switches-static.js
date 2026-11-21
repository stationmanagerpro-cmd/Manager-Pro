/**
 * Test statique : les modules Oui / Non des formulaires client (Nouveau client, Gérer client)
 * sont rangés dans des familles, chacune avec un interrupteur Actif / Inactif d'en-tête.
 * Chaque module Oui / Non doit appartenir à exactement une famille.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'public/ext-contracts.js'), 'utf8');
const engine = fs.readFileSync(path.join(root, 'public/ext-sectioned-form.js'), 'utf8');

const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg); };

// Bloc featureFormFields : clés des champs Oui / Non (type 's', options YN)
const ffStart = ui.indexOf('function featureFormFields()');
const ffEnd = ui.indexOf('function featureDefaultsFromContract');
const ffBlock = ui.slice(ffStart, ffEnd);
const yesNo = [...ffBlock.matchAll(/\['([a-z_]+)', '[^']*', 's', YN\]/g)].map(m => m[1]);
const allKeys = [...ffBlock.matchAll(/\['([a-z_]+)', '/g)].map(m => m[1]);

// Bloc MODULE_GROUPS : familles et leurs clés
const mgStart = ui.indexOf('const MODULE_GROUPS = {');
const mgEnd = ui.indexOf('\n  };', mgStart);
const mgBlock = ui.slice(mgStart, mgEnd);
const families = [...mgBlock.matchAll(/(\w+): \{ title:/g)].map(m => m[1]);
const groupKeys = [...mgBlock.matchAll(/keys: \[([^\]]*)\]/g)]
  .flatMap(m => [...m[1].matchAll(/'([a-z_]+)'/g)].map(x => x[1]));

const count = {};
groupKeys.forEach(k => { count[k] = (count[k] || 0) + 1; });
const dups = Object.keys(count).filter(k => count[k] > 1);
check(dups.length === 0, 'modules présents dans plusieurs familles : ' + dups.join(', '));

const missing = yesNo.filter(k => !count[k]);
check(missing.length === 0, 'modules Oui / Non sans famille : ' + missing.join(', '));

const unknown = Object.keys(count).filter(k => !allKeys.includes(k));
check(unknown.length === 0, 'clés de famille inconnues de featureFormFields : ' + unknown.join(', '));

check(yesNo.length > 30, 'trop peu de modules Oui / Non détectés (' + yesNo.length + ')');
check(families.length === 10, 'nombre de familles inattendu : ' + families.length);
check(/function featureFormFieldsSw\(\)/.test(ui), 'featureFormFieldsSw absente');
check(/\[f\[0\], f\[1\], 'sw'\]/.test(ui), 'conversion Oui / Non vers interrupteur absente');
check((ui.match(/\.\.\.moduleSections\(\)/g) || []).length === 2, 'sections modules absentes dans les deux formulaires');
check(/ty === 'sw'/.test(engine) && /class="sf-sw"/.test(engine), 'moteur : rendu interrupteur absent');
check(/closest\('\.sf-sw \.sf-seg'\)/.test(engine), 'moteur : clic sur interrupteur non relié');
check(/Activation globale des modules/.test(ui), 'barre d’activation globale absente');

if (fail.length) {
  console.error('ÉCHEC contract-module-switches-static :\n - ' + fail.join('\n - '));
  process.exit(1);
}
console.log('OK contract-module-switches-static : ' + yesNo.length + ' modules Oui / Non répartis en ' + families.length + ' familles');
