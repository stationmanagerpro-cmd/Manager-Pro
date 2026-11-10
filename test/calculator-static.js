// Calculatrice flottante : évaluateur (sans eval), branchement dans index.html, masquage hors connexion et à l'impression.
const fs = require('fs'), path = require('path');
const rd = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const JS = rd('public/ext-calc.js'), CSS = rd('public/ext-calc.css'), IDX = rd('public/index.html');
const { evaluate, plain } = require('../public/ext-calc.js');
const val = (e) => { try { return evaluate(e); } catch (x) { return 'ERR:' + x.message; } };
const cases = [
  ['2+3×4', 14], ['(2+3)×4', 20], ['10÷4', 2.5], ['0,1+0,2', 0.3], ['200+10%', 220], ['200−10%', 180], ['50×10%', 5],
  ['−5+2', -3], ['1 234,5×2', 2469], ['10÷0', 'ERR:Division par 0'], ['2+', 'ERR:Expression invalide'], ['(2+3', 'ERR:Parenthèse manquante'],
  ['alert(1)', 'ERR:Expression invalide'], ['', 'ERR:Expression vide'],
];
const checks = cases.map(([e, v]) => [`calcul ${e || '(vide)'}`, val(e) === v]);
checks.push(['aucun eval / Function', !/\beval\s*\(|new Function/.test(JS)]);
checks.push(['plain() virgule décimale', plain(2.5) === '2,5']);
checks.push(['bouton et script chargés', /ext-calc\.css/.test(IDX) && /ext-calc\.js/.test(IDX)]);
checks.push(['visible seulement connecté', /classList\.contains\('ready'\)/.test(JS)]);
checks.push(['raccourci Alt+C', /e\.altKey/.test(JS)]);
checks.push(['masqué à l\'impression', /@media print/.test(CSS)]);
checks.push(['aucun stockage navigateur', !/localStorage|sessionStorage/.test(JS)]);
let ok = 0; for (const [n, v] of checks) { console.log((v ? 'OK   ' : 'FAIL ') + n); if (v) ok++; }
console.log(`${ok}/${checks.length} contrôles réussis`); process.exit(ok === checks.length ? 0 : 1);
