'use strict';
// Test unitaire de l'interface sans navigateur : npm run test:product-profile
// Exécute public/ext-product-profile.js dans un contexte simulé : identité, onglets selon les droits, rendu des onglets,
// commandes en cours qui disparaissent une fois livrées, enregistrement d'un prix, échappement HTML, liste → fiche.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'ext-product-profile.js'), 'utf8');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const stats = (over = {}) => ({
  meta: { period: '12m', label: '12 derniers mois', gran: 'month', from: '2025-11-01', to: '2026-10-27', capped: false },
  product: { id: 12, name: 'Huile <b>5L</b>', category: 'HUILE', category_label: 'Huile', unit: 'L', barcode: 'B1', sku: null, buy_price: 1000, sell_price: 1500, tax_rate: 0, min_stock: 10, stock: 40, active: true, supplier_id: 3, supplier_name: 'Total' },
  kpis: { qty_sold: 90, revenue: 135000, tickets: 30, avg_ticket_qty: 3, avg_daily: 0.3, days: 300, days_cover: 133, first_sale_at: '2026-01-02', last_sale_at: '2026-10-25', days_since_last_sale: 2, share_pct: 25, rank: 2, n_products: 8, stock: 40, stock_value_buy: 40000, stock_value_sell: 60000, low: false, min_stock: 10, margin_unit: 500, margin_pct: 33.3, margin_total: 45000, margin_total_pct: 33.3, losses_qty: 2, open_orders: 1, open_qty: 15, last_buy: { at: '2026-10-01', received_at: null, unit_cost: 1000, qty: 20, supplier: 'Total' } },
  monthly: [{ month: '2026-08', qty: 20, revenue: 30000, cost: 20000, in_qty: 20, out_qty: 10 }, { month: '2026-09', qty: 30, revenue: 45000, cost: 30000, in_qty: 0, out_qty: 30 }, { month: '2026-10', qty: 40, revenue: 60000, cost: 40000, in_qty: 20, out_qty: 40 }],
  weekday: [1, 2, 3, 4, 5, 6, 7].map(d => ({ dow: d, qty: d === 6 ? 30 : 10, revenue: 1 })), top_customers: [{ name: 'Awa', qty: 5, amount: 7500 }], top_employees: [{ name: 'Moussa B', qty: 9, amount: 13500 }],
  movements_by_kind: [{ kind: 'vente', n: 30, qty: -90 }], suppliers: [{ supplier: 'Total', qty: 60, amount: 60000 }], price_points: [], ...over
});
const line = (id, status, o, r) => ({ detail_id: id, purchase_id: id, order_no: 'BC-' + id, status, ordered_at: '2026-10-20', supplier_id: 3, supplier: 'Total', qty_ordered: o, qty_received: r, qty_remaining: ['commande', 'partiel'].includes(status) && r < o ? o - r : 0, unit_cost: 1000, line_total: o * 1000, received_total: r * 1000, open: ['commande', 'partiel'].includes(status) && r < o, waiting_days: 7 });
let supplyLines = [line(1, 'commande', 20, 0), line(2, 'recu', 10, 10)];
const API = {
  '/products/12/prices': () => ({ product: { id: 12, name: 'Huile', unit: 'L', sell_price: 1500, buy_price: 1000, tax_rate: 0 }, margin_unit: 500, margin_pct: 33.3, can_edit: true, history: [
    { id: 2, type: 'sell', price: 1500, old_price: 1200, delta: 300, delta_pct: 25, from: '2026-10-01', to: null, note: 'hausse <i>x</i>', by: 'mod' }, { id: 1, type: 'sell', price: 1200, old_price: null, delta: null, delta_pct: null, from: '2026-08-01', to: '2026-10-01', note: null, by: null }] }),
  '/products/12/purchases': () => ({ lines: supplyLines, summary: { orders: 2, qty_ordered: 30, qty_received: 10, spent: 10000, avg_cost: 1000, min_cost: 1000, max_cost: 1000, open_count: supplyLines.filter(l => l.open).length, open_qty: 20, truncated: false } }),
  '/products/12/stock-history': () => ({ product: { id: 12, name: 'Huile', unit: 'L', stock: 40, min_stock: 10 }, rows: [{ id: 9, kind: 'achat', quantity: 20, balance_after: 40, comment: 'Réception <script>', at: '2026-10-20', by: 'mod', ref: { type: 'purchase', label: 'BC-5-00009', id: 9 } }, { id: 8, kind: 'perte', quantity: -2, balance_after: 20, comment: null, at: '2026-10-19', by: null, ref: null }], by_kind: [{ kind: 'achat', n: 1, qty: 20, qty_in: 20, qty_out: 0 }, { kind: 'perte', n: 1, qty: -2, qty_in: 0, qty_out: 2 }, { kind: 'correction', n: 2, qty: 1, qty_in: 3, qty_out: 2 }], truncated: false })
};
const fetched = [], posts = [], toasts = [], panes = {}; let clickHandler = null; let perms = new Set(['price.edit', 'stock.adjust', 'report.view', 'purchase.manage', 'supplier.view']);
const el = id => (panes[id] = panes[id] || { id, innerHTML: '', value: '', classList: { add() {}, remove() {} }, setAttribute() {}, scrollIntoView() {} });
const ctx = {
  URLSearchParams, Number, Math, Intl, Date, JSON, Set,
  VM: { prod: async () => '<table><tbody><tr onclick="editP(12)"><td>Huile</td></tr><tr ><td>Pain</td></tr></tbody></table>' }, arg: '12', CUR: 'FCFA', console, setTimeout: () => 0, NAVOF: {}, TITLES: {}, PSC: [{ id: 12 }, { id: 13 }],
  esc, f: v => String(v) + ' F', dt: v => String(v), can: p => p.split('|').some(x => perms.has(x)), toast: (m, t) => toasts.push([m, t]), errMsg: e => e.message, confirm: () => true,
  T: (h, r) => '<table><thead>' + h.join('|') + '</thead><tbody>' + r.map(x => '<tr>' + x.join('|') + '</tr>').join('') + '</tbody></table>',
  G: async p => { fetched.push(p); const k = p.split('?')[0]; if (/\/profile$/.test(k)) return stats(); if (API[k]) return API[k](); throw new Error('route inconnue ' + p); },
  Po: async (p, b) => { posts.push([p, b]); return { ok: true }; }, go: async () => {}, form: () => {}, closeM: () => {}, editP: () => {}, showPO: () => {},
  document: { querySelectorAll: () => [], querySelector: () => null, getElementById: el, createElement: () => ({}), head: { appendChild: () => {} }, addEventListener: (t, fn) => { if (t === 'click') clickHandler = fn; } }
};
ctx.window = ctx; vm.createContext(ctx); vm.runInContext(require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'ext-period-range.js'), 'utf8'), ctx); vm.runInContext(src, ctx);

let failed = 0;
const check = async (label, fn) => { try { await fn(); console.log('✔ ' + label); } catch (e) { failed++; console.log('✖ ' + label + '\n    ' + (e.stack || e).split('\n').slice(0, 3).join('\n    ')); } };
const open = async key => { clickHandler({ target: { closest: () => ({ dataset: { ppTab: key } }) } }); await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r)); };

(async () => {
  await check('la vue et la navigation sont enregistrées (fiche rattachée à « Produits »)', () => {
    assert.strictEqual(typeof ctx.VM.prodf, 'function'); assert.strictEqual(ctx.NAVOF.prodf, 'prod'); assert.ok(ctx.TITLES.prodf);
  });
  await check('fiche : informations du produit en haut + 5 onglets horizontaux, échappement HTML', async () => {
    const html = await ctx.VM.prodf();
    assert.ok(html.indexOf('class="pid pp-id"') < html.indexOf('class="pp-tabs"'), 'identité avant les onglets');
    for (const t of ["Vue d'ensemble", 'Comportement', 'Gestion des prix', 'Historique dotation', 'Historique des stocks']) assert.ok(html.includes(t), t);
    assert.ok(html.includes('Huile &lt;b&gt;5L') && !html.includes('<b>5L</b>'), 'nom échappé');
    for (const t of ['Code-barres', "Prix d'achat", 'Prix de vente', 'Marge unitaire', 'Stock actuel', 'Seuil minimum', 'Fournisseur principal']) assert.ok(html.includes(t), t);
    assert.ok(/data-pp-tab="overview"/.test(html) && /id="pp-pane-overview"/.test(html) && /Vue globale du produit/.test(html));
    assert.ok(html.includes("ppPeriod('30d')") && html.includes("ppPeriod('all')") && html.includes('pr-cal-btn') && html.includes('ppCustom'));
  });
  await check('onglets masqués selon les droits (sans achats ni stocks)', async () => {
    perms = new Set(['sale.create']);
    const html = await ctx.VM.prodf();
    assert.ok(!html.includes('Historique dotation') && !html.includes('Historique des stocks') && html.includes('Gestion des prix'));
    assert.ok(!html.includes('ppEdit') && !html.includes('ppMove'));
    perms = new Set(['price.edit', 'stock.adjust', 'report.view', 'purchase.manage', 'supplier.view']);
  });
  await check('Comportement : lecture rapide et graphiques', async () => {
    await ctx.VM.prodf(); await open('behavior');
    const h = panes['pp-pane-behavior'].innerHTML;
    assert.ok(/Lecture rapide/.test(h) && /N°2 sur 8/.test(h) && /Jour le plus fort : samedi/.test(h) && /Hausse de/.test(h) && /Marge brute/.test(h));
  });
  await check('Gestion des prix : formulaire, indicateurs, historique complet, notes échappées', async () => {
    await ctx.VM.prodf(); await open('prices');
    const h = panes['pp-pane-prices'].innerHTML;
    assert.ok(/Modifier les prix/.test(h) && /id="pp-sell"/.test(h) && /id="pp-buy"/.test(h) && /Historique complet des prix/.test(h));
    assert.ok(h.includes('hausse &lt;i&gt;x&lt;/i&gt;') && !h.includes('<i>x</i>'));
    assert.ok(/En vigueur/.test(h) && /jusqu'au/.test(h) && /▲/.test(h));
  });
  await check('Gestion des prix : enregistrement envoie seulement les prix modifiés avec la note', async () => {
    await ctx.VM.prodf(); await open('prices');
    const vals = { 'pp-sell': 1800, 'pp-buy': 1000, 'pp-note': 'promo' };
    for (const k in vals) el(k).value = vals[k];
    posts.length = 0; await ctx.ppSavePrices();
    assert.strictEqual(JSON.stringify(posts[0]), JSON.stringify(['/products/12/prices', { sell_price: 1800, note: 'promo' }]));
    posts.length = 0; el('pp-sell').value = 1500; el('pp-note').value = ''; await ctx.ppSavePrices();
    assert.strictEqual(posts.length, 0, 'aucun envoi si rien ne change');
    el('pp-sell').value = -5; await ctx.ppSavePrices(); assert.strictEqual(posts.length, 0, 'prix négatif refusé');
  });
  await check('Historique dotation : « Commande en cours » liste les commandes non livrées puis les retire une fois livrées', async () => {
    supplyLines = [line(1, 'commande', 20, 0), line(2, 'partiel', 10, 4), line(3, 'recu', 10, 10)];
    await ctx.VM.prodf(); await open('supply');
    let h = panes['pp-pane-supply'].innerHTML;
    assert.ok(h.includes('Commande en cours') && h.includes('Historique des achats') && h.includes('BC-3'));
    ctx.ppSupplyView('open'); h = panes['pp-pane-supply'].innerHTML;
    assert.ok(h.includes('BC-1') && h.includes('BC-2') && !h.includes('BC-3'), 'les commandes livrées ne sont pas en cours');
    assert.ok(/<b>6<\/b>/.test(h), 'reste à livrer du partiel');
    supplyLines = [line(1, 'recu', 20, 20), line(2, 'recu', 10, 10)];
    await ctx.VM.prodf(); await open('supply'); ctx.ppSupplyView('open'); h = panes['pp-pane-supply'].innerHTML;
    assert.ok(/Aucune commande en attente de livraison/.test(h) && !h.includes('BC-1'));
  });
  await check('Historique des stocks : entrées, sorties, pertes, corrections, références, échappement', async () => {
    await ctx.VM.prodf(); await open('stock');
    const h = panes['pp-pane-stock'].innerHTML;
    for (const t of ['Entrées (total)', 'Sorties (total)', 'Pertes et casse', 'Corrections', 'Achat (réception)', 'Perte', 'BC-5-00009', 'Stock après', 'Mouvement']) assert.ok(h.includes(t), t);
    assert.ok(h.includes('+3') && h.includes('−2'), 'corrections + / −');
    assert.ok(h.includes('Réception &lt;script&gt;') && !h.includes('<script>'));
  });
  await check('filtre de l\'historique des stocks : paramètres transmis à l\'API', async () => {
    await ctx.VM.prodf(); await open('stock');
    el('pp-skind').value = 'perte'; el('pp-sfrom').value = '2026-10-01'; el('pp-sto').value = '2026-10-27'; fetched.length = 0;
    await ctx.ppStockFilter();
    assert.ok(fetched.some(u => /\/products\/12\/stock-history\?/.test(u) && /kind=perte/.test(u) && /from=2026-10-01/.test(u) && /to=2026-10-27/.test(u)), fetched.join());
  });
  await check('changement de période : recharge le profil avec la période demandée', async () => {
    await ctx.VM.prodf(); fetched.length = 0; await ctx.ppPeriod('30d');
    assert.ok(fetched.includes('/products/12/profile?period=30d'));
  });
  await check('calendrier personnalisé : les deux dates sont envoyées au profil produit et conservées', async () => {
    await ctx.VM.prodf(); fetched.length = 0; await ctx.ppCustom('2026-09-01', '2026-09-30');
    assert.ok(fetched.includes('/products/12/profile?period=custom&from=2026-09-01&to=2026-09-30'), fetched.join());
    await ctx.ppPeriod('12m'); fetched.length = 0; await ctx.VM.prodf();
    assert.ok(fetched.includes('/products/12/profile?period=12m'), fetched.join());
  });
  await check('liste des produits : chaque ligne ouvre la fiche (même sans droit de modification)', async () => {
    const html = await ctx.VM.prod();
    assert.ok(html.includes("go('prodf',12)") && html.includes("go('prodf',13)") && !html.includes('editP(12)'));
  });

  console.log(failed ? `\n${failed} test(s) en échec` : '\nTous les tests de la fiche produit (interface) passent.');
  process.exit(failed ? 1 : 0);
})();
