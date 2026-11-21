'use strict';
// Vente par scan : trois points d'entrée (Ventes, Quart, raccourci bas droite) + ouverture directe de la caméra.
// node test/qr-scan-entrees-static.js
const assert = require('assert'); const fs = require('fs'); const path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('✔', name); };
const scan = read('public/ext-qr-scan.js'), app = read('public/app.js'), quart = read('public/ext-quart-view.js'), calc = read('public/ext-calc.js');
ok('point d’entrée unique openScanSale : vérifie la permission, ouvre le formulaire puis la caméra', () => {
  assert.ok(scan.includes('window.openScanSale = async function'));
  assert.ok(scan.includes("can('sale.create')"));
  assert.ok(/await window\.addFuel\(\)/.test(scan), 'formulaire non ouvert avant la caméra');
  assert.ok(/openScanner\(onScanned\);\s*\};/.test(scan), 'caméra non ouverte directement');
});
ok('Ventes : bouton « Vente par scan » dans la barre (permission sale.create)', () => {
  assert.ok(app.includes('onclick="openScanSale()">📷 Vente par scan</button>'));
});
ok('Quart : bouton « Vente par scan » dans la vue du quart en cours', () => {
  assert.ok(quart.includes('onclick="openScanSale()"'));
});
ok('Raccourci bas droite : entrée « Vente par scan » dans le menu ⚡', () => {
  assert.ok(calc.includes("items.push(['scan', '📷', 'Vente par scan'])"));
  assert.ok(calc.includes("a === 'scan') openScanSale()"));
});
ok('Le scan prérempli reste celui du serveur (qr_scan_id, aucun employé lu du navigateur)', () => {
  assert.ok(scan.includes("api('POST', '/sales/scan-pump', payload)"));
  assert.ok(!/employee_id\s*:\s*document/.test(scan));
});
console.log(`\n${n}/${n} contrôles réussis.`);
