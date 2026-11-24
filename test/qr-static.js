'use strict';
// Scan QR : contrôles STATIQUES du câblage (routes, droits, intégration à la vente, migration, interface, hors ligne, journaux). Ils lisent le code ; ils ne
// l'exécutent pas : l'exécution réelle est dans qr-logic-unit.js, qr-db-scenarios.js (PostgreSQL) et scripts/dev/verify-qr-scanner-browser.py.
const fs = require('fs'), path = require('path'), assert = require('assert');
const R = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
let ok = 0, ko = 0; const t = (n, f) => { try { f(); ok++; console.log('✓ ' + n); } catch (e) { ko++; console.log('✗ ' + n + '\n   ' + e.message.split('\n')[0]); } };
const qrc = R('src/qr_codes.js'), fs_ = R('src/fuelsales.js'), mig = R('migrations/124_qr_codes_scan_pompes.sql'), ui = R('public/ext-qr-scan.js'), idx = R('public/index.html'), off = R('public/ext-offline-sales.js');

t('Toutes les routes du cahier existent, une seule fois', () => {
  for (const re of [/r\.get\('\/qr-codes'/, /r\.post\('\/pumps\/:pumpId\/qr-code'/, /r\.post\('\/qr-codes\/bulk'/, /r\.patch\('\/qr-codes\/:id\/revoke'/, /r\.post\('\/qr-codes\/:id\/regenerate'/, /r\.get\('\/qr-codes\/sheet\.pdf'/, /r\.get\('\/qr-codes\/history'/, /r\.get\('\/qr-codes\/:id\/label\.pdf'/, /r\.post\('\/sales\/scan-pump'/])
    assert.strictEqual((qrc.match(new RegExp(re.source, 'g')) || []).length, 1, String(re));
});
t('Chaque route d’administration exige qr.manage ; le scan exige sale.create', () => {
  const lines = qrc.split('\n').filter(l => /^r\.(get|post|patch)\(/.test(l));
  assert.strictEqual(lines.length, 9);
  for (const l of lines) assert.ok(/adminOnly/.test(l) || /need\('sale\.create'\)/.test(l), l.slice(0, 60));
  assert.ok(/const adminOnly = need\('qr\.manage'\)/.test(qrc));
});
t('Les routes /qr-codes/sheet.pdf et /history sont déclarées avant /qr-codes/:id/label.pdf (pas de capture par :id)', () => assert.ok(qrc.indexOf("'/qr-codes/sheet.pdf'") < qrc.indexOf("'/qr-codes/:id/label.pdf'")));
t('Le routeur est monté dans server.js', () => assert.ok(/app\.use\('\/api', require\('\.\/qr_codes'\)\)/.test(R('src/server.js'))));
t('Toutes les requêtes d’administration sont filtrées par la station de la session (req.sid), jamais par un paramètre client', () => {
  assert.ok(!/req\.(body|query)\.(station|sid)/.test(qrc));
  for (const sql of qrc.match(/FROM qr_codes[^`']*/g) || []) assert.ok(/station_id|counter_id|id = \$1/.test(sql), sql.slice(0, 60));
});
t('Vente : le scan est contrôlé dans la transaction AVANT l’insertion de la vente, consommé APRÈS ; employé imposé par le scan', () => {
  const a = fs_.indexOf('QD.checkScanForSale'), b = fs_.indexOf('INSERT INTO sales'), c = fs_.indexOf('QD.consumeScan');
  assert.ok(a > 0 && b > a && c > b, [a, b, c].join());
  assert.ok(/b\.employee_id = scan\.employee_id/.test(fs_));
  assert.ok(/qrc\.saleRefusalLogger/.test(fs_) && /saleRefusalLogger = async function/.test(qrc));
  assert.ok(/CLIENT_REF_REQUIRED/.test(fs_) && /offline_at/.test(fs_) && /NETWORK_ERROR/.test(fs_));
  assert.ok(/qr_scan_id: z\.number\(\)\.int\(\)\.positive\(\)\.optional\(\)/.test(fs_));
});
t('Vente classique inchangée : le chemin sans qr_scan_id n’exécute aucun contrôle de scan', () => assert.strictEqual((fs_.match(/if \(b\.qr_scan_id\)/g) || []).length, 2));
t('Aucune route ne crée de vente au scan (scan-pump n’écrit ni dans sales ni dans les paiements)', () => {
  const seg = qrc.slice(qrc.indexOf("r.post('/sales/scan-pump'"), qrc.indexOf('/** Journalise le refus'));
  assert.ok(!/INSERT INTO (sales|sale_details|payments)/i.test(seg));
  assert.ok(!/INSERT INTO (sales|sale_details)/i.test(qrc));
});
t('Réponse du scan minimale : aucun jeton, aucun mot de passe', () => {
  const seg = qrc.slice(qrc.indexOf('// Réponse minimale'), qrc.indexOf('/** Journalise le refus'));
  assert.ok(!/token/i.test(seg) && !/password/i.test(seg));
});
t('Journal : aucune colonne ni appel ne porte le jeton complet', () => {
  assert.ok(!/\btoken\b/.test(mig.slice(mig.indexOf('CREATE TABLE IF NOT EXISTS qr_events'), mig.indexOf('qr_events_no_update'))));
  for (const m of qrc.match(/logEvent\([^;]*;/g) || []) assert.ok(!/\.token|token:/.test(m), m.slice(0, 80));
  assert.ok(!/console\.(log|error|warn)\([^)]*token/i.test(qrc));
});
t('Migration : additive, rejouable, journal en ajout seul, permission accordée', () => {
  assert.ok(!/DROP\s+(TABLE|COLUMN)|TRUNCATE|DELETE\s+FROM(?!\s+qr_)/i.test(mig.replace(/--.*$/gm, '')));
  for (const k of ['CREATE TABLE IF NOT EXISTS qr_codes', 'CREATE TABLE IF NOT EXISTS qr_scans', 'CREATE TABLE IF NOT EXISTS qr_events', 'uq_qr_codes_active_counter', 'qr_events_no_update', "'qr.manage'"]) assert.ok(mig.includes(k), k);
});
t('Interface : le scan n’envoie jamais de vente et ne dépend pas uniquement de BarcodeDetector', () => {
  assert.ok(!/['"]\/sales\/fuel['"]/.test(ui)); assert.ok(/SMPQr\.decodeRGBA/.test(ui) && /BarcodeDetector/.test(ui));
  assert.ok(/qr_scan_id = s\.scan_id/.test(ui) && !/body\.(employee_id|product_id|pump_id)\s*=/.test(ui));
});
t('Interface : caméra libérée (getTracks().stop) et Android via AndroidBridge.scan / __mpScanHandler', () => assert.ok(/getTracks\(\)\.forEach\(t => t\.stop\(\)\)/.test(ui) && /AndroidBridge\.scan\(\)/.test(ui) && /__mpScanHandler/.test(ui)));
t('Interface : messages CAMERA_DENIED et NETWORK_ERROR conformes au cahier', () => assert.ok(ui.includes('L’autorisation d’accès à la caméra a été refusée.') && ui.includes('Vérification impossible auprès du serveur. Réessayez lorsque la connexion est rétablie.')));
t('Hors ligne : une vente par scan n’est jamais mise en file (fail closed)', () => assert.ok(/canQueue = !body\.fleet_card && !body\.qr_scan_id/.test(off)));
t('Scripts enregistrés : décodeur avant l’interface, tous deux dans index.html et dans le service worker', () => {
  assert.ok(idx.indexOf('/qr-decoder.js') > 0 && idx.indexOf('/qr-decoder.js') < idx.indexOf('/ext-qr-scan.js') && idx.indexOf('/ext-qr-scan.js') > idx.indexOf('/ext-offline-sales.js'));
  const sw = R('public/sw.js'); assert.ok(sw.includes("'/ext-qr-scan.js") && sw.includes("'/qr-decoder.js"));
});
t('Vue « Gestion des QR Codes » : droit qr.manage, menu « Quarts & pompes », module pompes', () => {
  assert.ok(/V\.qrcodes = \['Gestion des QR Codes', 'qr\.manage'\]/.test(ui)); assert.ok(/'histcompteurs', 'qrcodes'/.test(R('public/ext-shell.js'))); assert.ok(/k === 'qrcodes'/.test(R('public/app.js')));
});
t('Android : permission CAMERA déclarée et lecteur ML Kit (tous formats)', () => { assert.ok(R('android/ManagePro-Android/app/src/main/AndroidManifest.xml').includes('android.permission.CAMERA')); assert.ok(R('android/ManagePro-Android/app/src/main/java/com/managepro/app/MainActivity.kt').includes('FORMAT_ALL_FORMATS')); });
t('Android : le lecteur natif remet un OBJET { code } à onScanned (un texte brut est refusé par le serveur : « JSON invalide »)', () => {
  assert.ok(/__mpScanHandler = c => \{[^}]*onText\(\{ code: String\(c \|\| ''\) \}\)/.test(ui), 'le chemin natif doit appeler onText({ code })');
  assert.ok(!/onText\(String\(/.test(ui), 'aucun appel onText avec un texte brut');
  assert.ok(/finish\(\{ code: text \}\)/.test(ui) && /finish\(\{ short_ref: v \}\)/.test(ui), 'chemin Web : objets { code } / { short_ref }');
});
t('Contrat client : module qr_delegate (défaut actif) déclaré dans le formulaire du Super Admin, groupe « Exploitation station »', () => {
  assert.ok(/qr_delegate: true,/.test(R('src/contracts.js')), 'valeur par défaut true : les contrats existants gardent la fonction');
  const ec = R('public/ext-contracts.js');
  assert.ok(/exploitation: \{[^\n]*'module_pumps', 'module_qr_delegate'/.test(ec), 'groupe Exploitation station');
  assert.ok(ec.includes("['module_qr_delegate', '② Vente au nom d’un employé par scan QR', 's', YN]") && ec.includes("module_qr_delegate: mod('qr_delegate')") && ec.includes("qr_delegate: t('module_qr_delegate')"), 'libellé, lecture et enregistrement du contrat');
});
t('Vente au nom d’un employé : la permission du rôle ET le module du contrat sont contrôlés côté serveur', () => {
  const d = R('src/qr_delegate.js');
  assert.ok(/perms\.has\('sale\.record_for_employee'\)\) && featureOn\(req\.contract, 'module:qr_delegate'\)/.test(d));
  assert.ok(/delegateTarget\(ctx, require\('\.\/qr_delegate'\)\.canDelegate\(req\)\)/.test(R('src/qr_codes.js')));
  assert.ok(/canDelegate: require\('\.\/qr_delegate'\)\.canDelegate\(req\)/.test(R('src/fuelsales.js')));
  assert.ok(!/perms\.has\('sale\.record_for_employee'\)/.test(R('src/qr_codes.js') + R('src/fuelsales.js')), 'plus de contrôle direct sans le contrat');
});
t('Scan : le formulaire fermé (closeM = display:none) est rouvert avant la caméra ; libellé « Quart N° » en blanc', () => {
  const q = R('public/ext-qr-scan.js');
  assert.ok(/function formVisible\(\)[^\n]*style\.display !== 'none'[^\n]*offsetParent/.test(q), 'visibilité réelle du formulaire');
  assert.ok(!/getElementById\('fs_pump'\)\) return/.test(q.replace(/const s = [^\n]*/g, '')), 'plus de test d’existence seul');
  assert.ok(/\.qv \.qv-id h2\{color:#fff !important/.test(R('public/ext-quart-view.css')));
});
t('Anti double-clic : le formulaire carburant et la vente rapide n’envoient qu’une requête à la fois', () => {
  const a = R('public/ext-sale-shift.js'), b = R('public/ext-improvements.js');
  assert.ok(/let fBusy = false;\s+async function sendF\(confirm\) \{\s+if \(fBusy\) return;/.test(a) && /okBtn\.disabled = true/.test(a) && /finally \{ fBusy = false;/.test(a));
  assert.ok(/focusBusy/.test(b) && /if \(focusBusy\) return;/.test(b));
});
t('Chargement long : le squelette affiche, après 6 s, un message et un bouton Recharger', () => {
  assert.ok(/class="sk-wait"[^']*location\.reload\(\)/.test(R('public/app.js')));
  assert.ok(/\.sk-wait \{[^}]*animation: sk-wait-in \.3s ease 6s forwards !important/.test(R('public/app.css')));
});
console.log(`\n${ok}/${ok + ko} contrôles réussis.`); process.exit(ko ? 1 : 0);
