'use strict';
// Contrôles statiques : réinitialisation du mot de passe de l'administrateur local d'un client par le Super Admin.
const fs = require('fs'), path = require('path'), assert = require('assert');
const rd = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('✔', name); };
const srv = rd('src/contracts.js');
const route = srv.slice(srv.indexOf("'/admin/clients/:id/users/:userId/reset-password'"), srv.indexOf("/** Mise à jour identité client"));
ok('route réservée au Super Admin (needPrincipal)', () => assert(/reset-password', needPrincipal/.test(srv)));
ok('confirmation par le mot de passe du Super Admin', () => assert(/superadmin_password/.test(route) && /bcrypt\.compare\(req\.body\.superadmin_password/.test(route)));
ok('limitée au rôle ADMIN du client, jamais un compte global', () => assert(/u\.is_global \|\| u\.role !== 'ADMIN'/.test(route) && /Number\(u\.client_id\) !== clientId/.test(route)));
ok('sessions révoquées, verrouillage levé, ligne verrouillée (FOR UPDATE)', () => assert(/revoked_at = now\(\)/.test(route) && /lockout_until = NULL/.test(route) && /FOR UPDATE OF u/.test(route)));
ok('mot de passe temporaire jamais journalisé', () => assert(!/audit\([^)]*temporaryPassword/.test(route) && /password_reset: true/.test(route)));
const ui = rd('public/ext-detail-pages.js');
ok('bouton visible seulement pour l\'admin local actif, dans le profil du compte client', () => assert(/user\.role !== 'ADMIN'/.test(ui) && /clientUserResetPassword\(/.test(ui) && /user\.active \?/.test(ui)));
ok('affichage unique du mot de passe temporaire', () => assert(/cu_rp_temp/.test(ui) && /ne sera plus affiché/.test(ui)));
// --- Périmètre du Superadmin : uniquement l'administrateur local d'un compte client ---
const auth = rd('src/auth.js'), scope = rd('src/roles_scope.js');
ok('garde-fou assertSuperadminScope : refuse tout compte client non ADMIN', () => assert(/async function assertSuperadminScope/.test(scope) && /u\.role !== 'ADMIN'/.test(scope)));
ok('garde-fou appliqué aux routes rôle, activation, profil et déblocage', () => assert((auth.match(/assertSuperadminScope\(req, targetId\)/g) || []).length === 4));
ok('liste des comptes d\'un client réservée aux administrateurs locaux', () => assert(/r\.code = 'ADMIN'\s+ORDER BY u\.active DESC/.test(srv)));
ok('plus de bouton « Nommer administrateur local » ni de gestion des autres rôles dans la fiche client', () => assert(!/clientUserMakeAdmin/.test(ui) && !/Nommer administrateur local/.test(ui)));

// --- Administrateur local de secours ---
const rescue = srv.slice(srv.indexOf("'/admin/clients/:id/rescue-admin'"), srv.indexOf("/** Mise à jour identité client"));
ok('secours : Super Admin uniquement, motif + mot de passe Super Admin exigés', () => assert(/rescue-admin', needPrincipal/.test(rescue) && /superadmin_password/.test(rescue) && /bcrypt\.compare\(req\.body\.superadmin_password/.test(rescue)));
ok('secours : crée un NOUVEAU compte ADMIN non global, sans promouvoir un compte existant', () => assert(/INSERT INTO users/.test(rescue) && /role_id, is_global, client_id/.test(rescue) && !/UPDATE users SET role_id/.test(rescue)));
ok('secours : quota max_users du contrat et unicité de l\'identifiant respectés', () => assert(/max_users/.test(rescue) && /lower\(login\) = lower\(\$1\)/.test(rescue)));
ok('secours : mot de passe temporaire jamais journalisé', () => assert(!/audit\([^)]*temporaryPassword/.test(rescue)));
ok('secours : bouton dans l\'onglet Utilisateurs de la fiche client', () => assert(/clientRescueAdmin\(\$\{id\}\)/.test(ui) && /window\.clientRescueAdminGo/.test(ui)));
console.log(`${n}/${n} contrôles statiques réussis.`);
