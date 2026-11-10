'use strict';
const fs = require('fs');
const assert = require('assert');
const ui = fs.readFileSync('public/ext-messaging.js', 'utf8');
const api = fs.readFileSync('src/messaging.js', 'utf8');
const server = fs.readFileSync('src/server.js', 'utf8');
const checks = [
  ['sélecteur de fichiers multiples', /type="file" multiple/.test(ui)],
  ['types de documents annoncés', /\.pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.doc,.docx,.xls,.xlsx/.test(ui)],
  ['bouton Joindre ouvre le sélecteur', /getElementById\('msg-file-input'\)\?\.click\(\)/.test(ui)],
  ['liste de fichiers en attente', /Fichiers à envoyer/.test(ui)],
  ['retrait individuel avant envoi', /msgRemovePendingFile/.test(ui)],
  ['envoi sur la route de la conversation', /\/messaging\/conversations\/'.*\/attachments/.test(ui)],
  ['téléchargement avec jeton de session', /msgDownloadAttachment = async function/.test(ui) && /Authorization: 'Bearer ' \+ TK/.test(ui)],
  ['limite 10 Mo côté interface', /file\.size > 10 \* 1024 \* 1024/.test(ui)],
  ['limite 10 Mo côté serveur', /uploadBuffer\.length > 10 \* 1024 \* 1024/.test(api)],
  ['liste MIME autorisée côté serveur', /const allowedMime = new Set/.test(api)],
  ['écriture de contenu reçu en base64', /fs\.writeFileSync\(dest, uploadBuffer/.test(api)],
  ['limite JSON compatible avec un fichier de 10 Mo encodé', /express\.json\(\{ limit: '16mb' \}\)/.test(server)],
  ['contrôle des membres de conversation conservé', /if \(!\(await isMember\(convId, req\.user\.id\)\)\) throw new HttpError\(403/.test(api)]
];
for (const [name, ok] of checks) { console.log(`${ok ? 'OK' : 'ÉCHEC'} - ${name}`); assert.ok(ok, name); }
console.log(`\n${checks.length}/${checks.length} contrôles statiques réussis.`);
