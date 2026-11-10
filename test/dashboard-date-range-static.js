'use strict';
const fs = require('fs');
const source = fs.readFileSync(require('path').join(__dirname, '..', 'src', 'reports.js'), 'utf8');
const checks = [
  ['validation stricte des dates calendaires via aller-retour ISO', /function validDay\(value\)[\s\S]*?d\.toISOString\(\)\.slice\(0, 10\) === value/.test(source)],
  ['tableau de bord principal utilise le normalisateur de période', /r\.get\('\/dashboard'[\s\S]*?dashboardRange\(req\.query\.from, req\.query\.to\)/.test(source)],
  ['overview utilise le normalisateur de période', /r\.get\('\/dashboard\/overview'[\s\S]*?dashboardRange\(req\.query\.from, req\.query\.to\)/.test(source)],
  ['centre de pilotage utilise le normalisateur de période', /r\.get\('\/dashboard\/pilotage'[\s\S]*?dashboardRange\(req\.query\.from, req\.query\.to\)/.test(source)],
  ['période longue limitée à 366 jours', /365 \* 86400000/.test(source) && /if \(to > maxTo\) to = maxTo/.test(source)],
  ['comparaison précédente rejette une période inversée', /validDay\(req\.query\.pto\) && pfrom && req\.query\.pto >= pfrom/.test(source)],
  ['série quotidienne bornée entre 1 et 90 jours', /Math\.min\(90, Math\.max\(1, requestedDays\)\)/.test(source)],
];
let failed = 0;
for (const [label, ok] of checks) { console.log(`${ok ? '✔' : '✘'} ${label}`); if (!ok) failed++; }
console.log(`${checks.length - failed}/${checks.length} contrôles statiques réussis.`);
if (failed) process.exit(1);
