'use strict';
// Harnais navigateur (Chromium headless) : charge les vrais fichiers public/ext-*.js avec une API simulée,
// pilote filtres + exports et valide chaque charge utile PDF contre le schéma zod de src/docs_render.js.
// Lancer : NODE_PATH=<node_modules avec playwright et zod> node test/report-ui-harness.js
const fs = require('fs'), path = require('path'), assert = require('assert'), vm = require('vm');
const { chromium } = require('playwright'); const { z } = require('zod');
const root = path.resolve(__dirname, '..'), rd = f => fs.readFileSync(path.join(root, f), 'utf8');
// --- schéma réel du serveur (extrait du source, pas recopié)
const src = rd('src/docs_render.js');
const schemaSrc = src.slice(src.indexOf('const cell ='), src.indexOf('const ALLOWED'));
const ctx = { z }; vm.createContext(ctx); vm.runInContext(schemaSrc.replace(/const (cell|section|payload) =/g, 'var $1 ='), ctx);
const payloadSchema = ctx.payload;
let n = 0; const ok = l => { n++; console.log('✔ ' + l); };

const mkDb = () => {
  const cards = [
    { id: 1, card_number: 'FC-001', label: 'AA-1111', driver_name: 'Moussa', customer_id: 7, customer_name: 'SOTRAMA', status: 'active', usage: { dayLiters: 10, monthLiters: 120 }, max_liters_day: 50, allowed_days: [], period: null },
    { id: 2, card_number: 'FC-002', label: 'BB-2222', customer_id: 7, customer_name: 'SOTRAMA', status: 'blocked', blocked_reason: 'Suspendue', usage: { dayLiters: 0, monthLiters: 0 }, allowed_days: [] },
    { id: 3, card_number: 'FC-003', label: 'CC-3333', customer_id: 8, customer_name: 'MALITEL', status: 'active', usage: { dayLiters: 0, monthLiters: 5 }, allowed_days: [] }];
  const act = { 1: [['2026-11-02', 40, 30000], ['2026-11-05', 20, 15000]], 3: [['2026-10-10', 15, 11000]] };
  const events = Array.from({ length: 250 }, (_, i) => ({ id: i, event_at: `2026-11-${String(1 + i % 28).padStart(2, '0')}T10:00:00Z`, event_type: 'VENTE', direction: i % 3 ? 'in' : 'out', amount: 1000 + i, method: 'cash', label: 'Op ' + i }));
  return { cards, act, events };
};
const json = (o, s = 200) => ({ status: s, contentType: 'application/json', body: JSON.stringify(o) });

(async () => {
  const db = mkDb(), sent = [], queries = [];
  const browser = await chromium.launch(); const page = await browser.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.route('**/*', async route => {
    const u = new URL(route.request().url()), p = u.pathname, q = u.searchParams;
    if (!p.startsWith('/api/')) return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body><div id="pg"></div></body></html>' });
    queries.push(p + u.search);
    const from = q.get('from'), to = q.get('to');
    if (from && to && from > to) return route.fulfill(json({ error: 'La date de début ne peut pas être postérieure à la date de fin' }, 400));
    if (p === '/api/docs/render') { sent.push(JSON.parse(route.request().postData())); return route.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.4' }); }
    if (p === '/api/customers') return route.fulfill(json([{ id: 7, name: 'SOTRAMA' }, { id: 8, name: 'MALITEL' }]));
    if (p === '/api/fleet/cards') {
      let rows = db.cards.filter(c => !q.get('customer_id') || String(c.customer_id) === q.get('customer_id'));
      if (from) rows = rows.map(c => { const a = (db.act[c.id] || []).filter(x => x[0] >= from && x[0] <= to); return { ...c, period: { from, to, uses: a.length, liters: a.reduce((s, x) => s + x[1], 0), amount: a.reduce((s, x) => s + x[2], 0), declines: 0 } }; }).filter(c => q.get('active_only') !== '1' || c.period.uses);
      return route.fulfill(json(rows));
    }
    if (p === '/api/finance/events') {
      const rows = db.events.filter(e => (!from || e.event_at.slice(0, 10) >= from) && (!to || e.event_at.slice(0, 10) <= to)), lim = +q.get('limit') || 100;
      const i = rows.filter(r => r.direction === 'in').reduce((s, r) => s + r.amount, 0), o = rows.filter(r => r.direction === 'out').reduce((s, r) => s + r.amount, 0);
      return route.fulfill(json({ lines: rows.slice(0, lim), totals: {}, period_totals: { count: rows.length, in: i, out: o, net: i - o, truncated: rows.length > lim }, note: '' }));
    }
    if (p === '/api/money/commission-rates') return route.fulfill(json({ wave: 1, orange_money: 1.5, mobile_money: 0, history: [] }));
    if (p === '/api/money/commission-report') return route.fulfill(json({ from, to, lines: [{ label: 'Wave', gross: 100000, rate_pct: 1, commission: 1000, net: 99000 }], total_gross: 100000, total_commission: 1000 }));
    if (p === '/api/reports/eod-period') return route.fulfill(json({ from, to, days: 2, kpis: { product_sales: 300, product_count: 3, fuel_liters: 50, fuel_amount: 600, expenses: 100, result: 800, shifts_closed: 1, cash_gap: -50 },
      by_day: [{ date: from, product_sales: 100, fuel_liters: 20, fuel_amount: 200, expenses: 0, result: 300, shifts_closed: 0, cash_gap: 0 }, { date: to, product_sales: 200, fuel_liters: 30, fuel_amount: 400, expenses: 100, result: 500, shifts_closed: 1, cash_gap: -50 }], shifts: [{ number: 4, kind: 'jour', closed_at: to + 'T18:00:00Z', cash_gap: -50 }], low_stock: [{ name: 'Huile', quantity: 2, min_stock: 5 }] }));
    if (p === '/api/reports/reconciliation') return route.fulfill(json({ from, to, pumps: { lines: [], total_liters: 50, total_amount: 600 }, sales: { product_sales: 300 }, payments: [{ label: 'Espèces', amount: 900 }], expenses: 100, cash: { total_gap: -50 },
      operations: [{ number: 1, kind: 'jour', state: 'reconciled', opened_at: from + 'T06:00:00Z', closed_at: from + 'T14:00:00Z', fuel_liters: 10, fuel_amount: 100, theoretical: 500, counted: 500, gap: 0 }, { number: 2, kind: 'nuit', state: 'gap', opened_at: from + 'T14:00:00Z', closed_at: to + 'T02:00:00Z', fuel_liters: 40, fuel_amount: 500, theoretical: 800, counted: 750, gap: -50 }, { number: 3, kind: 'jour', state: 'unreconciled', opened_at: to + 'T06:00:00Z', closed_at: null, fuel_liters: 0, fuel_amount: 0, theoretical: null, counted: null, gap: null }],
      summary: { counts: { total: 3, reconciled: 1, gap: 1, unreconciled: 1 }, fuel_vs_sales_note: 'note' } }));
    return route.fulfill(json({}));
  });
  await page.goto('http://localhost:9/index.html');
  // --- environnement minimal reproduisant les globales de app.js
  await page.evaluate(() => {
    window.ME = { permissions: ['report.view', 'finance.view', 'customer.view', 'customer.edit', 'money.manage', 'settings.edit', 'user.manage'], stations: [{ id: 1 }] };
    window.TK = 't'; window.SID = 1; window.CUR = 'FCFA'; window.V = {}; window.VM = {}; window.NAV_ICONS = {}; window.toasts = [];
    const geval = eval; geval(`
      var can = p => p == '*' || p.split('|').some(x => ME.permissions.includes(x));
      var esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
      var loc = () => 'fr-FR', f = n => new Intl.NumberFormat('fr-FR').format(+n || 0) + ' FCFA', dt = t => t ? String(t).slice(0,16) : '';
      var card = (l, v, n='') => '<div class="card"><small>'+l+'</small><b>'+v+'</b>'+n+'</div>';
      var T = (h, r) => '<table><thead><tr>'+h.map(x=>'<th>'+x).join('')+'</tr></thead><tbody>'+r.map(x=>'<tr>'+x.map(y=>'<td>'+y).join('')+'</tr>').join('')+'</tbody></table>';
      var emptyState = o => '<div>'+o.title+'</div>';
      var toast = (m, t) => window.toasts.push([m, t]);
      var G = async p => { const r = await fetch('/api' + p); const j = await r.json(); if (!r.ok) { const e = new Error(j.error); e.status = r.status; throw e; } return j; };
      var api = G, Po = G, form = () => {}, modal = () => {}, closeM = () => {};
      var go = async k => { document.getElementById('pg').innerHTML = await VM[k](); };
    `);
  });
  for (const f of ['ext-branded-pdf.js', 'ext-report-tools.js', 'ext-finance-p4.js', 'ext-fleet.js', 'ext-modern-pack.js', 'ext-magasins.js', 'ext-map.js']) await page.addScriptTag({ content: rd('public/' + f) });
  const html = () => page.evaluate(() => document.getElementById('pg').innerHTML);
  const setDates = (key, a, b) => page.evaluate(([k, a, b]) => { const box = document.querySelector(`.rt-bar[data-rt="${k}"]`); box.querySelector('.rt-from').value = a; box.querySelector('.rt-to').value = b; }, [key, a, b]);
  const click = (key, cls) => page.evaluate(([k, c]) => document.querySelector(`.rt-bar[data-rt="${k}"] .${c}`).click(), [key, cls]);
  const err = key => page.evaluate(k => { const e = document.querySelector(`.rt-bar[data-rt="${k}"] .rt-err`); return e.hidden ? '' : e.textContent; }, key);
  const lastPdf = () => { const p = sent[sent.length - 1]; const r = payloadSchema.safeParse(p); assert.ok(r.success, 'Charge PDF invalide : ' + (r.error && JSON.stringify(r.error.issues.slice(0, 3)))); return p; };
  const tick = () => page.waitForTimeout(250);

  // ===== Cartes flotte
  await page.evaluate(() => go('flotte')); await tick();
  assert.ok((await html()).includes('Exporter en PDF') && (await html()).includes('Date de début')); ok('Cartes flotte : barre de filtre + bouton PDF présents');
  await setDates('flotte', '2026-11-10', '2026-11-01'); await click('flotte', 'rt-go');
  assert.match(await err('flotte'), /ne peut pas être postérieure/); ok('Cartes flotte : début > fin refusé côté interface');
  await setDates('flotte', '', '2026-11-01'); await click('flotte', 'rt-go'); assert.match(await err('flotte'), /Renseignez/); ok('Cartes flotte : date manquante refusée');
  await setDates('flotte', '2026-11-01', '2026-11-07'); await click('flotte', 'rt-go'); await tick();
  let h = await html(); assert.ok(h.includes('FC-001') && !h.includes('FC-002') && !h.includes('FC-003')); assert.ok(h.includes('Total période')); ok('Cartes flotte : filtre période → seules les cartes actives, totaux affichés');
  assert.ok(queries.some(x => x.includes('/fleet/cards?from=2026-11-01&to=2026-11-07&active_only=1'))); ok('Cartes flotte : requête serveur from/to/active_only');
  await click('flotte', 'rt-pdf'); await tick(); let p = lastPdf();
  assert.strictEqual(p.period, 'du 01/11/2026 au 07/11/2026'); const t = p.sections.find(s => s.type === 'table'); assert.strictEqual(t.rows.length, 1); assert.deepStrictEqual(t.totals.slice(5, 8), [2, 60, 45000]); ok('Cartes flotte : PDF = période + lignes affichées + totaux exacts (2 prises, 60 L, 45 000)');
  await click('flotte', 'rt-reset'); await tick(); h = await html(); assert.ok(h.includes('FC-002') && h.includes('FC-003')); ok('Cartes flotte : réinitialiser → toutes les cartes');
  await setDates('flotte', '2026-01-01', '2026-01-02'); await click('flotte', 'rt-go'); await tick(); h = await html(); assert.ok(h.includes('Aucune carte active sur cette période')); await click('flotte', 'rt-pdf'); await tick(); lastPdf(); ok('Cartes flotte : période sans données → message + PDF valide (tableau vide)');
  await page.evaluate(() => fleetFilter('8')); await tick(); await setDates('flotte', '2026-10-01', '2026-10-31'); await click('flotte', 'rt-go'); await tick(); h = await html(); assert.ok(h.includes('FC-003') && !h.includes('FC-001')); ok('Cartes flotte : filtres combinés client + période');

  // ===== Journal financier
  await page.evaluate(() => go('finevents')); await tick();
  await setDates('finevents', '2026-11-01', '2026-11-30'); await click('finevents', 'rt-go'); await tick(); h = await html();
  assert.ok(h.includes('250') && h.includes('100 lignes affichées sur 250')); ok('Journal : totaux sur toute la période (250 opérations), 100 lignes affichées');
  await click('finevents', 'rt-pdf'); await tick(); p = lastPdf(); assert.strictEqual(p.sections.find(s => s.type === 'table').rows.length, 250);
  assert.ok(queries.some(x => x.includes('finance/events?from=2026-11-01&to=2026-11-30&limit=5000'))); ok('Journal : PDF = les 250 lignes de la période (limit=5000) et même période');
  const kp = p.sections.find(s => s.type === 'kpis').items; const expIn = db.events.filter(e => e.direction === 'in').reduce((s, e) => s + e.amount, 0); assert.strictEqual(kp[0].value, expIn); ok('Journal : total Entrées du PDF = somme réelle');

  // ===== Commissions
  await page.evaluate(() => go('mmcomm')); await tick(); await setDates('mmcomm', '2026-11-01', '2026-11-07'); await click('mmcomm', 'rt-go'); await tick();
  assert.ok((await html()).includes('Total commissions estimées')); await click('mmcomm', 'rt-pdf'); await tick(); p = lastPdf(); assert.strictEqual(p.sections.find(s => s.title && s.title.startsWith('Estimation')).totals[3], 1000); ok('Commissions : filtre + PDF (totaux brut/commission/net)');
  await setDates('mmcomm', '2026-11-09', '2026-11-01'); await click('mmcomm', 'rt-go'); assert.ok(await err('mmcomm')); ok('Commissions : début > fin refusé');

  // ===== Fin de journée
  await page.evaluate(() => go('eod')); await tick(); await setDates('eod', '2026-11-01', '2026-11-02'); await click('eod', 'rt-go'); await tick(); h = await html();
  assert.ok(h.includes('Détail par jour') && h.includes('Stock bas')); await click('eod', 'rt-pdf'); await tick(); p = lastPdf();
  assert.ok(p.sections.some(s => s.type === 'table' && s.title === 'Détail par jour' && s.totals[1] === 300)); ok('Fin de journée : détail par jour + PDF avec totaux');

  // ===== Rapprochement
  await page.evaluate(() => go('reconcile')); await tick(); await setDates('reconcile', '2026-11-01', '2026-11-02'); await click('reconcile', 'rt-go'); await tick(); h = await html();
  assert.ok(h.includes('Avec écart') && h.includes('Non rapprochée') && h.includes('Rapprochée')); await click('reconcile', 'rt-pdf'); await tick(); p = lastPdf();
  const titles = p.sections.map(s => s.title || ''); assert.ok(titles.some(x => x.startsWith('Opérations présentant un écart (1)')) && titles.some(x => x.startsWith('Opérations non rapprochées (1)')) && titles.some(x => x.startsWith('Opérations rapprochées (1)'))); ok('Rapprochement : 3 groupes de statuts dans le PDF');
  assert.strictEqual(p.period, 'du 01/11/2026 au 02/11/2026'); ok('Rapprochement : période du PDF = période appliquée');

  // ===== Mes stations (cases cochées) + Carte des stations (sans carte chargée)
  await page.evaluate(() => { ME.permissions = ['report.view', 'finance.view', 'user.manage']; window.__magExportData = { from: '2026-11-01', to: '2026-11-07', period: 'month', all: [{ id: 1, name: 'STATION A', ca_ttc: 1000, marge_brute: 200, achats: 500, stock_valorise: 300, ventes: 4, articles: 9, is_current: true }, { id: 2, name: 'DEPOT B', ca_ttc: 3000, marge_brute: 600, achats: 100, stock_valorise: 50, ventes: 6, articles: 3 }] }; magExportPdf(); });
  await tick(); p = lastPdf(); const opts = p.sections.filter(s => s.type === 'options');
  assert.strictEqual(opts.length, 2); assert.deepStrictEqual(opts[0].items.filter(i => i.selected).map(i => i.label), ['Ce mois']); assert.deepStrictEqual(opts[1].items.filter(i => i.selected).map(i => i.label), ['Comparaison des performances']); ok('Mes stations : options sélectionnées (Ce mois, Comparaison) cochées dans le PDF');
  const ct = p.sections.find(s => s.type === 'table'); assert.strictEqual(ct.totals[2], 4000); assert.strictEqual(ct.rows[1][3], 75); ok('Mes stations : totaux (CA 4 000) et parts (75 %) exacts');
  await page.evaluate(() => { window.__smpView = { scope: 'mine', stations: [{ id: 1, name: 'S1', address: 'Senou, Bamako', latitude: 12.6, longitude: -8, is_current: true }, { id: 2, name: 'S2', address: '', latitude: null, longitude: null }] }; document.body.insertAdjacentHTML('beforeend', '<div id="smp-map"></div>'); smpExportPdf(); });
  await tick(); p = lastPdf(); const mt = p.sections.find(s => s.type === 'table'); assert.strictEqual(mt.rows.length, 2); assert.strictEqual(mt.rows[1][mt.rows[1].length - 1], 'Non localisée'); assert.ok(p.sections.some(s => s.type === 'text' && s.title === 'Carte')); ok('Carte : liste complète, station sans coordonnées signalée, repli sans carte');

  // ===== Droits : sans droit PDF, pas de bouton
  await page.evaluate(() => { ME.permissions = ['customer.view']; go('flotte'); }); await tick(); assert.ok(!(await html()).includes('Exporter en PDF')); ok('Permissions : bouton PDF masqué sans droit de rendu');
  assert.deepStrictEqual(errors, [], 'Erreurs JS : ' + errors.join(' | ')); ok('Aucune erreur JavaScript levée pendant les scénarios');
  await browser.close(); console.log(`\n${n} contrôles réussis.`);
})().catch(e => { console.error('✖', e.message); process.exit(1); });
