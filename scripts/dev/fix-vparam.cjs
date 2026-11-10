const fs = require('fs');

const file = 'public/app.js';
const backup = 'public/app.js.before-vparam-fix';

const source = fs.readFileSync(file, 'utf8');

const start = source.indexOf('async function vParam() {');
const end = source.indexOf('\nconst addU =', start);

if (start < 0 || end < 0) {
  console.error('ERREUR : bloc vParam introuvable. Aucun changement effectué.');
  process.exit(1);
}

const oldBlock = source.slice(start, end);

if (!oldBlock.includes("G('/users')")) {
  console.error('ERREUR : contenu inattendu. Aucun changement effectué.');
  process.exit(1);
}

const replacement = [
  'async function vParam() {',
  "  const us = await G('/users');",
  "  const canManageUsers = can('user.manage');",
  "  const canAssignRoles = can('role.assign');",
  '',
  '  const actions = u =>',
  "    (canManageUsers && u.failed_logins >= 5 ? `<button class=\"b2\" onclick=\"Po('/users/${u.id}/unlock').then(()=>go('param'))\">Débloquer</button> ` : '') +",
  "    (canAssignRoles ? `<button class=\"b2\" onclick=\"changeUserRole(${u.id},${JSON.stringify(u.login)},${JSON.stringify(u.role)})\">Rôle</button>` : '');",
  '',
  '  return `<div class="bar">',
  `    \${canManageUsers ? '<button onclick="addU()">Ajouter un utilisateur</button>' : ''}`,
  `    \${canAssignRoles ? '<button class="b2" onclick="goRoles()">Gérer les rôles</button>' : ''}`,
  '  </div>` +',
  "    T(['Identifiant', 'Rôle', 'Échecs', 'Dernière connexion', ''],",
  '      us.map(u => [esc(u.login), u.role, u.failed_logins, dt(u.last_login_at), actions(u)]));',
  '}'
].join('\n');

if (fs.existsSync(backup)) {
  console.error('ERREUR : la sauvegarde existe déjà. Aucun changement effectué.');
  process.exit(1);
}

fs.copyFileSync(file, backup);
fs.writeFileSync(file, source.slice(0, start) + replacement + source.slice(end), 'utf8');

console.log('Correction appliquée.');
console.log('Sauvegarde créée : ' + backup);
