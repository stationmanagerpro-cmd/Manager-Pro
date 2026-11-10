/* Non-régression : GET /employees/unlinked doit être déclarée AVANT GET /employees/:id
 * (sinon « unlinked » est lu comme un id → 400 → liste vide → « Aucun employé sans compte »). */
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'catalog.js'), 'utf8');
const iUnlinked = src.indexOf("r.get('/employees/unlinked'");
const iById = src.indexOf("r.get('/employees/:id");
let fails = 0; const ok = (c, m) => { console.log((c ? '  ✔ ' : '  ✖ ') + m); if (!c) fails++; };
ok(iUnlinked > -1 && iById > -1, 'les deux routes existent');
ok(iUnlinked < iById, "/employees/unlinked est déclarée avant /employees/:id");
ok(/\/employees\/:id\(\\\\d\+\)/.test(src), "/employees/:id est restreinte aux identifiants numériques");
const ui = fs.readFileSync(path.join(__dirname, '..', 'public', 'ext-roles.js'), 'utf8');
ok(!/G\('\/employees\/unlinked[^)]*\)\.catch/.test(ui), "ext-roles.js n'avale plus l'erreur de /employees/unlinked");
process.exit(fails ? 1 : 0);
