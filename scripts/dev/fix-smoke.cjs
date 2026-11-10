const fs = require('node:fs');

const file = 'test/smoke.js';
const backup = 'test/smoke.js.bak';

if (!fs.existsSync(backup)) {
  console.error('ERREUR : sauvegarde test/smoke.js.bak introuvable.');
  process.exit(1);
}

const source = fs.readFileSync(file, 'utf8');

const expected = "  let r = await call('POST', '/auth/login', { login, password });";
if (!source.includes(expected)) {
  console.error('ERREUR : bloc de départ introuvable. Aucun changement effectué.');
  process.exit(1);
}

if (source.includes("const gLogin = 'gerant'")) {
  console.error('Le fichier semble déjà avoir été modifié. Aucun changement effectué.');
  process.exit(1);
}

console.log('Vérification OK. Aucun fichier modifié.');
console.log('Le fichier smoke.js contient bien le bloc attendu.');
console.log('Prochaine étape : préparer le remplacement exact de l’initialisation.');
