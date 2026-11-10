'use strict';
// Test unitaire sans base de données ni dépendances : npm run test:profile-stats-period
// Charge src/profile_stats.js avec un faux pool qui enregistre les requêtes SQL, puis contrôle
// la période, les paramètres, les filtres, le masquage des montants, les calculs et les PDF.
// Limite : le SQL n'est pas exécuté par PostgreSQL ici (voir l'intégration sur la base de test).
const Module = require('module');
const path = require('path');
const assert = require('assert');

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const calls = [];
let handler = () => [];
const pool = { query: async (sql, params) => { calls.push({ sql, params: params || [] }); return { rows: handler(sql, params || []) }; } };
const routes = {};
let lastPdf = null;
const docsStub = {
  cellText: v => (typeof v === 'number' ? new Intl.NumberFormat('fr-FR').format(v) : (v == null ? '' : String(v))),
  fmtDate: d => { const x = d instanceof Date ? d : new Date(d); return String(x.getDate()).padStart(2, '0') + '/' + String(x.getMonth() + 1).padStart(2, '0') + '/' + x.getFullYear(); },
  branding: async () => ({ currency: 'FCFA', name: 'Station test' }),
  buildPdf: async spec => { lastPdf = spec; return Buffer.from('%PDF-stub'); },
  send: (res, fmt, buf, name) => { res.sent = { fmt, name, buf }; }
};
const origLoad = Module._load;
Module._load = function (request, parent) {
  if (parent && /profile_stats\.js$/.test(parent.filename)) {
    if (request === 'express') return { Router: () => ({ get: (p, ...fns) => { routes[p] = fns; } }) };
    if (request === './core') return { pool, HttpError, wrap: f => f, need: (...perms) => ({ gate: perms }) };
    if (request === './docs') return docsStub;
  }
  return origLoad.apply(this, arguments);
};
const mod = require(path.join(__dirname, '..', 'src', 'profile_stats.js'));
Module._load = origLoad;
const { periodOf, fill, trimLead, customerStats, supplierStats, employeeStats, customerPdf, supplierPdf, employeePdf } = mod._internals;

let failed = 0;
const check = async (label, fn) => {
  try { await fn(); console.log('✔ ' + label); } catch (e) { failed++; console.log('✖ ' + label + '\n    ' + (e.message || e).split('\n')[0]); }
};
const req = (perms, extra = {}) => ({ sid: 5, user: { id: 9, perms: new Set(perms) }, query: {}, params: {}, ...extra });
const MONTHS = ['2026-08', '2026-09', '2026-10'];
const DAYS = Array.from({ length: 30 }, (_, i) => '2026-10-' + String(i - 4 > 0 ? i - 4 : 1).padStart(2, '0'));
const base = (keys, extra) => (sql, params) => {
  if (/generate_series/.test(sql)) return keys.map(k => ({ k }));
  if (/AS from_date/.test(sql)) return [{ from_date: '2026-08-01', to_date: '2026-10-25' }];
  return extra(sql, params) || [];
};

(async () => {
  await check('la période est validée par liste blanche (valeur inconnue, tableau, __proto__ → 12 mois)', () => {
    for (const bad of [undefined, '', 'x', "30d'; DROP TABLE sales;--", ['30d', '3m'], { a: 1 }, 'constructor', '__proto__', 'toString'])
      assert.strictEqual(periodOf({ query: { period: bad } }).key, bad === '30d' ? '30d' : '12m', String(bad));
    for (const k of ['30d', '3m', '12m', 'all']) assert.strictEqual(periodOf({ query: { period: k } }).key, k);
  });

  await check('fragments SQL : 30 jours = par jour, 3/12 mois = par mois, tout = sans borne pour les indicateurs', () => {
    const d = periodOf({ query: { period: '30d' } }), m3 = periodOf({ query: { period: '3m' } }), m12 = periodOf({ query: { period: '12m' } }), all = periodOf({ query: { period: 'all' } });
    assert.ok(/'YYYY-MM-DD'/.test(d.bucket('c')) && /date_trunc\('day'/.test(d.bucket('c')) && /29 days/.test(d.and('c')));
    assert.ok(/'YYYY-MM'/.test(m3.bucket('c')) && /2 months/.test(m3.and('c')));
    assert.ok(/11 months/.test(m12.and('c')) && /11 months/.test(m12.chartAnd('c')));
    assert.strictEqual(all.and('c'), ''); assert.strictEqual(all.inP('c'), 'TRUE');
    assert.ok(/59 months/.test(all.chartAnd('c')), 'courbe « tout » limitée à 60 mois');
    for (const p of [d, m3, m12, all]) for (const f of [p.and('c'), p.inP('c'), p.chartAnd('c'), p.bucket('c')]) assert.ok(!/undefined|\[object|null/.test(f), f);
  });

  await check('fill / trimLead : alignement sur les clés, mois vides du début retirés pour « tout » (12 mois minimum)', () => {
    const out = fill([{ month: '2026-09', sales: 10.456, orders: 2 }], MONTHS, ['sales', 'orders']);
    assert.deepStrictEqual(out.map(x => x.month), MONTHS); assert.strictEqual(out[1].sales, 10.46); assert.strictEqual(out[0].sales, 0);
    const keys = Array.from({ length: 60 }, (_, i) => 'k' + i), rows = keys.map(k => ({ month: k, sales: 0 }));
    rows[40].sales = 5;
    const all = periodOf({ query: { period: 'all' } }), y = periodOf({ query: { period: '12m' } });
    assert.strictEqual(trimLead(all, fill(rows, keys, ['sales']), ['sales']).length, 20);
    assert.strictEqual(trimLead(all, fill([], keys, ['sales']), ['sales']).length, 12);
    assert.strictEqual(trimLead(y, fill(rows, keys, ['sales']), ['sales']).length, 60, 'pas de troncature hors « tout »');
  });

  const customerRows = (opts = {}) => base(opts.keys || MONTHS, sql => {
    if (/FROM customers WHERE id=\$1/.test(sql)) return [{ id: 7, name: 'Awa Diop', balance: 90000, credit_limit: 100000, active: true }];
    if (/MIN\(sold_at\)/.test(sql)) return [{ total: 1000, n: 4, first_at: new Date('2025-01-10'), last_at: new Date('2026-10-20') }];
    if (/FROM sales WHERE station_id/.test(sql)) return [{ month: '2026-09', sales: 400, orders: 2 }, { month: '2026-10', sales: 600, orders: 2 }];
    if (/FROM customer_payments cp/.test(sql)) return [{ month: '2026-10', repaid: 50 }];
    if (/FROM payments p JOIN sales/.test(sql)) return [{ method: 'especes', amount: 700 }, { method: 'credit', amount: 300 }];
    if (/FROM sale_details d JOIN sales s/.test(sql)) return [{ product: 'Gasoil', amount: 800, quantity: 1000 }];
    if (/FROM customer_payments WHERE customer_id/.test(sql)) return [{ repaid: 500, repaid_period: 50 }];
    if (/FROM invoices/.test(sql)) return [{ status: 'emise', n: 2, total: 300, paid: 100 }];
  });

  for (const period of ['30d', '3m', '12m', 'all']) {
    await check(`client (${period}) : chaque requête a autant de paramètres que de $n, aucun fragment cassé`, async () => {
      calls.length = 0; handler = customerRows({ keys: period === '30d' ? DAYS : MONTHS });
      await customerStats(req(['customer.view', 'receivable.view']), 7, periodOf({ query: { period } }));
      assert.ok(calls.length >= 7);
      for (const c of calls) {
        const nums = [...c.sql.matchAll(/\$(\d+)/g)].map(m => Number(m[1])), max = nums.length ? Math.max(...nums) : 0;
        assert.strictEqual(c.params.length, max, 'params/placeholders : ' + c.sql.slice(0, 90));
        assert.ok(!/undefined|\[object/.test(c.sql), c.sql.slice(0, 90));
      }
      const sold = calls.filter(c => /sold_at/.test(c.sql)).map(c => c.sql).join(' ');
      if (period === 'all') assert.ok(!/interval '(2|11) months'|interval '29 days'/.test(calls.filter(c => /FILTER|payments p JOIN|sale_details/.test(c.sql)).map(c => c.sql).join(' ')), 'tout = sans borne d\'indicateur');
      else assert.ok(new RegExp({ '30d': '29 days', '3m': '2 months', '12m': '11 months' }[period]).test(sold));
    });
  }

  await check('client : indicateurs de période, dates cumulées, crédit, courbe avec remboursements', async () => {
    handler = customerRows();
    const s = await customerStats(req(['customer.view', 'receivable.view']), 7, periodOf({ query: { period: '3m' } }));
    assert.strictEqual(s.kpis.total_sales, 1000); assert.strictEqual(s.kpis.orders, 4); assert.strictEqual(s.kpis.avg_basket, 250);
    assert.strictEqual(s.kpis.credit_use_pct, 90); assert.strictEqual(s.kpis.repaid_total, 500); assert.strictEqual(s.kpis.repaid_period, 50);
    assert.ok(s.kpis.first_at && s.kpis.last_at && s.kpis.days_since_last >= 0);
    assert.deepStrictEqual(s.monthly.map(m => m.month), MONTHS); assert.strictEqual(s.monthly[2].repaid, 50); assert.strictEqual(s.monthly[0].sales, 0);
    assert.strictEqual(s.meta.period, '3m'); assert.strictEqual(s.customer.name, 'Awa Diop');
  });

  await check('client sans receivable.view : solde, limite, remboursements et totaux de factures masqués', async () => {
    handler = customerRows();
    const s = await customerStats(req(['customer.view']), 7, periodOf({ query: {} }));
    for (const k of ['balance', 'credit_limit', 'credit_use_pct', 'repaid_total', 'repaid_period']) assert.strictEqual(s.kpis[k], null, k);
    assert.ok(s.monthly.every(m => m.repaid === null));
    assert.ok(s.invoices.every(i => i.total === null && i.paid === null) && s.invoices[0].n === 2);
    const pdf = customerPdf({ currency: 'FCFA' }, s), flat = JSON.stringify(pdf);
    assert.ok(!/Solde dû|Limite de crédit|Remboursements/.test(flat), 'le PDF ne révèle pas ce que l\'écran masque');
  });

  await check('client inconnu → 404 ; identifiant invalide → 400', async () => {
    handler = base(MONTHS, () => []);
    await assert.rejects(() => customerStats(req(['customer.view']), 7, periodOf({ query: {} })), e => e.status === 404);
    const gate = routes['/customers/:id/stats'][1];
    await assert.rejects(() => gate(req(['customer.view'], { params: { id: 'abc' } }), { json() {} }), e => e.status === 400);
  });

  const supplierRows = base(MONTHS, sql => {
    if (/FROM suppliers WHERE id=\$1/.test(sql)) return [{ id: 3, name: 'Total Énergies', balance_due: 250000, payment_terms_days: 30, active: true }];
    if (/MIN\(ordered_at\)/.test(sql)) return [{ total: 5000, n: 5, first_at: new Date('2025-02-01'), last_at: new Date('2026-10-01'), invoiced: 4000 }];
    if (/FROM purchases WHERE station_id=\$1 AND supplier_id=\$2 AND status <> 'annule'/.test(sql)) return [{ month: '2026-10', purchases: 5000, orders: 5 }];
    if (/FROM supplier_payments sp JOIN purchases pu ON pu.id=sp.purchase_id\s+WHERE sp.supplier_id=\$1 AND pu.station_id=\$2 AND/.test(sql)) return [{ month: '2026-10', paid: 1000 }];
    if (/paid_period/.test(sql)) return [{ paid: 5000, paid_period: 1000 }];
    if (/due_date < CURRENT_DATE/.test(sql)) return [{ n: 2, amount: 700 }];
    if (/GROUP BY status ORDER BY 2/.test(sql)) return [{ status: 'recu', n: 3, total: 3000 }];
    if (/purchase_details d/.test(sql)) return [{ product: 'Super', amount: 2000, quantity: 500 }];
  });
  await check('fournisseur : indicateurs de période, taux de règlement plafonné à 100 %, paiement de période', async () => {
    handler = supplierRows; calls.length = 0;
    const s = await supplierStats(req(['supplier.view', 'debt.view']), 3, periodOf({ query: { period: '30d' } }));
    for (const c of calls) { const nums = [...c.sql.matchAll(/\$(\d+)/g)].map(m => +m[1]); assert.strictEqual(c.params.length, nums.length ? Math.max(...nums) : 0, c.sql.slice(0, 80)); }
    assert.strictEqual(s.kpis.purchases_total, 5000); assert.strictEqual(s.kpis.avg_order, 1000);
    assert.strictEqual(s.kpis.settle_pct, 100); assert.strictEqual(s.kpis.paid_period, 1000); assert.strictEqual(s.kpis.overdue_count, 2);
    assert.strictEqual(s.kpis.balance_due, 250000); assert.strictEqual(s.monthly[2].paid, 1000);
  });
  await check('fournisseur sans droit finance : dette, paiements, échéances masqués ; sans requête de paiement', async () => {
    handler = supplierRows; calls.length = 0;
    const s = await supplierStats(req(['supplier.view']), 3, periodOf({ query: {} }));
    for (const k of ['balance_due', 'paid_total', 'paid_period', 'invoiced_total', 'settle_pct', 'overdue_count', 'overdue_amount']) assert.strictEqual(s.kpis[k], null, k);
    assert.ok(!calls.some(c => /supplier_payments/.test(c.sql)) && s.monthly.every(m => m.paid === null));
    assert.ok(!/Dette actuelle|Payé \(période\)|Échéances|Taux de règlement/.test(JSON.stringify(supplierPdf({ currency: 'FCFA' }, s))));
  });

  const empRows = (over = {}) => base(MONTHS, sql => {
    if (/FROM employees WHERE id=\$1/.test(sql)) return [{ id: 4, user_id: over.userId ?? 77, hired_on: new Date('2024-01-01'), status: 'actif', first_name: 'Moussa', last_name: 'Ba', matricule: 'EMP-004', position: 'Pompiste' }];
    if (/COUNT\(DISTINCT sh\.id\)::int AS shifts\s+FROM shift_employees se JOIN shifts sh ON sh\.id = se\.shift_id\s+WHERE sh\.station_id=\$1 AND se\.employee_id=\$2$/.test(sql.trim())) return [{ shifts: 20 }];
    if (/AS month, COUNT\(DISTINCT sh/.test(sql)) return [{ month: '2026-10', shifts: 8 }];
    if (/AS cur/.test(sql)) return [{ cur: 150, prev: 100 }];
    if (/AS month, SUM\(d\.amount\)/.test(sql)) return [{ month: '2026-10', revenue: 700, operations: 7 }];
    if (/AS revenue, COUNT\(DISTINCT sa\.id\)::int AS operations/.test(sql)) return [{ revenue: 5000, operations: 50 }];
    if (/FROM employee_gaps/.test(sql)) return [{ status: 'en_attente', kind: 'caisse', n: 2, amount: 300 }];
    if (/FROM sales sa JOIN sale_details d ON d.sale_id = sa.id JOIN products/.test(sql)) return [{ product: 'Gasoil', amount: 900, quantity: 100 }];
    if (/FROM employee_debts/.test(sql)) return [{ initial: 1000, paid: 400 }];
    if (/FROM salary_advances/.test(sql)) return [{ outstanding: 200 }];
    if (/FROM payslips/.test(sql)) return [{ month: '2026-09', gross: 100, total_deductions: 10, net_pay: 90, status: 'valide' }];
  });
  await check('employé : totaux de période (pas la somme de la courbe), moyenne par quart, variation du mois, dette', async () => {
    handler = empRows(); calls.length = 0;
    const s = await employeeStats(req(['hr.view', 'hr.payroll']), 4, periodOf({ query: { period: 'all' } }));
    for (const c of calls) { const nums = [...c.sql.matchAll(/\$(\d+)/g)].map(m => +m[1]); assert.strictEqual(c.params.length, nums.length ? Math.max(...nums) : 0, c.sql.slice(0, 80)); }
    assert.strictEqual(s.kpis.revenue, 5000); assert.strictEqual(s.kpis.shifts, 20); assert.strictEqual(s.kpis.avg_per_shift, 250); assert.strictEqual(s.kpis.operations, 50);
    assert.strictEqual(s.kpis.month_variation_pct, 50); assert.strictEqual(s.kpis.debt_balance, 600); assert.strictEqual(s.kpis.gaps_amount, 300);
    assert.strictEqual(s.employee.name, 'Moussa Ba'); assert.strictEqual(s.payslips.length, 1);
  });
  await check('employé : sans droit RH ni fiche personnelle → 403 ; sa propre fiche → accès', async () => {
    handler = empRows();
    await assert.rejects(() => employeeStats(req(['customer.view']), 4, periodOf({ query: {} })), e => e.status === 403);
    const s = await employeeStats(req([], { user: { id: 77, perms: new Set() } }), 4, periodOf({ query: {} }));
    assert.strictEqual(s.kpis.debt_balance, 600);
  });
  await check('employé hr.gaps seul : dette, avances et paie masquées (aucune requête financière)', async () => {
    handler = empRows(); calls.length = 0;
    const s = await employeeStats(req(['hr.gaps']), 4, periodOf({ query: {} }));
    assert.strictEqual(s.kpis.debt_balance, null); assert.strictEqual(s.kpis.advances_outstanding, null); assert.strictEqual(s.payslips, null);
    assert.ok(!calls.some(c => /employee_debts|salary_advances|payslips/.test(c.sql)));
    assert.ok(!/Dettes|Avances|Dernier net|bulletins/.test(JSON.stringify(employeePdf({ currency: 'FCFA' }, s))));
  });

  await check('PDF : structure valide pour chaque profil et période (lignes = colonnes, pas de NaN/undefined)', async () => {
    const out = [];
    for (const period of ['30d', '3m', '12m', 'all']) {
      handler = customerRows({ keys: period === '30d' ? DAYS : MONTHS });
      out.push(customerPdf({ currency: 'FCFA' }, await customerStats(req(['customer.view', 'receivable.view']), 7, periodOf({ query: { period } }))));
      handler = supplierRows; out.push(supplierPdf({ currency: 'FCFA' }, await supplierStats(req(['supplier.view', 'debt.view']), 3, periodOf({ query: { period } }))));
      handler = empRows(); out.push(employeePdf({ currency: 'FCFA' }, await employeeStats(req(['hr.view', 'hr.payroll']), 4, periodOf({ query: { period } }))));
    }
    for (const spec of out) {
      assert.ok(spec.title && spec.subtitle && spec.ref && spec.sections.length >= 3);
      assert.ok(!/NaN|undefined|\[object|null/.test(JSON.stringify(spec).replace(/"type":"[a-z]+"/g, '')), spec.title);
      for (const sec of spec.sections) {
        if (sec.type === 'table') { assert.ok(sec.head.length <= 5 && sec.rows.length); sec.rows.forEach(r => assert.strictEqual(r.length, sec.head.length, sec.title)); }
        if (sec.type === 'kpis') assert.ok(sec.items.every(i => i.label && i.value != null && i.value !== ''));
      }
    }
  });

  await check('PDF : période affichée, graphique quotidien pour 30 jours, route renvoie un PDF nommé par période', async () => {
    handler = customerRows({ keys: DAYS });
    const res = {}, rq = req(['customer.view', 'receivable.view'], { params: { id: '7' }, query: { period: '30d' } });
    await routes['/customers/:id/stats.pdf'][1](rq, res);
    assert.deepStrictEqual([res.sent.fmt, res.sent.name], ['pdf', 'profil-client-7-30d']);
    assert.ok(/30 derniers jours/.test(lastPdf.subtitle) && /PRC-7-30d/.test(lastPdf.ref));
    assert.ok(lastPdf.sections.some(s => s.type === 'text' && /Période : 30 derniers jours/.test(s.text)));
  });

  await check('routes : JSON et PDF pour les trois profils, mêmes permissions pour les deux formats', () => {
    for (const base of ['/customers/:id', '/suppliers/:id', '/hr/employees/:id']) { assert.ok(routes[base + '/stats'] && routes[base + '/stats.pdf'], base); assert.deepStrictEqual(routes[base + '/stats'].slice(0, -1), routes[base + '/stats.pdf'].slice(0, -1)); }
    assert.deepStrictEqual(routes['/customers/:id/stats'][0].gate, ['customer.view', 'sale.create']);
    assert.deepStrictEqual(routes['/suppliers/:id/stats'][0].gate, ['supplier.view', 'purchase.manage', 'purchase.pay', 'stock.adjust']);
    assert.strictEqual(routes['/hr/employees/:id/stats'].length, 1, 'droits vérifiés dans le calcul (fiche personnelle ou RH)');
  });

  await check('plage personnalisée : dates validées, bornes incluses, jour/mois selon la durée, aucune injection SQL', async () => {
    const P1 = periodOf(req([], { query: { period: 'custom', from: '2026-09-01', to: '2026-09-30' } }));
    assert.strictEqual(P1.key, 'custom'); assert.strictEqual(P1.gran, 'day');
    assert.ok(P1.and('s.sold_at').includes("'2026-09-01'::date") && P1.and('s.sold_at').includes("('2026-09-30'::date + 1)"), P1.and('s.sold_at'));
    assert.deepStrictEqual(await P1.keys().then(k => k.length >= 0), true);
    const m1 = await P1.meta(); assert.strictEqual(m1.period, 'custom'); assert.strictEqual(m1.from, '2026-09-01'); assert.strictEqual(m1.to, '2026-09-30'); assert.strictEqual(m1.label, 'Du 01/09/2026 au 30/09/2026');
    assert.strictEqual(periodOf(req([], { query: { period: 'custom', from: '2025-01-01', to: '2026-06-30' } })).gran, 'month');
    // dates inversées : remises dans l'ordre ; date invalide ou tentative d'injection : retour à 12 mois
    assert.strictEqual((await periodOf(req([], { query: { period: 'custom', from: '2026-09-30', to: '2026-09-01' } })).meta()).from, '2026-09-01');
    for (const bad of ["2026-09-01'; DROP TABLE sales;--", '2026-13-45', 'abc', '2026-02-30']) {
      const Pb = periodOf(req([], { query: { period: 'custom', from: bad, to: bad } }));
      assert.strictEqual(Pb.key, '12m', bad); assert.ok(!/DROP/.test(Pb.and('x')), bad);
    }
    // une seule borne : l'autre prend la valeur par défaut ; sans period mais avec from/to : plage personnalisée
    assert.strictEqual(periodOf(req([], { query: { from: '2026-10-01' } })).key, 'custom');
  });
  await check('plage personnalisée : les trois profils répondent avec meta.period = custom et un comportement', async () => {
    handler = () => [];
    for (const [fn, perms] of [[customerStats, ['receivable.view']], [supplierStats, ['debt.view']]]) {
      handler = sql => (/FROM customers WHERE|FROM suppliers WHERE|FROM suppliers s|FROM customers c/.test(sql) ? [{ id: 7, name: 'X', balance: 0, credit_limit: 0, active: true }] : []);
      const out = await fn(req(perms, { query: { period: 'custom', from: '2026-09-01', to: '2026-09-30' } }), 7, periodOf(req(perms, { query: { period: 'custom', from: '2026-09-01', to: '2026-09-30' } })));
      assert.strictEqual(out.meta.period, 'custom'); assert.ok(out.behavior && out.behavior.by_weekday.length === 7, fn.name);
    }
  });

  if (failed) process.exitCode = 1;
})();
