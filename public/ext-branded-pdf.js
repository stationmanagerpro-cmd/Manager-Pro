/* ext-branded-pdf.js — Rapports PDF aux couleurs et à l'identité de la station
   (logo, coordonnées, pied de page, signatures) pour Comptabilité, Trésorerie, Vendeurs & commissions.
   Utilise POST /api/docs/render (même moteur que les rapports de ventes, quarts, RH, fiscalité).
   - brandedPdf({ title, subtitle, ref, landscape, sections, signatures, filename })
   - brandedPdfFromHtml(title, subtitle, htmlOrElement, opts) : convertit titres, tableaux, indicateurs et textes en sections */
(function () {
  'use strict';

  const clean = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const SKIP = 'button, script, style, .ac-bar, .no-print, input, select, textarea, nav, [hidden]';

  function tableSection(t, title) {
    let head = Array.from(t.querySelectorAll('thead th')).map(th => clean(th.textContent));
    let bodyRows = Array.from(t.querySelectorAll('tbody tr'));
    if (!head.length) {                       // pas de thead : première ligne = en-tête
      const first = t.querySelector('tr'); if (!first) return null;
      head = Array.from(first.children).map(c => clean(c.textContent));
      bodyRows = bodyRows.filter(tr => tr !== first);
    }
    head = head.slice(0, 14); if (!head.length) return null;
    const toCells = tr => Array.from(tr.children).slice(0, head.length).map(c => clean(c.textContent));
    const rows = bodyRows.map(toCells).filter(r => r.some(Boolean));
    const foot = t.querySelector('tfoot tr');
    const s = { type: 'table', head, rows };
    if (title) s.title = title;
    if (foot) s.totals = toCells(foot);
    return s;
  }

  /** Convertit un fragment HTML en sections PDF (titres → titres de section, tableaux, paires libellé/valeur, textes). */
  function domToSections(root) {
    const out = []; let pending = '', kv = [];
    const flushKv = () => { if (kv.length) { out.push({ type: 'kv', title: pending || undefined, rows: kv }); pending = ''; kv = []; } };
    const walk = el => {
      for (const n of Array.from(el.children)) {
        if (n.matches(SKIP)) continue;
        const tag = n.tagName;
        if (/^H[1-6]$/.test(tag)) { flushKv(); pending = clean(n.textContent); continue; }
        if (tag === 'TABLE') { flushKv(); const s = tableSection(n, pending); if (s) { out.push(s); pending = ''; } continue; }
        if (n.classList.contains('k') && n.querySelector('b')) {            // paire « libellé / valeur »
          const v = clean(n.querySelector('b').textContent);
          const l = clean(Array.from(n.childNodes).filter(c => c.nodeType === 3).map(c => c.textContent).join(' ')) || clean(n.textContent.replace(v, ''));
          kv.push([l, v]); continue;
        }
        if (n.querySelector('table, h1, h2, h3, h4, .k') || n.children.length > 3) { flushKv(); walk(n); continue; }
        const text = clean(n.textContent);
        if (text) { flushKv(); out.push({ type: 'text', title: pending || undefined, text }); pending = ''; }
      }
    };
    walk(root); flushKv();
    if (pending) out.push({ type: 'text', title: pending, text: ' ' });
    return out;
  }

  /* ---- Mise aux limites du serveur (POST /api/docs/render) : le serveur refuse tout le rapport (« Rapport invalide »)
     dès qu'un seul texte dépasse sa limite ou qu'une section est mal formée ; on tronque / écarte donc côté navigateur. ---- */
  const cut = (v, n) => { v = v == null ? '' : String(v); return v.length > n ? v.slice(0, n - 1) + '…' : v; };
  const num = v => typeof v === 'number' && isFinite(v);
  const cellOf = v => (num(v) ? v : cut(v, 2000));
  const IMG_RE = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/;
  function fitSection(s) {
    if (!s || typeof s !== 'object') return null;
    const t = s.title ? { title: cut(s.title, 200) } : {};
    switch (s.type) {
      case 'kpis': return { type: 'kpis', ...t, items: (Array.isArray(s.items) ? s.items : []).slice(0, 40).filter(i => i && typeof i === 'object')
        .map(i => ({ label: cut(i.label, 120), value: num(i.value) ? i.value : cut(i.value, 120), ...(i.note ? { note: cut(i.note, 160) } : {}) })) };
      case 'kv': return { type: 'kv', ...t, rows: (Array.isArray(s.rows) ? s.rows : []).slice(0, 300).filter(Array.isArray).map(r => [cut(r[0], 200), cellOf(r[1])]) };
      case 'text': return { type: 'text', ...t, text: cut(s.text, 8000) };
      case 'options': return { type: 'options', ...t, items: (Array.isArray(s.items) ? s.items : []).slice(0, 60).filter(i => i && typeof i === 'object').map(i => ({ label: cut(i.label, 80), selected: !!i.selected })) };
      case 'image': return (typeof s.data === 'string' && s.data.length <= 1500000 && IMG_RE.test(s.data))
        ? { type: 'image', ...t, data: s.data, ...(s.caption ? { caption: cut(s.caption, 300) } : {}) } : null;
      case 'table': {
        const head = (Array.isArray(s.head) ? s.head : []).slice(0, 14).map(h => cut(h, 120));
        if (!head.length) return null;
        const row = r => (Array.isArray(r) ? r : []).slice(0, 14).map(cellOf);
        return { type: 'table', ...t, head, rows: (Array.isArray(s.rows) ? s.rows : []).slice(0, 5000).map(row),
          ...(Array.isArray(s.totals) ? { totals: row(s.totals) } : {}),
          ...(Array.isArray(s.notes) && s.notes.length ? { notes: s.notes.slice(0, 10).map(n => cut(n, 300)) } : {}) };
      }
      default: return null;
    }
  }
  function fitPayload(o) {
    o = o || {};
    const out = {
      title: cut(String(o.title || '').trim() || 'Rapport', 120),
      ...(o.subtitle ? { subtitle: cut(o.subtitle, 200) } : {}), ...(o.ref ? { ref: cut(o.ref, 60) } : {}),
      ...(o.period ? { period: cut(o.period, 120) } : {}), ...(typeof o.landscape === 'boolean' ? { landscape: o.landscape } : {}),
      ...(o.filename ? { filename: cut(o.filename, 80) } : {}),
      sections: (Array.isArray(o.sections) ? o.sections : []).map(fitSection).filter(Boolean).slice(0, 300),
      ...(Array.isArray(o.signatures) ? { signatures: o.signatures.slice(0, 5).filter(x => x && typeof x === 'object').map(x => ({ label: cut(x.label, 60), ...(x.name ? { name: cut(x.name, 80) } : {}) })) } : {})
    };
    // Corps JSON limité à 2 Mo côté serveur : on retire les images les plus lourdes si nécessaire
    let size = JSON.stringify(out).length;
    while (size > 1900000) {
      let k = -1, best = 0;
      out.sections.forEach((s, i) => { if (s.type === 'image' && s.data.length > best) { best = s.data.length; k = i; } });
      if (k < 0) break;
      out.sections[k] = { type: 'text', ...(out.sections[k].title ? { title: out.sections[k].title } : {}), text: 'Graphique non inclus (trop volumineux) : voir à l’écran.' };
      size = JSON.stringify(out).length;
    }
    return out;
  }

  window.brandedPdf = async function (opts) {
    try {
      const payload = fitPayload(opts);
      if (!payload.sections.length) { toast('Rien à exporter.', 'info'); return false; }
      const r = await fetch('/api/docs/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(typeof TK !== 'undefined' && TK ? { Authorization: 'Bearer ' + TK } : {}), ...(typeof SID !== 'undefined' && SID ? { 'X-Station-Id': SID } : {}) },
        body: JSON.stringify(payload)
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        const det = Array.isArray(j.details) && j.details.length ? ' (' + j.details.slice(0, 2).join(' ; ') + ')' : '';
        toast((j.error || 'Génération du PDF impossible') + det, 'error'); return false;
      }
      const blob = await r.blob(), url = URL.createObjectURL(blob);
      const w = window.open(url, '_blank');
      if (!w) {                                  // pop-up bloquée : téléchargement direct
        const a = document.createElement('a'); a.href = url; a.download = (opts.filename || opts.title || 'rapport').replace(/[^\w.-]+/g, '_') + '.pdf';
        document.body.appendChild(a); a.click(); a.remove();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      return true;
    } catch (e) { toast((e && e.message) || 'Génération du PDF impossible', 'error'); return false; }
  };

  window.brandedPdfFromHtml = function (title, subtitle, source, opts) {
    let root = source;
    if (typeof source === 'string') { root = document.createElement('div'); root.innerHTML = source; }
    if (!root) { toast('Rien à imprimer', 'info'); return false; }
    const sections = domToSections(root);
    if (!sections.length) { toast('Rien à imprimer', 'info'); return false; }
    const widest = Math.max(0, ...sections.filter(s => s.type === 'table').map(s => s.head.length));
    return window.brandedPdf(Object.assign({ title, subtitle: subtitle || undefined, sections, landscape: widest > 5 ? true : undefined, filename: title }, opts || {}));
  };
})();
