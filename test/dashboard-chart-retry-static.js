'use strict';
// Graphique « Évolution des ventes » : chargement de Chart.js fiable (3 essais, délai) et message visible avec « Réessayer » en cas d'échec.
const fs = require('fs'), assert = require('assert'); const r = f => fs.readFileSync(f, 'utf8'); let n = 0; const ok = (t, f) => { f(); n++; };
const h = r('public/index.html'), d = r('public/ext-design.js');
ok('chargeur : 3 essais et délai de 20 s', () => { assert(/inject\(0\)\.catch\(function \(\) \{ return inject\(1\); \}\)\.catch\(function \(\) \{ return inject\(2\); \}\)/.test(h)); assert(/20000/.test(h)); assert(/pending = null; throw/.test(h)); });
ok('tableau de bord : message et bouton Réessayer, erreur de dessin interceptée', () => { assert(/whenChart\(\(\) => renderChart\(daily\), fail\)/.test(d)); assert(d.includes('dv2-chart-retry') && d.includes('Réessayer')); assert(/try \{ renderChartNow\(cv, daily\); \} catch/.test(d)); });
console.log(n + ' contrôles OK');
