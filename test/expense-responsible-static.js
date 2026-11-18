'use strict';
// ANO-016 : toute dépense a un responsable (compte de la station), désigné par une autre personne, avec motif obligatoire.
// Vérification statique du code (la base n'est pas disponible dans ce contrôle).
const fs = require('fs'), path = require('path'), assert = require('assert');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const ops = read('src/operations.js'), app = read('public/app.js');
const mig = fs.readdirSync(path.join(__dirname, '..', 'migrations')).find(f => /^123_/.test(f));
let n = 0; const check = (l, fn) => { fn(); n++; console.log('✔ ' + l); };
check('migration 123 : colonne responsible_user_id nullable, sans effet sur l’historique', () => {
  assert(mig, 'migration 123 absente');
  const sql = read('migrations/' + mig);
  assert(/ADD COLUMN IF NOT EXISTS responsible_user_id BIGINT REFERENCES users\(id\)/.test(sql));
  assert(!/NOT NULL/.test(sql.split('\n').filter(l => /responsible_user_id/.test(l)).join('\n')));
});
check('POST /expenses : responsable requis dans le schéma', () => {
  assert(/responsible_user_id: z\.number\(\)\.int\(\)\.positive\(\)[,\s]/.test(ops));
});
check('POST /expenses : refus si le responsable est la personne qui enregistre', () => {
  assert(ops.includes('Un autre utilisateur doit désigner le responsable de cette dépense'));
});
check('POST /expenses : responsable = compte actif rattaché à la station', () => {
  assert(/JOIN user_stations us ON us\.user_id = u\.id AND us\.station_id = \$2/.test(ops));
  assert(ops.includes('Responsable inconnu ou inactif sur cette station'));
});
check('POST /expenses : motif obligatoire pour toute dépense', () => {
  assert(ops.includes('Motif obligatoire pour toute dépense'));
});
check('POST /expenses : responsable enregistré et notifié (messagerie, hors rejeu)', () => {
  assert(/responsible_user_id\)\s*\n\s*VALUES/.test(ops) || ops.includes('employee_id, responsible_user_id)'));
  assert(ops.includes("kind: 'expense_assigned'"));
  assert(/if \(!e\._idempotent_replay\)/.test(ops));
});
check('GET /expenses/responsables : liste limitée à la station et au client', () => {
  assert(ops.includes("r.get('/expenses/responsables'"));
  assert(/u\.client_id = \$2/.test(ops));
});
check('formulaire dépense : responsable obligatoire et motif obligatoire', () => {
  assert(app.includes("'Responsable (obligatoire, désigné par une autre personne)'"));
  assert(app.includes("'Motif (obligatoire)'"));
  assert(app.includes("G('/expenses/responsables')"));
});
console.log(`\n${n}/8 contrôles réussis.`);
