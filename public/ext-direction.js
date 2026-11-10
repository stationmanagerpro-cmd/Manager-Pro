/* Pilotage direction — même design que le tableau de bord (cartes dv2-*, diagrammes Chart.js)
   et statistiques de CHAQUE station : CA, dépenses, ventes journalières, meilleurs employés,
   meilleurs clients, fournisseurs, produits, postes de dépenses.
   Chaque indicateur vient du serveur station par station (en-tête X-Station-Id) : une donnée
   indisponible s'affiche « — », jamais un faux zéro. */
(function () {
  'use strict';
  if (typeof VM === 'undefined' || typeof V === 'undefined') return;

  const E = s => (typeof esc === 'function' ? esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const N = x => Number(x) || 0;
  const LOC = () => { try { return typeof loc === 'function' ? loc() : 'fr-FR'; } catch (_) { return 'fr-FR'; } };
  const money = n => (typeof f === 'function' ? f(n) : new Intl.NumberFormat(LOC()).format(N(n)));
  const moneyHtml = n => { const s = money(n), m = /^(.*?)\s+([^\d\s][^\s]*)$/.exec(s); return m ? E(m[1]) + ' <span class="cur">' + E(m[2]) + '</span>' : E(s); };
  const liters = n => new Intl.NumberFormat(LOC(), { maximumFractionDigits: 0 }).format(N(n)) + ' L';
  const compact = v => new Intl.NumberFormat(LOC(), { notation: 'compact', maximumFractionDigits: 1 }).format(v);
  const cssVar = k => getComputedStyle(document.documentElement).getPropertyValue(k).trim();
  const ico = name => (typeof window.smpKpiIcon === 'function' ? window.smpKpiIcon(name) : '');
  const isoDay = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  const addDays = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return isoDay(d); };
  const spanDays = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5) + 1;
  const prevRange = (a, b) => { const len = spanDays(a, b), pb = addDays(a, -1); return [addDays(pb, -(len - 1)), pb]; };
  const PERIODS = [['today', "Aujourd'hui"], ['yday', 'Hier'], ['week', 'Semaine'], ['month', 'Mois'], ['quarter', 'Trimestre'], ['year', 'Année']];
  const DOTS = ['#2563eb', '#f59e0b', '#16a34a', '#a855f7', '#ef4444', '#06b6d4', '#ec4899', '#84cc16'];
  const sum = (arr, fn) => arr.reduce((t, x) => t + N(fn(x)), 0);

  let DP = 'today';      // période choisie
  let DA = null, DB = null;   // dates de la « Gamme personnalisée » (propres à cet écran)
  const drange = p => (p === 'custom' && DA && DB ? [DA, DB] : range(p === 'custom' ? 'today' : p));
  let DS = 'all';        // station choisie (« all » = toutes)

  window.dirSet = function (kind, v) { if (kind === 'p') DP = v; else DS = v; go('direction'); };

  /* Lecture d'une route pour UNE station donnée (en-tête X-Station-Id) */
  async function gs(sid, path) {
    if (window.SMP_DEMO && window.SMP_DEMO.state && window.SMP_DEMO.state.active) return G(path);
    const r = await fetch('/api' + path, { headers: { Authorization: 'Bearer ' + TK, 'X-Station-Id': String(sid) }, cache: 'no-store' });
    const j = await r.json().catch(() => null);
    if (!r.ok) throw Object.assign(new Error((j && j.error) || 'Erreur ' + r.status), { status: r.status });
    return j;
  }

  function delta(cur, prev, label, invert) {
    if (prev == null || !isFinite(prev) || prev <= 0 || cur == null) return `<span class="dv2-delta flat">— ${E(label)}</span>`;
    const pct = Math.round((cur - prev) / prev * 100);
    if (pct === 0) return `<span class="dv2-delta flat">= ${E(label)}</span>`;
    const good = invert ? pct < 0 : pct > 0;
    return `<span class="dv2-delta ${good ? 'up' : 'down'}">${pct > 0 ? '↑' : '↓'} ${Math.abs(pct)} % ${E(label)}</span>`;
  }
  const dash = '<span class="muted">—</span>';

  function rankList(items, emptyMsg, valFn, subFn, multi) {
    if (!items || !items.length) return `<div class="dv2-empty">${E(emptyMsg)}</div>`;
    const mx = Math.max(1, ...items.map(x => N(x.amount)));
    return `<div class="dir-rank">${items.map((x, i) => `<div class="dir-rk"><span class="dir-pos">${i + 1}</span>
      <div class="dir-rk-main"><b title="${E(x.name)}">${E(x.name || '—')}</b>${multi && x.station ? `<small>${E(x.station)}</small>` : ''}
        <div class="dv2-bar"><i style="width:${Math.max(3, Math.round(N(x.amount) / mx * 100))}%;background:${DOTS[i % DOTS.length]}"></i></div></div>
      <div class="dir-rk-val">${valFn(x)}<small>${subFn ? subFn(x) : ''}</small></div></div>`).join('')}</div>`;
  }
  const topMerged = (rows, key, lim) => rows.flatMap(r => (r.rk && r.rk[key] ? r.rk[key].map(x => ({ ...x, station: r.s.name })) : []))
    .sort((a, b) => N(b.amount) - N(a.amount)).slice(0, lim);
  const rankKnown = (rows, key) => rows.some(r => r.rk && r.rk[key] != null);

  function renderCharts(rows, days) {
    if (typeof Chart === 'undefined') return;
    (window.__dirCharts || []).forEach(c => { try { c.destroy(); } catch (_) { /* déjà détruit */ } });
    window.__dirCharts = [];
    const muted = cssVar('--m') || '#526178', grid = (document.documentElement.dataset.theme === 'dark') ? 'rgba(255,255,255,.08)' : 'rgba(15,23,42,.07)';
    const cvDays = document.getElementById('dir-chart-days'), cvSt = document.getElementById('dir-chart-st');
    const withDaily = rows.filter(r => Array.isArray(r.daily) && r.daily.length);
    if (cvDays && withDaily.length) {
      const labels = withDaily[0].daily.map(x => new Date(x.day + 'T12:00:00').toLocaleDateString(LOC(), { day: '2-digit', month: 'short' }).replace('.', ''));
      window.__dirCharts.push(new Chart(cvDays, {
        type: 'bar',
        data: { labels, datasets: withDaily.map((r, i) => ({ label: r.s.name, data: r.daily.map(x => N(x.revenue)), backgroundColor: DOTS[rows.indexOf(r) % DOTS.length], borderRadius: 6, borderSkipped: false, maxBarThickness: 56, stack: 'ca' })) },
        options: {
          responsive: true, maintainAspectRatio: false, layout: { padding: { top: 8 } }, interaction: { mode: 'index', intersect: false },
          plugins: { legend: { position: 'top', align: 'end', labels: { usePointStyle: true, boxWidth: 8, padding: 16, color: muted } }, tooltip: { callbacks: { label: c => ' ' + c.dataset.label + ' : ' + money(c.parsed.y) } } },
          scales: { x: { stacked: true, grid: { display: false }, ticks: { color: muted } }, y: { stacked: true, beginAtZero: true, grid: { color: grid }, ticks: { color: muted, callback: compact } } }
        }
      }));
    }
    const okRows = rows.filter(r => r.cur);
    if (cvSt && okRows.length) {
      window.__dirCharts.push(new Chart(cvSt, {
        type: 'bar',
        data: { labels: okRows.map(r => r.s.name), datasets: [
          { label: "Chiffre d'affaires", data: okRows.map(r => N(r.cur.revenue)), backgroundColor: cssVar('--p') || '#2563eb', borderRadius: 6, borderSkipped: false, maxBarThickness: 56 },
          { label: 'Dépenses', data: okRows.map(r => N(r.cur.expenses)), backgroundColor: '#f59e0b', borderRadius: 6, borderSkipped: false, maxBarThickness: 56 },
          { label: 'Résultat', data: okRows.map(r => N(r.cur.net)), backgroundColor: '#16a34a', borderRadius: 6, borderSkipped: false, maxBarThickness: 56 }
        ] },
        options: {
          responsive: true, maintainAspectRatio: false, layout: { padding: { top: 8 } }, interaction: { mode: 'index', intersect: false },
          plugins: { legend: { position: 'top', align: 'end', labels: { usePointStyle: true, boxWidth: 8, padding: 16, color: muted } }, tooltip: { callbacks: { label: c => ' ' + c.dataset.label + ' : ' + money(c.parsed.y) } } },
          scales: { x: { grid: { display: false }, ticks: { color: muted } }, y: { grid: { color: grid }, ticks: { color: muted, callback: compact } } }
        }
      }));
    }
  }

  async function vDirectionPro() {
    if (ME && ME.is_global) {
      return '<p class="warn">La vue direction est destinée aux comptes clients. Utilisez le centre de contrôle plateforme.</p><button onclick="go(\'admin\')">Centre admin</button>';
    }
    const [a, b] = drange(DP), [pa, pb] = prevRange(a, b);
    const days = Math.min(90, Math.max(7, spanDays(a, b)));   // fenêtre du graphique (même règle que /dashboard/daily)
    const oneDay = a === b, isToday = oneDay && a === isoDay(new Date());
    const cmp = isToday ? 'vs hier' : oneDay ? 'vs la veille' : 'vs période préc.';

    const [ov, jour, alertsRaw] = await Promise.all([
      G('/stations/overview').catch(() => null),
      G('/dashboard/jour').catch(() => null),
      G('/notifications').catch(() => [])
    ]);
    let stations = (ov && ov.stations) || [];
    if (!stations.length && ME && Array.isArray(ME.stations)) stations = ME.stations.map(s => ({ id: s.id, name: s.name, is_current: String(s.id) === String(SID) }));
    if (!stations.length) return '<p class="warn">Aucune station accessible pour afficher le pilotage.</p>';
    if (DS !== 'all' && !stations.some(s => String(s.id) === String(DS))) DS = 'all';
    const sel = DS === 'all' ? stations : stations.filter(s => String(s.id) === String(DS));
    const multi = sel.length > 1;

    const rows = await Promise.all(sel.map(async s => {
      const [cur, prev, daily, rk] = await Promise.all([
        gs(s.id, `/dashboard?from=${a}&to=${b}`).catch(() => null),
        gs(s.id, `/dashboard?from=${pa}&to=${pb}`).catch(() => null),
        gs(s.id, `/dashboard/daily?from=${a}&to=${b}`).catch(() => null),
        gs(s.id, `/dashboard/rankings?from=${a}&to=${b}&limit=5`).catch(() => null)
      ]);
      return { s, cur, prev, daily: Array.isArray(daily) ? daily : null, rk };
    }));
    const ok = rows.filter(r => r.cur), failed = rows.length - ok.length;
    const pairs = rows.filter(r => r.cur && r.prev);

    const revenue = sum(ok, r => r.cur.revenue), expenses = sum(ok, r => r.cur.expenses), net = revenue - expenses;
    const fuelL = sum(ok, r => sum(r.cur.fuel_by_product || [], x => x.liters));
    const txCount = sum(ok, r => r.cur.sales_count);
    const cashBal = sum(ok, r => r.cur.cash_balance);
    const recvKnown = ok.filter(r => r.cur.receivables != null), debtKnown = ok.filter(r => r.cur.payables != null);

    const kpi = (cls, svg, label, val, dl) => `<div class="dv2-kpi"><div class="dv2-ico ${cls}" aria-hidden="true">${ico(svg)}</div><div style="min-width:0"><small>${E(label)}</small><span class="val">${val}</span>${dl}</div></div>`;
    const kpis = [
      kpi('green', 'shopping-cart', multi ? "Chiffre d'affaires (stations)" : "Chiffre d'affaires", ok.length ? moneyHtml(revenue) : dash, delta(sum(pairs, r => r.cur.revenue), sum(pairs, r => r.prev.revenue), cmp)),
      kpi('amber', 'receipt', 'Dépenses', ok.length ? moneyHtml(expenses) : dash, delta(sum(pairs, r => r.cur.expenses), sum(pairs, r => r.prev.expenses), cmp, true)),
      kpi('blue', 'trending-up', 'Résultat (CA − dépenses)', ok.length ? moneyHtml(net) : dash, delta(sum(pairs, r => r.cur.net), sum(pairs, r => r.prev.net), cmp)),
      kpi('purple', 'fuel', 'Volume vendu', ok.length ? E(liters(fuelL)) : dash, `<span class="dv2-delta flat">${ok.length ? E(new Intl.NumberFormat(LOC()).format(txCount)) + ' vente(s) produits' : ''}</span>`)
    ].join('');

    const ovSel = sel.map(s => stations.find(x => x.id === s.id) || s);
    const miniItems = [
      ['Ventes du jour (toutes ventes)', ov ? money(sum(ovSel, x => x.sales_today)) : '—', false],
      ['Quarts ouverts', ov ? String(sum(ovSel, x => x.open_shifts)) : '—', false],
      ['Stock bas', ov ? String(sum(ovSel, x => x.low_stock)) : '—', false],
      ['Employés actifs', ov ? String(sum(ovSel, x => x.employees)) : '—', false],
      ['Solde des caisses', ok.length ? money(cashBal) : '—', false],
      recvKnown.length ? ['Créances clients', money(sum(recvKnown, r => r.cur.receivables)), false] : null,
      debtKnown.length ? ['Dettes fournisseurs', money(sum(debtKnown, r => r.cur.payables)), false] : null
    ].filter(Boolean).map(([l, v, neg]) => `<div><small>${E(l)}</small><b class="${neg ? 'neg' : ''}">${E(v)}</b></div>`).join('');

    /* Classement des stations par CA */
    const ranked = ok.slice().sort((x, y) => N(y.cur.revenue) - N(x.cur.revenue));
    const maxRev = Math.max(1, ...ranked.map(r => N(r.cur.revenue)));
    const stationBoard = ranked.length ? `<div class="dir-rank">${ranked.map((r, i) => `<div class="dir-rk"><span class="dir-pos">${i + 1}</span>
      <div class="dir-rk-main"><b>${E(r.s.name)}${r.s.is_current ? ' <span class="tag">Active</span>' : ''}</b>
        <small>${revenue > 0 ? Math.round(N(r.cur.revenue) / revenue * 100) : 0} % du CA · résultat ${E(money(r.cur.net))}</small>
        <div class="dv2-bar"><i style="width:${Math.max(3, Math.round(N(r.cur.revenue) / maxRev * 100))}%;background:${DOTS[rows.indexOf(r) % DOTS.length]}"></i></div></div>
      <div class="dir-rk-val">${E(money(r.cur.revenue))}<small>${E(liters(sum(r.cur.fuel_by_product || [], x => x.liters)))}</small></div></div>`).join('')}</div>`
      : '<div class="dv2-empty">Aucune donnée disponible pour la période.</div>';

    /* Classements fusionnés (toutes stations sélectionnées) */
    const empT = topMerged(rows, 'top_employees', 5), cusT = topMerged(rows, 'top_customers', 5), supT = topMerged(rows, 'top_suppliers', 5), prdT = topMerged(rows, 'top_products', 6);
    const catMap = new Map();
    rows.forEach(r => (r.rk && r.rk.expenses_by_category || []).forEach(x => { const o = catMap.get(x.name) || { name: x.name, amount: 0, n: 0 }; o.amount += N(x.amount); o.n += N(x.n); catMap.set(x.name, o); }));
    const catT = [...catMap.values()].sort((x, y) => N(y.amount) - N(x.amount)).slice(0, 6);
    const rkMissing = rows.length && !rows.some(r => r.rk);
    const salesSub = x => (x.n != null ? x.n + ' vente' + (x.n > 1 ? 's' : '') : '');
    const supHidden = rows.length && rows.every(r => r.rk && r.rk.suppliers_hidden);

    /* Alertes et stock bas (station active) */
    const openAlerts = (alertsRaw || []).filter(x => !x.read_at).slice(0, 5);
    const alertsHtml = openAlerts.length
      ? openAlerts.map(x => { const lv = x.level === 'critical' ? 'critical' : x.level === 'warning' ? 'warning' : 'info'; return `<div class="dv2-alert"><div class="dv2-ai ${lv}" aria-hidden="true">${lv === 'critical' ? '⛔' : lv === 'warning' ? '⚠' : 'ℹ'}</div><div><b>${E(x.message || '')}</b></div></div>`; }).join('')
      : '<div class="dv2-alert"><div class="dv2-ai ok" aria-hidden="true">✓</div><div><b>Aucune alerte non lue</b><span>Le centre d\'alertes est à jour.</span></div></div>';
    const low = (jour && jour.low_stock) || [];
    const lowHtml = low.length
      ? `<div class="dv2-tw"><table class="dv2-table"><thead><tr><th>Produit</th><th>Qté</th><th>Min</th></tr></thead><tbody>${low.slice(0, 6).map(x => `<tr><td>${E(x.name)}</td><td>${E(N(x.quantity))}</td><td>${E(x.min_stock)}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="dv2-empty">Aucun produit sous le seuil.</div>';

    /* Détail par station */
    const stCard = r => {
      const c = r.cur, rk = r.rk;
      const top3 = (key, fmt) => rk && rk[key] ? (rk[key].length ? rk[key].slice(0, 3).map(x => `<li><span>${E(x.name)}</span><b>${E(fmt(x))}</b></li>`).join('') : '<li class="muted">Aucune donnée</li>') : '<li class="muted">Indisponible</li>';
      const head = `<div class="dv2-card-head"><h3>${E(r.s.name)}${r.s.is_current ? ' <span class="tag">Active</span>' : ''}</h3>${r.s.is_current ? '' : `<button type="button" class="dv2-link" onclick="chSt(${Number(r.s.id)})">Basculer →</button>`}</div>`;
      if (!c) return `<section class="dv2-card dir-st">${head}<div class="dv2-empty">Statistiques indisponibles pour cette station (droits insuffisants ou connexion).</div></section>`;
      const cell = (l, v, neg) => `<div><small>${E(l)}</small><b class="${neg ? 'neg' : ''}">${E(v)}</b></div>`;
      return `<section class="dv2-card dir-st">${head}
        <div class="dir-st-kpis">${cell("Chiffre d'affaires", money(c.revenue))}${cell('Dépenses', money(c.expenses))}${cell('Résultat', money(c.net), N(c.net) < 0)}
          ${cell('Carburant', money(c.fuel_revenue))}${cell('Produits', money(c.product_revenue))}${cell('Volume vendu', liters(sum(c.fuel_by_product || [], x => x.liters)))}</div>
        <div class="dir-st-tops">
          <div><h4>Meilleurs employés</h4><ul>${top3('top_employees', x => money(x.amount))}</ul></div>
          <div><h4>Meilleurs clients</h4><ul>${top3('top_customers', x => money(x.amount))}</ul></div>
          <div><h4>Fournisseurs (achats)</h4><ul>${rk && rk.suppliers_hidden ? '<li class="muted">Non autorisé</li>' : top3('top_suppliers', x => money(x.amount))}</ul></div>
        </div></section>`;
    };

    const stationSelect = stations.length > 1
      ? `<div class="dv2-pill"><span class="pi" aria-hidden="true">⛽</span><select aria-label="Station" onchange="dirSet('s',this.value)"><option value="all" ${DS === 'all' ? 'selected' : ''}>Toutes les stations</option>${stations.map(s => `<option value="${s.id}" ${String(s.id) === String(DS) ? 'selected' : ''}>${E(s.name)}</option>`).join('')}</select></div>`
      : `<div class="dv2-pill"><span class="pi" aria-hidden="true">⛽</span><div><b>${E(stations[0].name)}</b></div></div>`;

    const html = `<div class="dv2 dir2">
<div class="dv2-head">
  <div class="dv2-hello"><h1>Pilotage direction</h1><p>Synthèse du ${E(a === b ? a : a + ' au ' + b)}${multi ? ' — ' + sel.length + ' stations, sans mélanger leurs opérations' : ''}.${failed ? ` <b class="neg">${failed} station(s) indisponible(s)</b> : leurs chiffres ne sont pas inclus dans les totaux.` : ''}</p></div>
  <div class="dv2-pills">${stationSelect}<div class="dv2-pill">${window.DashRange ? DashRange.html({ get: () => DP, rng: c => (c === 'custom' ? drange('custom') : range(c)), set: (c, x, y) => { if (c === 'custom') { DA = x; DB = y; } DP = c; go('direction'); } }) : `<select aria-label="Période" onchange="dirSet('p',this.value)">${PERIODS.map(([v, l]) => `<option value="${v}" ${DP === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`}</div></div>
</div>
<section class="dv2-kpis" aria-label="Indicateurs clés">${kpis}</section>
<section class="dv2-mini" aria-label="Indicateurs complémentaires">${miniItems}</section>
<div class="bar dir-actions">
  <button type="button" onclick="go('eod')">Rapport fin de journée</button>
  <button type="button" class="b2" onclick="go('jour')">Détail Jour J</button>
  <button type="button" class="b2" onclick="go('dash')">Dashboard complet</button>
  <button type="button" class="b2" onclick="go('stations')">Mes stations</button>
  <button type="button" class="b2" onclick="go('alert')">Centre d'alertes</button>
  <button type="button" class="b2" onclick="modernSendDigestNow()">Envoyer digest e-mail</button>
  <button type="button" class="b2" onclick="modernPresetDailyDigest()">Programmer digest 20h</button>
</div>
<div class="dv2-grid">
  <section class="dv2-card" aria-label="Ventes journalières"><div class="dv2-card-head"><h3>Ventes journalières par station (${days} jours jusqu'au ${E(b.slice(8, 10) + '-' + b.slice(5, 7) + '-' + b.slice(0, 4))})</h3></div><div class="dv2-chart">${rows.some(r => r.daily && r.daily.length) ? '<canvas id="dir-chart-days" role="img" aria-label="Chiffre d\'affaires journalier par station"></canvas>' : '<div class="dv2-empty">Ventes journalières indisponibles.</div>'}</div></section>
  <section class="dv2-card" aria-label="Classement des stations"><div class="dv2-card-head"><h3>Classement des stations (CA)</h3></div>${stationBoard}</section>
</div>
<div class="dv2-grid3">
  <section class="dv2-card" aria-label="Meilleurs employés"><div class="dv2-card-head"><h3>Meilleurs employés</h3></div>${rkMissing || !rankKnown(rows, 'top_employees') ? '<div class="dv2-empty">Classement indisponible.</div>' : rankList(empT, 'Aucune vente sur la période.', x => E(money(x.amount)), salesSub, multi)}</section>
  <section class="dv2-card" aria-label="Meilleurs clients"><div class="dv2-card-head"><h3>Meilleurs clients</h3></div>${rkMissing || !rankKnown(rows, 'top_customers') ? '<div class="dv2-empty">Classement indisponible.</div>' : rankList(cusT, 'Aucune vente à un client enregistré.', x => E(money(x.amount)), salesSub, multi)}</section>
  <section class="dv2-card" aria-label="Fournisseurs"><div class="dv2-card-head"><h3>Fournisseurs (achats)</h3></div>${supHidden ? '<div class="dv2-empty">Réservé aux profils finance / dettes.</div>' : rkMissing || !rankKnown(rows, 'top_suppliers') ? '<div class="dv2-empty">Classement indisponible.</div>' : rankList(supT, 'Aucun achat sur la période.', x => E(money(x.amount)), x => (x.n != null ? x.n + ' commande' + (x.n > 1 ? 's' : '') : ''), multi)}</section>
</div>
<div class="dv2-grid">
  <section class="dv2-card" aria-label="Chiffre d'affaires et dépenses par station"><div class="dv2-card-head"><h3>CA, dépenses et résultat par station</h3></div><div class="dv2-chart">${ok.length ? '<canvas id="dir-chart-st" role="img" aria-label="CA, dépenses et résultat par station"></canvas>' : '<div class="dv2-empty">Aucune donnée disponible.</div>'}</div></section>
  <section class="dv2-card" aria-label="Produits les plus vendus"><div class="dv2-card-head"><h3>Produits les plus vendus</h3></div>${rkMissing || !rankKnown(rows, 'top_products') ? '<div class="dv2-empty">Classement indisponible.</div>' : rankList(prdT, 'Aucune vente sur la période.', x => E(money(x.amount)), x => E(new Intl.NumberFormat(LOC(), { maximumFractionDigits: 1 }).format(N(x.qty))) + ' vendu(s)', multi)}</section>
</div>
<div class="dv2-grid3">
  <section class="dv2-card" aria-label="Dépenses par poste"><div class="dv2-card-head"><h3>Dépenses par poste</h3></div>${rkMissing || !rankKnown(rows, 'expenses_by_category') ? '<div class="dv2-empty">Indisponible.</div>' : rankList(catT, 'Aucune dépense sur la période.', x => E(money(x.amount)), x => (x.n ? x.n + ' dépense' + (x.n > 1 ? 's' : '') : ''), false)}</section>
  <section class="dv2-card" aria-label="Alertes à traiter"><div class="dv2-card-head"><h3>Alertes à traiter</h3>${typeof canView !== 'function' || canView('alert') ? '<button type="button" class="dv2-link" onclick="go(\'alert\')">Voir tout →</button>' : ''}</div>${alertsHtml}</section>
  <section class="dv2-card" aria-label="Stock sous minimum"><div class="dv2-card-head"><h3>Stock sous minimum (station active)</h3></div>${lowHtml}</section>
</div>
<h3 class="dir-sec">Statistiques de chaque station</h3>
<div class="dir-st-grid">${rows.map(stCard).join('')}</div>
</div>`;

    setTimeout(() => { if (document.getElementById('dir-chart-days') || document.getElementById('dir-chart-st')) renderCharts(rows, days); }, 30);
    return html;
  }

  /* Même en-tête épuré que le tableau de bord (le titre de la page remplace celui de la barre du haut) */
  function wrapGo() {
    if (typeof window.go !== 'function' || window.go.__dir) return;
    const orig = window.go;
    const wrapped = function (k) { const r = orig.apply(this, arguments); if (k === 'direction') document.body.classList.add('dv2-home'); return r; };
    wrapped.__dir = true; Object.keys(orig).forEach(p => { try { wrapped[p] = orig[p]; } catch (_) { /* propriété non copiable */ } });
    window.go = wrapped;
  }
  wrapGo();
  window.addEventListener('load', wrapGo);

  /* Remplace l'ancienne vue (registre des vues de ext-modern-pack) */
  VM.direction = vDirectionPro;
  window.addEventListener('load', () => { VM.direction = vDirectionPro; });
})();
