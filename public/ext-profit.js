/* Rapport client & marges — marge brute, résultat de gestion, période libre, export Excel / PDF / CSV.
 * Données : GET /api/reports/client-profit (src/profitability.js) — mêmes chiffres que le tableau de bord, le rapport financier et la Fiscalité.
 * Réutilise renderSection() (ext-fin.js) : l'aperçu et les exports reposent sur les mêmes sections. */
(function () {
  if (typeof V === 'undefined' || typeof VM === 'undefined') return;

  V.profit = ['Rapport client & marges', 'report.view|finance.view'];

  const PR = { preset: 'month', from: monthFirst(), to: dayNow(), group: 'auto', stations: null };   // stations : null = toutes les stations accessibles
  const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  const PRESETS = [['today', "Aujourd'hui"], ['yday', 'Hier'], ['last7', '7 derniers jours'], ['last30', '30 derniers jours'], ['week', 'Cette semaine'], ['month', 'Ce mois'], ['lastmonth', 'Mois dernier'],
    ['quarter', 'Ce trimestre'], ['year', 'Cette année'], ['lastyear', 'Année dernière'], ['custom', 'Période personnalisée']];
  const GROUPS = [['auto', 'Automatique'], ['day', 'Par jour'], ['week', 'Par semaine'], ['month', 'Par mois'], ['quarter', 'Par trimestre'], ['year', 'Par année'], ['none', 'Sans détail par période']];

  function presetRange(k) {
    const n = new Date(), t = new Date(n.getFullYear(), n.getMonth(), n.getDate()), day = 864e5;
    let a = t, b = t;
    if (k === 'yday') a = b = new Date(t - day);
    else if (k === 'last7') a = new Date(t - 6 * day);
    else if (k === 'last30') a = new Date(t - 29 * day);
    else if (k === 'week') a = new Date(t - ((t.getDay() + 6) % 7) * day);
    else if (k === 'month') a = new Date(n.getFullYear(), n.getMonth(), 1);
    else if (k === 'lastmonth') { a = new Date(n.getFullYear(), n.getMonth() - 1, 1); b = new Date(n.getFullYear(), n.getMonth(), 0); }
    else if (k === 'quarter') a = new Date(n.getFullYear(), Math.floor(n.getMonth() / 3) * 3, 1);
    else if (k === 'year') a = new Date(n.getFullYear(), 0, 1);
    else if (k === 'lastyear') { a = new Date(n.getFullYear() - 1, 0, 1); b = new Date(n.getFullYear() - 1, 11, 31); }
    return [iso(a), iso(b)];
  }

  function query(fmt) {
    const p = new URLSearchParams({ from: PR.from, to: PR.to, group: PR.group });
    if (PR.stations && PR.stations.length) p.set('station_ids', PR.stations.join(','));
    if (fmt) p.set('format', fmt);
    return p.toString();
  }

  function readForm() {
    const from = $('#pr_from').value, to = $('#pr_to').value;
    if (!from || !to) { toast('Renseignez les deux dates'); return false; }
    if (from > to) { toast('La date de début est postérieure à la date de fin'); return false; }
    PR.from = from; PR.to = to; PR.group = $('#pr_group').value;
    const boxes = [...document.querySelectorAll('.pr-st')];
    if (boxes.length) {
      const on = boxes.filter(b => b.checked).map(b => Number(b.value));
      if (!on.length) { toast('Sélectionnez au moins une station'); return false; }
      PR.stations = on.length === boxes.length ? null : on;
    }
    return true;
  }

  window.prPreset = v => {
    PR.preset = v;
    if (v !== 'custom') { const [a, b] = presetRange(v); $('#pr_from').value = a; $('#pr_to').value = b; }
  };
  window.prCustom = () => { PR.preset = 'custom'; const s = $('#pr_preset'); if (s) s.value = 'custom'; };
  window.prApply = () => { if (readForm()) go('profit'); };
  window.prExport = safe(async fmt => {
    if (!readForm()) return;
    await dlFile('/reports/client-profit?' + query(fmt), `rapport-client-${PR.from}_${PR.to}`);
  });

  async function vProfit() {
    const d = await G('/reports/client-profit?' + query());
    const sel = (opts, cur) => opts.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(cur) ? 'selected' : ''}>${esc(l)}</option>`).join('');
    const picked = new Set((PR.stations || d.available_stations.map(s => s.id)).map(Number));
    const stationBox = d.available_stations.length > 1
      ? `<fieldset style="border:1px solid var(--bd);border-radius:8px;margin-top:10px;padding:8px 12px"><legend style="font-size:13px">Stations incluses</legend>${d.available_stations.map(s =>
        `<label style="display:inline-flex;gap:6px;align-items:center;margin-right:14px"><input type="checkbox" class="pr-st" value="${Number(s.id)}" ${picked.has(Number(s.id)) ? 'checked' : ''}> ${esc(s.name)}</label>`).join('')}</fieldset>`
      : '';
    const t = d.totals;
    const head = `<div class="card"><div class="g">
        <label>Période<select id="pr_preset" onchange="prPreset(this.value)">${sel(PRESETS, PR.preset)}</select></label>
        <label>Du<input type="date" id="pr_from" value="${esc(PR.from)}" onchange="prCustom()"></label>
        <label>Au<input type="date" id="pr_to" value="${esc(PR.to)}" onchange="prCustom()"></label>
        <label>Détail<select id="pr_group">${sel(GROUPS, PR.group)}</select></label></div>${stationBox}
      <div class="r" style="margin-top:10px"><button onclick="prApply()">Afficher</button>
        <button class="b2" onclick="prExport('xlsx')">Exporter en Excel</button>
        <button class="b2" onclick="prExport('pdf')">Exporter en PDF</button>
        <button class="b2" onclick="prExport('csv')">Exporter en CSV</button></div>
      <p style="color:var(--m);margin:8px 0 0">Période du ${esc(d.period.from)} au ${esc(d.period.to)} : ${d.stations.length} station(s). Aucune limite de dates autre que 5 ans maximum.</p></div>`;
    const warn = t.revenue > 0 && !t.reliable
      ? `<div class="warn" style="margin:12px 0">Marge brute partielle : ${t.nocost_lines} ligne(s) vendue(s) sans coût d'achat (couverture ${t.cost_coverage_pct ?? 0} % du chiffre d'affaires). Renseignez le prix d'achat des produits concernés pour une marge exacte.</div>`
      : '';

    // Graphique : chiffre d'affaires, marge brute et résultat par période
    const chartId = 'prChart' + Date.now();
    if (d.series.length > 1) setTimeout(() => {
      const ctx = document.getElementById(chartId);
      if (!ctx || typeof Chart === 'undefined') return;
      new Chart(ctx, { type: 'bar', data: { labels: d.series.map(x => x.label), datasets: [
        { label: "Chiffre d'affaires", data: d.series.map(x => x.revenue), backgroundColor: 'rgba(13,122,107,.35)' },
        { label: 'Marge brute', data: d.series.map(x => x.gross_margin), backgroundColor: 'rgba(13,122,107,.8)' },
        { label: 'Résultat de gestion', data: d.series.map(x => x.operating_result), backgroundColor: 'rgba(200,120,20,.8)' }] },
      options: { responsive: true, maintainAspectRatio: false, scales: { y: { ticks: { callback: v => new Intl.NumberFormat('fr-FR', { notation: 'compact' }).format(v) } } } } });
    }, 50);
    const chart = d.series.length > 1 ? `<div class="card" style="margin:12px 0;height:300px"><canvas id="${chartId}"></canvas></div>` : '';

    const body = d.sections.map(s => renderSection(s)).join('');
    const notes = d.notes.length ? `<h3>Notes et limites</h3>${d.notes.map(n => `<div class="warn">${esc(n)}</div>`).join('')}` : '';
    return head + warn + chart + body + notes;
  }

  Object.assign(VM, { profit: vProfit });
})();
