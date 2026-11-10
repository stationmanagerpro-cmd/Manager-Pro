const fs = require('fs');
const assert = require('assert');
const js = fs.readFileSync('public/ext-messaging.js', 'utf8');
const css = fs.readFileSync('public/design-v2.css', 'utf8');
const checks = [
  ['conversation bubbles use semantic theme classes', /class="msg-bubble \$\{mine \? 'msg-bubble-mine' : 'msg-bubble-other'\}"/.test(js)],
  ['own bubble uses primary theme color', /\.msg-bubble-mine\s*\{[^}]*background:\s*var\(--p\)/s.test(css)],
  ['own bubble has explicit readable foreground fallback', /\.msg-bubble-mine\s*\{[^}]*color:\s*var\(--on-p,\s*#fff\)/s.test(css)],
  ['incoming bubble uses theme surface and text tokens', /\.msg-bubble-other\s*\{[^}]*background:\s*var\(--c,\s*#fff\)[^}]*color:\s*var\(--t,\s*#1a2332\)/s.test(css)],
  ['bubble borders use theme border token', /\.msg-bubble\s*\{[^}]*border:\s*1px solid var\(--bd\)/s.test(css)],
  ['message metadata inherits theme and retains contrast hierarchy', /\.msg-meta\s*\{[^}]*opacity:\s*\.72/s.test(css)],
  ['attachments wrap rather than overflow', /\.msg-attachments\s*\{[^}]*flex-wrap:\s*wrap/s.test(css) && /\.msg-bubble a\.tag\s*\{[^}]*overflow-wrap:\s*anywhere/s.test(css)],
  ['small screens get wider bubbles', /@media\s*\(max-width:\s*600px\)[\s\S]*?\.msg-bubble\s*\{[^}]*max-width:\s*88%/s.test(css)],
  ['legacy hardcoded incoming bubble background removed', !/background:\$\{mine \? 'var\(--p,#0d7a6b\)' : 'var\(--card,#f1f5f9\)'\}/.test(js)]
];
let failed = 0;
for (const [name, ok] of checks) { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); if (!ok) failed++; }
console.log(`${checks.length - failed}/${checks.length} checks passed`);
if (failed) process.exit(1);
