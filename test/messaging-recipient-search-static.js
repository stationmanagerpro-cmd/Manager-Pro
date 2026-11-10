const fs = require('fs');
const assert = require('assert');
const client = fs.readFileSync('public/ext-messaging.js', 'utf8');
const server = fs.readFileSync('src/messaging.js', 'utf8');
const checks = [
  ['direct message no longer asks for opaque employee ID', !/\['user_id',\s*'Destinataire \(ID employé\)'/.test(client)],
  ['recipient search field supports name or login queries', /id="msg-recipient-search"[^>]*type="search"/.test(client)],
  ['search query is URL encoded before request', /\/messaging\/users\?q=' \+ encodeURIComponent\(q\)/.test(client)],
  ['result rendering uses textContent to avoid HTML injection', /name\.textContent\s*=\s*u\.full_name/.test(client) && /detail\.textContent\s*=/.test(client)],
  ['results have accessible listbox and option semantics', /role="listbox"/.test(client) && /setAttribute\('role', 'option'\)/.test(client)],
  ['send is disabled until a recipient is selected', /id="msg-direct-send" class="b1" disabled/.test(client) && /send\.disabled = false/.test(client)],
  ['direct conversation endpoint still validates positive user id', /r\.post\('\/messaging\/conversations\/direct',[\s\S]*?user_id:\s*z\.number\(\)\.int\(\)\.positive\(\)/.test(server)],
  ['server restricts recipient search to same client and active users', /u\.client_id = \$1 AND u\.deleted_at IS NULL AND u\.active AND u\.id <> \$2/.test(server)],
  ['server search matches login, full name and job title', /fold\('u\.login'\).*ILIKE.*fold\('u\.full_name'\).*ILIKE.*fold\('u\.job_title'\)/s.test(server)],
  ['server search folds case and common French accents without unaccent extension', /translate\(lower\(COALESCE\(\$\{expr\}, ''\)\), 'áàâãäåéèêëíìîïóòôõöúùûüçñýÿ', 'aaaaaaeeeeiiiiooooouuuucnyy'\)/.test(server)],
  ['server bounds recipient search results', /ORDER BY COALESCE\(u\.full_name, u\.login\) LIMIT 50/.test(server)]
];
let failed = 0;
for (const [name, ok] of checks) { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); if (!ok) failed++; }
console.log(`${checks.length - failed}/${checks.length} checks passed`);
if (failed) process.exit(1);
