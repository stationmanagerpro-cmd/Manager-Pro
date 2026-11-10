const fs = require('fs');
const assert = require('assert');
const maintenance = fs.readFileSync('src/maintenance.js', 'utf8');
const financeUi = fs.readFileSync('public/ext-fin.js', 'utf8');
const systemUi = fs.readFileSync('public/ext-p12.js', 'utf8');
let n = 0;
function check(label, fn) { fn(); n++; console.log('✔ ' + label); }
check('Route reset-global reste réservée au principal', () => assert(maintenance.includes("r.post('/admin/maintenance/reset-global', needPrincipal")));
check('Mot de passe Superadmin requis', () => assert(maintenance.includes('await verifyPrincipalPassword(req, req.body?.superadmin_password)')));
check('Phrase exacte de confirmation toujours exigée', () => assert(maintenance.includes('req.body?.confirmation !== RESET_CONFIRM')));
check('Reset global échoue fermé tant que le périmètre plateforme-only n’est pas défini', () => assert(maintenance.includes("throw new HttpError(409, 'Réinitialisation globale suspendue par sécurité")));
check('Ancienne suppression générique de toutes les tables retirée de la route reset-global', () => { const route = maintenance.slice(maintenance.indexOf("r.post('/admin/maintenance/reset-global'"), maintenance.indexOf('\nmodule.exports = r;')); assert(!route.includes('DELETE FROM public.')); assert(!route.includes('planOrder(tables')); });
check('Statut API n’annonce jamais le reset global comme activé', () => assert(maintenance.includes('global_reset_enabled: false')));
check('Interface maintenance explique la protection A5', () => assert(financeUi.includes('le cahier des charges A5 interdit de toucher aux données opérationnelles des clients')));
check('Interface système indique la suspension de sécurité', () => assert(systemUi.includes('la réinitialisation ne doit pas toucher aux données opérationnelles des clients')));
console.log(`\n${n}/${n} contrôles A5 réussis.`);
