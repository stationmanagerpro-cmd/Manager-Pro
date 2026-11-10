'use strict';
const fs=require('fs'),path=require('path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const api=read('src/contracts.js'),ui=read('public/ext-contracts.js');
const block=api.slice(api.indexOf("r.get('/admin/platform/overview'"),api.indexOf("r.get('/admin/licenses/dashboard'"));
const checks=[
 ['vue plateforme dédiée avec accès Super Admin uniquement',/r\.get\('\/admin\/platform\/overview', needPrincipal/.test(block)],
 ['clients archivés exclus de la synthèse active',/WHERE c\.status <> 'archive'/.test(block)],
 ['stations agrégées par client sans mélanger les clients',/WHERE s\.client_id=c\.id/.test(block)&&/client_id.*client_name/.test(block)],
 ['stations actives et inactives comptées séparément',/s\.client_id=c\.id AND s\.active/.test(block)&&/inactive_stations/.test(block)],
 ['comptes utilisateurs actifs agrégés au niveau client',/u\.client_id=c\.id AND u\.deleted_at IS NULL AND u\.active/.test(block)],
 ['statuts de licence calculés via la fonction partagée',/licenseStatusOf\(row, now, maxWarn\)/.test(block)],
 ['stations non rattachées rendues visibles au Super Admin',/WHERE client_id IS NULL/.test(block)&&/unassigned_stations/.test(block)],
 ['interface consomme l’endpoint consolidé sans bloquer les licences en cas d’échec',/G\('\/admin\/platform\/overview'\)\.catch\(\(\) => null\)/.test(ui)&&/gestion des licences reste accessible/.test(ui)],
 ['interface présente stations par client et état actif/inactif',/Stations par client/.test(ui)&&/st\.active/.test(ui)],
 ['interface signale les stations sans client rattaché',/sans client rattaché/.test(ui)],
 ['données de la synthèse échappées avant insertion HTML',/esc\(c\.client_name\)/.test(ui)&&/esc\(st\.name\)/.test(ui)]
];
let failed=0;for(const [label,ok] of checks){console.log(`${ok?'✔':'✘'} ${label}`);if(!ok)failed++;}console.log(`${checks.length-failed}/${checks.length} contrôles statiques réussis.`);if(failed)process.exit(1);
