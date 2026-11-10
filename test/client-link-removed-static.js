// Vérifie que le « lien client » et sa clé d'identification d'appareil ont été entièrement retirés,
// et que la clé d'accès unique (Superadmin) reste en place.
const fs = require('fs'), path = require('path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const exists = p => fs.existsSync(path.join(__dirname, '..', p));
const server = read('src/server.js'), auth = read('src/auth.js'), core = read('src/core.js'), app = read('public/app.js'), detail = read('public/ext-detail-pages.js');
const checks = [
  ['module device_registry supprimé', !exists('src/device_registry.js')],
  ['plus de route /c/:code', !/['"]\/c\/:code['"]/.test(server)],
  ['plus de montage device_registry', !/device_registry/.test(server + auth + core)],
  ['plus d\'exigence d\'appareil approuvé à la connexion / en session', !/enforce(Login|Session)Device/.test(auth + core)],
  ['plus d\'écran d\'identification client dans l\'application', !/clientDeviceCode|showClientDeviceGate|showCommonDeviceGate|DEVICE_APPROVAL_REQUIRED/.test(app)],
  ['plus d\'onglet « Appareils autorisés » dans la fiche client', !/renderClientDeviceAccess|Appareils autorisés|device-access/.test(detail)],
  ['migration de nettoyage des tables', /DROP TABLE IF EXISTS client_devices/.test(read('migrations/070_remove_client_device_link.sql')) && /DROP TABLE IF EXISTS client_device_keys/.test(read('migrations/070_remove_client_device_link.sql'))],
  ['la clé d\'accès Superadmin reste montée', /access_keys'\)\.pub/.test(server) && /access_keys'\)\.admin/.test(server)],
  ['la connexion exige toujours la clé d\'accès', /requireGate/.test(auth)],
];
let bad = 0; for (const [n, ok] of checks) { console.log((ok ? '✔ ' : '✖ ') + n); if (!ok) bad++; }
console.log(`\n${checks.length - bad}/${checks.length} contrôles réussis`); process.exit(bad ? 1 : 0);
