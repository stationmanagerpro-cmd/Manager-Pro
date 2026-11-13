/* ext-export-all.js — boutons « PDF » et « Excel » sur toutes les interfaces qui affichent des tableaux.
   Reprend fidèlement les tableaux affichés (titres, en-têtes, lignes, filtres visibles dans l'en-tête de la vue).
   Les écrans qui ont déjà leurs propres exports (PDF / Excel / Exporter) ne reçoivent pas de doublon. */
(function () {
  'use strict';
  /* Écrans du Super Admin ayant un vrai rapport de plateforme (données clients/licences/factures de la plateforme). */
  const PLATFORM_EXPORT = { clients: 'licences' };
  const SKIP = new Set(['login', 'caisse', 'vente', 'sale', 'pos']);   // écrans de saisie, pas de rapport
  const clean = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const num = t => {
    const s = clean(t).replace(/\s*(FCFA|XOF|F CFA|%)\s*$/i, '').replace(/[\s  ]/g, '').replace(',', '.');
    return /^-?\d+(\.\d+)?$/.test(s) && s.length < 16 ? Number(s) : null;
  };
  const cellVal = td => { const t = clean(td.innerText || td.textContent); const n = num(t); return n === null ? t.slice(0, 1900) : n; };

  function tablesOf(root) {
    const out = [];
    root.querySelectorAll('table').forEach((tb, i) => {
      if (tb.closest('[data-no-export]')) return;
      const ths = [...tb.querySelectorAll('thead th')].slice(0, 14);
      const trs = [...tb.querySelectorAll('tbody tr')].filter(tr => tr.offsetParent !== null || tr.getClientRects().length);
      if (!ths.length || !trs.length) return;
      const rows = trs.slice(0, 5000).map(tr => [...tr.children].slice(0, ths.length).map(cellVal));
      if (rows.length === 1 && rows[0].length === 1 && /^aucune/i.test(String(rows[0][0]))) return;   // « Aucune donnée »
      // Titre : dernier titre (h2/h3/h4) précédant le tableau, sinon le titre de la vue
      let title = '', el = tb.closest('.tw') || tb;
      for (let k = 0; k < 8 && el && !title; k++) {
        let p = el.previousElementSibling;
        while (p && !title) { const h = /^H[2-5]$/.test(p.tagName) ? p : p.querySelector && p.querySelector('h2,h3,h4'); if (h) title = clean(h.textContent); p = p.previousElementSibling; }
        el = el.parentElement; if (el && el.id === 'pg') break;
      }
      const grid = [...tb.querySelectorAll('tfoot tr')].pop();
      out.push({ type: 'table', title: (title || 'Tableau ' + (out.length + 1)).slice(0, 190), head: ths.map(th => clean(th.textContent).slice(0, 110) || ' '), rows,
        totals: grid ? [...grid.children].slice(0, ths.length).map(cellVal) : undefined });
    });
    return out;
  }
  function filtersText(root) {
    const parts = [];
    root.querySelectorAll('select, input[type=date], input[type=month], input[type=search], input[type=text]').forEach(el => {
      if (el.closest('table') || el.closest('#m') || el.type === 'hidden' || !el.value) return;
      const lab = clean((el.closest('label') || {}).textContent || el.placeholder || '').replace(clean(el.value), '').slice(0, 40);
      const v = el.tagName === 'SELECT' ? clean(el.selectedOptions[0] && el.selectedOptions[0].textContent) : el.value;
      if (v && !/^(tous|toutes|—|-)$/i.test(v)) parts.push((lab ? lab + ' : ' : '') + v);
    });
    return parts.join(' · ').slice(0, 190);
  }
  function build() {
    const pg = document.getElementById('pg'); if (!pg) return null;
    const sections = tablesOf(pg); if (!sections.length) return null;
    const title = clean((document.getElementById('ttl') || {}).textContent) || 'Rapport';
    const filt = filtersText(pg);
    return { title: title.slice(0, 110), subtitle: filt || undefined, filename: title.replace(/[^\w-]+/g, '_').slice(0, 60) + '_' + new Date().toISOString().slice(0, 10),
      landscape: sections.some(s => s.head.length > 6), sections: sections.slice(0, 60), signatures: [{ label: 'Établi par' }, { label: 'Responsable' }] };
  }
  async function run(kind, btn) {
    if (typeof ME !== 'undefined' && ME && ME.is_global) return toast('Export non disponible ici pour le Super Admin : utilisez les rapports de « Finance plateforme ».', 'error');
    const payload = build(); if (!payload) return toast('Rien à exporter sur cet écran', 'error');
    btn.disabled = true;
    try {
      if (kind === 'pdf') { if (typeof brandedPdf === 'function') await brandedPdf(payload); return; }
      const r = await fetch('/api/docs/render-xlsx', { method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, typeof TK !== 'undefined' && TK ? { Authorization: 'Bearer ' + TK } : {}, typeof SID !== 'undefined' && SID ? { 'X-Station-Id': String(SID) } : {}),
        body: JSON.stringify(payload) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); return toast(j.error || 'Export Excel impossible', 'error'); }
      const url = URL.createObjectURL(await r.blob()), a = document.createElement('a');
      a.href = url; a.download = payload.filename + '.xlsx'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) { toast(e.message || 'Export impossible', 'error'); } finally { btn.disabled = false; }
  }
  window.exportAllView = run; window.__exportAllBuild = build;

  const hasOwnExport = pg => [...pg.querySelectorAll('button, a')].some(x => !x.closest('[data-export-all]') && !x.closest('table') && /(\bpdf\b|excel|xlsx|export|csv)/i.test(x.textContent));
  function inject() {
    const pg = document.getElementById('pg'); if (!pg) return;
    let view = ''; try { view = typeof cur !== 'undefined' ? cur : ''; } catch (_) { /* vue inconnue */ }
    const bar = pg.querySelector('[data-export-all]');
    if (SKIP.has(String(view))) { if (bar) bar.remove(); return; }
    /* Super Admin : jamais l'export générique (rendu avec l'identité d'une station et rattaché aux données des administrateurs locaux).
       Seuls les écrans qui portent des données de PLATEFORME reçoivent un export, branché sur les rapports plateforme (/admin/platform/reports). */
    if (typeof ME !== 'undefined' && ME && ME.is_global) {
      const key = PLATFORM_EXPORT[String(view)];
      if (!key) { if (bar) bar.remove(); return; }
      if (bar) return;
      if (hasOwnExport(pg) || !tablesOf(pg).length) return;
      const d = document.createElement('div');
      d.setAttribute('data-export-all', '1'); d.setAttribute('data-no-export', '1'); d.className = 'noprint';
      d.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin:0 0 8px';
      d.innerHTML = '<button type="button" class="b2" title="Rapport plateforme en PDF">⬇ PDF</button><button type="button" class="b2" title="Rapport plateforme en Excel">⬇ Excel</button>';
      const [bp, bx] = d.querySelectorAll('button');
      bp.onclick = () => (typeof pfPdf === 'function' ? pfPdf(key) : toast('Export indisponible', 'error'));
      bx.onclick = () => (typeof pfXlsx === 'function' ? pfXlsx(key) : toast('Export indisponible', 'error'));
      pg.insertBefore(d, pg.firstChild);
      return;
    }
    if (bar) return;
    if (hasOwnExport(pg)) return;
    if (!tablesOf(pg).length) return;
    const d = document.createElement('div');
    d.setAttribute('data-export-all', '1'); d.setAttribute('data-no-export', '1'); d.className = 'noprint';
    d.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin:0 0 8px';
    d.innerHTML = '<button type="button" class="b2" data-k="pdf" title="Exporter les tableaux de cet écran en PDF">⬇ PDF</button><button type="button" class="b2" data-k="xlsx" title="Exporter les tableaux de cet écran en Excel">⬇ Excel</button>';
    d.querySelectorAll('button').forEach(b => { b.onclick = () => run(b.dataset.k, b); });
    pg.insertBefore(d, pg.firstChild);
  }
  let t = null;
  const later = () => { clearTimeout(t); t = setTimeout(inject, 350); };
  try { new MutationObserver(later).observe(document.documentElement, { childList: true, subtree: true }); window.addEventListener('load', later); later(); } catch (_) { /* sans DOM */ }
})();
