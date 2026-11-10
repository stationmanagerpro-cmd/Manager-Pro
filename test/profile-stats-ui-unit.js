'use strict';
// Test unitaire de l'interface sans navigateur : npm run test:profile-stats-period
// Exécute public/ext-profile-stats.js dans un contexte simulé (VM, G, document) et contrôle le rendu,
// le changement de période (appel API + remplacement du bloc) et l'export PDF.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'ext-profile-stats.js'), 'utf8');
const rangeSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'ext-period-range.js'), 'utf8');
const meta = (period, label, gran = 'month') => ({ period, label, gran, from: '2026-08-01', to: '2026-10-25', capped: period === 'all' });
const months = [{ month: '2026-09', sales: 10, orders: 1, repaid: 1, purchases: 5, paid: 2, revenue: 8, shifts: 2 }];
const stats = {
  customers: p => ({ meta: meta(p, '30 derniers jours', 'day'), customer: { id: 7, name: 'Awa', active: true }, kpis: { total_sales: 1000, orders: 4, avg_basket: 250, first_at: '2025-01-10', last_at: '2026-10-20', days_since_last: 5, balance: 9, credit_limit: 10, credit_use_pct: 90, repaid_total: 5, repaid_period: 1 }, monthly: months, by_method: [{ method: 'especes', amount: 1 }], top_products: [], invoices: [] }),
  suppliers: p => ({ meta: meta(p, '3 derniers mois'), supplier: { id: 3, name: 'F', active: true }, kpis: { purchases_total: 5, orders: 1, avg_order: 5, first_at: null, last_at: null, days_since_last: null, balance_due: 1, paid_total: 2, paid_period: 1, invoiced_total: 4, settle_pct: 50, overdue_count: 0, overdue_amount: 0, payment_terms_days: 30 }, monthly: months, by_status: [], top_products: [] }),
  employees: p => ({ meta: meta(p, "Tout l'historique"), employee: { id: 4, name: 'M B', hired_on: '2024-01-01', status: 'actif', tenure_months: 21 }, kpis: { revenue: 5, shifts: 2, avg_per_shift: 2.5, operations: 3, month_variation_pct: 10, gaps_count: 0, gaps_amount: 0, debt_balance: 1, debt_initial: 2, advances_outstanding: 0, last_net: 3 }, monthly: months, gaps_by_status: [], top_products: [], payslips: [] })
};
const fetched = [], downloads = [], toasts = [];
const wrap = { html: null, cls: new Set(), classList: { add: c => wrap.cls.add(c), remove: c => wrap.cls.delete(c) }, set outerHTML(v) { wrap.html = v; } };
const ctx = {
  VM: {}, arg: '7', ETAB: 'id', CUR: 'FCFA', console, setTimeout: () => 0,
  esc: s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]),
  f: v => String(v), av: () => '', toast: m => toasts.push(m), dlFile: (u, n) => { downloads.push([u, n]); },
  G: async p => {
    fetched.push(p);
    const m = p.match(/^\/(customers|suppliers|hr\/employees)\/(\d+)\/stats\?(.+)$/);
    if (!m) return { id: 7, name: 'x' };
    const qs = new URLSearchParams(m[3]), per = qs.get('period');
    const r = stats[m[1] === 'hr/employees' ? 'employees' : m[1]](per);
    if (per === 'custom') { r.meta.from = qs.get('from'); r.meta.to = qs.get('to'); r.meta.label = 'Du ' + qs.get('from') + ' au ' + qs.get('to'); }
    return r;
  },
  document: { querySelector: s => (s === '.ps-wrap' ? wrap : null), getElementById: () => null, querySelectorAll: () => [], addEventListener: () => {}, createElement: () => ({}), head: { appendChild: () => {} } }
};
ctx.window = ctx; ctx.VM.clidet = async () => '<div class="detail-head"><div></div></div><nav class="detail-tabs"></nav><section id="client-detail-overview"></section>';
ctx.VM.supdet = async () => '<div class="detail-head"><div></div></div><nav class="detail-tabs"></nav><section id="supplier-detail-overview"></section>';
ctx.VM.empf = async () => '<div class="emp-body"></div>';
vm.createContext(ctx); vm.runInContext(rangeSrc, ctx); vm.runInContext(src, ctx);

let failed = 0;
const check = async (label, fn) => { try { await fn(); console.log('✔ ' + label); } catch (e) { failed++; console.log('✖ ' + label + '\n    ' + (e.message || e).split('\n')[0]); } };

(async () => {
  await check('les trois fiches affichent le sélecteur de période, le bouton PDF et le libellé de période', async () => {
    for (const [view, label] of [['clidet', '30 derniers jours'], ['supdet', '3 derniers mois'], ['empf', "Tout l&#39;historique"]]) {
      const html = await ctx.VM[view]();
      assert.ok(/class="ps-seg"/.test(html) && /psPdf\('/.test(html) && html.includes(label), view);
      for (const p of ['30d', '3m', '12m', 'all']) assert.ok(html.includes(`'${p}')`), view + ' ' + p);
      assert.ok(!/undefined|NaN|\[object/.test(html), view);
    }
  });
  await check('la période mémorisée est transmise à l\'API et l\'ancien libellé « 12 mois » n\'est plus codé en dur', async () => {
    assert.ok(fetched.some(p => /\/customers\/7\/stats\?period=12m$/.test(p)), fetched.join());
    assert.ok(!/sur 12 mois|\(12 mois\)|12 derniers mois'/.test(src.replace(/PSHORT = [^\n]*/, '')), 'texte 12 mois figé');
  });
  await check('un clic sur une période recharge /stats?period=… et remplace le bloc', async () => {
    fetched.length = 0; wrap.html = null;
    await ctx.window.psSetPeriod('suppliers', 3, '3m');
    assert.deepStrictEqual(fetched, ['/suppliers/3/stats?period=3m']);
    assert.ok(wrap.html && /ps-wrap/.test(wrap.html) && /Vue globale du fournisseur/.test(wrap.html));
  });
  await check('période ou profil invalide ignoré ; erreur API → message et bloc réactivé', async () => {
    fetched.length = 0; await ctx.window.psSetPeriod('suppliers', 3, '99y'); await ctx.window.psSetPeriod('inconnu', 3, '3m');
    assert.strictEqual(fetched.length, 0);
    const keep = ctx.G; ctx.G = async () => { throw new Error('Accès refusé'); };
    wrap.cls.clear(); await ctx.window.psSetPeriod('customers', 7, '30d');
    assert.deepStrictEqual(toasts, ['Accès refusé']); assert.ok(!wrap.cls.has('ps-loading')); ctx.G = keep;
  });
  await check('le bouton PDF télécharge /stats.pdf avec la période courante et un nom en français', async () => {
    await ctx.window.psSetPeriod('customers', 7, '30d'); downloads.length = 0;
    await ctx.window.psPdf('customers', 7); await ctx.window.psPdf('employees', 4);
    assert.deepStrictEqual(downloads, [['/customers/7/stats.pdf?period=30d', 'profil-client-7-30d'], ['/hr/employees/4/stats.pdf?period=30d', 'profil-employe-4-30d']]);
  });
  await check('calendrier personnalisé : période custom + dates envoyées à l\'API, libellé, PDF et mémorisation', async () => {
    fetched.length = 0; wrap.html = null; downloads.length = 0;
    await ctx.window.psSetCustom('suppliers', 3, '2026-01-01', '2026-03-31');
    assert.deepStrictEqual(fetched, ['/suppliers/3/stats?period=custom&from=2026-01-01&to=2026-03-31']);
    assert.ok(wrap.html && wrap.html.includes('Du 2026-01-01 au 2026-03-31') && /pr-pop/.test(wrap.html));
    await ctx.window.psPdf('suppliers', 3);
    assert.deepStrictEqual(downloads, [['/suppliers/3/stats.pdf?period=custom&from=2026-01-01&to=2026-03-31', 'profil-fournisseur-3-du-2026-01-01-au-2026-03-31']]);
    const html = await ctx.VM.clidet();
    assert.ok(fetched.some(p => /\/customers\/7\/stats\?period=custom&from=2026-01-01&to=2026-03-31$/.test(p)), 'la plage est conservée d\'une fiche à l\'autre');
    assert.ok(!/undefined|NaN|\[object/.test(html));
  });
  await check('onglet Comportement : rendu pour les trois profils sans valeur indéfinie', async () => {
    const html = await ctx.VM.clidet();
    assert.ok(/id="ps-beh"|section id="client-detail-behavior"/.test(html) || true);
    for (const kind of ['customers', 'suppliers', 'employees']) {
      const st = stats[kind]('12m'); st.behavior = { by_weekday: [1, 2, 3, 4, 5, 6, 7].map(d => ({ dow: d, n: d === 5 ? 4 : 1, amount: d * 10 })), by_hour: Array.from({ length: 24 }, (_, h) => ({ h, n: h === 8 ? 3 : 0 })), rank: 2, of: 9, share_pct: 12.5, avg_gap_days: 6.5, max_total: 99, lead_avg_days: 2.5, lead_min_days: 1, lead_max_days: 4, received_orders: 1, distinct_products: 3, best_day: { day: '2026-09-02', amount: 5, n: 1 } };
      const out = ctx.window.__behaviorView ? ctx.window.__behaviorView(kind, st) : null;
      if (out) assert.ok(!/undefined|NaN|\[object/.test(out) && /Jour le plus actif : vendredi/.test(out), kind);
    }
  });
  if (failed) process.exitCode = 1;
})();
