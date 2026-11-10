const fs = require('fs');
const assert = require('assert');
const shell = fs.readFileSync('public/ext-shell.js', 'utf8');
const css = fs.readFileSync('public/ext-shell.css', 'utf8');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const checks = [
  ['Superadmin tree has dashboard icon key', /label: 'Tableau de bord', icon: 'dashboard', keys: \['admin'\]/.test(shell)],
  ['Superadmin tree has clients/licences icon key', /label: 'Clients & licences', icon: 'clients', keys: \['clients', 'packs', 'carte'\]/.test(shell)],
  ['Superadmin tree has finance icon key', /label: 'Finance & rapports', icon: 'finance', keys: \['pfin'\]/.test(shell)],
  ['Superadmin tree has administration icon key', /label: 'Administration', icon: 'settings', keys: \['roles', 'homeadmin', 'accesskeys'\]/.test(shell)],
  ['Leaf SVG icons cover all Superadmin views', ['admin','clients','packs','pfin','roles','homeadmin','accesskeys'].every(k => shell.includes(`${k}: '`))],
  ['SVG markup is accessible/decorative', /aria-hidden="true" focusable="false"/.test(shell)],
  ['SVG stroke follows current text color', /stroke: currentColor/.test(css)],
  ['SVG size is responsive to sidebar layout', /\.nav2 \.nav-svg \{ width: 19px; height: 19px;/.test(css)],
  ['Superadmin SVG replacement only applies to global accounts', /if \(ME && ME\.is_global && saIcons\[k\]\) return svgIcon/.test(shell)],
  ['Static test is registered in package scripts', pkg.scripts['test:superadmin-sidebar-icons-static'] === 'node test/superadmin-sidebar-icons-static.js']
];
let failed = 0;
for (const [name, ok] of checks) { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); if (!ok) failed++; }
console.log(`\n${checks.length - failed}/${checks.length} contrôles réussis`);
if (failed) process.exit(1);
