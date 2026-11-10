// Signature personnalisée du compte client : autorisation Super Admin, onglet client, apposition sur les PDF.
const fs = require('fs'), path = require('path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const sig = read('src/signature.js'), docs = read('src/docs.js'), con = read('src/contracts.js'), srv = read('src/server.js');
const fin = read('public/ext-fin.js'), ctr = read('public/ext-contracts.js'), mig = read('migrations/071_client_signatures.sql');
const checks = [
  ['migration : table client_signatures', /CREATE TABLE IF NOT EXISTS client_signatures/.test(mig) && /active_mode/.test(mig)],
  ['contrat : signature_mode none par défaut, normalisé', /signature_mode: 'none'/.test(con) && /f\.signature_mode = 'none'/.test(con)],
  ['Super Admin : champ d\'autorisation dans le contrat', /\['signature_mode'/.test(ctr) && /Manuscrite et image/.test(ctr)],
  ['API : refus si type non autorisé par le contrat', /permits\(allowed, kind\)/.test(sig) && /403/.test(sig)],
  ['API : activation impossible sans signature enregistrée', /Enregistrez d'abord/.test(sig)],
  ['API : réservé aux comptes clients (pas le Super Admin)', /is_global \|\| !req\.user\.client_id/.test(sig)],
  ['API : formats PNG/JPEG vérifiés par signature binaire', /sniff/.test(sig) && /PNG ou JPEG/.test(sig)],
  ['serveur : routes montées', /require\('\.\/signature'\)\.r/.test(srv)],
  ['PDF : signature chargée seulement si autorisée ET activée', /loadActive/.test(docs) && /permits\(allowed, s\.active_mode\)/.test(sig)],
  ['PDF : cases de tiers (employé, client…) non signées', /employ\|pompiste\|salari\|client\|fournisseur/.test(docs)],
  ['PDF : cases déjà validées par un intervenant non écrasées', /!g\.status && b\.signature/.test(docs)],
  ['client : onglet Signature, masqué pour le Super Admin', /\['sig', 'Signature'/.test(fin) && /s\[0\] != 'sig'/.test(fin)],
  ['client : tracé manuscrit + import d\'image + bouton d\'activation', /sigSaveHand/.test(fin) && /sigSaveImage/.test(fin) && /sigActivate/.test(fin)],
];
let bad = 0; for (const [n, ok] of checks) { console.log((ok ? '✔ ' : '✖ ') + n); if (!ok) bad++; }
console.log(`\n${checks.length - bad}/${checks.length} contrôles réussis`); process.exit(bad ? 1 : 0);
