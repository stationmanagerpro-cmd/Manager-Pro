'use strict';
// Rendu des 5 vues « marché » + fenêtre de rapprochement dans Chromium (API simulée). Ignoré si Playwright est absent.
let chromium; try { chromium = require('playwright').chromium; } catch (_) { console.log('market-ui-dom : ignoré (playwright absent)'); process.exit(0); }
const fs = require('fs'), path = require('path'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '../public/ext-market.js'), 'utf8');
(async () => {
  const b = await chromium.launch(), p = await b.newPage(), errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.setContent('<div id="m"></div><div id="out"></div>');
  await p.evaluate(() => {
    window.V = {}; window.VM = {}; window.NAV_ICONS = {}; window.ME = {}; window.can = () => true;
    window.esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    window.nfr = n => String(Math.round(n * 100) / 100); window.f = n => nfr(n) + ' FCFA'; window.dt = t => String(t); window.toast = () => {};
    window.modal = h => { document.getElementById('m').innerHTML = '<div>' + h + '</div>'; }; window.closeM = () => {}; window.ask = (m, cb) => cb(); window.go = () => {};
    window.calls = [];
    window.G = async p => { calls.push(p); if (p.startsWith('/prices/board')) return { can_cost: true, open_shift: 3, items: [{ id: 1, name: 'Gasoil', unit: 'L', sell_price: 700, previous_price: 650, changed_at: '2026-11-01 08:00', qty_7d: 100, buy_price: 600, margin: 100, margin_pct: 14.3, margin_7d: 10000 }] };
      if (p.startsWith('/stock/forecast')) return { window_days: 28, critical: 1, attention: 0, items: [{ id: 1, name: 'Gasoil', unit: 'L', stock: 30, daily_rate: 20, days_left: 1.5, stockout_on: '2026-11-13', order_by: '2026-11-12', level: 'critique' }], no_sales: [{ id: 2, name: 'Huile' }] };
      if (p.startsWith('/risk/shifts')) return { summary: { total: 1, a_controler: 1, a_surveiller: 0, normal: 0 }, shifts: [{ shift_date: '2026-11-10', number: 1, manager: 'adm', cash_gap: -3000, cancelled_count: 1, sales_count: 3, anomaly_count: 1, anomaly_kinds: 'x', score: 62, level: 'a_controler', factors: [{ label: 'Écart', detail: '3000', points: 20 }] }] };
      if (p.startsWith('/loyalty/accounts?')) return { settings: { enabled: true, earn_per_amount: 1000, point_value: 10, fuel_only: true }, accounts: [{ id: 1, name: 'Awa', phone: '+22370112233', plate: 'AB123CD', points: 9, value: 90 }], total_accounts: 1, total_points: 9, total_value: 90 };
      if (p.startsWith('/portal/links')) return [{ id: 1, customer: 'Client X', created_on: '2026-11-01', expires_on: '2026-12-01', views: 2, last_seen: '2026-11-05 10:00', active: true }];
      if (p.startsWith('/customers')) return [{ id: 5, name: 'Client X' }];
      if (p.startsWith('/money/sales-reconcile')) return { account: { name: 'Orange Money' }, from: '2026-11-05', to: '2026-11-11', summary: { declared: 22000, received: 19242, matched_count: 2, declared_not_received_count: 1, declared_not_received: 7000, received_not_declared_count: 1, received_not_declared: 4242 }, declared_not_received: [{ moved_on: '2026-11-11', invoice_no: 'F3', employee: 'Moussa', reference: '', amount: 7000 }], received_not_declared: [{ line_date: '2026-11-11', label: 'x', reference: 'r', amount: 4242 }], by_day: [{ day: '2026-11-11', declared: 22000, received: 19242, gap: -2758 }], by_employee: [{ employee: 'Moussa', count: 1, amount: 7000 }] };
      throw new Error('route ?' + p); };
    window.Po = async () => ({}); window.Pu = async () => ({});
  });
  await p.addScriptTag({ content: src });
  const html = {};
  for (const k of ['prixjour', 'previsions', 'risque', 'fidelite', 'espaceclient']) html[k] = await p.evaluate(async k => { document.getElementById('out').innerHTML = await VM[k](); return document.getElementById('out').innerText; }, k);
  assert.match(html.prixjour, /Gasoil[\s\S]*700 FCFA[\s\S]*650 FCFA/); assert.match(html.prixjour, /Marge/); assert.match(html.prixjour, /quart n° 3/);
  assert.match(html.previsions, /Critique/); assert.match(html.previsions, /Huile/);
  assert.match(html.risque, /62\/100/); assert.match(html.risque, /À contrôler/); assert.match(html.risque, /Écart : 3000 \(\+20\)/);
  assert.match(html.fidelite, /AB123CD/); assert.match(html.fidelite, /Créditer une vente/);
  assert.match(html.espaceclient, /Client X/); assert.match(html.espaceclient, /Révoquer/);
  await p.evaluate(() => mkSalesRec(7)); const m = await p.evaluate(() => document.getElementById('m').innerText);
  assert.match(m, /DÉCLARÉS MAIS NON REÇUS[\s\S]*F3/); assert.match(m, /Moussa/);
  assert.deepStrictEqual(errs, []);
  const keys = await p.evaluate(() => Object.keys(V)); assert.deepStrictEqual(keys.sort(), ['espaceclient', 'fidelite', 'previsions', 'prixjour', 'risque']);
  console.log('✓ market-ui-dom : 5 vues + rapprochement ventes rendus sans erreur'); await b.close();
})().catch(e => { console.error('✗', e.message); process.exit(1); });
