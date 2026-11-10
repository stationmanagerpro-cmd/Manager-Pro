'use strict';
// Profil personnel : câblage serveur / interface / migration (aucune base requise).
const assert = require('assert'); const fs = require('fs');
const rd = p => fs.readFileSync(p, 'utf8');
const server = rd('src/server.js'), ui = rd('public/ext-my-profile.js'), idx = rd('public/index.html'), sw = rd('public/sw.js'), mig = rd('migrations/091_profil_personnel_journal.sql');
const app = rd('public/app.js'), shell = rd('public/ext-shell.js'), api = rd('src/my_profile.js');
let n = 0; const check = (l, fn) => { fn(); n++; console.log('✔ ' + l); };

check('le journal d’écritures est monté après l’authentification et le contrôle de station', () => {
  const a = server.indexOf("app.use('/api', station);"), b = server.indexOf("require('./activity_log').middleware"), c = server.indexOf("app.use('/api', require('./my_profile'))");
  assert(a > 0 && b > a && c > b);
});
check('migration : table en ajout seul, sans clé étrangère (survit aux suppressions et restaurations)', () => {
  assert.match(mig, /CREATE TABLE IF NOT EXISTS user_activity_log/); assert.match(mig, /BEFORE UPDATE OR DELETE ON user_activity_log/); assert(!/REFERENCES/.test(mig));
  assert.match(mig, /matricule\s+TEXT/); assert.match(mig, /user_name\s+TEXT/);
});
check('« Mon compte » est remplacé par « Mon profil » partout dans les menus', () => {
  assert.match(shell, /label: 'Mon profil & aide'/); assert(!/Mon compte & aide/.test(shell)); assert.match(rd('public/ext-core.js'), /moi: \['Mon profil', '\*'\]/);
});
check('le profil ne dépend plus du module RH du contrat', () => {
  assert(!/'empf','moi'\]/.test(app)); assert(/'empf'\]\.includes\(k\)/.test(app));
});
check('script, feuille de style et cache hors-ligne enregistrés', () => {
  assert.match(idx, /ext-my-profile\.js/); assert.match(idx, /ext-my-profile\.css/); assert.match(sw, /ext-my-profile\.js/); assert.match(sw, /ext-my-profile\.css/); assert(/smp-static-b[0-9a-f]{10}/.test(sw));
  assert(idx.indexOf('ext-my-profile.js') > idx.indexOf('ext-ux-v2.js'), 'chargé après ext-ux-v2 pour remplacer la vue « moi »');
});
check('l’interface expose les onglets demandés : indicateurs, autorisations, journal + exports PDF / Excel', () => {
  for (const s of ['Mes indicateurs', 'Mes autorisations', 'Mon journal', 'Mes bulletins', 'Sécurité & préférences']) assert(ui.includes(s), s);
  assert.match(ui, /mpExport\('pdf'\)/); assert.match(ui, /mpExport\('xlsx'\)/); assert.match(ui, /\/me\/profile\/activity\/export/);
  for (const k of ['pompiste', 'caissier', 'comptable', 'superviseur', 'gerant', 'admin']) assert(new RegExp(k + ':').test(ui), k);
});
check('le rejet d’une action faite à son nom passe par la route existante (rien n’est supprimé)', () => {
  assert.match(ui, /\/hr\/actions\/\$\{id\}\/reject/);
});
check('API : lecture seule, strictement personnelle', () => {
  assert(!/r\.(post|put|patch|delete)\(/.test(api), 'aucune route d’écriture'); assert(!/req\.params\.(id|user)/.test(api) && !/req\.query\.user/.test(api), 'aucun identifiant d’utilisateur fourni par le client');
  assert.match(api, /await audit\(pool, req, 'profil'/);
});
console.log(`\n${n} contrôles réussis`);
