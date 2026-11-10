/* ext-aggregates.js — Agrégats complémentaires reliés à leurs sources (tableau de bord, Vue consolidée, Vue par station,
   Achats, Trésorerie). Chaque tuile affiche sa valeur, sa variation et un bouton « Source » (formule + tables/colonnes).
   Données serveur : GET /api/aggregates (catalogue + valeurs, voir src/aggregates.js).
   Données calculées côté écran (Achats, Trésorerie) : mêmes tuiles, avec leurs propres sources déclarées.
   API : Agg.mount(id, opts) · Agg.render(data, opts) · Agg.tiles(items) · Agg.chips(values, catalog, keys, cur)
         Agg.pdfSections(data, title) · Agg.itemsPdf(items, title) · Agg.itemsTable(items) · Agg.fmt(unit, v, cur) */
(function () {
  'use strict';
  if (window.Agg) return;

  const E = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = (n, d) => (typeof nfr === 'function' ? nfr(n, d) : Number(n || 0).toLocaleString('fr-FR', { maximumFractionDigits: d }));
  const ACC = { 'Ventes et encaissements': '#16a34a', 'Modes de paiement': '#0891b2', Marge: '#9333ea', Exploitation: '#2563eb', 'Dépenses et flux': '#dc2626', 'Achats et fournisseurs': '#f59e0b', Clients: '#db2777', 'Facturation clients': '#0d9488', Stock: '#ea580c' };

  /** Formate une valeur selon son unité ; null → « n/d ». */
  function fmt(unit, v, cur) {
    if (v == null || !Number.isFinite(Number(v))) return 'n/d';
    const n = Number(v);
    if (unit === 'money') return nf(n, 0) + (cur ? ' ' + cur : '');
    if (unit === 'liters') return nf(n, 0) + ' L';
    if (unit === 'pct') return nf(n, 1) + ' %';
    if (unit === 'hours') return nf(n, 1) + ' h';
    if (unit === 'days') return nf(n, 1) + ' j';
    return nf(n, 0);
  }
  /** Variation : { kind: 'pct'|'pts', value } → texte ; null si absente. */
  function varText(v) {
    if (!v || v.value == null) return null;
    const a = Math.abs(v.value), sign = v.value > 0 ? '+' : v.value < 0 ? '−' : '';
    return v.kind === 'pts' ? `${sign}${nf(a, 1)} pt` : `${sign}${nf(a, 1)} %`;
  }
  const tone = (v, good) => (!v || !v.value || !good ? 'n' : (v.value > 0) === (good === 'up') ? 'g' : 'b');

  const css = document.createElement('style');
  css.textContent = `
  .agg-wrap h3{margin:0 0 4px}.agg-sub{color:var(--m);font-size:13px;margin:0 0 10px}
  .agg-g{margin:0 0 10px;border:1px solid var(--bd);border-radius:12px;padding:0 12px 10px;background:var(--c,transparent)}
  .agg-g>summary{cursor:pointer;font-weight:700;padding:10px 0;list-style:none;display:flex;align-items:center;gap:8px}
  .agg-g>summary::before{content:"";width:10px;height:10px;border-radius:50%;background:var(--agg-acc,#2563eb)}
  .agg-g>summary small{color:var(--m);font-weight:400;margin-left:auto}
  .agg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(205px,1fr));gap:10px}
  .agg-t{border:1px solid var(--bd);border-left:4px solid var(--agg-acc,#2563eb);border-radius:10px;padding:9px 11px;min-width:0;background:color-mix(in srgb,var(--agg-acc,#2563eb) 6%,transparent)}
  .agg-t small{display:block;color:var(--m);font-size:12px;line-height:1.25}
  .agg-t b{display:block;font-size:1.15rem;margin:3px 0 1px;letter-spacing:-.01em;word-break:break-word}
  .agg-v{font-size:12px}.agg-v.g{color:#16a34a}.agg-v.b{color:#dc2626}.agg-v.n{color:var(--m)}
  .agg-sub2{font-size:11px;color:var(--m)}
  .agg-src{margin-top:5px;font-size:11px;color:var(--m)}.agg-src summary{cursor:pointer;color:var(--agg-acc,#2563eb);font-weight:600}
  .agg-src div{margin-top:4px;line-height:1.35}.agg-src ul{margin:3px 0 0;padding-left:16px}
  .agg-chips{display:flex;flex-wrap:wrap;gap:8px;grid-column:1/-1}
  .agg-chip{border:1px solid var(--bd);border-radius:999px;padding:4px 12px;font-size:12px;background:color-mix(in srgb,var(--agg-acc,#2563eb) 8%,transparent);cursor:help}
  .agg-chip b{margin-left:6px}
  .agg-note{font-size:12px;color:var(--m);margin:8px 0 0}.agg-warn{padding:8px 12px;border-radius:8px;border:1px solid #f59e0b;background:rgba(245,158,11,.12);margin:0 0 10px;font-size:13px}`;
  document.head.appendChild(css);

  const srcBlock = (formula, sources) => `<details class="agg-src"><summary>Source</summary><div>${formula ? `<b>Calcul :</b> ${E(formula)}` : ''}<ul>${(sources || []).map(s => `<li>${E(s)}</li>`).join('')}</ul></div></details>`;

  /** items : [{ label, value (texte), variation?: texte, tone?: 'g'|'b'|'n', sub?, formula, sources[], accent? }] */
  function tiles(items) {
    return `<div class="agg-grid">${items.map(i => `<div class="agg-t" style="--agg-acc:${E(i.accent || '#2563eb')}"><small>${E(i.label)}</small><b>${E(i.value)}</b>${i.variation ? `<span class="agg-v ${i.tone || 'n'}">${E(i.variation)}</span>` : ''}${i.sub ? `<span class="agg-sub2">${E(i.sub)}</span>` : ''}${srcBlock(i.formula, i.sources)}</div>`).join('')}</div>`;
  }

  const catIndex = data => { const m = {}; (data.catalog || []).forEach(c => { m[c.key] = c; }); return m; };
  const curOf = data => (data.mixed_currency ? '' : (data.currencies && data.currencies[0]) || '');
  const fdate = s => new Date(s + 'T00:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const periodLabel = data => (data.period ? `du ${fdate(data.period.from)} au ${fdate(data.period.to)}` : '');

  /** Regroupe les indicateurs disponibles (valeur présente dans total) par groupe du catalogue, dans l'ordre du catalogue. */
  function grouped(data, keys) {
    const idx = catIndex(data), order = [], groups = {};
    (data.catalog || []).forEach(c => {
      if (!(c.key in (data.total || {})) || (keys && !keys.includes(c.key))) return;
      if (!groups[c.group]) { groups[c.group] = []; order.push(c.group); }
      groups[c.group].push({ meta: idx[c.key], t: data.total[c.key] });
    });
    return order.map(g => [g, groups[g]]);
  }

  function itemOf(meta, t, cur) {
    const vt = varText(t.variation);
    return { label: meta.label, value: fmt(meta.unit, t.value, cur), variation: vt ? `${t.variation.value > 0 ? '▲' : t.variation.value < 0 ? '▼' : '='} ${vt} vs période préc.` : null, tone: tone(t.variation, meta.good), formula: meta.formula, sources: meta.sources,
      sub: meta.flow ? null : 'Situation à ce jour', accent: ACC[meta.group] };
  }

  function render(data, opts) {
    opts = opts || {};
    const cur = curOf(data), gs = grouped(data, opts.keys);
    const hid = data.hidden || {}, nh = Object.values(hid).reduce((a, b) => Math.max(a, b), 0);
    const warn = [];
    if (data.mixed_currency) warn.push(`Vos stations n'ont pas la même devise (${(data.currencies || []).map(E).join(', ')}) : les montants sont additionnés sans conversion.`);
    if (nh) warn.push('Certaines rubriques sont partielles ou absentes : droits ou module de contrat insuffisants sur une partie des stations.');
    if (!gs.length) return `<p class="agg-note">Aucun indicateur disponible pour votre profil sur cette période.</p>`;
    const n = gs.reduce((a, g) => a + g[1].length, 0);
    return `<div class="agg-wrap"><h3>${E(opts.title || 'Indicateurs détaillés')}</h3><p class="agg-sub">${E(periodLabel(data))} · ${n} agrégats, chacun relié à ses tables sources (bouton « Source »). Variations comparées à la période précédente de même durée (${fdate(data.period.prev_from)} → ${fdate(data.period.prev_to)}).</p>
      ${warn.map(w => `<div class="agg-warn">${w}</div>`).join('')}
      ${gs.map(([g, list], i) => `<details class="agg-g" ${i < 3 ? 'open' : ''} style="--agg-acc:${E(ACC[g] || '#2563eb')}"><summary>${E(g)} <small>${list.length} indicateur(s)</small></summary>${tiles(list.map(x => itemOf(x.meta, x.t, cur)))}</details>`).join('')}</div>`;
  }

  const qs = o => '?' + Object.entries(o).filter(([, v]) => v != null && v !== '').map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
  const fetchAgg = o => G('/aggregates' + qs({ scope: o.scope || 'current', from: o.from, to: o.to, by_station: o.byStation ? 1 : '' }));

  /** Charge et affiche dans l'élément #id ; onData(data) permet de réutiliser les valeurs (ex. export PDF). */
  async function mount(id, o) {
    const host = document.getElementById(id); if (!host) return null;
    host.innerHTML = '<p class="agg-note">Chargement des agrégats…</p>';
    try {
      const data = await fetchAgg(o);
      const h = document.getElementById(id); if (!h) return data;
      h.innerHTML = render(data, o);
      if (typeof o.onData === 'function') o.onData(data);
      return data;
    } catch (e) {
      const h = document.getElementById(id);
      if (h) h.innerHTML = `<p class="agg-note">Agrégats indisponibles : ${E((e && e.message) || e)}</p>`;
      return null;
    }
  }

  /** Puces compactes (Vue par station) ; le survol affiche la formule et les sources. */
  function chips(values, catalog, keys, cur) {
    const idx = {}; (catalog || []).forEach(c => { idx[c.key] = c; });
    return keys.filter(k => idx[k] && k in (values || {})).map(k => {
      const m = idx[k];
      return `<span class="agg-chip" style="--agg-acc:${E(ACC[m.group] || '#2563eb')}" title="${E(m.label + ' — ' + m.formula + ' | Sources : ' + m.sources.join(' ; '))}">${E(m.label)}<b>${E(fmt(m.unit, values[k], cur))}</b></span>`;
    }).join('');
  }
  /** Bloc « Sources » listant les agrégats affichés en puces. */
  function sourcesList(catalog, keys) {
    const idx = {}; (catalog || []).forEach(c => { idx[c.key] = c; });
    return `<details class="msv-src"><summary>Sources des agrégats détaillés</summary><ul>${keys.filter(k => idx[k]).map(k => `<li><b>${E(idx[k].label)}</b> : ${E(idx[k].formula)} — ${idx[k].sources.map(E).join(' ; ')}</li>`).join('')}</ul></details>`;
  }

  /* ---------- PDF : mêmes données, avec la colonne « Source » ---------- */
  const PDF_HEAD = ['Indicateur', 'Valeur', 'Variation', 'Source'];
  function rowOf(i) { return [i.label, i.value, i.variation ? i.variation.replace(/ vs période préc\./, '') : '—', (i.formula ? i.formula + ' — ' : '') + (i.sources || []).join(' ; ')]; }
  function pdfSections(data, title) {
    if (!data || !data.total) return [];
    const cur = curOf(data), out = [];
    grouped(data).forEach(([g, list]) => out.push({ type: 'table', title: (title ? title + ' — ' : '') + g, head: PDF_HEAD, rows: list.map(x => rowOf(itemOf(x.meta, x.t, cur))) }));
    if (out.length) out.push({ type: 'text', title: 'Lecture des agrégats', text: `Période ${periodLabel(data)} ; variations comparées à la période précédente de même durée (${fdate(data.period.prev_from)} au ${fdate(data.period.prev_to)}). Les indicateurs « à ce jour » sont des situations (soldes), sans comparaison. Chaque ligne cite sa formule et ses tables sources.` });
    return out;
  }
  function itemsPdf(items, title) { return { type: 'table', title, head: PDF_HEAD, rows: items.map(rowOf) }; }
  /** Tableau HTML pour les rapports générés depuis le DOM (brandedPdfFromHtml). */
  function itemsTable(items) {
    return `<table><thead><tr><th>Indicateur</th><th>Valeur</th><th>Source</th></tr></thead><tbody>${items.map(i => `<tr><td>${E(i.label)}</td><td>${E(i.value)}</td><td>${E((i.formula ? i.formula + ' — ' : '') + (i.sources || []).join(' ; '))}</td></tr>`).join('')}</tbody></table>`;
  }

  window.Agg = { fmt, tiles, render, mount, fetch: fetchAgg, chips, sourcesList, pdfSections, itemsPdf, itemsTable, varText, ACC };
})();
