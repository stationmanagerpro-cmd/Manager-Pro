// Contrôles statiques de l'étape 8 : catalogue des droits et déblocage borné au périmètre.
const fs = require('fs');
const assert = require('assert');
const auth = fs.readFileSync('src/auth.js', 'utf8');
const contracts = fs.readFileSync('src/contracts.js', 'utf8');
const premium = fs.readFileSync('src/premium.js', 'utf8');
const ui = fs.readFileSync('public/ext-contracts.js', 'utf8');
const unlock = auth.slice(auth.indexOf("priv.post('/users/:id/unlock'"), auth.indexOf("priv.patch('/users/:id/role'"));
assert(/lockout_until = NULL/.test(unlock), 'Le déblocage manuel doit effacer l’échéance de verrouillage');
assert(/failed_logins = 0, lockout_until = NULL/.test(unlock), 'Le déblocage doit réinitialiser compteur et échéance');
assert(/if \(req\.user\.is_global\)[\s\S]*?if \(target\.is_global\) throw new HttpError\(403/.test(unlock), 'Le Super Admin peut déverrouiller tout compte ; un administrateur client ne doit jamais déverrouiller un compte de plateforme');
assert(/target\.client_id === actor\.client_id/.test(unlock), 'Le déblocage local doit rester dans le même client');
assert(/user_stations mine JOIN user_stations theirs/.test(unlock), 'Le chemin historique doit vérifier une station commune');
assert(/Déblocage du compte/.test(unlock) && /await audit\(/.test(unlock), 'Le déblocage doit être journalisé');
for (const code of ['sales','stock','receipts','reconcile','period_lock','price_history','payroll_amo','payroll_inps','payroll_its','payroll_charges','messaging','auto_alerts']) {
  assert(new RegExp("code: '" + code + "'").test(premium), 'Catalogue Super Admin incomplet : ' + code);
}
for (const field of ['module_sales','module_stock','module_receipts','module_reconcile','module_period_lock','module_price_history','module_auto_alerts']) {
  assert(ui.includes(field), 'Le formulaire client ne permet pas de régler ' + field);
}
assert(/auto_alerts: true/.test(contracts) && /can_use_auto_alerts: true/.test(contracts), 'Les alertes automatiques sont activées par défaut dans un nouveau contrat (fonctions gratuites, voir CHANGELOG_FONCTIONS_GRATUITES_ET_AVENIR) ; le contrôle reste celui du contrat');
assert(/personalization: t\('can_personalize'\)/.test(ui), 'Le droit de personnalisation doit aussi être enregistré dans le catalogue de modules');
console.log('✔ Contrôles statiques étape 8 — droits contractuels et déblocage : 27/27');
