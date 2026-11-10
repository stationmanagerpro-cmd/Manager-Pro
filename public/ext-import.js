/* Imports Excel — prévisualisation + rapport d'erreurs ligne par ligne */
(function () {
  'use strict';
  if (typeof V === 'undefined' || typeof VM === 'undefined') return;

  const IMPORT_KINDS = ['products', 'customers', 'suppliers', 'employees', 'sales'];
  const validKind = k => IMPORT_KINDS.includes(String(k));
  const IMP_LABELS = { products: 'Produits', customers: 'Clients', suppliers: 'Fournisseurs', employees: 'Employés', sales: 'Ventes produits' };
  // Page (route) → type d'import proposé directement dans le module
  const MODULE_IMPORT = { prod: 'products', cli: 'customers', four: 'suppliers', emp: 'employees', ventes: 'sales' };
  const OWN_IMPORT_BUTTONS = new Set(['prod', 'cli', 'four']);

  async function vImport() {
    const kinds = await G('/imports/kinds').catch(() => []);
    const allowed = (kinds || []).filter(k => k && k.allowed && validKind(k.key));
    return `<h2 style="margin-top:0">Imports Excel</h2>
      <p class="muted">Téléchargez un modèle, remplissez-le, prévisualisez, puis importez. Rapport d'erreurs ligne par ligne.</p>
      <div id="imp-result"></div>
      ${allowed.length ? T(['Type', 'Colonnes', ''], allowed.map(k => [
        esc(k.label),
        (k.columns || []).map(c => esc(c && c.label) + (c && c.required ? '*' : '')).join(', '),
        `<button class="b2" onclick="impDownload('${esc(k.key)}')">Modèle</button>
         <button onclick="impStart('${esc(k.key)}')">Importer</button>`
      ])) : '<p class="warn">Aucun type d\'import autorisé pour votre profil.</p>'}
      <div class="bar"><button class="b2" onclick="go('param')">Retour</button></div>`;
  }

  window.impDownload = async function (kind) {
    if (!validKind(kind)) return;
    try {
      const r = await fetch('/api/imports/template/' + encodeURIComponent(kind), {
        headers: { Authorization: 'Bearer ' + TK, 'X-Station-Id': String(SID || '') }
      });
      if (!r.ok) throw new Error('Téléchargement impossible');
      const blob = await r.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'modele-import-' + kind + '.xlsx';
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      toast(typeof errMsg === 'function' ? errMsg(e) : e.message, 'error');
    }
  };

  function fileToB64(f) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
      reader.onerror = reject;
      reader.readAsDataURL(f);
    });
  }

  window.impStart = function (kind) {
    if (!validKind(kind)) return;
    modal(`<h3 style="margin-top:0">Import Excel — ${esc(IMP_LABELS[kind] || kind)}</h3>
      <p class="muted">1) Prévisualiser · 2) Corriger si besoin · 3) Importer</p>
      <div class="g">
        <label>Fichier Excel (.xlsx)<input type="file" id="imp-file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"></label>
      </div>
      <div id="imp-preview-box" style="margin-top:10px"></div>
      <div class="r" style="gap:8px;margin-top:12px">
        <button class="b2" onclick="closeM()">Annuler</button>
        <button class="b2" id="imp-preview">Prévisualiser</button>
        <button id="imp-go" disabled>Importer définitivement</button>
      </div>`);

    let lastB64 = null;

    document.getElementById('imp-preview').onclick = async () => {
      const f = document.getElementById('imp-file').files[0];
      if (!f) return toast('Choisissez un fichier', 'error');
      if (f.size > 5 * 1024 * 1024) return toast('Max 5 Mo', 'error');
      try {
        toast('Analyse du fichier…', 'info');
        lastB64 = await fileToB64(f);
        const out = await Po('/imports/' + encodeURIComponent(kind) + '/preview', { file_base64: lastB64 });
        const box = document.getElementById('imp-preview-box');
        const errLines = (out.details || []).filter(d => d.status === 'error');
        const okLines = (out.details || []).filter(d => d.status === 'ok');
        let table = '';
        if (out.sample_rows && out.sample_rows.length) {
          const cols = out.columns || [];
          table = '<div style="overflow:auto;max-height:200px;margin-top:8px"><table class="t"><thead><tr><th>L.</th>' +
            cols.map(c => '<th>' + esc(c.label) + (c.required ? '*' : '') + '</th>').join('') +
            '</tr></thead><tbody>' +
            out.sample_rows.map(row => {
              const bad = errLines.find(e => e.line === row._line);
              return '<tr style="' + (bad ? 'background:rgba(239,68,68,0.12)' : '') + '"><td>' + row._line + '</td>' +
                cols.map(c => '<td>' + esc(String(row[c.key] == null ? '' : row[c.key])) + '</td>').join('') + '</tr>';
            }).join('') + '</tbody></table></div>';
        }
        box.innerHTML = `<div class="card" style="padding:10px">
          <b>Prévisualisation</b>
          <p>${out.ok || 0} lignes OK · <span style="color:var(--r)">${out.error || 0} erreur(s)</span> · total ${out.total || 0}</p>
          ${errLines.length ? '<ul style="font-size:12px;max-height:120px;overflow:auto;margin:6px 0">' +
            errLines.slice(0, 40).map(d =>
              '<li><span class="tag x">L.' + d.line + '</span> ' + esc(d.message || '') +
              (d.preview ? ' <span class="muted">(' + esc(d.preview) + ')</span>' : '') + '</li>'
            ).join('') + '</ul>' : '<p class="muted">Aucune erreur de validation détectée.</p>'}
          ${table}
          ${out.sample_rows && out.sample_rows.length < (out.total || 0) ? '<p class="muted" style="font-size:11px">Aperçu des 15 premières lignes.</p>' : ''}
        </div>`;
        const goBtn = document.getElementById('imp-go');
        if (goBtn) {
          goBtn.disabled = false;
          goBtn.title = errLines.length ? 'Des lignes en erreur seront ignorées / reportées' : 'Importer';
        }
        toast(`Prévisualisation : ${out.ok} OK, ${out.error} erreurs`, out.error ? 'error' : 'success');
      } catch (e) {
        toast(typeof errMsg === 'function' ? errMsg(e) : e.message, 'error');
      }
    };

    document.getElementById('imp-go').onclick = async () => {
      if (!lastB64) return toast('Prévisualisez d\'abord le fichier', 'error');
      try {
        toast('Import en cours…', 'info');
        const out = await Po('/imports/' + encodeURIComponent(kind), { file_base64: lastB64, dry_run: false });
        closeM();
        const box = document.getElementById('imp-result');
        const lines = (out.details || []).slice(0, 50).map(d =>
          `<li><span class="tag ${d.status === 'error' ? 'x' : ''}">${esc(d.status)}</span> L.${d.line} ${esc(d.name || d.message || d.reason || d.preview || '')}</li>`
        ).join('');
        if (box) {
          box.innerHTML = `<div class="card">
            <b>Résultat import — ${esc(kind)}</b>
            <p>${out.ok || 0} ok · ${out.skip || 0} ignorés · ${out.error || 0} erreurs (total ${out.total || 0})</p>
            <ul style="font-size:13px;max-height:240px;overflow:auto">${lines || '<li>Aucun détail</li>'}</ul>
          </div>`;
        }
        toast(`Import : ${out.ok} ok, ${out.skip} ignorés, ${out.error} erreurs`, out.error ? 'error' : 'success');
        if (!box && typeof go === 'function' && typeof cur !== 'undefined' && cur) go(cur, typeof arg !== 'undefined' ? arg : undefined);   // module parent : recharger la liste
      } catch (e) {
        toast(typeof errMsg === 'function' ? errMsg(e) : e.message, 'error');
      }
    };
  };

  /* ---- Boutons « Modèle » / « Importer (Excel) » dans chaque module parent concerné ---- */
  let kindsCache = null, kindsAt = 0;
  const allowedKinds = async () => {
    if (kindsCache && Date.now() - kindsAt < 60000) return kindsCache;
    const ks = await G('/imports/kinds').catch(() => []);
    kindsCache = new Set((ks || []).filter(k => k && k.allowed && validKind(k.key)).map(k => k.key)); kindsAt = Date.now();
    return kindsCache;
  };
  const impBar = kind => `<div class="bar imp-modbar" style="justify-content:flex-end;margin:0 0 8px"><button type="button" class="b2" onclick="impDownload('${kind}')" title="Télécharger le modèle Excel à remplir">Modèle</button><button type="button" class="b2" onclick="impStart('${kind}')" title="Importer des ${esc((IMP_LABELS[kind] || '').toLowerCase())} depuis un fichier Excel">⬆ Importer</button></div>`;
  Object.keys(MODULE_IMPORT).forEach(route => {
    let fn = VM[route];
    const wrapped = new WeakMap();
    const wrap = orig => {
      if (typeof orig !== 'function') return orig;
      if (!wrapped.has(orig)) wrapped.set(orig, async function () {
        const html = await orig.apply(this, arguments);
        if (typeof html !== 'string' || html.includes('imp-modbar')) return html;
        // Clients, fournisseurs, produits : l'écran a déjà ses propres boutons « Importer » / « Modèle » (aussi sur la vue des inactifs) → pas de seconde barre.
        if (OWN_IMPORT_BUTTONS.has(route) || /impStart\(|impDownload\(|pcImport\(/.test(html)) return html;
        try { return (await allowedKinds()).has(MODULE_IMPORT[route]) ? impBar(MODULE_IMPORT[route]) + html : html; } catch (_) { return html; }
      });
      return wrapped.get(orig);
    };
    // Accesseur : reste actif même si un autre script redéfinit VM[route] plus tard
    Object.defineProperty(VM, route, { configurable: true, enumerable: true, get: () => wrap(fn), set: v => { fn = v; } });
  });

  Object.assign(V, { imports: ['Imports Excel', 'price.edit|customer.edit|supplier.edit|settings.edit'] });
  Object.assign(VM, { imports: vImport });
  if (typeof TITLES !== 'undefined') TITLES.imports = 'Imports Excel';
})();
