/* ext-multistation-views.js — Vue consolidée, Vue par station, Archivage mensuel.
   Aucune donnée n'est calculée ici : tout provient de /api/stations/consolidated, /api/stations/by-station
   et /api/exports/archive/monthly (voir src/multistation_views.js et src/monthly_archive.js, qui listent leurs tables sources). */
(function () {
  'use strict';
  if (typeof V === 'undefined' || typeof VM === 'undefined') return;

  V.consolidee = ['Vue consolidée', 'report.view|finance.view'];
  V.parstation = ['Vue par station', 'report.view|finance.view'];
  V.archive = ['Archivage mensuel', 'report.view|finance.view'];
  if (typeof NAV_ICONS !== 'undefined') { NAV_ICONS.consolidee = '🏢'; NAV_ICONS.parstation = '⛽'; NAV_ICONS.archive = '🗄️'; }

  const css = document.createElement('style');
  css.textContent = `
  .msv-bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:0 0 14px}
  .msv-bar input[type=date],.msv-bar input[type=month]{width:auto}
  .msv-grid{display:grid;gap:12px;margin-bottom:12px}
  .msv-g4{grid-template-columns:repeat(auto-fit,minmax(210px,1fr))}
  .msv-g3{grid-template-columns:repeat(auto-fit,minmax(280px,1fr))}
  .msv-g2{grid-template-columns:repeat(auto-fit,minmax(340px,1fr))}
  .msv-sm{width:40px!important;height:40px!important;flex:none}.msv-sm svg{width:20px!important;height:20px!important}
  .msv-m{display:flex;gap:10px;align-items:center;min-width:0}
  .msv-k small{display:block;color:var(--m)}
  .msv-k b{display:block;font-size:1.45rem;margin:4px 0;letter-spacing:-.02em}
  .msv-up{color:#16a34a}.msv-down{color:#dc2626}.msv-na{color:var(--m)}
  .msv-gauge-row{display:flex;justify-content:space-between;gap:8px;font-size:13px;padding:4px 0;border-bottom:1px solid var(--bd)}
  .msv-gauge-row:last-child{border-bottom:0}
  .msv-donut-wrap{display:flex;gap:18px;align-items:center;flex-wrap:wrap}
  .msv-legend{display:grid;gap:6px;font-size:13px}.msv-legend i{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:8px}
  .msv-health{width:100%;border-collapse:collapse;font-size:13px}.msv-health th,.msv-health td{padding:6px 8px;text-align:center}.msv-health th:first-child,.msv-health td:first-child{text-align:left}
  .msv-dot{display:inline-block;width:12px;height:12px;border-radius:50%;cursor:help}
  .msv-ok{background:#16a34a}.msv-warn{background:#f59e0b}.msv-crit{background:#dc2626}.msv-none{background:var(--bd)}
  .msv-st{display:grid;grid-template-columns:84px repeat(4,minmax(150px,1fr)) minmax(230px,auto);gap:16px;align-items:center;padding:18px 18px 18px 20px;margin-bottom:14px;border-left:6px solid var(--msv-acc,#2563eb);background:linear-gradient(120deg,color-mix(in srgb,var(--msv-acc,#2563eb) 9%,transparent),transparent 55%)}
  .msv-logo{width:72px;height:72px;border-radius:16px;object-fit:contain;background:#fff;border:1px solid var(--bd);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:1.2rem;color:var(--m);box-shadow:0 2px 8px rgba(15,23,42,.08)}
  .msv-tanks{display:flex;gap:12px;align-items:flex-end;justify-content:flex-end}
  .msv-tank{width:58px;text-align:center;font-size:11px;font-weight:700;color:var(--m);letter-spacing:.02em}
  .msv-tube{height:130px;border:2px solid color-mix(in srgb,var(--tc,#64748b) 55%,var(--bd));border-radius:10px 10px 14px 14px;position:relative;overflow:hidden;background:linear-gradient(90deg,rgba(255,255,255,.55),rgba(148,163,184,.12) 45%,rgba(148,163,184,.22));margin-bottom:6px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.5),0 4px 10px color-mix(in srgb,var(--tc,#64748b) 28%,transparent)}
  .msv-tube i{position:absolute;left:0;right:0;bottom:0;display:block;background:linear-gradient(90deg,color-mix(in srgb,var(--tc,#64748b) 80%,#fff) 0,var(--tc,#64748b) 40%,color-mix(in srgb,var(--tc,#64748b) 78%,#000) 100%);border-top:3px solid color-mix(in srgb,var(--tc,#64748b) 55%,#fff);transition:height .6s ease}
  .msv-tube::after{content:"";position:absolute;top:6px;bottom:6px;left:7px;width:7px;border-radius:6px;background:linear-gradient(180deg,rgba(255,255,255,.75),rgba(255,255,255,.05));pointer-events:none}
  .msv-tube b{position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);z-index:2;font-size:13px;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.65);pointer-events:none}
  .msv-tube.na{background:repeating-linear-gradient(45deg,transparent 0 6px,var(--bd) 6px 7px)}
  .msv-tube.na b{color:var(--m);text-shadow:none;font-weight:600;font-size:11px}
  .msv-m{padding:10px 12px;border-radius:14px;background:color-mix(in srgb,var(--msv-mc,#16a34a) 10%,transparent);border:1px solid color-mix(in srgb,var(--msv-mc,#16a34a) 24%,transparent)}
  .msv-m.green{--msv-mc:#16a34a}.msv-m.amber{--msv-mc:#f59e0b}.msv-m.blue{--msv-mc:#2563eb}.msv-m.purple{--msv-mc:#9333ea}
  .msv-open{text-align:right}
  .msv-name{font-weight:700;font-size:15px;margin-bottom:10px;text-align:right}
  .msv-k{min-width:0;flex:1 1 auto}.msv-k b{white-space:nowrap}
  @media(max-width:1100px){.msv-open{text-align:left}.msv-st{grid-template-columns:repeat(2,minmax(0,1fr))}.msv-logo{grid-column:1/-1;justify-self:start}.msv-nm{grid-column:1/-1;order:1}.msv-st>.agg-chips{grid-column:1/-1;order:3}.msv-st>.msv-m{order:2}.msv-name{text-align:left}.msv-tanks{justify-content:flex-start;flex-wrap:wrap}}
  @media(max-width:700px){
    .msv-st{gap:10px;padding:14px 12px 14px 14px}
    .msv-logo{width:56px;height:56px;border-radius:14px}
    .msv-m{flex-direction:column;align-items:flex-start;gap:6px;padding:10px}
    .msv-m .dv2-ico,.msv-m .msv-sm{width:32px!important;height:32px!important}.msv-m .msv-sm svg{width:16px!important;height:16px!important}
    .msv-k{width:100%}.msv-k small{font-size:11.5px;line-height:1.25;overflow-wrap:break-word;hyphens:auto}
    .msv-k b{font-size:clamp(.95rem,4.6vw,1.25rem);margin:2px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .msv-name{font-size:16px;margin-bottom:6px}
    .msv-tank{width:52px}.msv-tube{height:110px}
  }
  .msv-range{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:8px 12px;border:1px solid var(--bd);border-radius:12px}
  .msv-range input[type=date]{width:auto}
  .msv-tag{display:inline-block;padding:2px 10px;border-radius:999px;background:rgba(37,99,235,.12);color:#2563eb;font-size:12px;font-weight:600}
  .msv-src{font-size:12px;color:var(--m);margin-top:10px}.msv-src summary{cursor:pointer}
  .msv-warnbox{padding:8px 12px;border-radius:8px;border:1px solid #f59e0b;background:rgba(245,158,11,.12);margin:0 0 12px;font-size:13px}
  .msv-arch li{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid var(--bd)}
  .msv-arch ol{list-style:none;padding:0;margin:0}
  `;
  document.head.appendChild(css);


  /* Icônes des agrégats : mêmes pastilles que le tableau de bord (.dv2-ico.green|blue|purple|amber). */
  const IC = {
    'trending-up': '<path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    'calendar-days': '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>',
    'calendar-check': '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18m-12 6 2 2 4-4"/>',
    'bar-chart': '<path d="M3 3v18h18"/><path d="M7 16v-5M12 16V7M17 16v-8"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM20 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
    truck: '<path d="M10 17h4V5H2v12h3"/><path d="M14 8h4l4 4v5h-3"/><circle cx="7.5" cy="17.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
    droplet: '<path d="M12 22a8 8 0 0 0 8-8c0-4-8-13-8-13S4 10 4 14a8 8 0 0 0 8 8z"/>',
    'pie-chart': '<path d="M21.2 15.9A10 10 0 1 1 8 2.8"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>',
    activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    wallet: '<rect x="2" y="5" width="20" height="16" rx="2"/><path d="M2 9h20M16 15h2M5 5V3h14"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    receipt: '<path d="M4 2v20l4-2 4 2 4-2 4 2V2l-4 2-4-2-4 2zM8 8h8M8 12h8M8 16h4"/>',
    bag: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
    layers: '<path d="m12 2 10 5-10 5L2 7zM2 12l10 5 10-5M2 17l10 5 10-5"/>',
    archive: '<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8"/>'
  };
  const svg = (n, sz) => `<svg viewBox="0 0 24 24" width="${sz || 22}" height="${sz || 22}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[n] || IC['trending-up']}</svg>`;
  const chip = (color, n, small) => `<div class="dv2-ico ${color}${small ? ' msv-sm' : ''}" aria-hidden="true">${svg(n, small ? 20 : 24)}</div>`;
  const kpi = (color, icon, label, val, sub) => `<div class="dv2-kpi"><div class="dv2-ico ${color}" aria-hidden="true">${svg(icon, 24)}</div><div style="min-width:0;flex:1"><small>${label}</small><span class="val">${val}</span>${sub || ''}</div></div>`;
  const h3i = (color, icon, text) => `<h3 style="margin-top:0;display:flex;align-items:center;gap:10px">${chip(color, icon, true)}<span>${text}</span></h3>`;

  const nf = (n, d) => (typeof nfr === 'function' ? nfr(n, d) : Number(n || 0).toLocaleString('fr-FR', { maximumFractionDigits: d }));
  const compact = (n, cur) => {
    const a = Math.abs(Number(n) || 0), c = cur ? ' ' + esc(cur) : '';
    if (a >= 1e6) return nf(n / 1e6, 1) + ' M' + c;
    if (a >= 1e3) return nf(n / 1e3, 1) + ' k' + c;
    return nf(n, 0) + c;
  };
  const varHtml = (v, label) => v == null
    ? `<small class="msv-na">${label} : n/d (période précédente à zéro)</small>`
    : `<small class="${v >= 0 ? 'msv-up' : 'msv-down'}">${v >= 0 ? '+' : '−'}${nf(Math.abs(v), 2)} % par rapport à ${label}</small>`;
  const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
  const state = { date: null, month: null, from: null, to: null, data: null };
  const dateBar = (view) => `<div class="msv-bar"><label style="margin:0">Date de référence <input type="date" value="${esc(state.date || today())}" max="${today()}" onchange="msvSetDate('${view}',this.value)"></label>
    <button class="b2" onclick="go('${view}')">Actualiser</button></div>`;
  const isDay = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const fd = v => (isDay(v) ? new Date(v + 'T00:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—');
  const rangeBar = () => `<div class="msv-bar">
      <label style="margin:0">Date de référence <input type="date" value="${esc(state.date || today())}" max="${today()}" onchange="msvSetDate('consolidee',this.value)" ${state.from && state.to ? 'disabled title="Ignorée : une période est active"' : ''}></label>
      <div class="msv-range" role="group" aria-label="Filtre entre deux dates">
        <label style="margin:0">Du <input type="date" id="msv-from" value="${esc(state.from || '')}" max="${today()}"></label>
        <label style="margin:0">au <input type="date" id="msv-to" value="${esc(state.to || '')}" max="${today()}"></label>
        <button type="button" onclick="msvApplyRange()">Appliquer</button>
        ${state.from && state.to ? '<button type="button" class="b2" onclick="msvClearRange()">Effacer la période</button>' : ''}
      </div>
      <button class="b2" onclick="go('consolidee')">Actualiser</button>
      <button type="button" onclick="msvExportPdf()" title="Exporter la vue affichée en PDF">📄 Exporter en PDF</button></div>`;
  window.msvApplyRange = () => {
    const a = (document.getElementById('msv-from') || {}).value, b = (document.getElementById('msv-to') || {}).value;
    if (!isDay(a) || !isDay(b)) return toast('Choisissez les deux dates de la période.', 'error');
    if (a > b) return toast('La date de début doit précéder la date de fin.', 'error');
    if (b > today()) return toast('La date de fin ne peut pas être dans le futur.', 'error');
    state.from = a; state.to = b; go('consolidee');
  };
  window.msvClearRange = () => { state.from = state.to = null; go('consolidee'); };
  window.msvSetDate = (view, v) => { state.date = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null; go(view); };

  const q = (path, date, range) => G(path + (range && range.from && range.to ? '?from=' + encodeURIComponent(range.from) + '&to=' + encodeURIComponent(range.to) : date ? '?date=' + encodeURIComponent(date) : ''));
  const sourcesBox = list => `<details class="msv-src"><summary>Sources des données</summary><ul>${list.map(s => `<li>${esc(s)}</li>`).join('')}</ul></details>`;
  const NO_ACCESS = '<p class="msv-na">Non affiché : droits ou module de contrat insuffisants pour cette rubrique.</p>';

  /* ---------------- Vue consolidée ---------------- */
  const donut = items => {
    const colors = ['#2563eb', '#16a34a', '#f59e0b', '#ea580c', '#9333ea', '#0891b2', '#db2777', '#64748b'];
    const total = items.reduce((a, x) => a + (x.ht || 0), 0);
    if (!(total > 0)) return '<p class="msv-na">Aucun CA HT sur la période.</p>';
    const R = 52, C = 2 * Math.PI * R; let off = 0;
    const arcs = items.map((x, i) => { const len = (x.ht / total) * C, s = `<circle r="${R}" cx="70" cy="70" fill="none" stroke="${colors[i % colors.length]}" stroke-width="22" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" transform="rotate(-90 70 70)"><title>${esc(x.name)}</title></circle>`; off += len; return s; }).join('');
    return `<div class="msv-donut-wrap"><svg viewBox="0 0 140 140" width="150" height="150" role="img" aria-label="Répartition du CA HT par station">${arcs}</svg>
      <div class="msv-legend">${items.map((x, i) => `<div><i style="background:${colors[i % colors.length]}"></i>${esc(x.name)} <b style="float:right;margin-left:14px">${x.pct == null ? '—' : nf(x.pct, 1) + ' %'}</b></div>`).join('')}</div></div>`;
  };
  const dot = h => !h ? '<span class="msv-dot msv-none" title="Non affiché (droits ou module)"></span>'
    : `<span class="msv-dot msv-${h.level}" title="${esc(h.reasons.length ? h.reasons.join(' • ') : 'Aucun point d\'attention')}"></span>`;

  async function vConsolidee() {
    const d = await q('/stations/consolidated', state.date, { from: state.from, to: state.to });
    state.data = d; state.agg = null;
    setTimeout(() => { if (window.Agg && d.as_of) Agg.mount('msv-agg', { scope: 'all', from: d.range ? d.range.from : d.as_of.slice(0, 8) + '01', to: d.as_of, title: 'Indicateurs détaillés — toutes les stations', onData: x => { state.agg = x; } }); }, 40);
    if (!d.stations_total && !d.ca_ttc) return '<p class="warn">Aucune station accessible.</p>';
    const cur = d.mixed_currency ? '' : (d.currencies[0] || '');
    const warn = [];
    if (d.mixed_currency) warn.push(`Vos stations n'ont pas la même devise (${d.currencies.map(esc).join(', ')}) : les totaux additionnent des montants sans conversion.`);
    const hid = d.hidden || {};
    if (hid.sales) warn.push(`${hid.sales} station(s) exclue(s) du CA : droits insuffisants sur ces stations.`);
    const ca = d.ca_ttc, mo = new Date(d.as_of + 'T00:00:00').toLocaleDateString('fr-FR', { month: 'long' }), rg = d.range;
    const perLabel = rg ? `du ${fd(rg.from)} au ${fd(rg.to)}` : '';
    const kd = (color, icon, title, o, lab, extra) => kpi(color, icon, title, compact(o.value, cur), lab ? varHtml(o.variation_pct, lab) : `<small>${extra}</small>`);
    const kperiod = ca && rg && ca.period ? kpi('blue', 'calendar-check', `CA TTC de la période : ${perLabel}`, compact(ca.period.value, cur), varHtml(ca.period.variation_pct, `la période précédente (${rg.days} j)`)) : '';
    const kpis = ca ? `<div class="msv-grid msv-g4">
        ${kperiod}
        ${kd('green', 'trending-up', `CA TTC du jour : ${esc(d.as_of.slice(8, 10) + '-' + d.as_of.slice(5, 7))}`, ca.day, 'J-1')}
        ${kd('blue', 'calendar', `CA TTC de la semaine : Semaine ${d.period_labels.iso_week}`, ca.week, 'S-1')}
        ${kd('purple', 'calendar-days', `CA TTC du mois : ${esc(mo)}`, ca.month, 'M-1')}
        ${kd('amber', 'bar-chart', `CA TTC de l'année : ${d.period_labels.year}`, ca.year, null, '* Cumulatif')}</div>` : NO_ACCESS;
    const rec = d.receivables ? kpi('blue', 'users', 'Créances clients', compact(d.receivables.amount, cur), `<small>${d.receivables.customers} client(s) avec un solde positif</small>`) : kpi('blue', 'users', 'Créances clients', '', NO_ACCESS);
    const pay = d.payables ? kpi('amber', 'truck', 'Dettes fournisseurs', compact(d.payables.amount, cur), `<small>${d.payables.suppliers} fournisseur(s) avec un solde à payer</small>`) : kpi('amber', 'truck', 'Dettes fournisseurs', '', NO_ACCESS);
    const gRows = d.gauging ? (d.gauging.items.length ? d.gauging.items.map(g => `<div class="msv-gauge-row"><span>${esc(g.name)}</span><span class="${g.gap_liters < 0 ? 'msv-down' : 'msv-up'}">${g.gap_liters > 0 ? '+' : g.gap_liters < 0 ? '−' : ''}${nf(Math.abs(g.gap_liters), 0)} L</span><span class="${g.gap_liters < 0 ? 'msv-down' : 'msv-up'}">${g.pct_of_sales == null ? 'n/d' : (g.pct_of_sales > 0 ? '+' : g.pct_of_sales < 0 ? '−' : '') + nf(Math.abs(g.pct_of_sales), 1) + ' %'}</span></div>`).join('') : '<small>Aucun inventaire physique enregistré ce mois-ci.</small>') : NO_ACCESS;
    const gz = kpi('purple', 'droplet', `Écarts jaugeage — ${rg ? perLabel : esc(mo)} (% ventes)`, '', `<div style="margin-top:4px">${gRows}</div>`);
    const share = d.ht_share ? donut(d.ht_share.items) : NO_ACCESS;
    const hs = d.health.stations;
    const health = `<table class="msv-health"><thead><tr><th>Station</th><th>Stock</th><th>Finance</th><th>Opérations</th></tr></thead><tbody>${hs.map(s => `<tr><td>${esc(s.name)}</td><td>${dot(s.stock)}</td><td>${dot(s.finance)}</td><td>${dot(s.ops)}</td></tr>`).join('')}</tbody></table>
      <details class="msv-src"><summary>Règles des feux (survolez un point pour voir le motif)</summary><ul>
        <li>Stock : rouge si une cuve est vide, sous son seuil mini ou à ${d.health.thresholds.fuel_level_crit_pct} % ou moins ; orange jusqu'à ${d.health.thresholds.fuel_level_warn_pct} % ou si des produits sont sous leur seuil.</li>
        <li>Finance : écarts de caisse des 7 derniers jours rapportés au CA (orange &gt; ${d.health.thresholds.cash_gap_warn_pct} %, rouge &gt; ${d.health.thresholds.cash_gap_crit_pct} %) ; orange si un client dépasse son plafond de crédit.</li>
        <li>Opérations : rouge si un quart reste ouvert plus de ${d.health.thresholds.open_shift_crit_hours} h ou ≥ ${d.health.thresholds.anomalies_crit} anomalies sur 7 jours ; orange si anomalie ou aucun quart saisi hier.</li></ul></details>`;
    return `<h2 style="margin-top:0">Vue consolidée – Toutes les stations</h2>
      ${rangeBar()}
      ${rg ? `<p class="msv-na" style="margin:0 0 10px"><span class="msv-tag">Période active : ${perLabel}</span> · jour, semaine, mois et année restent calculés à la date de fin ; la répartition HT et les écarts de jaugeage portent sur la période.</p>` : ''}
      ${warn.map(w => `<div class="msv-warnbox">${w}</div>`).join('')}
      ${kpis}
      <div class="msv-grid msv-g3">${rec}${pay}${gz}</div>
      <div class="msv-grid msv-g2">
        <div class="card">${h3i('green', 'pie-chart', 'Répartition du CA HT par station — ' + (rg ? perLabel : esc(new Date(d.as_of + 'T00:00:00').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }))))}${share}</div>
        <div class="card">${h3i('blue', 'activity', 'État de santé des stations')}${health}</div>
      </div>
      <div class="card" id="msv-agg" style="margin-bottom:12px"></div>
      ${sourcesBox([
        'CA TTC : même définition que le tableau de bord — ventes produits (sales) + carburant des compteurs des quarts clos (meter_readings) + carburant déclaré des quarts ouverts. Comparaisons à périodes équivalentes (S-1 : mêmes jours de la semaine précédente ; M-1 : même jour du mois précédent).',
        'CA HT : même assiette, TVA par ligne de vente (sale_details.tax_rate) et taux du produit pour les compteurs.',
        'Créances clients : somme des soldes positifs (customers.balance). Dettes fournisseurs : suppliers.balance_due positif.',
        'Écarts de jaugeage : shift_stock_counts.gap (physique − théorique) des carburants des quarts clos du mois, rapporté aux litres des compteurs (meter_readings.liters).',
        'Santé : niveaux de stock/cuves (stock, tanks), écarts de caisse (shifts.cash_gap), anomalies (shift_anomalies), plafonds de crédit (customers.credit_limit), quarts (shifts).'])}`;
  }


  /* ---------------- Export PDF de la Vue consolidée (même moteur que les autres rapports : /api/docs/render) ---------------- */
  const LVL = { ok: 'OK', warn: 'Vigilance', crit: 'Critique' };
  const pdfVar = (v, lab) => (v == null ? 'n/d (' + lab + ' à zéro)' : (v >= 0 ? '+' : '−') + nf(Math.abs(v), 2) + ' % vs ' + lab);
  window.msvExportPdf = async () => {
    const d = state.data;
    if (!d || !d.stations_total) return toast('Rien à exporter : aucune donnée affichée.', 'info');
    const cur = d.mixed_currency ? '' : (d.currencies[0] || '');
    const m = v => nf(v, 0) + (cur ? ' ' + cur : '');
    const rg = d.range, per = rg ? `du ${fd(rg.from)} au ${fd(rg.to)}` : '';
    const mo = new Date(d.as_of + 'T00:00:00').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    const sections = [];
    if (d.mixed_currency) sections.push({ type: 'text', title: 'Attention', text: `Les stations n'ont pas la même devise (${d.currencies.join(', ')}) : les totaux additionnent des montants sans conversion.` });
    const ca = d.ca_ttc;
    if (ca) {
      const items = [];
      if (rg && ca.period) items.push({ label: `CA TTC de la période (${per})`, value: m(ca.period.value), note: pdfVar(ca.period.variation_pct, `période précédente (${rg.days} j)`) });
      items.push({ label: `CA TTC du jour (${fd(d.as_of)})`, value: m(ca.day.value), note: pdfVar(ca.day.variation_pct, 'J-1') });
      items.push({ label: `CA TTC de la semaine ${d.period_labels.iso_week}`, value: m(ca.week.value), note: pdfVar(ca.week.variation_pct, 'S-1') });
      items.push({ label: 'CA TTC du mois', value: m(ca.month.value), note: pdfVar(ca.month.variation_pct, 'M-1') });
      items.push({ label: `CA TTC de l'année ${d.period_labels.year}`, value: m(ca.year.value), note: 'Cumulatif' });
      sections.push({ type: 'kpis', title: "Chiffre d'affaires TTC", items });
    }
    const soldes = [];
    if (d.receivables) soldes.push({ label: 'Créances clients', value: m(d.receivables.amount), note: d.receivables.customers + ' client(s) avec un solde positif' });
    if (d.payables) soldes.push({ label: 'Dettes fournisseurs', value: m(d.payables.amount), note: d.payables.suppliers + ' fournisseur(s) avec un solde à payer' });
    if (soldes.length) sections.push({ type: 'kpis', title: 'Créances et dettes (situation à ce jour)', items: soldes });
    if (d.ht_share && d.ht_share.items.length) sections.push({ type: 'table', title: 'Répartition du CA HT par station — ' + (rg ? per : mo), head: ['Station', 'CA HT', 'Part'], rows: d.ht_share.items.map(x => [x.name, m(x.ht), x.pct == null ? '—' : nf(x.pct, 1) + ' %']) });
    if (d.gauging) {
      sections.push(d.gauging.items.length
        ? { type: 'table', title: 'Écarts de jaugeage — ' + (rg ? per : mo), head: ['Carburant', 'Écart (L)', '% des ventes'], rows: d.gauging.items.map(g => [g.name, (g.gap_liters > 0 ? '+' : g.gap_liters < 0 ? '−' : '') + nf(Math.abs(g.gap_liters), 0), g.pct_of_sales == null ? 'n/d' : (g.pct_of_sales > 0 ? '+' : g.pct_of_sales < 0 ? '−' : '') + nf(Math.abs(g.pct_of_sales), 1) + ' %']) }
        : { type: 'text', title: 'Écarts de jaugeage — ' + (rg ? per : mo), text: 'Aucun inventaire physique enregistré sur la période.' });
    }
    const cell = h => (h ? LVL[h.level] + (h.reasons && h.reasons.length ? ' — ' + h.reasons.join(' ; ') : '') : 'Non affiché');
    sections.push({ type: 'table', title: 'État de santé des stations', head: ['Station', 'Stock', 'Finance', 'Opérations'], rows: d.health.stations.map(s => [s.name, cell(s.stock), cell(s.finance), cell(s.ops)]) });
    if (window.Agg && state.agg) Agg.pdfSections(state.agg, 'Agrégats').forEach(x => sections.push(x));
    const sub = rg ? `Période ${per} — toutes les stations` : `Situation au ${fd(d.as_of)} — toutes les stations`;
    if (typeof brandedPdf !== 'function') return toast('Module PDF indisponible.', 'error');
    await brandedPdf({ title: 'Vue consolidée', subtitle: sub, sections, landscape: true, filename: 'Vue_consolidee_' + (rg ? rg.from + '_' + rg.to : d.as_of), signatures: [{ label: 'Établi par' }, { label: 'Direction' }] });
  };

  /* ---------------- Vue par station ---------------- */
  const cache = {};
  /* Période propre à « Vue par station » : un seul jour (comportement historique) ou « du … au … » (CA, espèces et quarts cumulés). */
  const ps = { code: 'today', a: null, b: null };
  const psRange = c => (c === 'custom' && ps.a && ps.b ? [ps.a, ps.b] : (typeof range === 'function' ? range(c === 'custom' ? 'today' : c) : [today(), today()]));
  const psBar = () => `<div class="msv-bar"><div class="dv2-pill" style="display:inline-flex;align-items:center;gap:10px;background:var(--c);border:1px solid var(--bd);border-radius:12px;padding:8px 14px"><span style="color:var(--m);font-size:13px">Période</span>${window.DashRange ? DashRange.html({ get: () => ps.code, rng: psRange, set: (c, x, y) => { ps.code = c; ps.a = x; ps.b = y; go('parstation'); } }) : `<input type="date" value="${esc(state.date || today())}" max="${today()}" onchange="msvSetDate('parstation',this.value)">`}</div>
    <button class="b2" onclick="go('parstation')">Actualiser</button></div>`;
  async function hydrateLogos() {
    for (const el of document.querySelectorAll('[data-msv-logo]')) {
      const id = el.getAttribute('data-msv-logo');
      try {
        if (!cache[id]) {
          const r = await fetch('/api/stations/' + encodeURIComponent(id) + '/logo', { headers: { Authorization: 'Bearer ' + TK, 'X-Station-Id': SID } });
          if (!r.ok) throw 0; cache[id] = URL.createObjectURL(await r.blob());
        }
        el.innerHTML = `<img src="${cache[id]}" alt="" style="max-width:100%;max-height:100%">`;
      } catch (_) { /* repli : initiales déjà affichées */ }
    }
  }
  const tank = t => {
    const pct = t.level_pct, col = esc(t.color || '#64748b');
    const fill = pct == null ? '' : `<i style="height:${pct}%"></i>`;
    const lab = pct == null ? '<b>n/d</b>' : `<b>${nf(pct, 0)} %</b>`;
    return `<div class="msv-tank" style="--tc:${col}" title="${esc(t.name)} : ${nf(t.quantity, 0)} ${esc(t.unit)}${t.capacity ? ' / ' + nf(t.capacity, 0) + ' ' + esc(t.unit) + ' (' + pct + ' %)' : ' — capacité de cuve non renseignée'}">
      <div class="msv-tube${pct == null ? ' na' : ''}">${fill}${lab}</div>${esc(t.short)}</div>`;
  };
  const ACC = ['#2563eb', '#16a34a', '#f59e0b', '#9333ea', '#0891b2', '#db2777', '#ea580c'];
  /* Agrégats du jour (ou de la période) par station (puces) : chaque puce porte sa formule et ses sources en infobulle, liste complète en bas de page. */
  const EXTRA_KEYS = ['tx_n', 'avg_basket', 'liters', 'cancel_n', 'pay_credit', 'cash_gap_net', 'anomalies_n', 'shifts_closed', 'expenses_total', 'purchases_total', 'low_stock_n', 'overdue_amount'];
  async function fillExtras(from, to) {
    if (!window.Agg) return;
    try {
      const a = await Agg.fetch({ scope: 'all', from, to, byStation: true });
      (a.stations || []).forEach(st => {
        const host = document.querySelector(`[data-msv-extra="${Number(st.id)}"]`); if (!host) return;
        const html = Agg.chips(st.values, a.catalog, EXTRA_KEYS, st.currency);
        host.innerHTML = html || '<span class="msv-na">Aucun agrégat accessible pour cette station.</span>';
      });
      const src = document.getElementById('msv-agg-src'); if (src) src.innerHTML = Agg.sourcesList(a.catalog, EXTRA_KEYS);
    } catch (e) {
      document.querySelectorAll('[data-msv-extra]').forEach(h => { h.innerHTML = `<span class="msv-na">Agrégats indisponibles : ${esc((e && e.message) || e)}</span>`; });
    }
  }
  async function vParStation() {
    const [pa, pb] = window.DashRange ? psRange(ps.code) : [state.date || today(), state.date || today()];
    const multiDay = pa !== pb;
    const d = await q('/stations/by-station', multiDay ? null : pa, multiDay ? { from: pa, to: pb } : null);
    const rg = d.range, perTxt = rg ? `du ${fd(rg.from)} au ${fd(rg.to)}` : '', vsLab = rg ? `la période précédente (${rg.days} j)` : 'J-1';
    const cards = d.stations.map((s, i) => {
      const m = (color, icon, title, body) => `<div class="msv-m ${color}">${chip(color, icon, true)}<div class="msv-k" style="min-width:0"><small>${title}</small>${body}</div></div>`;
      const ca = s.ca_ttc ? m('green', 'trending-up', rg ? `CA TTC de la période : ${perTxt}` : `CA TTC du jour : ${esc(d.as_of.slice(8, 10) + '-' + d.as_of.slice(5, 7))}`, `<b>${compact(s.ca_ttc.value, s.currency)}</b>${varHtml(s.ca_ttc.variation_pct, vsLab)}`) : m('green', 'trending-up', rg ? 'CA TTC de la période' : 'CA TTC du jour', NO_ACCESS);
      const cash = s.cash ? m('amber', 'wallet', 'Encaissement Espèces', `<b>${compact(s.cash.value, s.currency)}</b>${varHtml(s.cash.variation_pct, vsLab)}`) : m('amber', 'wallet', 'Encaissement Espèces', NO_ACCESS);
      const sh = s.shifts ? m('blue', 'clock', rg ? 'Quarts saisis sur la période' : 'Quarts saisis', rg ? `<b>${s.shifts.period}</b><small>quart(s) du ${fd(rg.from)} au ${fd(rg.to)}</small>` : `<b>${s.shifts.today}</b><small>${s.shifts.yesterday} saisie(s) hier</small>`) : m('blue', 'clock', 'Quarts saisis', NO_ACCESS);
      const cu = s.customers_balance ? m('purple', 'users', 'Solde total clients', `<b>${compact(s.customers_balance.amount, s.currency)}</b><small>${s.customers_balance.customers} client(s) débiteur(s)</small>`) : m('purple', 'users', 'Solde total clients', NO_ACCESS);
      const tanks = s.tanks ? (s.tanks.length ? s.tanks.map(tank).join('') : '<small class="msv-na">Aucun carburant</small>') : '';
      return `<div class="card msv-st" style="--msv-acc:${ACC[i % ACC.length]}"><div class="msv-logo" data-msv-logo="${Number(s.id)}">${s.has_logo ? '' : esc(String(s.name).split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase())}</div>
        ${ca}${cash}${sh}${cu}
        <div class="msv-nm"><div class="msv-name">${esc(s.name)}${s.is_current ? ' <span class="tag">Active</span>' : ''}</div><div class="msv-tanks">${tanks}</div>
        <div class="msv-open" style="margin-top:10px"><button class="b2" onclick="msvOpen(${Number(s.id)})">Ouvrir le tableau de bord</button></div></div>
        <div class="agg-chips" data-msv-extra="${Number(s.id)}"><span class="msv-na">Chargement des agrégats…</span></div></div>`;
    }).join('');
    setTimeout(hydrateLogos, 0);
    setTimeout(() => fillExtras(rg ? rg.from : d.as_of, rg ? rg.to : d.as_of), 0);
    return `<h2 style="margin-top:0">Vue par station</h2>${psBar()}
      ${cards || '<p class="warn">Aucune station accessible.</p>'}
      <div id="msv-agg-src"></div>
      ${sourcesBox([
        'CA TTC : même définition que le tableau de bord (ventes produits + compteurs des quarts clos + carburant déclaré des quarts ouverts).',
        'Encaissement Espèces : payments (mode « espèces ») du jour, rattachés à des ventes valides ou à la clôture de quart.',
        'Quarts saisis : shifts (ouverts ou clos) par date de quart. Solde total clients : somme des soldes positifs (customers.balance).',
        'Cuves : stock comptable (stock.quantity) moins les litres déjà vendus dans le quart ouvert, rapporté à la capacité (tanks.capacity_liters). Sans capacité renseignée, la jauge est hachurée : aucun niveau n\'est inventé.'])}`;
  }
  window.msvOpen = async id => { try { await chSt(id); go('dash'); } catch (e) { toast(errMsg(e)); } };

  /* ---------------- Archivage mensuel ---------------- */
  async function vArchive() {
    if (!state.month) state.month = today().slice(0, 7);
    let sum = null, err = '';
    try { sum = await G('/exports/archive/monthly/summary?month=' + encodeURIComponent(state.month)); } catch (e) { err = errMsg(e); }
    const AI = { days: ['green', 'calendar-check'], purchases: ['amber', 'bag'], customers: ['blue', 'receipt'], expenses: ['purple', 'wallet'], thirds: ['blue', 'users'], misc: ['green', 'layers'] };
    const list = sum ? sum.folders.map((f, i) => `<li><span style="display:flex;align-items:center;gap:10px">${chip(...(AI[f.key] || ['green', 'file']), true)}<span><b>${i + 1}.</b> ${esc(f.label)}${f.available ? '' : ' <span class="tag x">non accessible</span>'}</span></span><span class="msv-na">${f.available ? (f.count == null ? '' : f.count + ' ' + esc(f.unit)) : 'droits ou module du contrat'}</span></li>`).join('') : '';
    const any = sum && sum.folders.some(f => f.available);
    return `<h2 style="margin-top:0;display:flex;align-items:center;gap:10px">${chip('blue', 'archive', true)}Module d'archivage</h2>
      <div class="card" style="max-width:760px">
        <p>Ce module vous permet de générer et de télécharger une archive ZIP contenant l'ensemble des rapports <b>au format PDF</b> pour un mois spécifique${sum && sum.station ? ' de la station <b>' + esc(sum.station) + '</b>' : ''}.</p>
        <p style="margin-bottom:4px">L'archive comprend une structure organisée en dossiers :</p>
        ${err ? `<p style="color:var(--r)">${esc(err)}</p>` : `<ol class="msv-arch">${list}</ol>`}
        <p class="msv-na" style="font-size:13px">Vous pouvez ainsi les sauvegarder afin de conserver une archive complète en local. Les PDF utilisent les mêmes modèles que les rapports PDF existants ; un fichier INDEX_ARCHIVE.csv liste chaque document avec ses tables sources et son empreinte SHA-256.</p>
        <div class="msv-bar"><label style="margin:0"><b>Sélectionner le mois et l'année :</b> <input type="month" value="${esc(state.month)}" max="${today().slice(0, 7)}" onchange="msvSetMonth(this.value)"></label>
          <button id="msv-dl" ${any ? '' : 'disabled'} onclick="msvDownload()">Télécharger</button><span id="msv-st" class="msv-na"></span></div>
      </div>`;
  }
  window.msvSetMonth = v => { if (/^\d{4}-\d{2}$/.test(v)) { state.month = v; go('archive'); } };
  window.msvDownload = async () => {
    const btn = document.getElementById('msv-dl'), st = document.getElementById('msv-st');
    if (!btn || !state.month) return;
    btn.disabled = true; st.textContent = 'Génération de l\'archive en cours…';
    try {
      const r = await fetch('/api/exports/archive/monthly?month=' + encodeURIComponent(state.month), { headers: { Authorization: 'Bearer ' + TK, 'X-Station-Id': SID } });
      if (!r.ok) { const j = await r.json().catch(() => null); throw new Error((j && j.error) || 'Erreur ' + r.status); }
      const m = /filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') || ''), blob = await r.blob();
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = m ? m[1] : `Archive_${state.month}.zip`; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      st.textContent = ''; toast('Archive téléchargée', 'success');
    } catch (e) { st.textContent = ''; toast(errMsg(e), 'error'); }
    btn.disabled = false;
  };

  Object.assign(VM, { consolidee: vConsolidee, parstation: vParStation, archive: vArchive });
})();
