'use strict';
const fs = require('fs');
const assert = require('assert');
const src = fs.readFileSync('src/messaging.js', 'utf8');
const tests = [];
function check(name, fn) { try { fn(); tests.push({ name, ok: true }); } catch (e) { tests.push({ name, ok: false, error: e.message }); } }
check('chemins source client résolus via realpath et limités à UPLOAD_DIR', () => {
  assert.match(src, /function resolveUploadSource\(filePath\)/);
  assert.match(src, /fs\.realpathSync\(path\.resolve\(process\.env\.UPLOAD_DIR \|\| '\.\/uploads'\)\)/);
  assert.match(src, /fs\.realpathSync\(path\.resolve\(filePath\)\)/);
  assert.match(src, /relative\.startsWith\('\.\.' \+ path\.sep\)/);
});
check('refuse les sources absentes et les chemins hors du répertoire de téléversement', () => {
  assert.match(src, /Fichier source introuvable/);
  assert.match(src, /doit être situé dans le répertoire de téléversement/);
});
check('refuse les sources qui ne sont pas des fichiers ordinaires', () => assert.match(src, /if \(!stat\.isFile\(\)\)/));
check('les noms stockés sont aléatoires et ne réutilisent pas le nom fourni', () => {
  assert.match(src, /crypto\.randomBytes\(16\)\.toString\('hex'\)/);
  assert.match(src, /safeStoredName\(fileMeta\.originalname/);
  assert.match(src, /safeStoredName\(req\.body\.file_name\)/);
});
check('envoi de document valide la source avant toute copie', () => assert.match(src, /const sourceFile = resolveUploadSource\(req\.body\.file_path\);[\s\S]*?fs\.copyFileSync\(sourceFile\.path, dest\)/));
check('téléchargement limité au client et aux membres de la conversation', () => {
  assert.match(src, /WHERE a\.id = \$1 AND a\.client_id = \$2/);
  assert.match(src, /isMember\(att\.conversation_id, req\.user\.id\)/);
});
check('fonctionnalité pièce jointe toujours soumise au contrat', () => assert.match(src, /async function requireAttachments\(req\)[\s\S]*?featureOn\(req\.contract, 'messaging_attachments'\)/));
const failed = tests.filter(t => !t.ok);
for (const t of tests) console.log(`${t.ok ? 'OK' : 'FAIL'} - ${t.name}${t.error ? ': ' + t.error : ''}`);
console.log(`\n${tests.length - failed.length}/${tests.length} contrôles réussis`);
if (failed.length) process.exit(1);
