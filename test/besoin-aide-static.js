'use strict';
// Besoin d'aide : entrée « Mon profil & aide » (clients et superadmin), vue en cartes par module, édition superadmin.
const fs = require('fs'), assert = require('assert');
const rd = p => fs.readFileSync(p, 'utf8');
const idx = rd('public/index.html'), help = rd('public/ext-help.js'), app = rd('public/app.js'), shell = rd('public/ext-shell.js');
const srv = rd('src/server.js'), route = rd('src/help_guides.js'), mig = rd('migrations/120_help_guides.sql');

// 1. Pas de bouton dans l'en-tête : seule l'entrée du menu « Mon profil & aide » reste.
assert(!idx.includes('help-top-btn') && !help.includes('help-top-btn'), 'aucun bouton « Besoin d\'aide » dans l\'en-tête');
// 2. Accès : vue ouverte à tout compte connecté, sans passer par SUPERADMIN_VIEWS (alias de GLOBAL_ONLY_VIEWS).
assert(/if \(k === 'besoin_aide'\) return true;/.test(app), 'canView autorise besoin_aide pour tous les comptes');
assert(!help.includes("SUPERADMIN_VIEWS.add('besoin_aide')") && !/SUPERADMIN_VIEWS = new Set\([^)]*besoin_aide/.test(app), 'besoin_aide n\'est pas réservé à la plateforme');
assert(help.includes("V.besoin_aide = [\"Besoin d'aide\", '*']") && help.includes('VM.besoin_aide') && !/V\.aide\s*=/.test(help), 'vue enregistrée sous besoin_aide (le manuel garde aide)');
// 3. Menu : entrée pour les clients et pour le superadmin, sous « Mon profil & aide ».
assert(/keys: \['moi', 'clients', 'onboard', 'aide', 'besoin_aide'\]/.test(shell), 'entrée dans « Mon profil & aide » (clients)');
assert(/label: 'Mon profil & aide', icon: 'settings', keys: \['besoin_aide'\]/.test(shell), 'entrée dans « Mon profil & aide » (superadmin)');
// 4. Superadmin : toutes les cartes de module, avec le bouton Modifier.
assert(help.includes('(isSuper || canView(k))') && help.includes('const isSuper = !!(ME && ME.is_global)'), 'superadmin voit tous les modules de la vue, droit lu dans la session');
assert(help.includes("helpEdit('") && help.includes('data.is_superadmin'), 'bouton Modifier réservé au superadmin');
// 5. Stockage et écriture côté serveur.
assert(help.includes("G('/help-guides')") && help.includes("Pu('/help-guides/'"), 'lecture et écriture via /api/help-guides');
assert(!/https?:\/\/[a-z0-9]/i.test(help), 'aucun lien vidéo inventé');
assert(srv.includes("require('./help_guides').r"), 'route montée dans server.js');
assert(route.includes('req.user.is_global') && route.includes('403'), 'écriture réservée au Super Admin');
assert(mig.includes('CREATE TABLE IF NOT EXISTS help_guides'), 'migration de la table');
const keysOf = (src, re) => (src.match(re) || [''])[0].match(/'[a-z]+'/g) || [];
assert.deepStrictEqual(keysOf(help, /const HELP_MODULES = \[[^\]]*\]/), keysOf(route, /const HELP_KEYS = \[[^\]]*\]/), 'mêmes modules côté interface et serveur');
assert(idx.indexOf('ext-help.js') > idx.indexOf('/app.js') && idx.indexOf('ext-help.js') > 0, 'ext-help.js chargé après app.js');
console.log('✔ besoin d\'aide : entrée du menu (clients et superadmin), accès à la vue, cartes et édition superadmin');
console.log('OK besoin-aide-static (14 assertions)');
