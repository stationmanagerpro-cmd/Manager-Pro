'use strict';
// Génère des PDF d'étiquettes de TEST (station fictive, jetons aléatoires qui n'existent dans aucune base) avec le vrai module src/qr_pdf.js.
// Usage : node scripts/dev/make-qr-test-pdfs.js <dossier_sortie>   → qr-test-planche-A4.pdf, qr-test-etiquette-A5.pdf, qr-test-jetons.json
const fs = require('fs'), path = require('path'); const L = require('../../src/qr_logic'), P = require('../../src/qr_pdf');
const out = path.resolve(process.argv[2] || '.'); fs.mkdirSync(out, { recursive: true });
const prods = ['Gasoil', 'Super sans plomb', 'Gasoil', 'Super sans plomb', 'Gasoil', 'Pétrole lampant', 'Gasoil', 'Super sans plomb'];
const labels = prods.map((p, i) => { const token = L.generateToken(); return { id: i + 1, token, payload: L.payloadOf(token), stationName: 'STATION DE TEST - NE PAS UTILISER', pumpLabel: 'Pompe ' + (Math.floor(i / 2) + 1) + ' - Compteur ' + (i % 2 + 1), productName: p, shortRef: L.shortRef(token) }; });
fs.writeFileSync(path.join(out, 'qr-test-planche-A4.pdf'), P.sheetPdf(labels, { stationName: 'STATION DE TEST - NE PAS UTILISER', generatedAt: new Date() }));
fs.writeFileSync(path.join(out, 'qr-test-etiquette-A5.pdf'), P.singlePdf(labels[0]));
fs.writeFileSync(path.join(out, 'qr-test-jetons.json'), JSON.stringify(labels.map(l => l.payload)));
console.log('PDF de test écrits dans', out);
