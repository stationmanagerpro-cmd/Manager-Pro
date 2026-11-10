'use strict';
// Filtre « entre 2 dates » du Tableau de bord : le sélecteur est lié à range(), aux appels serveur et au graphique.
const fs = require('fs'), path = require('path'), assert = require('assert');
const rd = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('✔', name); };
const design = rd('public/ext-design.js'), picker = rd('public/ext-dash-range.js'), app = rd('public/app.js'), rep = rd('src/reports.js');
ok('sélecteur chargé avant le tableau de bord (index.html) et mis en cache hors ligne (sw.js)', () => {
  const h = rd('public/index.html'); assert(h.indexOf('ext-dash-range.js') > 0 && h.indexOf('ext-dash-range.js') < h.indexOf('ext-design.js'));
  assert(/ext-dash-range\.js/.test(rd('public/sw.js')));
});
ok('le tableau de bord affiche le sélecteur de dates (bouton « jj-mm-aaaa - jj-mm-aaaa »)', () => assert(/DashRange\.html\(\)/.test(design)));
ok('Appliquer écrit P/CA/CB puis relance go(\'dash\') ; raccourcis → P', () => {
  assert(/CA = a; CB = b/.test(picker) && /P = c; go\('dash'\)/.test(picker) && /cfg\.set\(code\(sel\)/.test(picker) && /cfg\.set\('custom', a, b\)/.test(picker));
});
ok('range() gère 7 j, 30 j, mois dernier et gamme personnalisée', () => assert(/p == 'd7'/.test(app) && /p == 'd30'/.test(app) && /p == 'lastmonth'/.test(app) && /p == 'custom'/.test(app)));
ok('validations : dates valides, début ≤ fin, pas de futur, 366 jours max (comme le serveur)', () => {
  assert(/doit précéder/.test(picker) && /dans le futur/.test(picker) && /MAX_DAYS = 366/.test(picker));
});
ok('toutes les requêtes du tableau de bord portent la période (KPI, comparaison, vue d\'ensemble, graphique, agrégats)', () => {
  assert(/G\(`\/dashboard\?from=\$\{a\}&to=\$\{b\}`\)/.test(design) && /G\(`\/dashboard\?from=\$\{pa\}&to=\$\{pb\}`\)/.test(design));
  assert(/\/dashboard\/overview\?from=\$\{a\}&to=\$\{b\}&pfrom=\$\{pa\}&pto=\$\{pb\}/.test(design));
  assert(/\/dashboard\/daily\?from=\$\{a\}&to=\$\{b\}/.test(design));
  assert(/Agg\.mount\('agg-dash', \{ scope: 'current', from: a, to: b/.test(design));
});
ok('serveur : /dashboard/daily accepte from/to (7 à 90 jours, jamais après aujourd\'hui)', () => {
  assert(/validDay\(req\.query\.from\) && validDay\(req\.query\.to\)/.test(rep) && /len > 90/.test(rep) && /len < 7/.test(rep));
  assert(/generate_series\(COALESCE\(\$2::date, current_date - \(\$3::int - 1\)\), COALESCE\(\$4::date, current_date\)/.test(rep));
});
ok('« Dernières ventes » : limitées à la période, sauf la période du jour (recent=all → tous jours confondus)', () => {
  assert(/\(\$4::boolean OR \(s\.sold_at >= \$2::date AND s\.sold_at < \$3::date \+ 1\)\)\s+ORDER BY s\.sold_at DESC, s\.id DESC\s+LIMIT 6`, \[s, from, to, req\.query\.recent === 'all'\]/.test(rep));
  assert(/&recent=all/.test(design));
});
const dir = rd('public/ext-direction.js'), msv = rd('public/ext-multistation-views.js'), ms = rd('src/multistation_views.js');
ok('Pilotage direction : sélecteur lié (période propre DP/DA/DB), requêtes /dashboard, /daily et /rankings avec from/to', () => {
  assert(/DashRange\.html\(\{ get: \(\) => DP/.test(dir) && /const drange = /.test(dir) && /[^d]range\(DP\)/.test(dir) === false);
  assert(/\/dashboard\/daily\?from=\$\{a\}&to=\$\{b\}/.test(dir) && /\/dashboard\/rankings\?from=\$\{a\}&to=\$\{b\}/.test(dir) && /\/dashboard\?from=\$\{pa\}&to=\$\{pb\}/.test(dir));
});
ok('Vue par station : sélecteur lié (période propre), /stations/by-station?from&to, agrégats de la période', () => {
  assert(/DashRange\.html\(\{ get: \(\) => ps\.code/.test(msv) && /\{ from: pa, to: pb \}/.test(msv) && /fillExtras\(rg \? rg\.from : d\.as_of, rg \? rg\.to : d\.as_of\)/.test(msv));
  assert(/parseRange\(req\.query\)/.test(ms.slice(ms.indexOf("'/stations/by-station'"))) && /loadShiftsRange/.test(ms) && /AS range_cur/.test(ms));
});
console.log(`${n}/${n} contrôles statiques réussis.`);
