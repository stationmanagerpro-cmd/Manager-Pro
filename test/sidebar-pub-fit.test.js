'use strict';
// Zone PUB du menu : sur téléphone, les sous-onglets ne doivent jamais être cachés par la publicité.
// Chromium réel, vraies feuilles de style et vrai ext-sidebar-pub.js ; menu simulé (sous-menus fermés / ouverts).
const fs = require('fs'), path = require('path'), assert = require('assert');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const pub = f => path.join(__dirname, '..', 'public', f);
const css = ['app.css', 'ext-shell.css', 'design-v2.css', 'responsive-v3.css', 'ext-polish.css', 'responsive-phone.css', 'ext-skin-pro.css'].map(f => fs.readFileSync(pub(f), 'utf8')).join('\n');
const js = fs.readFileSync(pub('ext-sidebar-pub.js'), 'utf8');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const items = n => Array.from({ length: n }, (_, i) => `<a class="nav-link" role="menuitem" style="display:flex;height:48px">Sous-onglet ${i + 1}</a>`).join('');
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>
<div id="app-header"></div><div id="app" class="ready"><nav id="nav" class="nav2 drawer-open"><div class="nav-head" style="height:64px">Manager Pro</div>
<div class="nav-scroll"><div class="nav-node" id="n1"><button class="nav-parent" style="height:48px" onclick="this.parentNode.classList.toggle('open');this.nextElementSibling.style.display=this.parentNode.classList.contains('open')?'block':'none'">Exploitation</button><div class="flyout" style="display:none">${items(14)}</div></div>
<a class="nav-link" style="display:flex;height:48px">Messagerie</a></div></nav><main></main></div>
<script>var ME={id:5,is_global:false},TK='t',SID=1;window.G=async()=>({enabled:true,interval_sec:60,images:['/img.png']});</script>
<script>${js}</script></body></html>`;
let n = 0; const ok = (c, l) => { assert(c, l); n++; console.log('✔ ' + l); };
(async () => {
  const b = await chromium.launch(), ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 }), page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.route('**/img.png', r => r.fulfill({ contentType: 'image/png', body: png }));
  await page.route('**/*', r => r.request().url().startsWith('http://t.test/') ? r.fulfill({ contentType: 'text/html', body: html }) : r.continue());
  await page.goto('http://t.test/'); await page.waitForSelector('#nav-pub', { state: 'attached', timeout: 8000 }); if (process.env.DBG) console.log(await page.evaluate(() => { const nav = document.getElementById('nav'), s = nav.querySelector('.nav-scroll'); const cn = getComputedStyle(nav); return JSON.stringify({ pos: cn.position, top: cn.top, bottom: cn.bottom, h: cn.height, mh: cn.maxHeight, navH: nav.clientHeight, kids: Array.from(nav.children).map(c => [c.className || c.id, c.offsetHeight, getComputedStyle(c).position]), scrollKids: Array.from(s.children).map(c => c.offsetHeight), pad: getComputedStyle(s).padding }); }));
  await page.waitForTimeout(300);
  const zoneShown = () => page.evaluate(() => { const z = document.getElementById('nav-pub'); return !!z && !z.classList.contains('nav-pub-off') && z.offsetHeight > 0; });
  const overlap = () => page.evaluate(() => { const z = document.getElementById('nav-pub'); if (!z || !z.offsetHeight) return false; const zr = z.getBoundingClientRect(); return Array.from(document.querySelectorAll('#nav .nav-scroll a, #nav .nav-scroll button')).some(e => e.offsetHeight && e.getBoundingClientRect().bottom > zr.top + 1 && e.getBoundingClientRect().top < zr.bottom); });
  ok(await zoneShown(), 'menu court (sous-menus fermés) : la ZONE INFOS est affichée');
  ok(!(await overlap()), 'menu court : aucun élément du menu sous la publicité');
  await page.click('#n1 .nav-parent'); await page.waitForTimeout(500);
  ok(!(await zoneShown()), 'sous-menu ouvert (place insuffisante) : la ZONE INFOS s\'efface');
  ok(!(await overlap()), 'sous-menu ouvert : aucun sous-onglet caché par la publicité');
  const last = await page.evaluate(() => { const a = Array.from(document.querySelectorAll('#n1 .flyout a')).pop(), s = document.querySelector('#nav .nav-scroll'); a.scrollIntoView(); const r = a.getBoundingClientRect(), sr = s.getBoundingClientRect(); return r.bottom <= sr.bottom + 1 && r.top >= sr.top - 1; });
  ok(last, 'dernier sous-onglet atteignable (défilement du menu)');
  ok(await page.evaluate(() => document.getElementById('pub-mobile') !== null), 'la bannière compacte du haut reste disponible');
  await page.click('#n1 .nav-parent'); await page.waitForTimeout(500);
  ok(await zoneShown(), 'sous-menu refermé : la ZONE INFOS revient');
  ok(errs.length === 0, 'aucune erreur JavaScript (' + errs.length + ')');
  await b.close(); console.log(`\n${n}/${n} contrôles réussis.`);
})().catch(e => { console.error(e); process.exit(1); });
