'use strict';
// CORR-024 (B4) : la requête des déclarations (src/ops_plus.js) doit viser des colonnes qui existent dans les migrations.
const fs = require('fs'); const path = require('path'); const assert = require('assert');
const root = path.resolve(__dirname, '..');
const code = fs.readFileSync(path.join(root, 'src/ops_plus.js'), 'utf8');
const mig = fs.readdirSync(path.join(root, 'migrations')).filter(f => f.endsWith('.sql')).map(f => fs.readFileSync(path.join(root, 'migrations', f), 'utf8')).join('\n');
const start = code.indexOf("'/hr/declarations'"); const end = code.indexOf('res.json({ summary, lines: slips })', start);
const route = code.slice(start, end);
let n = 0; const check = (l, fn) => { fn(); n++; console.log('✓ ' + l); };
check('la route déclarations est localisée', () => assert.ok(start > 0 && end > start));
check("plus de lecture de p.gross_pay (colonne réelle : gross)", () => assert.doesNotMatch(route, /p\.gross_pay/));
check('plus de lecture de e.nin ni e.cnss_number (colonnes inexistantes)', () => assert.doesNotMatch(route, /\be\.nin\b|\be\.cnss_number\b/));
check('payslips.gross existe dans le schéma', () => { const m = mig.match(/CREATE TABLE (?:IF NOT EXISTS )?payslips \(([\s\S]*?)\n\s*created_at[^;]*;/); assert.ok(m, 'table payslips introuvable'); assert.ok(/\bgross NUMERIC/.test(m[1]), 'colonne gross absente'); });
check('employees.inps_number existe dans le schéma', () => assert.match(mig, /ALTER TABLE employees ADD COLUMN IF NOT EXISTS inps_number/));
for (const c of ['its_amount', 'inps_employee', 'inps_employer', 'amo_employee', 'amo_employer', 'employer_charges_total'])
  check('payslips.' + c + ' existe dans le schéma', () => assert.match(mig, new RegExp('ALTER TABLE payslips ADD COLUMN IF NOT EXISTS ' + c + '\\b')));
check('les noms exposés à l\'interface sont inchangés (gross_pay, nin, cnss_number)', () => { assert.match(route, /p\.gross AS gross_pay/); assert.match(route, /AS nin/); assert.match(route, /AS cnss_number/); });
console.log(`\n${n}/${n} contrôles réussis.`);
