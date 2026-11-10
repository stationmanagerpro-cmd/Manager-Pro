/* ext-product-profile.js — Fiche produit complète (même esprit que les fiches client / fournisseur / employé) :
   1) carte d'identité du produit en haut, 2) onglets horizontaux auto-adaptés,
   3) Vue d'ensemble (agrégats, diagrammes), Comportement (lecture rapide, marge, jours forts),
      Gestion des prix (modification + historique complet), Historique dotation (achats + « Commande en cours »),
      Historique des stocks (entrées, sorties, pertes, corrections, achats…). */
(function () {
  'use strict';
  if (typeof VM === 'undefined' || typeof G === 'undefined') return;

  const MN = ['janv', 'févr', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc'];
  const DOW = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
  const monthLbl = m => { const p = String(m).split('-'); return p.length === 3 ? p[2] + '/' + p[1] : MN[(+p[1] || 1) - 1] + ' ' + String(p[0]).slice(2); };
  const PSHORT = { '30d': '30 j', '3m': '3 mois', '12m': '12 mois', all: 'Tout' };
  const KIND = { entree: 'Entrée', sortie: 'Sortie', vente: 'Vente', achat: 'Achat (réception)', retour: 'Retour', perte: 'Perte', casse: 'Casse', correction: 'Correction', transfert: 'Transfert' };
  const PSTAT = { commande: 'Commandé', partiel: 'Partiellement reçu', recu: 'Reçu', facture: 'Facturé', paye: 'Payé', archive: 'Archivé', annule: 'Annulé' };
  const PAL = ['#2563eb', '#22c55e', '#f59e0b', '#a855f7', '#ef4444', '#14b8a6', '#64748b'];
  const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 });
  const q3 = v => (v == null || !isFinite(v) ? '—' : nf.format(v));
  const sgn = v => (v > 0 ? '+' : '') + nf.format(v);
  const dshort = d => (d ? new Date(d).toLocaleDateString('fr-FR') : '—');
  const val = (v, fn) => (v == null ? '<span style="color:var(--m)">—</span>' : (fn ? fn(v) : v));
  const money = v => (typeof f === 'function' ? f(v) : String(v));
  const cur = () => (typeof CUR !== 'undefined' ? CUR : 'FCFA');
  const ago = d => (d == null ? '' : d === 0 ? "aujourd'hui" : 'il y a ' + d + ' j');
  const uid = () => 'pp' + Math.random().toString(36).slice(2, 8);
  const tag = (txt, cls) => `<span class="tag ${cls || ''}">${esc(txt)}</span>`;
  const field = (label, v) => `<div><small>${esc(label)}</small><b>${v == null || v === '' ? '—' : v}</b></div>`;
  const kpi = (ico, label, v, sub) => `<div class="sad-kpi"><span class="sad-ico">${ico}</span><div><small>${esc(label)}</small><b>${v}</b><small>${sub || ''}</small></div></div>`;
  const mini = (ico, label, v) => `<div class="sad-mini"><small><i>${ico}</i>${esc(label)}</small><b>${v}</b></div>`;
  const card = (title, inner) => `<div class="sad-card"><h3>${title}</h3>${inner}</div>`;
  const cv = (id, cls) => `<div class="sad-chart ${cls || ''}"><canvas id="${id}"></canvas></div>`;
  const empty = txt => `<p class="dv2-empty" style="color:var(--m);font-size:13px">${txt || 'Pas encore de données.'}</p>`;
  const bar = (pct, cls) => `<div class="ps-bar"><i class="${cls || ''}" style="width:${Math.max(0, Math.min(100, pct || 0))}%"></i></div>`;

  // ---------- état de la fiche ouverte ----------
  let ST = null;                 // { id, stats, prices, supply, stock, supplyView, filters, loaded }
  let PERIOD = '12m';            // période conservée d'une fiche à l'autre pendant la session
  const CH = {};                 // graphiques par onglet

  const grid = { color: 'rgba(148,163,184,.25)' };
  const base = { responsive: true, maintainAspectRatio: false };
  const compact = v => (Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1).replace('.0', '') + ' M' : Math.abs(v) >= 1e3 ? Math.round(v / 1e3) + ' k' : v);
  const legend = { position: 'top', align: 'end', labels: { boxWidth: 8, usePointStyle: true } };
  const tipMoney = { callbacks: { label: c => ' ' + c.dataset.label + ' : ' + new Intl.NumberFormat('fr-FR').format(Math.round(c.raw || 0)) + ' ' + cur() } };
  function draw(key, spec) {
    if (typeof Chart === 'undefined') return;
    (CH[key] || []).forEach(c => { try { c.destroy(); } catch (_) { /* déjà détruit */ } });
    CH[key] = [];
    spec.forEach(([id, cfg]) => { const el = document.getElementById(id); if (el) CH[key].push(new Chart(el, cfg)); });
  }
  const donut = (labels, data, colors) => ({ type: 'doughnut', data: { labels, datasets: [{ data, backgroundColor: colors || PAL, borderWidth: 0 }] }, options: { ...base, cutout: '66%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 8, usePointStyle: true } } } } });
  // links : tableau parallèle aux barres — [vue, id] pour ouvrir la fiche liée au clic (null = pas de lien)
  const linkOpts = links => ({ onClick: (ev, els) => { const l = links && els && els.length && links[els[0].index]; if (l && typeof go === 'function') go(l[0], l[1]); }, onHover: (ev, els) => { if (ev && ev.native && ev.native.target) ev.native.target.style.cursor = links && els.length && links[els[0].index] ? 'pointer' : 'default'; } });
  const hbar = (labels, data, color, money$, links) => ({ type: 'bar', data: { labels, datasets: [{ label: money$ ? 'Montant' : 'Quantité', data, backgroundColor: color, borderRadius: 6, barThickness: 12 }] }, options: { ...base, ...(links && links.some(Boolean) ? linkOpts(links) : {}), indexAxis: 'y', plugins: { legend: { display: false }, tooltip: money$ ? tipMoney : {} }, scales: { x: { beginAtZero: true, grid, ticks: { callback: compact } }, y: { grid: { display: false } } } } });
  const okc = p => typeof can === 'function' && can(p);

  // ---------- Carte d'identité (en haut, comme la fiche fournisseur) ----------
  function identity(s) {
    const p = s.product, k = s.kpis;
    window.__ppCur = { id: p.id, stock: p.stock, unit: p.unit };
    const sub = `${tag(p.category_label || p.category)}${tag(p.active ? 'Actif' : 'Inactif', p.active ? 'ok' : 'x')}${k.low ? tag('Stock bas', 'x') : ''}`;
    const fields = field('Code-barres', p.barcode ? esc(p.barcode) : '') + field('Référence (SKU)', p.sku ? esc(p.sku) : '') + field('Unité', esc(p.unit))
      + field('Prix de vente', money(p.sell_price)) + (p.buy_price != null ? field("Prix d'achat", money(p.buy_price)) : '')
      + field('Marge unitaire', k.margin_unit != null ? money(k.margin_unit) + (k.margin_pct != null ? ' (' + k.margin_pct + ' %)' : '') : '')
      + field('Taxe', p.tax_rate ? p.tax_rate + ' %' : 'Aucune')
      + field('Stock actuel', q3(p.stock) + ' ' + esc(p.unit)) + field('Seuil minimum', q3(p.min_stock) + ' ' + esc(p.unit))
      + field('Fournisseur principal', p.supplier_id && typeof can === 'function' && can('supplier.view|purchase.manage|purchase.pay|stock.adjust') ? `<a href="#" onclick="go('supdet',${Number(p.supplier_id)});return false">${esc(p.supplier_name || '')}</a>` : esc(p.supplier_name || ''));
    const actions = `${typeof can === 'function' && can('price.edit') ? `<button class="b2" onclick="ppEdit(${p.id})">Modifier le produit</button>` : ''}`
      + `${typeof can === 'function' && can('stock.adjust') ? `<button class="b2" onclick="ppMove(${p.id})">Mouvement de stock</button>` : ''}`
      + `<button class="b2" onclick="ppPdf('all')" title="Fiche complète : identité, ventes, comportement, prix, dotation et stocks">📄 PDF complet</button>`
      + `${typeof can === 'function' && can('price.edit') && typeof archSet === 'function' ? `<button class="b2" onclick="archSet('products',${p.id},${p.active ? 'false' : 'true'},${jsArg(p.name)})">${p.active ? '🗄 Archiver' : '♻ Réactiver'}</button>` : ''}`
      + `<button class="b2" onclick="go('prod')">← Retour à la liste</button>`;
    const canPhoto = typeof can === 'function' && (can('image.manage') || can('price.edit') || can('stock.adjust'));
    const photo = typeof av === 'function' ? av('products', p.id, p.photo_path, p.name, true) : `<span class="av big">${esc((p.name || '?').trim().charAt(0).toUpperCase())}</span>`;
    return `<div class="pid pp-id"><div class="pp-avwrap">${photo}${canPhoto ? `<button type="button" class="b2 pp-photo-btn" onclick="pickImage('products',${p.id})">📷 Photo</button>` : ''}</div>
      <div class="pid-main"><h2>${esc(p.name)}</h2><div class="pid-sub">${sub}<span>ID ${p.id}</span></div></div>
      <div class="pid-fields">${fields}</div><div class="pid-actions">${actions}</div></div>`;
  }

  // ---------- Onglets horizontaux auto-adaptés ----------
  function tabsDef() {
    const c = typeof can === 'function' ? can : () => true;
    return [
      ['overview', '📊', "Vue d'ensemble"],
      ['behavior', '🧭', 'Comportement'],
      ['prices', '💲', 'Gestion des prix'],
      ...(c('purchase.manage|supplier.view|stock.adjust|report.view|price.edit') ? [['supply', '🚚', 'Historique dotation']] : []),
      ...(c('stock.adjust|report.view|price.edit') ? [['stock', '📦', 'Historique des stocks']] : [])
    ];
  }
  const tabsBar = items => `<div class="pp-tabs" role="tablist" aria-label="Sections de la fiche produit">${items.map((t, i) => `<button type="button" role="tab" class="b2 ${i ? '' : 'on'}" aria-selected="${i === 0}" data-pp-tab="${t[0]}"><span class="pp-ti" aria-hidden="true">${t[1]}</span><span>${esc(t[2])}</span></button>`).join('')}</div>`;
  const pane = (key, on, html) => `<section id="pp-pane-${key}" class="pp-pane" ${on ? '' : 'hidden'}>${html}</section>`;
  const loading = '<p class="pp-loading">Chargement…</p>';

  function openTab(key) {
    document.querySelectorAll('[data-pp-tab]').forEach(b => { const on = b.dataset.ppTab === key; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); if (on && b.scrollIntoView) { try { b.scrollIntoView({ inline: 'center', block: 'nearest' }); } catch (_) { /* ancien navigateur */ } } });
    document.querySelectorAll('.pp-pane').forEach(p => { p.hidden = p.id !== 'pp-pane-' + key; });
    return loadPane(key, false);
  }
  if (!window.__ppBound) {
    window.__ppBound = true;
    document.addEventListener('click', ev => { const b = ev.target && ev.target.closest && ev.target.closest('[data-pp-tab]'); if (b) openTab(b.dataset.ppTab); });
  }
  const setPane = (key, html) => { const el = document.getElementById('pp-pane-' + key); if (el) el.innerHTML = html; };
  const failPane = (key, e) => setPane(key, `<p class="warn" style="color:var(--r)">${esc((e && e.message) || 'Chargement impossible')}</p>`);

  async function loadPane(key, force) {
    if (!ST) return;
    if (ST.loaded[key] && !force) return;
    try {
      if (key === 'overview') setPane('overview', overview(ST.stats));
      else if (key === 'behavior') setPane('behavior', behavior(ST.stats));
      else if (key === 'prices') { setPane('prices', loading); ST.prices = await G('/products/' + ST.id + '/prices'); setPane('prices', pricesView(ST.prices)); drawPrices(ST.prices); }
      else if (key === 'supply') { setPane('supply', loading); ST.supply = await G('/products/' + ST.id + '/purchases'); setPane('supply', supplyView()); drawSupply(); }
      else if (key === 'stock') { setPane('stock', loading); await fetchStock(); setPane('stock', stockView()); }
      ST.loaded[key] = true;
    } catch (e) { failPane(key, e); }
  }

  // ---------- Vue d'ensemble ----------
  function head(s) {
    return `<div class="ps-head"><div><p class="ps-title">📊 Vue globale du produit</p><small class="ps-per">${esc(s.meta.label)}${s.meta.capped ? ' · courbe limitée aux 60 derniers mois' : ''}</small></div>
      <div class="ps-tools">${PRange.seg(s.meta, 'ppPeriod', 'ppCustom')}</div></div>`;
  }
  function overview(s) {
    const k = s.kpis, p = s.product, ids = { m: uid(), fl: uid(), mv: uid(), cu: uid(), su: uid() };
    const pctStock = k.min_stock > 0 ? Math.round(k.stock / (k.min_stock * 2) * 100) : (k.stock > 0 ? 100 : 0);
    const lb = k.last_buy;
    setTimeout(() => draw('overview', [
      [ids.m, { type: 'bar', data: { labels: s.monthly.map(m => monthLbl(m.month)), datasets: [
        { label: "Chiffre d'affaires", data: s.monthly.map(m => m.revenue), backgroundColor: '#2563eb', borderRadius: 6, maxBarThickness: 30, yAxisID: 'y', order: 2 },
        { type: 'line', label: 'Quantité vendue', data: s.monthly.map(m => m.qty), borderColor: '#f59e0b', backgroundColor: '#f59e0b', tension: .3, pointRadius: 3, yAxisID: 'y2', order: 1 }
      ] }, options: { ...base, plugins: { legend, tooltip: { callbacks: { label: c => ' ' + c.dataset.label + ' : ' + (c.datasetIndex === 0 ? new Intl.NumberFormat('fr-FR').format(Math.round(c.raw || 0)) + ' ' + cur() : q3(c.raw) + ' ' + p.unit) } } }, scales: { y: { beginAtZero: true, grid, ticks: { callback: compact } }, y2: { beginAtZero: true, position: 'right', grid: { display: false } }, x: { grid: { display: false } } } } }],
      [ids.fl, { type: 'bar', data: { labels: s.monthly.map(m => monthLbl(m.month)), datasets: [
        { label: 'Entrées', data: s.monthly.map(m => m.in_qty), backgroundColor: '#22c55e', borderRadius: 6, maxBarThickness: 24 },
        { label: 'Sorties', data: s.monthly.map(m => m.out_qty), backgroundColor: '#ef4444', borderRadius: 6, maxBarThickness: 24 }
      ] }, options: { ...base, plugins: { legend }, scales: { y: { beginAtZero: true, grid }, x: { grid: { display: false } } } } }],
      ...(s.movements_by_kind.length ? [[ids.mv, donut(s.movements_by_kind.map(x => (KIND[x.kind] || x.kind) + ' ' + x.n), s.movements_by_kind.map(x => x.n))]] : []),
      ...(s.top_customers.length ? [[ids.cu, hbar(s.top_customers.map(x => x.name), s.top_customers.map(x => x.amount), '#a855f7', true, s.top_customers.map(x => (x.id && okc('customer.view|sale.create') ? ['clidet', x.id] : null)))]] : []),
      ...(s.suppliers.length ? [[ids.su, s.suppliers.some(x => x.amount != null) ? hbar(s.suppliers.map(x => x.supplier), s.suppliers.map(x => x.amount), '#f59e0b', true) : hbar(s.suppliers.map(x => x.supplier), s.suppliers.map(x => x.qty), '#f59e0b', false)]] : [])
    ]), 40);
    const situation = `<div class="sad-card sad-treso"><h3>Situation du stock</h3>
      <div class="big">${q3(k.stock)} ${esc(p.unit)}</div><div class="sub">${k.low ? '⚠ Sous le seuil minimum.' : 'Stock disponible actuellement.'}</div>
      <div class="rows"><div><span>Seuil minimum</span><b>${q3(k.min_stock)} ${esc(p.unit)}</b></div>
        <div><span>Couverture estimée</span><b>${k.days_cover != null ? k.days_cover + ' j' : '—'}</b></div>
        <div><span>Valeur au prix d'achat</span><b>${val(k.stock_value_buy, money)}</b></div>
        <div><span>Valeur au prix de vente</span><b>${money(k.stock_value_sell)}</b></div>
        <div><span>Dernier achat</span><b>${lb ? dshort(lb.at) + (lb.unit_cost != null ? ' · ' + money(lb.unit_cost) : '') : '—'}</b></div></div>
      ${bar(pctStock, k.low ? 'bad' : pctStock < 60 ? 'warn' : '')}</div>`;
    return `<div class="ps-wrap">${head(s)}
      <div class="sad-kpis">
        ${kpi('🛒', 'Quantité vendue', q3(k.qty_sold) + ' ' + esc(p.unit), `${k.tickets} vente(s) · moy. ${q3(k.avg_ticket_qty)} par vente`)}
        ${kpi('🧾', "Chiffre d'affaires", money(k.revenue), k.rank ? `${k.share_pct} % du CA · n°${k.rank} sur ${k.n_products}` : 'Aucune vente sur la période')}
        ${kpi('📈', 'Marge brute', val(k.margin_total, money), k.margin_total_pct != null ? k.margin_total_pct + ' % du CA' : '')}
        ${kpi('📦', 'Stock actuel', q3(k.stock) + ' ' + esc(p.unit), k.days_cover != null ? `≈ ${k.days_cover} j de ventes` : '')}
      </div>
      <div class="sad-kpis2">
        ${mini('📅', 'Moyenne par jour', q3(k.avg_daily) + ' ' + esc(p.unit))}
        ${mini('🕒', 'Dernière vente', dshort(k.last_sale_at) + (k.days_since_last_sale != null ? ' <small style="color:var(--m)">' + ago(k.days_since_last_sale) + '</small>' : ''))}
        ${mini('💰', 'Valeur du stock (achat)', val(k.stock_value_buy, money))}
        ${mini('⚠', 'Pertes et casse', q3(k.losses_qty) + ' ' + esc(p.unit))}
        ${mini('🚚', 'Commandes en cours', k.open_orders ? k.open_orders + ' · ' + q3(k.open_qty) + ' ' + esc(p.unit) : '0')}
      </div>
      <div class="sad-row r21">${card('Ventes · ' + esc(s.meta.label), cv(ids.m))}${situation}</div>
      <div class="sad-row r3">
        ${card('Entrées et sorties de stock', s.monthly.some(m => m.in_qty || m.out_qty) ? cv(ids.fl, 'sm') : empty())}
        ${card('Mouvements par type', s.movements_by_kind.length ? cv(ids.mv, 'sm') : empty())}
        ${card('Meilleurs clients', s.top_customers.length ? cv(ids.cu, 'sm') : empty())}
      </div>
      <div class="sad-row r2">${card('Approvisionnement par fournisseur', s.suppliers.length ? cv(ids.su, 'sm') : empty('Aucun achat reçu sur la période.'))}${card('Prix actuels', `<div class="pp-pricebox"><div><small>Prix de vente</small><b>${money(p.sell_price)}</b></div><div><small>Prix d'achat</small><b>${money(p.buy_price)}</b></div><div><small>Marge unitaire</small><b>${val(k.margin_unit, v => money(v) + (k.margin_pct != null ? ' · ' + k.margin_pct + ' %' : ''))}</b></div></div><div class="pid-actions" style="margin-top:12px"><button class="b2" onclick="ppGo('prices')">Gérer les prix →</button></div>`)}</div>
    </div>`;
  }

  // ---------- Comportement ----------
  function behavior(s) {
    const k = s.kpis, p = s.product, ids = { mg: uid(), pr: uid(), wd: uid(), em: uid() };
    const m = s.monthly, tot = m.reduce((a, x) => a + x.revenue, 0);
    const best = m.reduce((a, x) => (x.revenue > (a ? a.revenue : -1) ? x : a), null);
    const wdBest = s.weekday.reduce((a, x) => (x.qty > (a ? a.qty : -1) ? x : a), null);
    let trend = null;
    if (s.meta.gran === 'day' && m.length >= 14) { const l = m.slice(-7).reduce((a, x) => a + x.revenue, 0), pv = m.slice(-14, -7).reduce((a, x) => a + x.revenue, 0); if (pv > 0) trend = { pct: Math.round((l - pv) / pv * 100), txt: '7 derniers jours vs 7 jours précédents' }; }
    else if (s.meta.gran !== 'day' && m.length >= 3) { const l = m[m.length - 2].revenue, pv = m[m.length - 3].revenue; if (pv > 0) trend = { pct: Math.round((l - pv) / pv * 100), txt: 'dernier mois complet vs précédent' }; }
    const lossShare = k.qty_sold + k.losses_qty > 0 ? Math.round(k.losses_qty / (k.qty_sold + k.losses_qty) * 1000) / 10 : 0;
    const realized = k.qty_sold > 0 ? k.revenue / k.qty_sold : null;
    const costTot = m.every(x => x.cost == null) ? null : m.reduce((a, x) => a + (x.cost || 0), 0);
    const realizedCost = costTot != null && k.qty_sold > 0 ? costTot / k.qty_sold : null;
    const li = [];
    if (!k.rank) li.push(['💤', 'Aucune vente sur la période', 'Ce produit n\'a pas été vendu sur la période choisie.']);
    else {
      li.push(['🏆', `N°${k.rank} sur ${k.n_products} produits vendus`, `Il représente ${k.share_pct} % du chiffre d'affaires de la période.`]);
      if (best && best.revenue > 0 && tot > 0) li.push(['📅', 'Meilleure période : ' + monthLbl(best.month), `${money(best.revenue)} · ${Math.round(best.revenue / tot * 100)} % du chiffre d'affaires de la période.`]);
      if (wdBest && wdBest.qty > 0) li.push(['🗓', 'Jour le plus fort : ' + ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'][wdBest.dow - 1], `${q3(wdBest.qty)} ${p.unit} vendus ce jour-là sur la période.`]);
      if (trend) li.push([trend.pct >= 0 ? '📈' : '📉', (trend.pct >= 0 ? 'Hausse de ' : 'Baisse de ') + Math.abs(trend.pct) + ' % du chiffre d\'affaires', trend.txt + '.']);
    }
    if (realized != null) li.push(['💵', 'Prix moyen réellement encaissé : ' + money(realized), realizedCost != null ? `Coût moyen des unités vendues : ${money(realizedCost)} · marge réalisée ${money(realized - realizedCost)} par ${p.unit}.` : `Prix de vente actuel : ${money(p.sell_price)}.`]);
    if (k.days_cover != null) li.push([k.days_cover < 7 ? '🚨' : '🧮', 'Couverture : ' + k.days_cover + ' jours de ventes', k.days_cover < 7 ? 'Rupture probable à ce rythme : pensez à réapprovisionner.' : 'Au rythme moyen de la période (' + q3(k.avg_daily) + ' ' + p.unit + '/jour).']);
    if (k.days_since_last_sale != null && k.days_since_last_sale > 30 && k.stock > 0) li.push(['🕸', 'Produit dormant', `Aucune vente depuis ${k.days_since_last_sale} jours alors que ${q3(k.stock)} ${p.unit} restent en stock.`]);
    if (k.losses_qty > 0) li.push(['⚠', 'Pertes et casse : ' + q3(k.losses_qty) + ' ' + p.unit, lossShare + ' % des sorties de la période (ventes + pertes).']);
    if (k.margin_pct != null && k.margin_pct < 0) li.push(['🔻', 'Vendu à perte', 'Le prix de vente actuel est inférieur au prix d\'achat.']);
    const hasCost = m.some(x => x.cost != null);
    setTimeout(() => draw('behavior', [
      ...(hasCost ? [[ids.mg, { type: 'bar', data: { labels: m.map(x => monthLbl(x.month)), datasets: [
        { label: 'Marge brute', data: m.map(x => Math.round(x.revenue - (x.cost || 0))), backgroundColor: '#22c55e', borderRadius: 6, maxBarThickness: 30, yAxisID: 'y', order: 2 },
        { type: 'line', label: 'Marge %', data: m.map(x => (x.revenue > 0 ? Math.round((x.revenue - (x.cost || 0)) / x.revenue * 1000) / 10 : null)), borderColor: '#2563eb', backgroundColor: '#2563eb', tension: .3, pointRadius: 3, yAxisID: 'y2', order: 1, spanGaps: true }
      ] }, options: { ...base, plugins: { legend, tooltip: { callbacks: { label: c => ' ' + c.dataset.label + ' : ' + (c.datasetIndex === 0 ? new Intl.NumberFormat('fr-FR').format(c.raw) + ' ' + cur() : c.raw + ' %') } } }, scales: { y: { grid, ticks: { callback: compact } }, y2: { position: 'right', grid: { display: false }, ticks: { callback: v => v + ' %' } }, x: { grid: { display: false } } } } }]] : []),
      [ids.pr, { type: 'line', data: { labels: m.map(x => monthLbl(x.month)), datasets: [
        { label: 'Prix moyen encaissé', data: m.map(x => (x.qty > 0 ? Math.round(x.revenue / x.qty * 100) / 100 : null)), borderColor: '#2563eb', backgroundColor: '#2563eb', tension: .25, pointRadius: 3, spanGaps: true },
        ...(hasCost ? [{ label: 'Coût moyen vendu', data: m.map(x => (x.qty > 0 && x.cost != null ? Math.round(x.cost / x.qty * 100) / 100 : null)), borderColor: '#f59e0b', backgroundColor: '#f59e0b', tension: .25, pointRadius: 3, spanGaps: true }] : [])
      ] }, options: { ...base, plugins: { legend, tooltip: tipMoney }, scales: { y: { grid, ticks: { callback: compact } }, x: { grid: { display: false } } } } }],
      [ids.wd, { type: 'bar', data: { labels: DOW, datasets: [{ label: 'Quantité vendue', data: s.weekday.map(x => x.qty), backgroundColor: '#14b8a6', borderRadius: 6, maxBarThickness: 36 }] }, options: { ...base, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid }, x: { grid: { display: false } } } } }],
      ...(s.top_employees.length ? [[ids.em, hbar(s.top_employees.map(x => x.name), s.top_employees.map(x => x.amount), '#2563eb', true, s.top_employees.map(x => (x.id && okc('hr.view|hr.manage|hr.payroll|hr.debts|hr.gaps') ? ['empf', x.id] : null)))]] : [])
    ]), 60);
    return `<div class="ps-wrap">${head(s)}
      <div class="sad-card" style="margin-bottom:14px"><h3>Lecture rapide</h3><ul class="pp-insights">${li.map(x => `<li><span class="pp-ii" aria-hidden="true">${x[0]}</span><div><b>${esc(x[1])}</b><small>${esc(x[2])}</small></div></li>`).join('')}</ul></div>
      <div class="sad-row r2">${hasCost ? card('Marge brute · ' + esc(s.meta.label), cv(ids.mg)) : card('Prix moyen encaissé', cv(ids.pr))}${hasCost ? card('Prix encaissé et coût moyen', cv(ids.pr)) : card('Jours de la semaine', cv(ids.wd))}</div>
      <div class="sad-row r2">${hasCost ? card('Ventes par jour de la semaine', cv(ids.wd, 'sm')) : ''}${card('Ventes par employé', s.top_employees.length ? cv(ids.em, 'sm') : empty())}</div></div>`;
  }

  // ---------- Gestion des prix ----------
  function pricesView(d) {
    const p = d.product, hasBuy = !!d.can_cost, sellLoss = hasBuy && p.sell_price < p.buy_price;   // RG-03 : coût réservé à « cost.view »
    const hist = d.history;
    const changes = hist.filter(h => h.old_price != null);
    const typeSel = `<select id="pp-ptype" onchange="ppPriceFilter()"><option value="">Tous les prix</option><option value="sell">Prix de vente</option>${hasBuy ? '<option value="buy">Prix d\'achat</option>' : ''}</select>`;
    const form = d.can_edit ? `<div class="sad-card" style="margin-bottom:14px"><h3>Modifier les prix</h3>
      <div class="pp-form">
        <label>Nouveau prix de vente (${esc(cur())})<input id="pp-sell" type="number" min="0" step="any" inputmode="decimal" value="${p.sell_price}" oninput="ppPreview()"></label>
        ${hasBuy ? `<label>Nouveau prix d'achat (${esc(cur())})<input id="pp-buy" type="number" min="0" step="any" inputmode="decimal" value="${p.buy_price}" oninput="ppPreview()"></label>` : ''}
        <label class="pp-note">Motif / note (facultatif)<input id="pp-note" maxlength="300" placeholder="Ex. hausse fournisseur, promotion, alignement concurrence…"></label>
      </div>
      <div class="pp-chips" role="group" aria-label="Ajustement rapide du prix de vente"><span>Ajuster la vente :</span>${[-10, -5, 5, 10].map(x => `<button type="button" class="b2" onclick="ppAdj(${x})">${x > 0 ? '+' : '−'}${Math.abs(x)} %</button>`).join('')}<button type="button" class="b2" onclick="ppReset()">Rétablir</button></div>
      <p id="pp-prev" class="pp-prev" aria-live="polite"></p>
      <div class="pid-actions"><button onclick="ppSavePrices()">Enregistrer le nouveau prix</button></div></div>` : `<p class="ps-note">Vous pouvez consulter l'historique ; la modification des prix demande l'autorisation « Modifier les prix ».</p>`;
    return `<div class="ps-wrap">
      <div class="sad-kpis pp-k3">
        ${kpi('🏷', 'Prix de vente actuel', money(p.sell_price), p.tax_rate ? `Taxe ${p.tax_rate} %` : 'Sans taxe')}
        ${hasBuy ? kpi('🧾', "Prix d'achat actuel", money(p.buy_price), 'Dernier coût connu') : ''}
        ${hasBuy ? kpi('📈', 'Marge unitaire', money(d.margin_unit), d.margin_pct != null ? d.margin_pct + ' % du prix de vente' : '') : ''}
        ${kpi('🔁', 'Changements de prix', changes.length, hist.length ? 'depuis le ' + dshort(hist[hist.length - 1].from) : '')}
      </div>
      ${sellLoss ? '<p class="pp-alert">⚠ Le prix de vente est inférieur au prix d\'achat : chaque vente est faite à perte.</p>' : ''}
      ${form}
      <div class="sad-card" style="margin-bottom:14px"><h3>Évolution des prix</h3>${hist.length > 1 ? cv('pp-pchart') : empty('Aucun changement de prix enregistré pour le moment.')}</div>
      <div class="sad-card"><h3>Historique complet des prix <span>${typeSel}</span></h3><div id="pp-ptable">${priceTable(hist, '')}</div></div></div>`;
  }
  function priceTable(hist, type) {
    const rows = hist.filter(h => !type || h.type === type);
    return T(['Date', 'Prix', 'Ancien prix', 'Nouveau prix', 'Variation', 'Valable', 'Par', 'Note'], rows.map(h => {
      const dlt = h.delta == null ? '—' : `<span style="color:${h.delta > 0 ? 'var(--g)' : h.delta < 0 ? 'var(--r)' : 'var(--m)'}">${h.delta > 0 ? '▲' : h.delta < 0 ? '▼' : '='} ${sgn(h.delta)}${h.delta_pct != null ? ' (' + sgn(h.delta_pct) + ' %)' : ''}</span>`;
      const to = h.to ? 'jusqu\'au ' + dshort(h.to) : '<span class="tag ok">En vigueur</span>';
      return [dt(h.from), tag(h.type === 'sell' ? 'Vente' : 'Achat', h.type === 'sell' ? '' : 'x'), h.old_price == null ? '—' : money(h.old_price), '<b>' + money(h.price) + '</b>', dlt, to, esc(h.by || '—'), esc(h.note || '—')];
    }));
  }
  function drawPrices(d) {
    const ev = d.history.slice().reverse(); // du plus ancien au plus récent
    if (ev.length < 2) return;
    let sell = null, buy = null; const labels = [], S = [], B = [];
    ev.forEach(h => {
      if (h.type === 'sell') sell = h.price; else buy = h.price;
      labels.push(dshort(h.from)); S.push(sell); B.push(buy);
    });
    labels.push("Aujourd'hui"); S.push(d.product.sell_price); B.push(d.product.buy_price != null ? d.product.buy_price : null);
    setTimeout(() => draw('prices', [['pp-pchart', { type: 'line', data: { labels, datasets: [
      { label: 'Prix de vente', data: S, borderColor: '#2563eb', backgroundColor: '#2563eb', stepped: true, pointRadius: 3, spanGaps: true },
      ...(d.can_cost ? [{ label: "Prix d'achat", data: B, borderColor: '#f59e0b', backgroundColor: '#f59e0b', stepped: true, pointRadius: 3, spanGaps: true }] : [])
    ] }, options: { ...base, plugins: { legend, tooltip: tipMoney }, scales: { y: { grid, ticks: { callback: compact } }, x: { grid: { display: false } } } } }]]), 40);
  }
  window.ppPriceFilter = function () { const el = document.getElementById('pp-ptype'), t = document.getElementById('pp-ptable'); if (el && t && ST && ST.prices) t.innerHTML = priceTable(ST.prices.history, el.value); };
  const nv = id => { const el = document.getElementById(id); return el ? Number(el.value) : NaN; };
  window.ppPreview = function () {
    const out = document.getElementById('pp-prev'); if (!out || !ST || !ST.prices) return;
    const p = ST.prices.product, hb = !!ST.prices.can_cost, s = nv('pp-sell'), b = hb ? nv('pp-buy') : 0;
    if (!isFinite(s) || !isFinite(b) || s < 0 || b < 0) { out.textContent = 'Saisissez des prix valides (nombres positifs).'; out.className = 'pp-prev bad'; return; }
    const m = s - b, pct = s > 0 ? Math.round(m / s * 1000) / 10 : null, ds = p.sell_price > 0 ? Math.round((s - p.sell_price) / p.sell_price * 1000) / 10 : null;
    const same = s === p.sell_price && (!hb || b === p.buy_price);
    out.className = 'pp-prev' + (hb && m < 0 ? ' bad' : '');
    if (!hb) { out.textContent = same ? 'Aucun changement par rapport aux prix actuels.' : `Nouveau prix de vente : ${money(s)}${ds != null ? ' (' + (ds >= 0 ? '+' : '') + ds + ' %)' : ''}`; return; }
    out.textContent = same ? 'Aucun changement par rapport aux prix actuels.' : `Après changement : marge unitaire ${money(m)}${pct != null ? ' (' + pct + ' %)' : ''}${ds != null && s !== p.sell_price ? ' · prix de vente ' + (ds >= 0 ? '+' : '') + ds + ' %' : ''}${m < 0 ? ' — vente à perte !' : ''}`;
  };
  window.ppAdj = function (pct) { const el = document.getElementById('pp-sell'); if (!el || !ST || !ST.prices) return; const base$ = ST.prices.product.sell_price, v = base$ * (1 + pct / 100); el.value = Number.isInteger(base$) ? Math.round(v) : Math.round(v * 100) / 100; ppPreview(); };
  window.ppReset = function () { if (!ST || !ST.prices) return; const p = ST.prices.product; document.getElementById('pp-sell').value = p.sell_price; if (ST.prices.can_cost) document.getElementById('pp-buy').value = p.buy_price; ppPreview(); };
  window.ppSavePrices = async function () {
    if (!ST || !ST.prices) return;
    const hb = !!ST.prices.can_cost, p = ST.prices.product, s = nv('pp-sell'), b = hb ? nv('pp-buy') : 0, note = (document.getElementById('pp-note') || {}).value || '';
    if (!isFinite(s) || !isFinite(b) || s < 0 || b < 0) return toast('Saisissez des prix valides (nombres positifs).', 'error');
    const body = {}; if (s !== p.sell_price) body.sell_price = s; if (hb && b !== p.buy_price) body.buy_price = b;
    if (!Object.keys(body).length) return toast('Aucun changement : les prix saisis sont identiques aux prix actuels.', 'info');
    const sellEff = body.sell_price !== undefined ? s : p.sell_price, buyEff = body.buy_price !== undefined ? b : p.buy_price;
    if (hb && sellEff < buyEff && !confirm('Le prix de vente (' + money(sellEff) + ') est inférieur au prix d\'achat (' + money(buyEff) + '). Vous vendrez à perte. Continuer ?')) return;
    if (note.trim()) body.note = note.trim();
    try { await Po('/products/' + ST.id + '/prices', body); toast('Prix mis à jour et ajouté à l\'historique.', 'success'); await ppRefresh('prices'); }
    catch (e) { toast(errMsg(e), 'error'); }
  };

  // ---------- Historique dotation ----------
  function supplyView() {
    const d = ST.supply, s = d.summary, open = d.lines.filter(l => l.open);
    const canPO = typeof window.poNew === 'function' && typeof can === 'function' && can('purchase.manage');
    const sv = ST.supplyView;
    return `<div class="ps-wrap">
      <div class="sad-kpis2">
        ${mini('🧾', 'Commandes', s.orders)}
        ${mini('📥', 'Quantité reçue', q3(s.qty_received) + ' ' + esc(ST.stats.product.unit))}
        ${mini('💰', 'Total acheté (reçu)', money(s.spent))}
        ${mini('⚖', "Coût moyen d'achat", val(s.avg_cost, money))}
        ${mini('↕', 'Coût min – max', s.min_cost != null ? money(s.min_cost) + ' – ' + money(s.max_cost) : '—')}
      </div>
      <div class="pp-sub" role="group" aria-label="Affichage des achats">
        <button type="button" class="b2 ${sv === 'all' ? 'on' : ''}" onclick="ppSupplyView('all')">Historique des achats <span class="pp-badge">${d.lines.length}</span></button>
        <button type="button" class="b2 ${sv === 'open' ? 'on' : ''}" onclick="ppSupplyView('open')">Commande en cours <span class="pp-badge ${open.length ? 'hot' : ''}">${open.length}</span></button>
        ${canPO ? `<button type="button" class="b2 pp-right" onclick="poNew(${Number(ST.stats.product.supplier_id) || ''})">+ Nouveau bon de commande</button>` : ''}
      </div>
      ${sv === 'open' ? openOrders(open) : `<div class="sad-card" style="margin-bottom:14px"><h3>Coût unitaire par commande</h3>${d.lines.filter(l => l.status !== 'annule').length > 1 ? cv('pp-cchart', 'sm') : empty('Pas assez de commandes pour tracer une évolution.')}</div>
        <div class="sad-card"><h3>Tous les achats de ce produit</h3>${supplyTable(d.lines)}${s.truncated ? '<p class="ps-note">Affichage limité aux 500 lignes les plus récentes.</p>' : ''}</div>`}
    </div>`;
  }
  const poLink = l => (typeof showPO === 'function' ? `<a href="#" onclick="showPO(${Number(l.purchase_id)});return false">${esc(l.order_no || '#' + l.purchase_id)}</a>` : esc(l.order_no || '#' + l.purchase_id));
  const supLink = l => (typeof can === 'function' && can('supplier.view|purchase.manage|purchase.pay|stock.adjust') ? `<a href="#" onclick="go('supdet',${Number(l.supplier_id)});return false">${esc(l.supplier)}</a>` : esc(l.supplier));
  function supplyTable(lines) {
    return T(['N° commande', 'Date', 'Fournisseur', 'Commandé', 'Reçu', 'Coût unitaire', 'Total commandé', 'Statut'], lines.map(l => [
      poLink(l), dt(l.ordered_at), supLink(l), q3(l.qty_ordered), q3(l.qty_received), money(l.unit_cost), money(l.line_total),
      tag(PSTAT[l.status] || l.status, l.status === 'annule' ? 'x' : (l.open ? '' : 'ok'))
    ]));
  }
  function openOrders(open) {
    if (!open.length) return `<div class="sad-card pp-empty-ok"><h3>Commande en cours</h3><p>✅ Aucune commande en attente de livraison pour ce produit.</p><p class="ps-note">Une commande apparaît ici dès qu'elle est émise et disparaît automatiquement quand elle est entièrement livrée.</p></div>`;
    const u = ST.stats.product.unit;
    return `<div class="sad-card"><h3>Commande en cours <span>${open.length} ligne(s) · reste à livrer : ${q3(open.reduce((a, l) => a + l.qty_remaining, 0))} ${esc(u)}</span></h3>
      <p class="ps-note">Commandes émises non encore livrées. Elles disparaissent d'ici dès la réception complète.</p>
      ${T(['N° commande', 'Émise le', 'Attente', 'Fournisseur', 'Commandé', 'Déjà reçu', 'Reste à livrer', 'Coût unitaire', 'Statut', ''], open.map(l => [
        poLink(l), dt(l.ordered_at), `<span class="tag ${l.waiting_days > 14 ? 'x' : ''}">${l.waiting_days} j</span>`, supLink(l), q3(l.qty_ordered), q3(l.qty_received), '<b>' + q3(l.qty_remaining) + '</b>', money(l.unit_cost),
        tag(PSTAT[l.status] || l.status), typeof showPO === 'function' ? `<button class="b2" onclick="showPO(${Number(l.purchase_id)})">Ouvrir / recevoir</button>` : ''
      ]))}</div>`;
  }
  function drawSupply() {
    if (!ST.supply || ST.supplyView !== 'all') return;
    const ls = ST.supply.lines.filter(l => l.status !== 'annule').slice().reverse();
    if (ls.length < 2) return;
    setTimeout(() => draw('supply', [['pp-cchart', { type: 'line', data: { labels: ls.map(l => dshort(l.ordered_at)), datasets: [{ label: 'Coût unitaire', data: ls.map(l => l.unit_cost), borderColor: '#f59e0b', backgroundColor: '#f59e0b', stepped: true, pointRadius: 3 }] }, options: { ...base, plugins: { legend: { display: false }, tooltip: tipMoney }, scales: { y: { grid, ticks: { callback: compact } }, x: { grid: { display: false } } } } }]]), 40);
  }
  window.ppSupplyView = function (v) { if (!ST) return; ST.supplyView = v; setPane('supply', supplyView()); drawSupply(); };

  // ---------- Historique des stocks ----------
  async function fetchStock() {
    const f$ = ST.filters, qs = new URLSearchParams();
    if (f$.kind) qs.set('kind', f$.kind); if (f$.from) qs.set('from', f$.from); if (f$.to) qs.set('to', f$.to);
    ST.stock = await G('/products/' + ST.id + '/stock-history' + (qs.toString() ? '?' + qs : ''));
  }
  function stockView() {
    const d = ST.stock, u = esc(d.product.unit), bk = k => d.by_kind.filter(x => k.includes(x.kind));
    const sum = (arr, key) => arr.reduce((a, x) => a + Number(x[key] || 0), 0);
    const entries = sum(d.by_kind, 'qty_in'), exits = sum(d.by_kind, 'qty_out');
    const corrPlus = sum(bk(['correction']), 'qty_in'), corrMinus = sum(bk(['correction']), 'qty_out');
    const f$ = ST.filters;
    const opts = ['', ...Object.keys(KIND)].map(k => `<option value="${k}" ${f$.kind === k ? 'selected' : ''}>${k ? KIND[k] : 'Tous les types'}</option>`).join('');
    return `<div class="ps-wrap">
      <div class="sad-kpis2">
        ${mini('⬇', 'Entrées (total)', '+' + q3(entries) + ' ' + u)}
        ${mini('⬆', 'Sorties (total)', '−' + q3(exits) + ' ' + u)}
        ${mini('🛒', 'Ventes', q3(sum(bk(['vente']), 'qty_out')) + ' ' + u)}
        ${mini('⚠', 'Pertes et casse', q3(sum(bk(['perte', 'casse']), 'qty_out')) + ' ' + u)}
        ${mini('🛠', 'Corrections', '+' + q3(corrPlus) + ' / −' + q3(corrMinus))}
      </div>
      <div class="sad-card"><h3>Historique des stocks <span>Stock actuel : ${q3(d.product.stock)} ${u}</span></h3>
        <div class="pp-filters">
          <label>Type<select id="pp-skind">${opts}</select></label>
          <label>Du<input id="pp-sfrom" type="date" value="${esc(f$.from || '')}"></label>
          <label>Au<input id="pp-sto" type="date" value="${esc(f$.to || '')}"></label>
          <button class="b2" onclick="ppStockFilter()">Appliquer</button>
          <button class="b2" onclick="ppStockFilter(true)">Réinitialiser</button>
          ${typeof can === 'function' && can('stock.adjust') ? `<button class="pp-right" onclick="ppMove(${ST.id})">+ Mouvement</button>` : ''}
        </div>
        ${T(['Date', 'Type', 'Quantité', 'Stock après', 'Référence', 'Par', 'Commentaire'], d.rows.map(m => [
          dt(m.at), tag(KIND[m.kind] || m.kind, m.quantity < 0 ? 'x' : (m.kind === 'vente' ? '' : 'ok')),
          `<b style="color:${m.quantity < 0 ? 'var(--r)' : 'var(--g)'}">${sgn(m.quantity)} ${u}</b>`, q3(m.balance_after) + ' ' + u,
          m.ref ? (m.ref.type === 'purchase' && typeof showPO === 'function' ? `<a href="#" onclick="showPO(${Number(m.ref.id)});return false">${esc(m.ref.label)}</a>` : esc((m.ref.type === 'sale' ? 'Vente ' : '') + m.ref.label)) : '—',
          esc(m.by || '—'), esc(m.comment || '—')
        ]))}
        ${d.truncated ? '<p class="ps-note">Affichage limité aux mouvements les plus récents : affinez avec les filtres de date ou de type.</p>' : ''}</div></div>`;
  }
  window.ppStockFilter = async function (reset) {
    if (!ST) return;
    ST.filters = reset ? { kind: '', from: '', to: '' } : { kind: document.getElementById('pp-skind').value, from: document.getElementById('pp-sfrom').value, to: document.getElementById('pp-sto').value };
    try { setPane('stock', loading); await fetchStock(); setPane('stock', stockView()); } catch (e) { failPane('stock', e); }
  };

  // ---------- Actions ----------
  window.ppGo = key => openTab(key);
  window.ppEdit = function (id) { if (typeof editP === 'function') { Promise.all([G('/products'), G('/products?inactive=1').catch(() => [])]).then(([a, i]) => { PSC = a.concat(i); editP(id); }).catch(e => toast(errMsg(e), 'error')); } };
  window.ppMove = function (id) {
    const name = ST && ST.stats ? ST.stats.product.name : 'produit';
    form('Mouvement de stock · ' + name, [['kind', 'Type', 's', [['entree', 'Entrée'], ['retour', 'Retour'], ['perte', 'Perte'], ['casse', 'Casse'], ['correction', 'Correction (+ ou −)']]], ['quantity', 'Quantité (correction : + ou −)', 'number'], ['comment', 'Motif (obligatoire, 3 caractères min.)']], { kind: 'entree' }, async d => {
      if (String(d.comment || '').trim().length < 3) { toast('Motif obligatoire (3 caractères minimum).', 'error'); return; }
      await Po('/stock/movements', { product_id: Number(id), kind: d.kind, quantity: Number(d.quantity), comment: String(d.comment).trim() });
      closeM(); toast('Mouvement enregistré', 'success'); await ppRefresh('stock');
    });
  };
  async function reloadStats() {
    if (!ST) return;
    const wrap = document.querySelector('.ps-wrap'); if (wrap) wrap.classList.add('ps-loading');
    try {
      const st = await G('/products/' + ST.id + '/profile?' + PRange.query());
      PRange.sync(st.meta); PERIOD = PRange.key(); ST.stats = st; ST.loaded.overview = ST.loaded.behavior = false;
      const active = (document.querySelector('[data-pp-tab].on') || {}).dataset;
      const key = active && ['overview', 'behavior'].includes(active.ppTab) ? active.ppTab : 'overview';
      await loadPane(key, true); ST.loaded[key] = true;
    } catch (e) { if (wrap) wrap.classList.remove('ps-loading'); toast(errMsg(e), 'error'); }
  }
  window.ppPeriod = async function (p) {
    if (!ST || !PSHORT[p]) return;
    PRange.state.period = p; PRange.state.from = PRange.state.to = null;
    return reloadStats();
  };
  window.ppCustom = async function (from, to) {
    if (!ST) return;
    PRange.state.period = 'custom'; PRange.state.from = from; PRange.state.to = to;
    return reloadStats();
  };
  async function ppRefresh(tabKey) {
    const id = ST.id; await go('prodf', id);
    setTimeout(() => { const b = document.querySelector('[data-pp-tab="' + tabKey + '"]'); if (b) b.click(); }, 60);
  }
  window.ppRefresh = ppRefresh;

  // Export PDF : 'all' = fiche complète ; sinon l'onglet affiché (même période et mêmes filtres que l'écran)
  window.ppPdf = function (sec) {
    if (!ST) return;
    const tabBtn = document.querySelector('.pp-tabs button.on');
    const key = sec || (tabBtn && tabBtn.dataset.ppTab) || 'overview';
    const qs = new URLSearchParams(PRange.query());
    if (key !== 'all') qs.set('section', key);
    if (key === 'stock' && ST.filters) ['kind', 'from', 'to'].forEach(k => { if (ST.filters[k]) qs.set(k, ST.filters[k]); });
    if (typeof dlFile !== 'function') return;
    dlFile('/products/' + ST.id + '/profile.pdf?' + qs.toString(), 'fiche-produit-' + ST.id + (key === 'all' ? '' : '-' + key) + '-' + PERIOD)
      .catch(e => toast((e && e.message) || 'Export PDF impossible', 'error'));
  };

  // ---------- Vue ----------
  VM.prodf = async function () {
    const id = Number(arg); if (!Number.isInteger(id) || id < 1) return '<p class="warn">Produit invalide.</p>';
    const st = await G('/products/' + id + '/profile?' + PRange.query());
    if (st.meta) { PRange.sync(st.meta); PERIOD = PRange.key(); }
    ST = { id, stats: st, prices: null, supply: null, stock: null, supplyView: 'all', filters: { kind: '', from: '', to: '' }, loaded: { overview: true } };
    Object.keys(CH).forEach(k => { (CH[k] || []).forEach(c => { try { c.destroy(); } catch (_) { /* déjà détruit */ } }); CH[k] = []; });
    const items = tabsDef();
    return `<div class="pp-page" data-pid="${id}">${identity(st)}${tabsBar(items)}<div class="pp-pdfbar"><button type="button" class="b2" onclick="ppPdf()" title="Exporter en PDF l'onglet affiché">📄 PDF de l'onglet affiché</button><button type="button" class="b2" onclick="ppPdf('all')" title="Exporter toute la fiche produit en PDF">📄 PDF complet du produit</button></div>${items.map((t, i) => pane(t[0], i === 0, i === 0 ? overview(st) : loading)).join('')}</div>`;
  };
  if (typeof NAVOF !== 'undefined') NAVOF.prodf = 'prod';
  if (typeof TITLES !== 'undefined') TITLES.prodf = 'Fiche produit';

  // La liste des produits ouvre désormais la fiche complète (la modification reste dans la fiche).
  const oldProd = VM.prod;
  if (typeof oldProd === 'function') {
    VM.prod = async function () {
      const html = await oldProd();
      if (typeof html !== 'string' || !Array.isArray(PSC)) return html;
      return html.replace(/<tbody>([\s\S]*?)<\/tbody>/, (m0, inner) => {
        let i = 0;
        return '<tbody>' + inner.replace(/<tr\b[^>]*>/g, () => { const p = PSC[i++]; return p ? `<tr class="pp-row" onclick="go('prodf',${Number(p.id)})" title="Ouvrir la fiche du produit">` : '<tr>'; }) + '</tbody>';
      });
    };
  }
})();
