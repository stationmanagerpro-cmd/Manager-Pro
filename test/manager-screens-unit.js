'use strict';
// Écrans gérant (synthèse hebdo, justificatifs) : rendu, navigation bornée, droits de menu. API simulée, pas de navigateur.
const assert = require('assert'), fs = require('fs'), vm = require('vm'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'ext-manager-screens.js'), 'utf8');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let n = 0; const check = async (l, f) => { await f(); n++; console.log('✓ ' + l); };
function load(apiGet, extra = {}) {
  const calls = []; const ctx = {
    console, setTimeout, Date, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} }, fetch: async () => ({ ok: true, blob: async () => ({}) }),
    navigator: {}, window: { open: () => ({ location: {}, close() {} }) }, document: { getElementById: () => ({ value: '2026-11-01' }) },
    VM: {}, V: {}, NAV_ICONS: {}, esc, f: n => String(n) + ' FCFA', fl: n => String(n), TK: 'tok', SID: 7,
    G: async p => { calls.push(p); return apiGet(p); }, toast() {}, modal(h) { ctx.lastModal = h; }, closeM() {}, go(k) { ctx.goes = (ctx.goes || []).concat(k); },
    ...extra
  };
  vm.createContext(ctx); vm.runInContext(src, ctx); return { ctx, calls };
}
const summary = (ws) => ({ week_start: ws, week_end: '2026-11-15', amount: 150000, fuel_amount: 120000, shop_amount: 30000, liters: 150,
  shifts_closed: 1, cash_gap: -2000, top_seller: { name: 'Awa <b>', amount: 30000 }, evolution_pct: null, text: 'Résumé test' });

(async () => {
  await check('menu : synthèse et justificatifs déclarés avec leurs droits', () => {
    const { ctx } = load(() => ({}));
    assert.strictEqual(ctx.V.synthese[1], 'report.view|finance.view');
    assert.strictEqual(ctx.V.justificatifs[1], 'expense.create|report.view|finance.view');
    assert.strictEqual(typeof ctx.VM.synthese, 'function'); assert.strictEqual(typeof ctx.VM.justificatifs, 'function');
  });
  await check('synthèse : appelle l\'API de la semaine écoulée, affiche les montants et échappe le nom', async () => {
    const { ctx, calls } = load(p => summary('2026-11-09'));
    const html = await ctx.VM.synthese();
    assert.match(calls[0], /^\/reports\/weekly-summary\?week_start=\d{4}-\d{2}-\d{2}$/);
    assert.match(html, /Ventes de la semaine/); assert.match(html, /150000 FCFA/); assert.match(html, /Awa &lt;b&gt;/);
    assert.match(html, /Référence indisponible/); assert.match(html, /Résumé test/);
  });
  await check('synthèse : pas de navigation vers une semaine future', async () => {
    const { ctx } = load(p => summary('2026-11-09'));
    await ctx.VM.synthese();              // semaine écoulée par défaut
    ctx.window.synthNav(1);               // -> semaine courante : autorisé
    assert.strictEqual(ctx.goes.length, 1);
    ctx.window.synthNav(1);               // -> semaine suivante (future) : refusé
    assert.strictEqual(ctx.goes.length, 1);
  });
  await check('justificatifs : liste les dépenses et ouvre la liste de pièces sans quitter l\'écran', async () => {
    const { ctx, calls } = load(p => p.startsWith('/treasury') ? { from: '2026-11-01', to: '2026-11-16', total: 50000, lines: [{ id: 3, spent_on: '2026-11-10', category: 'Carburant véhicule', amount: 50000, beneficiary: 'Garage <Sud>' }] }
      : [{ id: 9, filename: 'recu.jpg', size: 2048 }]);
    const html = await ctx.VM.justificatifs();
    assert.match(calls[0], /^\/treasury\/expenses\?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}$/);
    assert.match(html, /justList\(3\)/); assert.match(html, /Garage &lt;Sud&gt;/);
    await ctx.window.justList(3);
    assert.strictEqual(calls.at(-1), '/expenses/3/receipts');
    assert.match(ctx.lastModal, /justOpen\(3,9\)/); assert.match(ctx.lastModal, /recu\.jpg/);
  });
  await check('justificatifs : période inversée refusée sans appel réseau', () => {
    const { ctx, calls } = load(() => ({}), { document: { getElementById: id => ({ value: id === 'jf' ? '2026-11-10' : '2026-11-01' }) } });
    const before = calls.length; ctx.window.justApply();
    assert.strictEqual(calls.length, before); assert.strictEqual(ctx.goes, undefined);
  });
  console.log(`\n${n} contrôles réussis.`);
})().catch(e => { console.error('✘', e.message); process.exit(1); });
