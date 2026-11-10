'use strict';
const fs=require('fs'),path=require('path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const route=read('src/reports.js'),ui=read('public/app.js');
const block=route.slice(route.indexOf("r.get('/dashboard/pilotage'"),route.indexOf("r.get('/audit'"));
const checks=[
 ['route pilotage protégée par les permissions de rapport/finance',/r\.get\('\/dashboard\/pilotage', need\('report\.view', 'finance\.view'\)/.test(block)],
 ['dates de période validées et comparaison à durée identique',/dashboardRange\(req\.query\.from, req\.query\.to\)/.test(block)&&/previous_from: prevFrom, previous_to: prevTo, days/.test(block)],
 ['ventes validées et carburant des quarts clôturés uniquement',/status='valide' AND kind='produits'/.test(block)&&/sh\.status='ferme'/.test(block)],
 ['données strictement limitées à la station autorisée',/const stationId = req\.sid/.test(block)&&/station_id=\$1/.test(block)],
 ['indicateur CA moins dépenses réservé à la permission finance',/const canFinance = req\.user\.perms\.has\('finance\.view'\)/.test(block)&&/revenue_minus_expenses: canFinance \?/.test(block)],
 ['alertes RH non agrégées pour les profils sans permission RH',/req\.user\.perms\.has\('hr\.view'\).*Promise\.resolve\(\[\]\)/s.test(block)],
 ['aucune présentation du CA moins dépenses comme bénéfice',/bénéfice comptable/.test(block)],
 ['interface consomme le nouvel endpoint sans bloquer le dashboard si indisponible',/G\(`\/dashboard\/pilotage\?from=\$\{a\}&to=\$\{b\}`\)\.catch\(\(\) => null\)/.test(ui)],
 ['interface présente comparaison de périodes et actions prioritaires',/Centre de pilotage/.test(ui)&&/Actions prioritaires/.test(ui)&&/previous_from/.test(ui)],
 ['variations sans base de comparaison explicitement signalées',/Référence indisponible/.test(ui)],
];
let failed=0;for(const [label,ok] of checks){console.log(`${ok?'✔':'✘'} ${label}`);if(!ok)failed++;}console.log(`${checks.length-failed}/${checks.length} contrôles statiques réussis.`);if(failed)process.exit(1);
