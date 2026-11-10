/* ext-profile-stats.js — Profils station (client, fournisseur, employé) :
   1) l'identité du profil, 2) les agrégats : indicateurs, courbes, répartitions et situation face à l'entreprise. */
(function () {
  'use strict';
  if (typeof VM === 'undefined' || typeof G === 'undefined') return;

  const MN = ['janv', 'févr', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc'];
  // Clé de courbe : « YYYY-MM » (mois) ou « YYYY-MM-DD » (jour, période 30 jours)
  const monthLbl = m => { const p = String(m).split('-'); return p.length === 3 ? p[2] + '/' + p[1] : MN[(+p[1] || 1) - 1] + ' ' + String(p[0]).slice(2); };
  const PSHORT = { '30d': '30 j', '3m': '3 mois', '12m': '12 mois', all: 'Tout' };
  const head = (kind, id, title, s) => `<div class="ps-head"><div><p class="ps-title">📊 ${esc(title)}</p><small class="ps-per">${esc(s.meta.label)}${s.meta.capped ? ' · courbe limitée aux 60 derniers mois' : ''}</small></div>
      <div class="ps-tools">${PRange.seg(s.meta, 'psSetPeriod', 'psSetCustom', [kind, Number(id)])}<button type="button" class="b2 ps-pdf" onclick="psPdf('${kind}',${Number(id)})">📄 PDF</button></div></div>`;
  const dshort = d => (d ? new Date(d).toLocaleDateString('fr-FR') : '—');
  const val = (v, fn) => (v == null ? '<span style="color:var(--m)">—</span>' : (fn ? fn(v) : v));
  const kpi = (ico, label, v, sub) => `<div class="sad-kpi"><span class="sad-ico">${ico}</span><div><small>${esc(label)}</small><b>${v}</b><small>${sub || ''}</small></div></div>`;
  const mini = (ico, label, v) => `<div class="sad-mini"><small><i>${ico}</i>${esc(label)}</small><b>${v}</b></div>`;
  const ago = d => d == null ? '' : d === 0 ? "aujourd'hui" : 'il y a ' + d + ' j';
  const field = (label, v) => `<div><small>${esc(label)}</small><b>${v ? esc(String(v)) : '—'}</b></div>`;
  const tag = (txt, cls) => `<span class="tag ${cls || ''}">${esc(txt)}</span>`;
  const bar = (pct, thresholds) => { const p = Math.max(0, Math.min(100, pct || 0)); const c = thresholds ? (p >= 90 ? 'bad' : p >= 70 ? 'warn' : '') : ''; return `<div class="ps-bar"><i class="${c}" style="width:${p}%"></i></div>`; };
  const METH = { especes: 'Espèces', carte: 'Carte', mobile_money: 'Mobile money', credit: 'Crédit', autre: 'Autre' };
  const PSTAT = { commande: 'Commandé', partiel: 'Partiel', recu: 'Reçu', facture: 'Facturé', paye: 'Payé', archive: 'Archivé', annule: 'Annulé' };
  const ISTAT = { brouillon: 'Brouillon', emise: 'Émise', partielle: 'Partielle', payee: 'Payée', annulee: 'Annulée' };
  const GSTAT = { en_attente: 'En attente', accepte: 'Accepté', conteste: 'Contesté', regularise: 'Régularisé', cloture: 'Clôturé' };
  const PAL = ['#2563eb', '#22c55e', '#f59e0b', '#a855f7', '#ef4444', '#14b8a6', '#64748b'];

  const charts = {};
  const grid = { color: 'rgba(148,163,184,.25)' };
  const base = { responsive: true, maintainAspectRatio: false };
  const compact = v => (Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1).replace('.0', '') + ' M' : Math.abs(v) >= 1e3 ? Math.round(v / 1e3) + ' k' : v);
  const tipMoney = { callbacks: { label: c => ' ' + new Intl.NumberFormat('fr-FR').format(Math.round(c.raw || 0)) + ' ' + (typeof CUR !== 'undefined' ? CUR : 'FCFA') } };

  function draw(spec, key) {
    if (typeof Chart === 'undefined') return;
    const k = key || 'main';
    (charts[k] || []).forEach(c => { try { c.destroy(); } catch (_) { /* déjà détruit */ } }); charts[k] = [];
    spec.forEach(([id, cfg]) => { const cv = document.getElementById(id); if (cv) charts[k].push(new Chart(cv, cfg)); });
  }
  const donut = (labels, data, colors) => ({ type: 'doughnut', data: { labels, datasets: [{ data, backgroundColor: colors || PAL, borderWidth: 0 }] }, options: { ...base, cutout: '66%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 8, usePointStyle: true } } } } });
  const linkOpts = links => ({ onClick: (ev, els) => { const l = links && els && els.length && links[els[0].index]; if (l && typeof go === 'function') go(l[0], l[1]); }, onHover: (ev, els) => { if (ev && ev.native && ev.native.target) ev.native.target.style.cursor = links && els.length && links[els[0].index] ? 'pointer' : 'default'; } });
  const prodLinks = list => list.map(x => (x.product_id && typeof can === 'function' && can('stock.adjust|price.edit|sale.create|report.view') ? ['prodf', x.product_id] : null));
  const hbar = (labels, data, color, links) => ({ type: 'bar', data: { labels, datasets: [{ data, backgroundColor: color, borderRadius: 6, barThickness: 12 }] }, options: { ...base, ...(links && links.some(Boolean) ? linkOpts(links) : {}), indexAxis: 'y', plugins: { legend: { display: false }, tooltip: tipMoney }, scales: { x: { beginAtZero: true, grid, ticks: { callback: compact } }, y: { grid: { display: false } } } } });
  const card = (title, inner, extra) => `<div class="sad-card"><h3>${title}</h3>${inner}</div>`;
  const cv = (id, cls) => `<div class="sad-chart ${cls || ''}"><canvas id="${id}"></canvas></div>`;
  const empty = '<p class="dv2-empty" style="color:var(--m);font-size:13px">Pas encore de données.</p>';
  const uid = () => 'ps' + Math.random().toString(36).slice(2, 8);

  const gp = p => typeof can === 'function' && can(p);
  function actionsFor(kind, r, active, title, backView) {
    const b = (label, js, cls) => `<button class="${cls || 'b2'}" onclick="${js}">${label}</button>`;
    let out = '';
    if (kind === 'customers') {
      if (gp('customer.edit')) out += b('Modifier le client', `editCli(${r.id})`);
      if (gp('cash.manage|sale.create') && Number(r.balance) > 0 && gp('receivable.view')) out += b('Encaisser', `payCli(${r.id},${Number(r.balance)})`);
      if (gp('customer.edit')) out += b('Créer un avoir', `addCliCredit(${r.id})`);
      if (typeof window.billNew === 'function' && gp('sale.create|customer.edit|finance.view')) out += b('Nouvelle facture', `billNew(${r.id})`);
    } else if (kind === 'suppliers') {
      if (gp('supplier.edit')) out += b('Modifier le fournisseur', `editSup(${r.id})`);
      if (gp('purchase.manage')) out += b('Nouveau bon de commande', `addPOForSupplier(${r.id})`);
      if (gp('supplier.edit')) out += b('Créer un avoir', `addSupCredit(${r.id})`);
    }
    out += b('← Retour à la liste', `go('${backView}')`);
    if (typeof archRowBtn === 'function') out += archRowBtn(kind, r.id, !active, title);
    return out;
  }

  /* ---------- Carte d'identité ---------- */
  function identity(kind, r, st, backView) {
    const active = kind === 'employees' ? r.status !== 'inactif' : r.active !== false;
    const photo = av(kind, r.id, r.photo_path, r.name || (r.first_name + ' ' + r.last_name), true);
    const title = kind === 'employees' ? r.first_name + ' ' + r.last_name : r.name;
    let sub = '', fields = '';
    if (kind === 'customers') {
      sub = `${tag(r.kind || 'client')}${tag(active ? 'Actif' : 'Inactif (archivé)', active ? 'ok' : 'x')}${r.credit_blocked ? tag('Crédit bloqué', 'x') : ''}`;
      fields = field('Téléphone', r.phone) + field('E-mail', r.email) + field('Société', r.company) + field('Adresse', r.address) + field('Premier achat', dshort(st && st.kpis && st.kpis.first_at)) + field('Fidélité', r.loyalty_tier || 'standard') + field('Statut crédit', r.credit_blocked ? 'Crédit bloqué' : 'Normal');
    } else if (kind === 'suppliers') {
      sub = `${tag(active ? 'Actif' : 'Inactif (archivé)', active ? 'ok' : 'x')}${r.company ? `<span>${esc(r.company)}</span>` : ''}`;
      fields = field('Contact', r.contact) + field('Téléphone', r.phone) + field('E-mail', r.email) + field('Adresse', r.address) + field('NIF', r.tax_id) + field('Délai de paiement', r.payment_terms_days != null ? r.payment_terms_days + ' jours' : '') + field('Première commande', dshort(st && st.kpis && st.kpis.first_at));
    }
    return `<div class="pid">${photo}<div class="pid-main"><h2>${esc(title)}</h2><div class="pid-sub">${sub}<span>ID ${r.id}</span></div></div><div class="pid-fields">${fields}</div>
      <div class="pid-actions">${actionsFor(kind, r, active, title, backView)}</div></div>`;
  }

  /* ---------- Client ---------- */
  function customerDash(c, s) {
    const k = s.kpis, ids = { m: uid(), pay: uid(), prod: uid(), inv: uid() };
    const hasRecv = k.balance != null;
    const invTotal = (s.invoices || []).reduce((a, x) => a + x.n, 0);
    const unpaid = (s.invoices || []).filter(x => ['emise', 'partielle'].includes(x.status)).reduce((a, x) => a + x.n, 0);
    setTimeout(() => draw([
      [ids.m, { type: 'bar', data: { labels: s.monthly.map(m => monthLbl(m.month)), datasets: [
        { label: 'Achats', data: s.monthly.map(m => m.sales), backgroundColor: '#2563eb', borderRadius: 6, maxBarThickness: 30, order: 2 },
        ...(hasRecv ? [{ type: 'line', label: 'Remboursements', data: s.monthly.map(m => m.repaid), borderColor: '#22c55e', backgroundColor: '#22c55e', tension: .3, pointRadius: 3, order: 1 }] : []),
        ...(hasRecv && s.monthly.some(m => m.invoiced) ? [{ type: 'line', label: 'Facturé', data: s.monthly.map(m => m.invoiced), borderColor: '#0d9488', backgroundColor: '#0d9488', borderDash: [5, 4], tension: .3, pointRadius: 3, order: 0 }] : [])
      ] }, options: { ...base, plugins: { legend: { position: 'top', align: 'end', labels: { boxWidth: 8, usePointStyle: true } }, tooltip: tipMoney }, scales: { y: { beginAtZero: true, grid, ticks: { callback: compact } }, x: { grid: { display: false } } } } }],
      ...(s.by_method.length ? [[ids.pay, donut(s.by_method.map(x => METH[x.method] || x.method), s.by_method.map(x => x.amount))]] : []),
      ...(s.top_products.length ? [[ids.prod, hbar(s.top_products.map(x => x.product), s.top_products.map(x => x.amount), '#a855f7', prodLinks(s.top_products))]] : []),
      ...((s.invoices || []).length ? [[ids.inv, donut(s.invoices.map(x => ISTAT[x.status] || x.status), s.invoices.map(x => x.n), ['#94a3b8', '#2563eb', '#f59e0b', '#22c55e', '#ef4444'])]] : [])
    ]), 40);
    const credit = hasRecv ? `<div class="sad-card sad-treso"><h3>Situation face à l'entreprise</h3>
        <div class="big">${f(k.balance)}</div><div class="sub">Solde actuellement dû par ce client.</div>
        <div class="rows"><div><span>Limite de crédit</span><b>${k.credit_limit ? f(k.credit_limit) : 'Aucune'}</b></div>
          <div><span>Crédit disponible</span><b>${k.credit_limit ? f(Math.max(0, k.credit_limit - k.balance)) : '—'}</b></div>
          <div><span>Remboursements reçus (total)</span><b>${f(k.repaid_total)}</b></div>
          <div><span>Factures à régler (reste)</span><b>${val(k.invoice_due, f)}</b></div>
          <div><span>Encaissé sur factures (total)</span><b>${val(k.invoice_collected_total, f)}</b></div>
          <div><span>Utilisation du crédit</span><b>${k.credit_use_pct != null ? k.credit_use_pct + ' %' : '—'}</b></div></div>
        ${k.credit_use_pct != null ? bar(k.credit_use_pct, true) : ''}</div>` : '';
    return `<div class="ps-wrap">${head('customers', s.customer.id, 'Vue globale du client', s)}
      <div class="sad-kpis">
        ${kpi('🧾', "Chiffre d'affaires", f(k.total_sales), `${k.orders} achat(s)`)}
        ${kpi('🛒', 'Panier moyen', f(k.avg_basket), `Sur ${k.orders} achat(s)`)}
        ${kpi('💳', 'Solde dû', val(k.balance, f), k.credit_use_pct != null ? `${k.credit_use_pct} % de la limite` : '')}
        ${kpi('🕒', 'Dernier achat', dshort(k.last_at), ago(k.days_since_last))}
      </div>
      <div class="sad-kpis2">
        ${mini('🏦', 'Limite de crédit', val(k.credit_limit, v => v ? f(v) : 'Aucune'))}
        ${mini('↩', 'Remboursements', val(k.repaid_period, f))}
        ${mini('📄', 'Factures', invTotal)}
        ${mini('🧮', 'Facturé (période)', val(k.invoiced_period, f))}
        ${mini('✅', 'Encaissé sur factures', val(k.invoice_collected_period, f))}
        ${mini('⏳', 'Factures à régler', unpaid + (k.invoice_due != null && unpaid ? ' · ' + f(k.invoice_due) : ''))}
        ${mini('📅', 'Premier achat', dshort(k.first_at))}
      </div>
      <div class="sad-row ${hasRecv ? 'r21' : ''}">
        ${card('Achats · ' + esc(s.meta.label), cv(ids.m))}
        ${credit}
      </div>
      <div class="sad-row r3">
        ${card('Répartition des paiements', s.by_method.length ? cv(ids.pay, 'sm') : empty)}
        ${card('Produits les plus achetés', s.top_products.length ? cv(ids.prod, 'sm') : empty)}
        ${card('Factures par état', (s.invoices || []).length ? cv(ids.inv, 'sm') : empty)}
      </div></div>`;
  }

  /* ---------- Fournisseur ---------- */
  function supplierDash(sp, s) {
    const k = s.kpis, ids = { m: uid(), st: uid(), prod: uid() }, fin = k.paid_total != null;
    setTimeout(() => draw([
      [ids.m, { type: 'bar', data: { labels: s.monthly.map(m => monthLbl(m.month)), datasets: [
        { label: 'Achats', data: s.monthly.map(m => m.purchases), backgroundColor: '#f59e0b', borderRadius: 6, maxBarThickness: 30, order: 2 },
        ...(fin ? [{ type: 'line', label: 'Paiements', data: s.monthly.map(m => m.paid), borderColor: '#2563eb', backgroundColor: '#2563eb', tension: .3, pointRadius: 3, order: 1 }] : [])
      ] }, options: { ...base, plugins: { legend: { position: 'top', align: 'end', labels: { boxWidth: 8, usePointStyle: true } }, tooltip: tipMoney }, scales: { y: { beginAtZero: true, grid, ticks: { callback: compact } }, x: { grid: { display: false } } } } }],
      ...(s.by_status.length ? [[ids.st, donut(s.by_status.map(x => (PSTAT[x.status] || x.status) + ' ' + x.n), s.by_status.map(x => x.n))]] : []),
      ...(s.top_products.length ? [[ids.prod, hbar(s.top_products.map(x => x.product), s.top_products.map(x => x.amount), '#a855f7', prodLinks(s.top_products))]] : [])
    ]), 40);
    const sit = (k.balance_due != null || fin) ? `<div class="sad-card sad-treso"><h3>Situation face à l'entreprise</h3>
        <div class="big">${val(k.balance_due, f)}</div><div class="sub">Dette actuelle envers ce fournisseur.</div>
        <div class="rows"><div><span>Total facturé (cumul)</span><b>${val(k.invoiced_total, f)}</b></div>
          <div><span>Total payé (cumul)</span><b>${val(k.paid_total, f)}</b></div>
          <div><span>En retard d'échéance</span><b>${k.overdue_count != null ? k.overdue_count + ' · ' + f(k.overdue_amount) : '—'}</b></div>
          <div><span>Taux de règlement</span><b>${k.settle_pct != null ? k.settle_pct + ' %' : '—'}</b></div></div>
        ${k.settle_pct != null ? bar(k.settle_pct) : ''}</div>` : '';
    return `<div class="ps-wrap">${head('suppliers', s.supplier.id, 'Vue globale du fournisseur', s)}
      <div class="sad-kpis">
        ${kpi('📦', 'Achats', f(k.purchases_total), `${k.orders} commande(s)`)}
        ${kpi('🧮', 'Commande moyenne', f(k.avg_order), `Sur ${k.orders} commande(s)`)}
        ${kpi('💸', 'Dette fournisseur', val(k.balance_due, f), k.settle_pct != null ? `${k.settle_pct} % réglé` : '')}
        ${kpi('🕒', 'Dernière commande', dshort(k.last_at), ago(k.days_since_last))}
      </div>
      <div class="sad-kpis2">
        ${mini('✅', 'Payé (période)', val(k.paid_period, f))}
        ${mini('⚠', 'Échéances dépassées', k.overdue_count != null ? k.overdue_count : '—')}
        ${mini('🗓', 'Délai de paiement', k.payment_terms_days != null ? k.payment_terms_days + ' j' : '—')}
        ${mini('🧾', 'Total facturé (cumul)', val(k.invoiced_total, f))}
        ${mini('📅', 'Première commande', dshort(k.first_at))}
      </div>
      <div class="sad-row ${sit ? 'r21' : ''}">
        ${card('Achats et paiements · ' + esc(s.meta.label), cv(ids.m))}
        ${sit}
      </div>
      <div class="sad-row r2">
        ${card('Commandes par statut', s.by_status.length ? cv(ids.st, 'sm') : empty)}
        ${card('Produits les plus commandés', s.top_products.length ? cv(ids.prod, 'sm') : empty)}
      </div></div>`;
  }

  /* ---------- Employé ---------- */
  function employeeDash(s) {
    const k = s.kpis, ids = { m: uid(), g: uid(), prod: uid(), pay: uid() };
    const slips = s.payslips || [];
    setTimeout(() => draw([
      [ids.m, { type: 'bar', data: { labels: s.monthly.map(m => monthLbl(m.month)), datasets: [
        { label: "Chiffre d'affaires attribué", data: s.monthly.map(m => m.revenue), backgroundColor: '#2563eb', borderRadius: 6, maxBarThickness: 30, yAxisID: 'y', order: 2 },
        { type: 'line', label: 'Quarts travaillés', data: s.monthly.map(m => m.shifts), borderColor: '#f59e0b', backgroundColor: '#f59e0b', tension: .3, pointRadius: 3, yAxisID: 'y2', order: 1 }
      ] }, options: { ...base, plugins: { legend: { position: 'top', align: 'end', labels: { boxWidth: 8, usePointStyle: true } } }, scales: { y: { beginAtZero: true, grid, ticks: { callback: compact } }, y2: { beginAtZero: true, position: 'right', grid: { display: false }, ticks: { precision: 0 } }, x: { grid: { display: false } } } } }],
      ...(s.gaps_by_status.length ? [[ids.g, donut(s.gaps_by_status.map(x => (GSTAT[x.status] || x.status) + ' ' + x.n), s.gaps_by_status.map(x => x.n), ['#f59e0b', '#22c55e', '#ef4444', '#2563eb', '#94a3b8'])]] : []),
      ...(s.top_products.length ? [[ids.prod, hbar(s.top_products.map(x => x.product), s.top_products.map(x => x.amount), '#a855f7', prodLinks(s.top_products))]] : []),
      ...(slips.length ? [[ids.pay, { type: 'bar', data: { labels: slips.map(x => monthLbl(x.month)), datasets: [{ label: 'Net payé', data: slips.map(x => x.net), backgroundColor: '#22c55e', borderRadius: 6, maxBarThickness: 36 }, { label: 'Retenues', data: slips.map(x => x.deductions), backgroundColor: '#ef4444', borderRadius: 6, maxBarThickness: 36 }] }, options: { ...base, plugins: { legend: { position: 'top', align: 'end', labels: { boxWidth: 8, usePointStyle: true } }, tooltip: tipMoney }, scales: { y: { beginAtZero: true, grid, ticks: { callback: compact } }, x: { grid: { display: false } } } } }]] : [])
    ]), 40);
    const fin = (k.debt_balance != null) ? `<div class="sad-card sad-treso"><h3>Situation face à l'entreprise</h3>
        <div class="big">${f(k.debt_balance)}</div><div class="sub">Dettes envers l'entreprise restant à rembourser.</div>
        <div class="rows"><div><span>Dettes initiales</span><b>${f(k.debt_initial)}</b></div>
          <div><span>Avances à déduire</span><b>${f(k.advances_outstanding)}</b></div>
          <div><span>Écarts attribués</span><b>${k.gaps_count} · ${f(k.gaps_amount)}</b></div>
          <div><span>Dernier net payé</span><b>${val(k.last_net, f)}</b></div></div></div>` : '';
    const vr = k.month_variation_pct;
    return `<div class="ps-wrap">${head('employees', s.employee.id, "Vue globale de l'employé", s)}
      <div class="sad-kpis">
        ${kpi('💰', 'CA attribué', f(k.revenue), vr != null ? `${vr >= 0 ? '▲' : '▼'} ${Math.abs(vr)} % ce mois vs précédent` : `${k.operations} opération(s)`)}
        ${kpi('🕐', 'Quarts travaillés', k.shifts, esc(s.meta.label))}
        ${kpi('📈', 'Moyenne par quart', f(k.avg_per_shift), `${k.operations} opération(s)`)}
        ${kpi('⚖', 'Écarts', k.gaps_count, f(k.gaps_amount))}
      </div>
      <div class="sad-kpis2">
        ${mini('🎖', 'Ancienneté', s.employee.tenure_months != null ? (s.employee.tenure_months >= 12 ? Math.floor(s.employee.tenure_months / 12) + ' an(s) ' + (s.employee.tenure_months % 12) + ' mois' : s.employee.tenure_months + ' mois') : '—')}
        ${mini('🧾', 'Dettes à rembourser', val(k.debt_balance, f))}
        ${mini('💵', 'Avances à déduire', val(k.advances_outstanding, f))}
        ${mini('🏧', 'Dernier net payé', val(k.last_net, f))}
        ${mini('📅', "Date d'embauche", dshort(s.employee.hired_on))}
      </div>
      <div class="sad-row ${fin ? 'r21' : ''}">
        ${card('Activité · ' + esc(s.meta.label), cv(ids.m))}
        ${fin}
      </div>
      <div class="sad-row r3">
        ${card('Écarts par statut · ' + esc(s.meta.label), s.gaps_by_status.length ? cv(ids.g, 'sm') : empty)}
        ${card('Ventes par produit', s.top_products.length ? cv(ids.prod, 'sm') : empty)}
        ${card('Paie des 6 derniers bulletins', slips.length ? cv(ids.pay, 'sm') : empty)}
      </div></div>`;
  }

  /* ---------- Onglet « Comportement » (client, fournisseur, employé) ---------- */
  const DOW = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'], DOWL = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
  const dec = v => (v == null || !isFinite(v) ? '—' : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(v));
  function behaviorView(kind, s) {
    const b = s.behavior || {}, k = s.kpis || {}, ids = { wd: uid(), hr: uid() };
    const wdVal = x => (kind === 'suppliers' ? x.n : x.amount);
    const wdLabel = kind === 'suppliers' ? 'Commandes' : kind === 'customers' ? 'Achats' : "Chiffre d'affaires";
    const hasWd = (b.by_weekday || []).some(x => x.n), hasHr = (b.by_hour || []).some(x => x.n);
    const top = hasWd ? b.by_weekday.reduce((a, x) => (x.n > a.n || (x.n === a.n && x.amount > a.amount) ? x : a)) : null;
    const peak = hasHr ? b.by_hour.reduce((a, x) => (x.n > a.n ? x : a)) : null;
    setTimeout(() => draw([
      ...(hasWd ? [[ids.wd, { type: 'bar', data: { labels: DOW, datasets: [{ label: wdLabel, data: b.by_weekday.map(wdVal), backgroundColor: b.by_weekday.map(x => (top && x.dow === top.dow ? '#2563eb' : '#93c5fd')), borderRadius: 6, maxBarThickness: 34 }] }, options: { ...base, plugins: { legend: { display: false }, tooltip: kind === 'suppliers' ? {} : tipMoney }, scales: { y: { beginAtZero: true, grid, ticks: { callback: kind === 'suppliers' ? undefined : compact, precision: 0 } }, x: { grid: { display: false } } } } }]] : []),
      ...(hasHr ? [[ids.hr, { type: 'bar', data: { labels: b.by_hour.map(x => x.h + ' h'), datasets: [{ label: 'Opérations', data: b.by_hour.map(x => x.n), backgroundColor: b.by_hour.map(x => (peak && x.h === peak.h ? '#f59e0b' : '#fde68a')), borderRadius: 4, maxBarThickness: 18 }] }, options: { ...base, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid, ticks: { precision: 0 } }, x: { grid: { display: false }, ticks: { maxTicksLimit: 12 } } } } }]] : [])
    ], 'beh'), 40);
    const rk = b.rank != null ? `n° ${b.rank} sur ${b.of}` : '—';
    let kp = '', notes = [];
    if (kind === 'customers') {
      const seg = !k.orders ? 'Aucune activité' : (k.days_since_last != null && k.days_since_last > 90 ? 'À relancer' : (b.avg_gap_days != null && b.avg_gap_days <= 14 ? 'Fidèle · régulier' : 'Occasionnel'));
      const cr = (s.by_method || []).find(x => x.method === 'credit'), tot = (s.by_method || []).reduce((a, x) => a + x.amount, 0);
      kp = `<div class="sad-kpis">${kpi('🔁', 'Rythme d\'achat', b.avg_gap_days != null ? 'tous les ' + dec(b.avg_gap_days) + ' j' : '—', `${k.orders} achat(s)`)}${kpi('🏆', 'Rang parmi les clients', rk, `${dec(b.share_pct)} % du CA clients`)}${kpi('💎', 'Plus gros achat', f(b.max_total), esc(s.meta.label))}${kpi('🏷', 'Profil', esc(seg), k.days_since_last != null ? ago(k.days_since_last) : '')}</div>`;
      if (tot > 0 && cr) notes.push(`${Math.round(cr.amount / tot * 100)} % des achats de la période sont passés à crédit.`);
      if (k.days_since_last != null && k.days_since_last > 60) notes.push(`Aucun achat depuis ${k.days_since_last} jours : une relance peut être utile.`);
    } else if (kind === 'suppliers') {
      kp = `<div class="sad-kpis">${kpi('🚚', 'Délai moyen de livraison', b.lead_avg_days != null ? dec(b.lead_avg_days) + ' j' : '—', b.lead_min_days != null ? `de ${dec(b.lead_min_days)} à ${dec(b.lead_max_days)} j` : 'Aucune réception')}${kpi('🏆', 'Rang parmi les fournisseurs', rk, `${dec(b.share_pct)} % des achats`)}${kpi('📦', 'Produits fournis', b.distinct_products || 0, esc(s.meta.label))}${kpi('✅', 'Commandes reçues', b.received_orders || 0, `sur ${k.orders} commande(s)`)}</div>`;
      if (k.overdue_count > 0) notes.push(`${k.overdue_count} échéance(s) dépassée(s) à régler.`);
      if (b.lead_avg_days != null && k.payment_terms_days != null) notes.push(`Livraison en ${dec(b.lead_avg_days)} j en moyenne, paiement convenu à ${k.payment_terms_days} j.`);
    } else {
      kp = `<div class="sad-kpis">${kpi('🏆', 'Rang parmi les employés', rk, `${dec(b.share_pct)} % du CA de la station`)}${kpi('🌟', 'Meilleure journée', b.best_day ? f(b.best_day.amount) : '—', b.best_day ? dshort(b.best_day.day) : '')}${kpi('📈', 'Moyenne par quart', f(k.avg_per_shift), `${k.shifts} quart(s)`)}${kpi('🧾', 'Opérations par quart', k.shifts ? dec(k.operations / k.shifts) : '—', `${k.operations} opération(s)`)}</div>`;
      if (k.gaps_count > 0) notes.push(`${k.gaps_count} écart(s) attribué(s) sur la période.`);
    }
    if (top) notes.unshift(`Jour le plus actif : ${DOWL[top.dow - 1]}.`);
    if (peak) notes.unshift(`Heure de pointe : ${peak.h} h – ${peak.h + 1} h.`);
    const read = notes.length ? `<div class="sad-card"><h3>Lecture rapide</h3><ul class="ps-read">${notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul></div>` : '';
    return `<div id="ps-beh" class="ps-wrap">${head(kind, (s.customer || s.supplier || s.employee).id, 'Comportement · ' + ({ customers: 'client', suppliers: 'fournisseur', employees: 'employé' })[kind], s)}${kp}
      <div class="sad-row r2">${card(wdLabel + ' par jour de la semaine', hasWd ? cv(ids.wd, 'sm') : empty)}${kind === 'suppliers' ? read : card('Activité par heure', hasHr ? cv(ids.hr, 'sm') : empty)}</div>${kind === 'suppliers' ? '' : read}</div>`;
  }

  /* ---------- Changement de période et export PDF ---------- */
  const EP = { customers: id => '/customers/' + id, suppliers: id => '/suppliers/' + id, employees: id => '/hr/employees/' + id };
  const DASH = { customers: s => customerDash(null, s), suppliers: s => supplierDash(null, s), employees: employeeDash };
  let seq = 0;
  async function reloadProfile(kind, id) {
    if (!EP[kind]) return;
    const wrap = document.querySelector('.ps-wrap'); if (!wrap) return;
    const mine = ++seq; wrap.classList.add('ps-loading');
    try {
      const st = await G(EP[kind](id) + '/stats?' + PRange.query());
      if (mine !== seq) return; // une sélection plus récente est en cours
      const cur = document.querySelector('.ps-wrap'); if (!cur) return;
      PRange.sync(st.meta);
      cur.outerHTML = DASH[kind](st);
      const beh = document.getElementById('ps-beh'); // l'onglet Comportement suit la même période
      if (beh) beh.outerHTML = behaviorView(kind, st);
    } catch (e) {
      if (mine === seq) wrap.classList.remove('ps-loading');
      if (typeof toast === 'function') toast((e && e.message) || 'Période indisponible');
    }
  }
  window.__behaviorView = behaviorView; // exposé pour les tests
  window.psSetPeriod = function (kind, id, p) {
    if (!EP[kind] || !PSHORT[p]) return;
    PRange.state.period = p; PRange.state.from = PRange.state.to = null;
    return reloadProfile(kind, id);
  };
  window.psSetCustom = function (kind, id, from, to) {
    PRange.state.period = 'custom'; PRange.state.from = from; PRange.state.to = to;
    return reloadProfile(kind, id);
  };
  window.psPdf = function (kind, id) {
    if (!EP[kind] || typeof dlFile !== 'function') return;
    return dlFile(EP[kind](id) + '/stats.pdf?' + PRange.query(), 'profil-' + ({ customers: 'client', suppliers: 'fournisseur', employees: 'employe' })[kind] + '-' + id + '-' + PRange.key());
  };

  /* ---------- Branchement dans les pages ---------- */
  // Fiche client / fournisseur : l'en-tête devient la carte d'identité ; les agrégats ouvrent l'onglet « Vue d'ensemble ».
  function wrapDetail(viewName, kind, paneId, endpoint, backView, dash) {
    const old = VM[viewName]; if (typeof old !== 'function') return;
    const behId = paneId.replace(/-overview$/, '-behavior');
    const fillPane = (html, id, content) => html.replace(new RegExp('(<section id="' + id + '"[^>]*>)[\\s\\S]*?(</section>)'), (m0, open, close) => open + content + close);
    VM[viewName] = async function () {
      const id = Number(arg);
      const [html, rec, st] = await Promise.all([old(), G(endpoint(id)).catch(() => null), G(endpoint(id) + '/stats?' + PRange.query()).catch(() => null)]);
      if (typeof html !== 'string' || !rec || !st) return html;
      PRange.sync(st.meta);
      const idCard = identity(kind, rec, st, backView);
      let out = html.replace(/<div class="detail-head">[\s\S]*?<\/div><\/div>(?=<div class="detail-tabs")/, () => idCard);
      if (out === html) out = idCard + html;
      // « Vue d'ensemble » : les agrégats remplacent l'ancien bloc de chiffres (plus de doublon avec la carte d'identité)
      out = fillPane(out, paneId, dash(rec, st));
      out = fillPane(out, behId, behaviorView(kind, st));
      return out;
    };
  }
  wrapDetail('clidet', 'customers', 'client-detail-overview', id => '/customers/' + id, 'cli', customerDash);
  wrapDetail('supdet', 'suppliers', 'supplier-detail-overview', id => '/suppliers/' + id, 'four', supplierDash);

  // Profil employé : onglets horizontaux (comme le produit) ; « Vue d'ensemble » = agrégats, « Comportement » = habitudes.
  const oldEmpf = VM.empf;
  if (typeof oldEmpf === 'function') {
    VM.empf = async function () {
      const id = Number(arg);
      const showDash = typeof ETAB === 'undefined' || ETAB === 'id';
      const [html, st] = await Promise.all([oldEmpf(), showDash && id ? G('/hr/employees/' + id + '/stats?' + PRange.query()).catch(() => null) : Promise.resolve(null)]);
      if (typeof html !== 'string' || !st) return html;
      PRange.sync(st.meta);
      const block = employeeDash(st);
      return html.includes('<div class="emp-body">') ? html.replace('<div class="emp-body">', () => '<div class="emp-body">' + block) : html;
    };
  }
  if (typeof ETABS !== 'undefined') {
    ETABS.comp = async function (e) {
      const st = await G('/hr/employees/' + e.id + '/stats?' + PRange.query());
      PRange.sync(st.meta);
      return behaviorView('employees', st);
    };
  }
})();
