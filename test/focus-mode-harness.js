'use strict';
// Mode Focus : (1) vente rapide — le pompiste suit la POMPE du compteur choisi (plus de 1er employé par défaut) ; (2) bannière compacte, sans débordement en écran étroit.
// Lancer : NODE_PATH=<node_modules avec playwright> node test/focus-mode-harness.js
const fs = require('fs'), path = require('path'), assert = require('assert');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..'), rd = f => fs.readFileSync(path.join(root, f), 'utf8');
let n = 0; const ok = l => { n++; console.log('✔ ' + l); };
(async () => {
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 390, height: 800 } });
  const errors = []; pg.on('pageerror', e => errors.push(String(e)));
  const html = rd('public/index.html').replace(/<script[\s\S]*?<\/script>/g, '');
  await pg.route('**/*', r => { const u = new URL(r.request().url()); if (u.pathname === '/') return r.fulfill({ contentType: 'text/html', body: html }); const f = path.join(root, 'public', u.pathname); return fs.existsSync(f) && fs.statSync(f).isFile() ? r.fulfill({ path: f }) : r.fulfill({ status: 404, body: '' }); });
  await pg.goto('http://x.test/');
  await pg.evaluate(() => {
    window.esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    window.toast = () => {}; window.V = {}; window.VM = {}; window.ME = { id: 1 }; window.sent = [];
    window.G = async p => p === '/pumps' ? [{ id: 1, name: 'Pompe 1', counters: [{ id: 11, counter_number: 1, product: 'Essence' }] }, { id: 2, name: 'Pompe 2', counters: [{ id: 21, counter_number: 1, product: 'Gasoil' }] }, { id: 3, name: 'Pompe 3', counters: [{ id: 31, counter_number: 1, product: 'Gasoil' }] }]
      : p === '/shifts/current' ? { id: 5, team: [{ id: 1, name: 'Kontao Amadou', pump_ids: [1] }, { id: 2, name: 'Traoré Fanta', pump_ids: [2] }] } : [];
    window.Po = async (p, body) => { window.sent.push([p, body]); return {}; };
    window.errMsg = e => e.message; window.go = () => {}; window.can = () => true;
  });
  await pg.addScriptTag({ content: rd('public/ext-improvements.js') });
  const state = () => pg.evaluate(() => { const e = document.getElementById('fq-emp'); return { v: e.value, dis: e.disabled, txt: e.options[e.selectedIndex].textContent, note: document.getElementById('fq-emp-note').textContent }; });
  await pg.evaluate(async () => { document.getElementById('app').classList.add('ready'); document.body.classList.add('focus-mode'); document.getElementById('pg').innerHTML = await renderFocusQuickSale(); }); await pg.waitForTimeout(100);
  let s = await state(); assert.deepStrictEqual([s.v, s.dis], ['1', true]); ok('Focus : premier compteur (Pompe 1) → pompiste = Kontao Amadou, sélection verrouillée');
  await pg.selectOption('#fq-counter', '21'); s = await state(); assert.deepStrictEqual([s.v, s.dis, s.txt], ['2', true, 'Traoré Fanta']); assert.match(s.note, /Traoré Fanta/); ok('Focus : compteur de la Pompe 2 → pompiste = Traoré Fanta (BUG signalé : restait le 1er employé)');
  await pg.selectOption('#fq-counter', '31'); s = await state(); assert.strictEqual(s.dis, false); assert.match(s.note, /pas de responsable/); ok('Focus : pompe sans responsable → choix manuel déverrouillé');
  await pg.selectOption('#fq-counter', '21'); await pg.fill('#fq-val', '5000'); await pg.selectOption('#fq-mode', 'montant'); await pg.evaluate(() => submitFocusSale());
  const sent = await pg.evaluate(() => window.sent.find(x => x[0] === '/sales/fuel')); assert.strictEqual(sent[1].employee_id, 2); assert.strictEqual(sent[1].counter_id, 21); ok('Focus : la vente envoyée porte employee_id = responsable de la pompe');
  // bannière en écran étroit (téléphone 390 px) avec le nom long de la capture
  await pg.evaluate(() => {
    document.getElementById('app').classList.add('ready'); document.documentElement.dataset.skin = 'pro'; document.documentElement.dataset.hero = '1';
    const main = document.querySelector('main'), h = document.createElement('div'); h.id = 'hero'; h.className = 'hero hero-top al-center has-img tone-light len-m';
    h.innerHTML = '<div class="hero-in"><span class="hero-logo"></span><div class="hero-txt"><h1 class="hero-name">STATION DE TEST</h1><p class="hero-slogan">Slogan</p><button class="hero-cta">Accéder aux ventes →</button></div></div>'; main.insertBefore(h, document.getElementById('app-header'));
  });
  const m = await pg.evaluate(() => { const hn = document.querySelector('.hero-name'), r = hn.getBoundingClientRect(), lh = parseFloat(getComputedStyle(hn).lineHeight) || r.height; return { lines: Math.round(r.height / lh), cta: getComputedStyle(document.querySelector('.hero-cta')).display, slogan: getComputedStyle(document.querySelector('.hero-slogan')).display, heroH: document.getElementById('hero').getBoundingClientRect().height, hscroll: document.documentElement.scrollWidth > innerWidth }; });
  assert.ok(m.lines <= 2 && m.cta === 'none' && m.slogan === 'none' && m.heroH < 110 && !m.hscroll, JSON.stringify(m)); ok('Focus : bannière compacte (≤ 2 lignes, sans bouton ni slogan, < 110 px, sans défilement horizontal)');
  assert.deepStrictEqual(errors, []); ok('Aucune erreur JavaScript');
  await b.close(); console.log(`\n${n} contrôles réussis.`);
})().catch(e => { console.error('✖', e.message); process.exit(1); });
