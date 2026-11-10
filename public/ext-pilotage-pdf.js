/* ext-pilotage-pdf.js — bouton « Exporter en PDF » du Tableau de bord et du Pilotage direction.
   Le PDF est construit à partir de ce qui est réellement affiché (tuiles, tableaux, classements, graphiques, agrégats détaillés) :
   il respecte donc automatiquement la station, la période et les droits appliqués à l'écran. Rendu serveur : POST /api/docs/render
   (identité de la station, date de génération, numérotation) via brandedPdf(). */
(function () {
  'use strict';

  const clean = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const txt = el => (el ? clean(el.textContent) : '');
  const SKIP = 'button, script, style, .no-print, input, textarea, nav, [hidden], .dv2-hero, .dv2-quick, .dv2-link, .dir-actions, .agg-src, details.msv-src';

  /** Libellé / valeur d'une tuile « <small>libellé</small><b>valeur</b> » (+ variation éventuelle). */
  function pairOf(el) {
    const label = txt(el.querySelector('small')) || txt(el.querySelector('span'));
    const val = el.querySelector('.val, b, strong');
    let value = txt(val);
    if (!value) value = clean(txt(el).replace(label, ''));
    const note = txt(el.querySelector('.dv2-delta, .agg-v'));
    return { label, value, note: note && note !== value ? note : '' };
  }

  function kpiSection(nodes, title) {
    const items = nodes.map(pairOf).filter(i => i.label && i.value).map(i => ({ label: i.label, value: i.value, ...(i.note ? { note: i.note } : {}) }));
    return items.length ? { type: 'kpis', ...(title ? { title } : {}), items } : null;
  }

  function tableSection(t, title) {
    let head = Array.from(t.querySelectorAll('thead th')).map(txt);
    let rowsEl = Array.from(t.querySelectorAll('tbody tr'));
    if (!head.length) { const first = t.querySelector('tr'); if (!first) return null; head = Array.from(first.children).map(txt); rowsEl = rowsEl.filter(tr => tr !== first); }
    head = head.slice(0, 14); if (!head.length) return null;
    const cells = tr => Array.from(tr.children).slice(0, head.length).map(txt);
    const rows = rowsEl.map(cells).filter(r => r.some(Boolean));
    const foot = t.querySelector('tfoot tr');
    return { type: 'table', ...(title ? { title } : {}), head, rows, ...(foot ? { totals: cells(foot) } : {}) };
  }

  /** Graphique Chart.js → image PNG sur fond blanc (lisible aussi depuis le thème sombre). */
  function canvasImage(cv, title) {
    try {
      if (!cv || !cv.width || !cv.height) return null;
      const c = document.createElement('canvas'); c.width = cv.width; c.height = cv.height;
      const g = c.getContext('2d'); g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(cv, 0, 0);
      const data = c.toDataURL('image/png');
      if (data.length > 1400000) return null;
      return { type: 'image', ...(title ? { title } : {}), data, caption: clean(cv.getAttribute('aria-label') || '') || undefined };
    } catch (_) { return null; }
  }

  /** Groupes « Indicateurs détaillés » (tuiles agg-t) → un tableau par groupe, avec variation et source. */
  function aggSections(host) {
    const out = [];
    host.querySelectorAll('.agg-g').forEach(g => {
      const title = clean((g.querySelector('summary') || {}).textContent).replace(/\s+\d+ indicateur\(s\)$/, '');
      const rows = Array.from(g.querySelectorAll('.agg-t')).map(t => {
        const d = t.querySelector('.agg-src > div');
        const formula = d ? clean(Array.from(d.childNodes).filter(n => n.nodeType === 3 || (n.nodeType === 1 && n.tagName === 'B')).map(n => n.textContent).join(' ')).replace(/^Calcul :\s*/, '') : '';
        const sources = d ? Array.from(d.querySelectorAll('li')).map(txt).join(' ; ') : '';
        return [txt(t.querySelector('small')), txt(t.querySelector('b')), txt(t.querySelector('.agg-v')) || '—', [formula, sources].filter(Boolean).join(' — ')];
      }).filter(r => r[0]);
      if (rows.length) out.push({ type: 'table', title: 'Indicateurs détaillés — ' + title, head: ['Indicateur', 'Valeur', 'Variation', 'Source'], rows });
    });
    const sub = host.querySelector('.agg-sub');
    if (out.length && sub) out.push({ type: 'text', title: 'Lecture des indicateurs', text: txt(sub) });
    return out;
  }

  /** Classement (barres) → tableau # / nom / valeur / détail. */
  function rankRows(card) {
    return Array.from(card.querySelectorAll('.dir-rk')).map(r => [txt(r.querySelector('.dir-pos')), txt(r.querySelector('.dir-rk-main b')) + (txt(r.querySelector('.dir-rk-main > small')) ? ' (' + txt(r.querySelector('.dir-rk-main > small')) + ')' : ''), txt(r.querySelector('.dir-rk-val')).replace(txt(r.querySelector('.dir-rk-val small')), '').trim(), txt(r.querySelector('.dir-rk-val small'))]);
  }

  /** Repli : lignes d'une liste (li ou blocs enfants) découpées en cellules. */
  function listRows(card) {
    const cand = Array.from(card.querySelectorAll('li'));
    const rowsEl = cand.length ? cand : Array.from(card.querySelectorAll(':scope > div:not(.dv2-card-head):not(.dv2-chart), :scope > section, :scope > ul > *, :scope > .dv2-stock'));
    const rows = rowsEl.map(r => {
      const parts = Array.from(r.children).map(txt).filter(Boolean);
      return parts.length > 1 ? parts.slice(0, 4) : [txt(r)];
    }).filter(r => r.some(Boolean));
    return rows;
  }

  function cardSections(card) {
    const title = txt(card.querySelector('.dv2-card-head h3, .dv2-card-head h4')) || clean(card.getAttribute('aria-label'));
    const out = [];
    if (card.querySelector('.agg-g')) return aggSections(card);
    const empty = card.querySelector('.dv2-empty');
    const cv = card.querySelector('canvas');
    if (cv) { const im = canvasImage(cv, title); if (im) out.push(im); else out.push({ type: 'text', title, text: 'Graphique non exportable : ' + (clean(cv.getAttribute('aria-label')) || 'voir à l’écran') }); }
    const tables = Array.from(card.querySelectorAll('table'));
    tables.forEach((t, i) => { const s = tableSection(t, i || cv ? '' : title); if (s) out.push(s); });
    if (!cv && !tables.length) {
      const rk = rankRows(card);
      if (rk.length) out.push({ type: 'table', title, head: ['#', 'Libellé', 'Montant / valeur', 'Détail'], rows: rk });
      else {
        const grid = Array.from(card.querySelectorAll(':scope > div > small, :scope > div > b')).length && Array.from(card.children).filter(n => n.matches('div') && n.querySelector(':scope > small') && n.querySelector(':scope > b'));
        if (grid && grid.length) out.push({ type: 'kv', title, rows: grid.map(n => [txt(n.querySelector('small')), txt(n.querySelector('b'))]) });
        else if (empty && !card.querySelector('li, .dv2-stock')) out.push({ type: 'text', title, text: txt(empty) });
        else { const rows = listRows(card); if (rows.length) { const w = Math.max(...rows.map(r => r.length)); out.push({ type: 'table', title, head: ['Élément', 'Valeur', 'Détail', 'Complément'].slice(0, w), rows: rows.map(r => r.slice(0, w)) }); } else if (txt(card).replace(title, '').trim()) out.push({ type: 'text', title, text: clean(txt(card).replace(title, '')) }); }
      }
    }
    return out;
  }

  function build(root) {
    const sections = [];
    const h1 = root.querySelector('.dv2-hello h1');
    const title = txt(h1) || 'Tableau de bord';
    const subtitle = txt(root.querySelector('.dv2-hello p'));

    // Filtres appliqués : station, période (lus dans les sélecteurs de l'en-tête)
    const filters = [];
    let period = '';
    root.querySelectorAll('.dv2-head .dv2-pill').forEach(p => {
      const sel = p.querySelector('select');
      const pc = p.cloneNode(true); pc.querySelectorAll('.pi, .ico, svg').forEach(x => x.remove());
      const v = sel ? clean(sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : '') : txt(pc);
      if (!v) return;
      if (/\d{1,2}[-/]\d{1,2}[-/]\d{4}/.test(v)) { period = v.replace(/^[^\d]*(?=\d)/, ''); filters.push(['Période', v]); }
      else if (/^\d{1,2}:\d{2}/.test(v)) return;
      else filters.push([sel && /p[ée]riode/i.test(sel.getAttribute('aria-label') || '') ? 'Période' : 'Station', v]);
    });
    if (filters.length) sections.push({ type: 'kv', title: 'Filtres appliqués', rows: filters });

    let pending = '';
    const walk = el => {
      for (const n of Array.from(el.children)) {
        if (n.matches(SKIP) || n.matches('.dv2-head')) continue;
        if (n.matches('.dv2-kpis')) { const s = kpiSection(Array.from(n.querySelectorAll('.dv2-kpi')), 'Indicateurs clés'); if (s) sections.push(s); continue; }
        if (n.matches('.dv2-mini')) { const s = kpiSection(Array.from(n.children), 'Indicateurs complémentaires'); if (s) sections.push(s); continue; }
        if (n.matches('h2, h3, h4')) { pending = txt(n); continue; }
        if (n.matches('.dv2-card')) {
          const secs = cardSections(n);
          if (pending && secs.length && !secs[0].title) { secs[0].title = pending; }
          pending = ''; sections.push(...secs); continue;
        }
        if (n.matches('.dv2-grid, .dv2-grid3, .dir-st-grid') || n.querySelector('.dv2-card, .dv2-kpis')) { walk(n); continue; }
        if (n.matches('.dv2-ai, .dv2-alert, .dv2-note, .dv2-tip')) { const t = txt(n); if (t) sections.push({ type: 'text', text: t }); continue; }
        if (n.querySelector('table')) { Array.from(n.querySelectorAll('table')).forEach(t => { const s = tableSection(t, pending); if (s) sections.push(s); }); pending = ''; continue; }
      }
    };
    walk(root);
    return { title, subtitle, period, sections };
  }

  window.exportPilotagePdf = async function (btn) {
    const root = (btn && btn.closest && btn.closest('.dv2')) || document.querySelector('.dv2');
    if (!root) return typeof toast === 'function' && toast('Rien à exporter.', 'info');
    if (typeof brandedPdf !== 'function') return typeof toast === 'function' && toast('Module PDF indisponible.', 'error');
    let r;
    try { r = build(root); } catch (e) { return typeof toast === 'function' && toast('Préparation du PDF impossible : ' + e.message, 'error'); }
    if (!r.sections.length) return typeof toast === 'function' && toast('Rien à exporter : le tableau de bord est encore en chargement.', 'info');
    if (btn) { btn.disabled = true; }
    const stamp = new Date().toISOString().slice(0, 10);
    try {
      await brandedPdf({
        title: r.title, subtitle: r.subtitle || undefined, period: r.period || undefined, ref: 'PIL-' + stamp.replace(/-/g, ''),
        landscape: true, sections: r.sections.slice(0, 300), filename: r.title.replace(/\s+/g, '_') + '_' + stamp,
        signatures: [{ label: 'Établi par' }, { label: 'Direction' }]
      });
    } finally { if (btn) btn.disabled = false; }
  };

  /** Ajoute le bouton dans l'en-tête (Tableau de bord et Pilotage direction), quel que soit le moteur de rendu. */
  function inject() {
    document.querySelectorAll('.dv2 .dv2-head').forEach(h => {
      if (h.querySelector('[data-pdf-export]')) return;
      const host = h.querySelector('.dv2-pills') || h;
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'b2'; b.setAttribute('data-pdf-export', '1'); b.textContent = 'Exporter en PDF';
      b.title = 'Exporter ce rapport en PDF (période et filtres affichés)';
      b.style.cssText = 'margin-left:8px;white-space:nowrap';
      b.onclick = () => window.exportPilotagePdf(b);
      host.appendChild(b);
    });
  }
  try {
    new MutationObserver(inject).observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('load', inject);
    inject();
  } catch (_) { /* environnement sans DOM */ }
  window.__pilotagePdfBuild = build;
})();
