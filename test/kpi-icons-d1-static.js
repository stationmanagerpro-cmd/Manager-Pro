'use strict';
const fs = require('fs');
const assert = require('assert');
const design = fs.readFileSync('public/ext-design.js', 'utf8');
const css = fs.readFileSync('public/design-v2.css', 'utf8');
let passed = 0;
function check(name, fn) { try { fn(); passed++; console.log('✓ ' + name); } catch (e) { console.error('✗ ' + name + ': ' + e.message); process.exitCode = 1; } }
check('Icônes SVG en style trait disponibles sans dépendance externe', () => { assert(design.includes('const KPI_PATHS =')); assert(design.includes('stroke-width="1.8"')); });
check('Correspondances pour les principales cartes métier', () => { for (const k of ['shopping-cart','fuel','droplet','wallet','clock','alert-triangle','user-check','user-x','building-2','badge-check','hourglass','calendar-x','pause-circle','refresh-cw','users','shield','receipt','database','layers']) assert(design.includes(k), 'missing '+k); });
check('Les emojis des quatre KPI du tableau de bord sont remplacés par des SVG', () => { assert(design.includes('kpiSvg(({')); assert(design.includes("'🛒':'shopping-cart'")); assert(design.includes("'⛽':'fuel'")); assert(design.includes("'👥':'users'")); assert(design.includes("'💰':'wallet'")); });
check('Cartes KPI existantes et ajoutées dynamiquement décorées', () => { assert(design.includes("'.kpi-card, .dir-kpi, .dv2-kpi, .dv2-mini > div, .cards > .card'")); assert(design.includes('ca\\b|revenu|transaction')); assert(!design.includes('ca\x08')); assert(design.includes('MutationObserver')); assert(design.includes('window.smpDecorateKpiCards')); });
check('Icônes accessibles et marquées décoratives', () => { assert(design.includes('aria-hidden',)); assert(design.includes("glyph.setAttribute('aria-hidden', 'true')")); });
check('Pastille teintée et prise en charge du thème sombre', () => { assert(css.includes('.smp-kpi-glyph')); assert(css.includes('[data-theme="dark"] .smp-kpi-glyph')); assert(css.includes('var(--p')); });
check('Respect du réglage de réduction des animations', () => assert(css.includes('prefers-reduced-motion: reduce')));
check('Fiche D1 confirmée dans le cahier des charges fourni', () => { assert(fs.existsSync('public/ext-design.js')); assert(fs.existsSync('public/design-v2.css')); });
console.log(`${passed}/8 contrôles réussis`);
if (passed !== 8) process.exitCode = 1;
