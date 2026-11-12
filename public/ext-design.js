/* ext-design.js — Manager PRO : nouveau design.
   1. Moteur de lisibilité : calcule automatiquement la couleur du texte posé sur la couleur de marque
      (et une variante de la couleur de marque lisible comme texte), en mode jour comme en mode nuit.
   2. Barre supérieure : le profil rejoint la barre de recherche / notifications.
   3. Tableau de bord moderne alimenté par les vraies données (aucune valeur d'exemple). */
(function () {
  'use strict';
  const $q = s => document.querySelector(s);

  // Jeu d'icônes SVG cohérent (style trait, sans dépendance externe).
  const KPI_PATHS = {
    'shopping-cart': '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6"/>',
    'trending-up': '<path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    fuel: '<path d="M3 22V3a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v19M2 22h13M5 5h8v6H5zM15 7h2l3 3v8a2 2 0 0 0 4 0v-6l-3-3"/>',
    droplet: '<path d="M12 22a8 8 0 0 0 8-8c0-4-8-13-8-13S4 10 4 14a8 8 0 0 0 8 8z"/>',
    wallet: '<rect x="2" y="5" width="20" height="16" rx="2"/><path d="M2 9h20M16 15h2M5 5V3h14"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    'alert-triangle': '<path d="m10.3 3.9-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3.1l-8-14a2 2 0 0 0-3.4 0z"/><path d="M12 9v4m0 4h.01"/>',
    'user-check': '<path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM16 11l2 2 4-4"/>',
    'user-x': '<path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM17 8l5 5m0-5-5 5"/>',
    'building-2': '<path d="M3 21h18M5 21V5l7-3 7 3v16M9 9h1m4 0h1M9 13h1m4 0h1M9 17h1m4 0h1"/>',
    'badge-check': '<path d="M12 2 15 4l4-.2.8 3.8L22 11l-2.2 3.4-.8 3.8-4-.2-3 2-3-2-4 .2-.8-3.8L2 11l2.2-3.4L5 3.8 9 4z"/><path d="m8.5 11.5 2.3 2.3 4.7-4.7"/>',
    hourglass: '<path d="M5 2h14M5 22h14M7 2v5l5 5-5 5v5m10-20v5l-5 5 5 5v5"/>',
    'calendar-x': '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18m-11 4 4 4m0-4-4 4"/>',
    'pause-circle': '<circle cx="12" cy="12" r="10"/><path d="M9 8v8m6-8v8"/>',
    'refresh-cw': '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.6 9A7 7 0 0 1 18 6l2 6M4 12l2 6a7 7 0 0 0 12.4-3"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM20 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
    shield: '<path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11z"/><path d="m9 12 2 2 4-4"/>',
    receipt: '<path d="M4 2v20l4-2 4 2 4-2 4 2V2l-4 2-4-2-4 2zM8 8h8M8 12h8M8 16h4"/>',
    database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5M3 12c0 1.7 4 3 9 3s9-1.3 9-3"/>',
    layers: '<path d="m12 2 10 5-10 5L2 7zM2 12l10 5 10-5M2 17l10 5 10-5"/>'
  };
  function kpiSvg(name) { return `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${KPI_PATHS[name] || KPI_PATHS['trending-up']}</svg>`; }
  const kpiIconFor = label => {
    const t = String(label || '').toLocaleLowerCase();
    if (/vente produit|panier/.test(t)) return 'shopping-cart';
    if (/carburant|pompe/.test(t)) return 'fuel';
    if (/litre|volume/.test(t)) return 'droplet';
    if (/dépense|depense|charge|wallet/.test(t)) return 'wallet';
    if (/quart|heure|durée/.test(t)) return 'clock';
    if (/stock|alerte/.test(t)) return 'alert-triangle';
    if (/employé.*inactif/.test(t)) return 'user-x';
    if (/employé|utilisateur|rôle/.test(t)) return 'users';
    if (/abonnement.*actif/.test(t)) return 'badge-check';
    if (/expire bientôt|échéance/.test(t)) return 'hourglass';
    if (/expiré/.test(t)) return 'calendar-x';
    if (/suspendu/.test(t)) return 'pause-circle';
    if (/renouvellement/.test(t)) return 'refresh-cw';
    if (/client|station/.test(t)) return 'building-2';
    if (/sauvegarde|base de données|migration/.test(t)) return 'database';
    if (/vente|recette|chiffre d'affaires|ca\b|revenu|transaction/.test(t)) return 'trending-up';
    if (/utilisateur|rôle|permission/.test(t)) return 'users';
    if (/sécurité|sécurite|autorisation/.test(t)) return 'shield';
    if (/jour|ticket|facture/.test(t)) return 'receipt';
    return 'trending-up';
  };
  function decorateKpiCards(root = document) {
    root.querySelectorAll('.kpi-card, .dir-kpi, .dv2-kpi, .dv2-mini > div, .cards > .card').forEach(card => {
      if (card.dataset.kpiIconDone) return;
      if (card.classList.contains('dv2-kpi')) { card.dataset.kpiIconDone = '1'; return; }
      const label = card.querySelector('.card-body > small, .card-body > div > small, small, .dv2-kpi small');
      if (!label || !card.querySelector('b, .val, strong')) return;
      if (label.querySelector('.smp-kpi-glyph')) { card.dataset.kpiIconDone = '1'; return; }
      const glyph = document.createElement('span'); glyph.className = 'smp-kpi-glyph'; glyph.innerHTML = kpiSvg(kpiIconFor(label.textContent)); glyph.setAttribute('aria-hidden', 'true');
      label.classList.add('smp-kpi-label'); label.prepend(glyph); card.dataset.kpiIconDone = '1';
    });
  }
  window.smpKpiIcon = kpiSvg;
  window.smpDecorateKpiCards = decorateKpiCards;

  /* ---------- 1. Couleurs et contraste (WCAG) ---------- */
  const hex = h => {
    h = String(h || '').trim();
    if (/^#[0-9a-f]{3}$/i.test(h)) h = '#' + [...h.slice(1)].map(c => c + c).join('');
    return /^#[0-9a-f]{6}$/i.test(h) ? h.toLowerCase() : null;
  };
  const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const toHex = a => '#' + a.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  const lin = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); };
  const lumi = h => { const [r, g, b] = rgb(h).map(lin); return .2126 * r + .7152 * g + .0722 * b; };
  const ratio = (a, b) => { const x = lumi(a), y = lumi(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  const blend = (a, b, t) => toHex(rgb(a).map((v, i) => v * t + rgb(b)[i] * (1 - t)));
  // Rapproche une couleur du noir (fond clair) ou du blanc (fond sombre) jusqu'au contraste demandé.
  const readable = (h, bg, min) => {
    if (ratio(h, bg) >= min) return h;
    const target = lumi(bg) > .4 ? '#000000' : '#ffffff';
    for (let t = .05; t <= 1.001; t += .05) { const x = blend(target, h, t); if (ratio(x, bg) >= min) return x; }
    return target;
  };
  const onColor = h => (ratio(h, '#ffffff') >= ratio(h, '#0f172a') ? '#ffffff' : '#0f172a');
  const LEGACY_PRIMARY = '#0d7a6b', LEGACY_PRIMARY_2 = '#0a6b5c';     // ancienne couleur par défaut : remplacée par le bleu du nouveau design
  const DEFAULT_PRIMARY = '#2563eb';

  function applyColors(t) {
    const d = document.documentElement, dark = d.dataset.theme === 'dark';
    const card = dark ? '#121b2d' : '#ffffff', page = dark ? '#0a111e' : '#f1f5fb';
    let p = hex(t && t.primary) || DEFAULT_PRIMARY;
    if (dark && ratio(p, card) < 3) p = blend('#ffffff', p, .55);      // une marque très sombre reste visible sur fond nuit
    const pl = blend(p, card, dark ? .22 : .12);
    const set = (k, v) => d.style.setProperty(k, v);
    set('--p', p);
    set('--on-p', onColor(p));
    set('--p2', onColor(p) === '#ffffff' ? blend('#000000', p, .18) : blend('#ffffff', p, .18));
    set('--pl', pl);
    set('--p-text', readable(p, card, 4.5));
    set('--pl-text', readable(p, pl, 4.5));
    const sec = hex(t && t.secondary) || (dark ? '#9db0ca' : '#526178');
    const tabHover = dark ? '#22314d' : '#d6e0f2';
    set('--m', readable(readable(readable(readable(sec, card, 4.5), page, 4.5), tabHover, 4.5), pl, 4.5));
  }
  function wrapPaint() {
    if (typeof window.paint !== 'function' || window.paint.__dv2) return;
    const orig = window.paint;
    const wrapped = function (t) {
      t = Object.assign({}, t);
      const p = hex(t.primary);
      if (!p || p === LEGACY_PRIMARY || p === LEGACY_PRIMARY_2) t.primary = DEFAULT_PRIMARY;
      orig(t);
      try { applyColors(t); } catch (e) { console.warn('[design]', e && e.message); }
    };
    wrapped.__dv2 = true; window.paint = wrapped;
  }
  window.dv2ApplyColors = applyColors;
  window.dv2Color = { hex, onColor, readable, blend, ratio };

  /* Les anciennes feuilles de style (app.css, ext-*.css) emploient la couleur de marque comme couleur de texte :
     illisible si la marque est claire. On génère, pour chacune de ces règles, la variante lisible (--p-text).
     La feuille générée est placée AVANT design-v2.css : le nouveau design garde la priorité. */
  function fixLegacyBrandText() {
    const old = document.getElementById('dv2-legacy-fix'); if (old) old.remove();
    const usesP = v => /var\(\s*--p\s*[,)]/.test(v || '');
    let css = '';
    const walk = rules => {
      for (const r of rules) {
        if (r.cssRules && !r.selectorText) { continue; }            // @media & co : ignorés (sans risque)
        if (!r.style || !r.selectorText) continue;
        const col = r.style.getPropertyValue('color');
        if (!usesP(col)) continue;
        const bg = (r.style.getPropertyValue('background') || '') + (r.style.getPropertyValue('background-color') || '');
        if (/var\(\s*--p\s*[,)]/.test(bg)) continue;               // texte sur fond de marque : géré par --on-p
        const onTint = /var\(\s*--pl\s*\)/.test(bg);
        css += r.selectorText + '{color:var(' + (onTint ? '--pl-text' : '--p-text') + ')' + (r.style.getPropertyPriority('color') ? '!important' : '') + '}\n';
      }
    };
    for (const sh of Array.from(document.styleSheets)) {
      if (sh.href && /design-v2\.css/.test(sh.href)) continue;
      let rules; try { rules = sh.cssRules; } catch (e) { continue; }
      if (rules) walk(rules);
    }
    if (!css) return;
    const st = document.createElement('style'); st.id = 'dv2-legacy-fix'; st.textContent = css;
    const link = document.querySelector('link[href="design-v2.css"]');
    if (link && link.parentNode) link.parentNode.insertBefore(st, link); else document.head.appendChild(st);
  }

  /* ---------- 2. Barre supérieure ---------- */
  function relocateChip() {
    const chip = $q('#user-chip'), top = $q('#topbar-ctx');
    if (chip && top && chip.parentElement !== top) top.appendChild(chip);
  }

  /* ---------- 3. Tableau de bord ---------- */
  const E = s => (typeof esc === 'function' ? esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const N = x => Number(x) || 0;
  const LOC = () => { try { return typeof loc === 'function' ? loc() : 'fr-FR'; } catch (e) { return 'fr-FR'; } };
  const money = n => (typeof f === 'function' ? f(n) : new Intl.NumberFormat(LOC()).format(N(n)));
  const moneyHtml = n => { const s = money(n), m = /^(.*?)\s+([^\d\s][^\s]*)$/.exec(s); return m ? E(m[1]) + ' <span class="cur">' + E(m[2]) + '</span>' : E(s); };
  const liters = n => new Intl.NumberFormat(LOC(), { maximumFractionDigits: 0 }).format(N(n)) + ' L';
  const isoDay = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  const addDays = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return isoDay(d); };
  const prevRange = (a, b) => {
    const len = Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5) + 1, pb = addDays(a, -1);
    return [addDays(pb, -(len - 1)), pb];
  };
  const PERIODS = [['today', "Aujourd'hui"], ['yday', 'Hier'], ['week', 'Semaine'], ['month', 'Mois'], ['quarter', 'Trimestre'], ['year', 'Année']];
  const METHODS = { especes: 'Espèces', carte: 'Carte bancaire', mobile_money: 'Mobile Money', credit: 'Crédit', autre: 'Autre' };
  const TIPS = [
    'Vérifiez régulièrement le niveau de vos cuves pour éviter les ruptures de stock et optimiser vos ventes.',
    'Clôturez chaque quart avec un comptage de caisse : les écarts se corrigent plus vite quand ils sont récents.',
    'Comparez chaque semaine les litres vendus aux relevés de compteurs pour détecter les anomalies tôt.',
    'Sauvegardez vos données chaque jour et copiez la sauvegarde sur un disque externe.',
    'Relisez les alertes de stock bas avant le week-end pour planifier vos livraisons.',
    'Attribuez à chaque employé uniquement les droits dont il a besoin : c’est plus sûr et plus simple à suivre.',
    'Faites contrôler vos pompes à intervalle régulier : un compteur dérivé fausse vos recettes.'
  ];
  const PAL = ['#fde68a', '#bbf7d0', '#bfdbfe', '#fecaca', '#e9d5ff', '#a5f3fc'];
  const DOTS = ['#f59e0b', '#22c55e', '#3b82f6', '#ef4444', '#a855f7', '#06b6d4'];
  const hashIdx = (s, n) => { let h = 0; for (const c of String(s || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % n; };
  const cssVar = k => getComputedStyle(document.documentElement).getPropertyValue(k).trim();

  function delta(cur, prev, label) {
    if (prev == null || !isFinite(prev) || prev <= 0) return `<span class="dv2-delta flat">— ${E(label)}</span>`;
    const pct = Math.round((cur - prev) / prev * 100);
    if (pct === 0) return `<span class="dv2-delta flat">= ${E(label)}</span>`;
    return `<span class="dv2-delta ${pct > 0 ? 'up' : 'down'}">${pct > 0 ? '↑' : '↓'} ${Math.abs(pct)} % ${E(label)}</span>`;
  }
  function keyFor(cands, re) {
    if (typeof V === 'undefined') return null;
    for (const k of cands || []) if (V[k] && (typeof canView !== 'function' || canView(k))) return k;
    if (re) for (const k of Object.keys(V)) if (re.test(V[k][0] || '') && (typeof canView !== 'function' || canView(k))) return k;
    return null;
  }
  async function clientAd() {
    try {
      const ad = await G('/me/advertising');
      if (!ad || !ad.enabled) return '';
      // Texte : bandeau classique en haut (inchangé)
      const textBlock = (ad.title || ad.text)
        ? `<section class="dv2-card dv2-ad" aria-label="Annonce">${ad.title ? `<h3>${E(ad.title)}</h3>` : ''}${ad.text ? `<p style="margin:6px 0 0;color:var(--m)">${E(ad.text)}</p>` : ''}</section>`
        : '';
      // Les images sont affichées dans la « Zone PUB » en bas du menu de gauche (ext-sidebar-pub.js).
      return textBlock;
    } catch (e) { return ''; }
  }

  function renderChart(daily) {
    const cv = document.getElementById('dv2-chart');
    if (!cv || typeof Chart === 'undefined') return;
    if (window.__dv2Chart) { try { window.__dv2Chart.destroy(); } catch (e) { /* déjà détruit */ } }
    const muted = cssVar('--m') || '#526178', grid = (document.documentElement.dataset.theme === 'dark') ? 'rgba(255,255,255,.08)' : 'rgba(15,23,42,.07)';
    const compact = v => new Intl.NumberFormat(LOC(), { notation: 'compact', maximumFractionDigits: 1 }).format(v);
    const labels = daily.map(x => new Date(x.day + 'T12:00:00').toLocaleDateString(LOC(), { day: '2-digit', month: 'short' }).replace('.', ''));
    window.__dv2Chart = new Chart(cv, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { type: 'bar', label: 'Produits (' + (typeof CUR === 'string' ? CUR : 'FCFA') + ')', data: daily.map(x => x.product_revenue != null ? N(x.product_revenue) : N(x.revenue)), backgroundColor: cssVar('--p') || '#2563eb', borderRadius: 6, borderSkipped: false, maxBarThickness: 64, stack: 'ventes', yAxisID: 'y', order: 3 },
          { type: 'bar', label: 'Carburant (' + (typeof CUR === 'string' ? CUR : 'FCFA') + ')', data: daily.map(x => x.fuel_revenue != null ? N(x.fuel_revenue) : 0), backgroundColor: '#f59e0b', borderRadius: 6, borderSkipped: false, maxBarThickness: 64, stack: 'ventes', yAxisID: 'y', order: 3 },
          { type: 'line', label: 'Volume vendu (L)', data: daily.map(x => N(x.liters)), borderColor: '#16a34a', backgroundColor: '#16a34a', tension: .35, pointRadius: 4, pointBackgroundColor: '#ffffff', pointBorderColor: '#16a34a', pointBorderWidth: 2, yAxisID: 'y1', order: 1 },
          ...(daily.some(x => x.stock_liters != null) ? [{ type: 'line', label: 'Stock carburant (L)', data: daily.map(x => x.stock_liters == null ? null : N(x.stock_liters)), borderColor: '#dc2626', backgroundColor: '#dc2626', borderDash: [6, 4], tension: .25, pointRadius: 3, yAxisID: 'y1', order: 1 }] : [])
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false, layout: { padding: { top: 8 } }, interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'top', align: 'end', labels: { usePointStyle: true, boxWidth: 8, padding: 18, color: muted } },
          tooltip: { callbacks: { label: c => ' ' + c.dataset.label.replace(/ \(.*\)$/, '') + ' : ' + (c.dataset.yAxisID === 'y' ? money(c.parsed.y) : liters(c.parsed.y)) } }
        },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { color: muted } },
          y: { stacked: true, beginAtZero: true, position: 'left', grid: { color: grid }, ticks: { color: muted, callback: compact } },
          y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, ticks: { color: muted, callback: v => compact(v) + ' L' } }
        }
      }
    });
  }

  function tickClock() {
    const el = document.getElementById('dv2-clock');
    if (!el) { clearInterval(window.__dv2Timer); window.__dv2Timer = null; return; }
    const n = new Date();
    el.innerHTML = `<b>${n.toLocaleTimeString(LOC(), { hour: '2-digit', minute: '2-digit' })}</b> <small style="display:inline">· ${E(n.toLocaleDateString(LOC(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}</small>`;
  }

  async function dash() {
    const [a, b] = range(P), [pa, pb] = prevRange(a, b);
    const [d, dp, ovRaw, dailyRaw, jour] = await Promise.all([
      G(`/dashboard?from=${a}&to=${b}`),
      G(`/dashboard?from=${pa}&to=${pb}`).catch(() => null),
      G(`/dashboard/overview?from=${a}&to=${b}&pfrom=${pa}&pto=${pb}${(a === b && a === isoDay(new Date())) ? '&recent=all' : ''}`).catch(() => null),
      G(`/dashboard/daily?from=${a}&to=${b}`).catch(() => []),
      G('/dashboard/jour').catch(() => null)
    ]);
    const ov = ovRaw || { tanks: [], recent_sales: [], tx_count: d.sales_count, prev_tx_count: null };
    const daily = Array.isArray(dailyRaw) ? dailyRaw : [];
    const dFirst = daily.length ? daily[0].day : a, dLast = daily.length ? daily[daily.length - 1].day : b;
    const frD = s => String(s).slice(8, 10) + '-' + String(s).slice(5, 7) + '-' + String(s).slice(0, 4);
    const chartTitle = (daily.length === 7 && dLast === isoDay(new Date())) ? 'Évolution des ventes (7 derniers jours)' : 'Évolution des ventes (' + frD(dFirst) + ' → ' + frD(dLast) + ')';
    const sumL = x => (x && x.fuel_by_product || []).reduce((s, r) => s + N(r.liters), 0);
    const sumP = x => (x && x.payments_by_method || []).reduce((s, r) => s + N(r.amount), 0);
    const todayIso0 = isoDay(new Date()), oneDay = a === b, today = oneDay && a === todayIso0;
    const cmp = today ? 'vs hier' : (oneDay ? 'vs la veille' : 'vs période préc.');
    const fr = s => s.slice(8, 10) + '-' + s.slice(5, 7) + '-' + s.slice(0, 4);
    const periodTxt = oneDay ? 'le ' + fr(a) : 'du ' + fr(a) + ' au ' + fr(b);
    const first = String((ME && (ME.full_name || ME.login)) || '').trim().split(/\s+/)[0] || 'Admin';
    const st = (ME && ME.stations || []).find(s => String(s.id) === String(SID)) || (ME && ME.stations || [])[0] || {};
    const place = [st.city, st.country].filter(Boolean).join(', ');
    const multi = ME && ME.stations && ME.stations.length > 1;

    const kpi = (cls, ico, label, val, dl) => `<div class="dv2-kpi"><div class="dv2-ico ${cls}" aria-hidden="true">${kpiSvg(({ '🛒':'shopping-cart', '⛽':'fuel', '👥':'users', '💰':'wallet' })[ico] || 'trending-up')}</div><div style="min-width:0"><small>${E(label)}</small><span class="val">${val}</span>${dl}</div></div>`;
    const kpis = [
      kpi('green', '🛒', today ? 'Ventes du jour' : 'Ventes de la période', moneyHtml(d.revenue), delta(N(d.revenue), dp ? N(dp.revenue) : null, cmp)),
      kpi('blue', '⛽', 'Volume vendu', E(liters(sumL(d))), delta(sumL(d), dp ? sumL(dp) : null, cmp)),
      kpi('purple', '👥', 'Nombre de transactions', new Intl.NumberFormat(LOC()).format(N(ov.tx_count)), delta(N(ov.tx_count), ov.prev_tx_count == null ? null : N(ov.prev_tx_count), cmp)),
      kpi('amber', '💰', today ? "Recettes totales (aujourd'hui)" : 'Recettes totales', moneyHtml(sumP(d)), delta(sumP(d), dp ? sumP(dp) : null, cmp))
    ].join('');

    const mini = [
      ['Dépenses', money(d.expenses), false], ['Résultat net', money(d.net), N(d.net) < 0], ['Solde des caisses', money(d.cash_balance), false],
      d.receivables != null ? ['Créances clients', money(d.receivables), false] : null,
      d.payables != null ? ['Dettes fournisseurs', money(d.payables), false] : null,
      d.billing ? ['Factures émises', money(d.billing.issued_total) + ' · ' + d.billing.issued_count, false] : null,
      d.billing ? ['Encaissé sur factures', money(d.billing.collected_total), false] : null,
      d.billing ? ['Factures à encaisser', money(d.billing.due_total) + ' · ' + d.billing.open_count, d.billing.overdue_count > 0] : null,
      d.week_compare ? ['Ventes 7 j vs 7 j précédents', money(d.week_compare.current) + (d.week_compare.delta_pct == null ? '' : ' · ' + (d.week_compare.delta_pct > 0 ? '▲ +' : d.week_compare.delta_pct < 0 ? '▼ ' : '= ') + d.week_compare.delta_pct + ' %'), d.week_compare.delta_pct != null && d.week_compare.delta_pct < 0] : null,
      ['Quarts ouverts', String((d.open_shifts || []).length), false]
    ].filter(Boolean).map(([l, v, neg]) => `<div><small>${E(l)}</small><b class="${neg ? 'neg' : ''}">${v}</b></div>`).join('');

    // Niveaux de cuves : % de la capacité si elle est renseignée, sinon niveau relatif au plus grand stock.
    const tanks = ov.tanks || [], maxQ = Math.max(1, ...tanks.map(t => N(t.quantity)));
    const stocks = tanks.length ? tanks.map(t => {
      const q = N(t.quantity), cap = N(t.capacity), min = N(t.min_stock);
      const pct = Math.max(0, Math.min(100, Math.round((cap > 0 ? q / cap : q / maxQ) * 100)));
      const cls = (min > 0 && q <= min) || pct < 25 ? 'low' : pct < 50 ? 'mid' : '';
      const i = hashIdx(t.name, PAL.length);
      return `<div class="dv2-stock"><div class="dv2-fuel" style="background:${PAL[i]}" aria-hidden="true">⛽</div><div><b>${E(t.name)}</b><div class="dv2-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Niveau ${E(t.name)}"><i class="${cls}" style="width:${pct}%"></i></div></div><div class="dv2-qty">${liters(q)}<small>${pct} %</small></div></div>`;
    }).join('') + (tanks.some(t => N(t.capacity) > 0) ? '' : '<p class="dv2-note">Capacité des cuves non renseignée : niveaux relatifs au plus grand stock.</p>') : '<div class="dv2-empty">Aucun carburant configuré.</div>';

    const sales = (ov.recent_sales || []).length ? `<div class="dv2-tw"><table class="dv2-table"><thead><tr><th>Heure</th><th>Produit</th><th>Quantité</th><th>Montant</th><th>Paiement</th></tr></thead><tbody>${ov.recent_sales.slice(0, 5).map(s => {
      const prod = s.products || ('Vente ' + (s.kind || ''));
      const qty = N(s.quantity) ? new Intl.NumberFormat(LOC(), { maximumFractionDigits: 3 }).format(N(s.quantity)) + (s.units ? ' ' + E(s.units) : '') : '—';
      const pay = String(s.methods || '').split(', ').filter(Boolean).map(m => METHODS[m] || m).join(', ') || '—';
      return `<tr><td>${new Date(s.sold_at).toLocaleTimeString(LOC(), { hour: '2-digit', minute: '2-digit' })}</td><td><span class="dv2-dot" style="background:${DOTS[hashIdx(prod, DOTS.length)]}"></span>${E(prod)}</td><td>${qty}</td><td>${money(s.total)}</td><td>${E(pay)}</td></tr>`;
    }).join('')}</tbody></table></div>` : (today ? '<div class="dv2-empty">Aucune vente enregistrée pour le moment.</div>' : '<div class="dv2-empty">Aucune vente enregistrée sur cette période.</div>');

    const al = [];
    (d.watch || []).slice(0, 4).forEach(x => al.push([x.level === 'critical' ? 'critical' : 'warning', x.level === 'critical' ? '⛔' : '⚠', x.message, x.sub || '']));
    ((jour && jour.low_stock) || []).slice(0, 4).forEach(x => al.push(['warning', '⚠', 'Niveau de stock bas — ' + x.name, 'Il reste ' + new Intl.NumberFormat(LOC(), { maximumFractionDigits: 0 }).format(N(x.quantity)) + ' (minimum ' + N(x.min_stock) + ')']));
    ((jour && jour.alerts) || []).filter(x => !(x.type === 'stock')).slice(0, 5).forEach(x => al.push([x.level === 'critical' ? 'critical' : x.level === 'warning' ? 'warning' : 'info', x.level === 'critical' ? '⛔' : x.level === 'warning' ? '⚠' : 'ℹ', x.message, x.due_date ? 'Échéance : ' + x.due_date : '']));
    const alerts = al.length ? al.slice(0, 5).map(([lv, ic, t, sub]) => `<div class="dv2-alert"><div class="dv2-ai ${lv}" aria-hidden="true">${ic}</div><div><b>${E(t)}</b>${sub ? `<span>${E(sub)}</span>` : ''}</div></div>`).join('') : '<div class="dv2-alert"><div class="dv2-ai ok" aria-hidden="true">✓</div><div><b>Aucune alerte</b><span>Tout est à jour pour cette station.</span></div></div>';

    const reportKey = keyFor(['rapports', 'rap', 'report'], /rapport/i) || keyFor(['direction'], null) || keyFor(['quart'], null);
    const tiles = [
      ['q1', '🛒', 'Nouvelle vente', keyFor(['ventes'])], ['q2', '📦', 'Gérer les stocks', keyFor(['prod'])], ['q3', '🧾', 'Clôture de caisse', keyFor(['quart', 'caisse'])],
      ['q4', '📊', 'Rapports', keyFor(['rapports', 'rap', 'report'], /rapport/i)], ['q5', '🔧', 'Gestion des pompes', keyFor(['pompes'])], ['q6', '👤', 'Ajouter un utilisateur', keyFor(['param'])]
    ].filter(t => t[3]).map(([c, ic, l, k]) => `<button type="button" class="${c}" onclick="go('${k}')"><span aria-hidden="true">${ic}</span>${E(l)}</button>`).join('');
    const avKey = keyFor(['avenir']);
    const tip = TIPS[Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 864e5) % TIPS.length];
    const stockKey = keyFor(['prod']);
    const brand = (typeof brandName === 'function' && brandName()) || 'Manager PRO';
    const adRaw = await clientAd();
    // Séparer bandeau texte (haut) et zone images (bas)
    let adText = '', adImages = '';
    if (typeof adRaw === 'string' && adRaw) {
      const split = adRaw.split('<!--PUB_ZONE-->');
      adText = split[0] || '';
      adImages = split[1] || '';
    }
    const globalAd = typeof adPanelHtml === 'function' ? adPanelHtml() : '';

    setTimeout(() => { renderChart(daily); tickClock(); if (!window.__dv2Timer) window.__dv2Timer = setInterval(tickClock, 30000); }, 30);
    // Agrégats complémentaires (chacun relié à ses sources) : chargés après l'affichage pour ne pas ralentir le tableau de bord
    setTimeout(() => { if (window.Agg) Agg.mount('agg-dash', { scope: 'current', from: a, to: b, title: 'Indicateurs détaillés de la station' }); }, 60);

    return `<div class="dv2">
${adText}
<div class="dv2-head">
  <div class="dv2-hello"><h1>Bonjour, ${E(first)} 👋</h1><p>Voici un aperçu de l'activité de votre station ${today ? "aujourd'hui" : E(periodTxt)}.</p></div>
  <div class="dv2-pills">
    <div class="dv2-pill"><span class="pi" aria-hidden="true">⛽</span>${multi ? `<select aria-label="Station" onchange="chSt(this.value)">${ME.stations.map(s => `<option value="${s.id}" ${String(s.id) === String(SID) ? 'selected' : ''}>${E(s.name)}</option>`).join('')}</select>` : `<div><b>${E(st.name || 'Station')}</b>${place ? `<small>${E(place)}</small>` : ''}</div>`}</div>
    <div class="dv2-pill"><span class="pi" aria-hidden="true">🗓</span><span id="dv2-clock"></span></div>
    <div class="dv2-pill">${window.DashRange ? DashRange.html() : `<select aria-label="Période" onchange="P=this.value;go('dash')">${PERIODS.map(([v, l]) => `<option value="${v}" ${P === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`}</div>
  </div>
</div>
<section class="dv2-kpis" aria-label="Indicateurs clés">${kpis}</section>
<section class="dv2-mini" aria-label="Indicateurs financiers">${mini}</section>
<section class="dv2-card" id="agg-dash" aria-label="Indicateurs détaillés" style="margin:12px 0"></section>
<div class="dv2-grid">
  <section class="dv2-card" aria-label="Évolution des ventes"><div class="dv2-card-head"><h3>${E(chartTitle)}</h3></div><div class="dv2-chart"><canvas id="dv2-chart" role="img" aria-label="Ventes et volume sur la période"></canvas></div></section>
  <div class="dv2-right">
    <section class="dv2-card" aria-label="État des stocks"><div class="dv2-card-head"><h3>État des stocks (cuves)</h3>${stockKey ? `<button type="button" class="dv2-link" onclick="go('${stockKey}')">Voir tout →</button>` : ''}</div>${stocks}</section>
    <section class="dv2-hero" aria-label="Rapport du jour"><h3>${E(brand)}</h3><p>Une gestion simple, rapide et efficace de votre station-service.</p>${reportKey ? `<button type="button" onclick="go('${reportKey}')">Voir le rapport du jour →</button>` : ''}</section>
  </div>
</div>
<div class="dv2-grid3">
  <section class="dv2-card" aria-label="Dernières ventes"><div class="dv2-card-head"><h3>Dernières ventes</h3>${keyFor(['ventes']) ? `<button type="button" class="dv2-link" onclick="go('ventes')">Voir tout →</button>` : ''}</div>${sales}</section>
  <section class="dv2-card" aria-label="Alertes et notifications"><div class="dv2-card-head"><h3>Alertes &amp; Notifications</h3>${keyFor(['alert']) ? `<button type="button" class="dv2-link" onclick="go('alert')">Voir tout →</button>` : ''}</div>${alerts}</section>
  <section class="dv2-card" aria-label="Raccourcis rapides"><div class="dv2-card-head"><h3>Raccourcis rapides</h3></div><div class="dv2-quick">${tiles}</div>${avKey ? `<div class="dv2-adv"><b>Fonctionnalités avancées <span class="soon">À venir</span></b><p>Paiements mobiles, cartes carburant, intégrations fiscales et plus encore…</p><button type="button" onclick="go('${avKey}')">Découvrir les options</button></div>` : ''}</section>
</div>
<div class="dv2-tip" role="note"><span class="ic" aria-hidden="true">💡</span><div><b>Conseil du jour :</b> ${E(tip)}</div>${stockKey ? `<button type="button" onclick="go('${stockKey}')">Voir les stocks</button>` : ''}</div>
${globalAd}
${adImages}
</div>`;
  }

  function wrapGo() {
    if (typeof window.go !== 'function' || window.go.__dv2) return;
    const orig = window.go;
    const wrapped = function (k) { document.body.classList.toggle('dv2-home', k === 'dash'); return orig.apply(this, arguments); };
    wrapped.__dv2 = true; window.go = wrapped;
  }

  /* ---------- Initialisation ---------- */
  function init() {
    wrapPaint();
    wrapGo();
    relocateChip();
    decorateKpiCards();
    if (!window.__smpKpiObserver && document.body && window.MutationObserver) {
      window.__smpKpiObserver = new MutationObserver(records => records.forEach(r => r.addedNodes.forEach(n => { if (n.nodeType === 1) { if (n.matches && n.matches('.kpi-card, .dir-kpi, .dv2-kpi, .dv2-mini > div, .cards > .card')) decorateKpiCards(n.parentElement || document); else decorateKpiCards(n); } })));
      window.__smpKpiObserver.observe(document.body, { childList: true, subtree: true });
    }
    if (typeof VM !== 'undefined') VM.dash = dash;
    // Couleurs initiales (écran de connexion) : seulement si aucune couleur de marque n'a encore été appliquée.
    if (!document.documentElement.style.getPropertyValue('--p')) { try { applyColors({ primary: DEFAULT_PRIMARY, secondary: null }); } catch (e) { /* sans effet */ } }
  }
  init();
  window.addEventListener('load', () => { init(); fixLegacyBrandText(); });
  setTimeout(fixLegacyBrandText, 0);   // sécurité : réapplique si un autre script a redéfini paint/VM.dash entre-temps
})();
