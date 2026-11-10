// Contrôles statiques : agrégat marge / résultat, rapport client, liens Fiscalité ↔ RH ↔ ventes.
const fs = require('fs'), path = require('path');
const rd = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const P = rd('src/profitability.js'), F = rd('src/fiscal.js'), R = rd('src/reports.js'), S = rd('src/server.js'), UI = rd('public/ext-profit.js'), IDX = rd('public/index.html');
const checks = [
  ['route rapport client', /r\.get\('\/reports\/client-profit', need\('report\.view', 'finance\.view'\)/.test(P)],
  ['routeur monté', /require\('\.\/profitability'\)\.r/.test(S)],
  ['période libre validée', /validDay/.test(P) && /MAX_DAYS/.test(P)],
  ['regroupement en liste blanche', /GROUPS = \['none', 'day', 'week', 'month', 'quarter', 'year'\]/.test(P) && /if \(!GROUPS\.includes\(g\)\)/.test(P)],
  ['exports xlsx/pdf/csv', /'pdf', 'xlsx', 'csv'/.test(P)],
  ['export soumis au contrat', /can_export_reports/.test(P)],
  ['isolation par stations de l\'utilisateur', /user_stations/.test(P) && /station_permission_caps/.test(P)],
  ['fiscalité conditionnée (contrat + permission)', /fiscal\.access/.test(P) && /can_access_fiscal/.test(P)],
  ['paie : table réelle payslips', /FROM payslips/.test(P)],
  ['fiscal n\'utilise plus des tables inexistantes', !/payroll_bulletins|payroll_runs/.test(F)],
  ['fiscal branché sur profitability', (F.match(/profitability\./g) || []).length >= 5],
  ['marge dans le dashboard (profils finance)', /stationProfit/.test(R) && /finance\.view/.test(R) && /gross_margin/.test(R)],
  ['page front et script chargé', /V\.profit/.test(UI) && /ext-profit\.js/.test(IDX)],
];
let ok = 0; for (const [n, v] of checks) { console.log((v ? 'OK   ' : 'FAIL ') + n); if (v) ok++; }
console.log(`${ok}/${checks.length} contrôles réussis`); process.exit(ok === checks.length ? 0 : 1);
