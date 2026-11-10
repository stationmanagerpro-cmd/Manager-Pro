/* ext-product-catalog.js — Page « Produits & services » : vue Liste ou Mosaïque (cartes avec photo),
   filtres (recherche, catégorie, stock), et ouverture de la fiche produit complète au clic.
   Remplace VM.prod ; doit être chargé après ext-product-profile.js. */
(function () {
  'use strict';
  if (typeof VM === 'undefined' || typeof G === 'undefined') return;

  const VKEY = 'pc_view';
  const getView = () => { try { return localStorage.getItem(VKEY) === 'grid' ? 'grid' : 'list'; } catch (_) { return 'list'; } };
  const setView = v => { try { localStorage.setItem(VKEY, v); } catch (_) { /* stockage indisponible */ } };

  let FILT = { q: '', cat: '', stock: '' };
  let CTX = { hasArch: false, inactiveView: false };

  const num = v => Number(v) || 0;
  // RG-03 : coût et marge réservés à « cost.view » (le serveur n'envoie plus buy_price aux autres rôles).
  const showCost = () => typeof can === 'function' && can('cost.view');
  const margin = p => { if (!showCost() || p.buy_price == null) return null; const s = num(p.sell_price), b = num(p.buy_price); return s > 0 ? (s - b) / s * 100 : null; };
  const mcls = m => (m == null ? '' : m >= 30 ? 'pc-m-hi' : m >= 20 ? 'pc-m-mid' : 'pc-m-lo');
  const mtxt = m => (m == null ? '—' : m.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' %');
  const stockState = p => (num(p.stock) <= 0 ? 'out' : (num(p.min_stock) > 0 && num(p.stock) <= num(p.min_stock) ? 'low' : 'ok'));
  const catName = p => p.category_label || p.category || '';
  const tint = p => { const s = String(p.category || ''); let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 6; return 'pc-t' + h; };
  const ini = n => (typeof initials === 'function' ? initials(n) : String(n || '?').slice(0, 2).toUpperCase());

  function img(p, cls) {
    return p.photo_path
      ? `<img class="${cls}" data-ent="products" data-id="${Number(p.id)}" data-name="${esc(p.name)}" alt="">`
      : `<span class="${cls}">${esc(ini(p.name))}</span>`;
  }
  function stateBadge(p) {
    const s = stockState(p);
    return s === 'out' ? '<span class="pc-flag pc-out">Rupture</span>' : s === 'low' ? '<span class="pc-flag pc-low">Stock faible</span>' : '';
  }
  const sub = p => esc(p.sku || p.barcode || '—');

  function visible() {
    const q = FILT.q.trim().toLowerCase();
    return PSC.filter(p => {
      if (FILT.cat && String(p.category) !== FILT.cat) return false;
      if (FILT.stock && stockState(p) !== FILT.stock) return false;
      if (q && ![p.name, p.sku, p.barcode, p.category, p.category_label].join(' ').toLowerCase().includes(q)) return false;
      return true;
    });
  }

  function listHtml(rows) {
    const arch = CTX.hasArch && typeof archRowBtn === 'function';
    const body = rows.map(p => {
      const m = margin(p);
      return `<tr class="pc-row" onclick="go('prodf',${Number(p.id)})" title="Ouvrir la fiche du produit">
        <td><div class="pc-prod">${img(p, 'pc-thumb')}<div><b>${esc(p.name)}</b><small>${sub(p)}</small></div></div></td>
        <td class="pc-hide-sm">${esc(catName(p))}</td>
        <td class="pc-hide-sm pc-code">${esc(p.barcode || '—')}</td>
        ${showCost() ? `<td class="pc-num">${f(p.buy_price)}</td>` : ''}
        <td class="pc-num"><b>${f(p.sell_price)}</b></td>
        ${showCost() ? `<td><span class="pc-mg ${mcls(m)}">${mtxt(m)}</span></td>` : ''}
        <td class="pc-num"><b>${fl(p.stock)}</b> <span class="pc-unit">${esc(p.unit || '')}</span> ${stateBadge(p)}</td>
        ${arch ? `<td class="pc-act" onclick="event.stopPropagation()">${archRowBtn('products', p.id, !!CTX.inactiveView, p.name)}</td>` : ''}
      </tr>`;
    }).join('');
    return `<div class="pc-tw"><table class="pc-tbl"><thead><tr><th>Produit</th><th class="pc-hide-sm">Catégorie</th><th class="pc-hide-sm">Code-barres</th>${showCost() ? '<th class="pc-num">Coût</th>' : ''}<th class="pc-num">Prix de vente</th>${showCost() ? '<th>Marge</th>' : ''}<th class="pc-num">Stock</th>${arch ? '<th></th>' : ''}</tr></thead><tbody>${body}</tbody></table></div>`;
  }

  function gridHtml(rows) {
    return '<div class="pc-grid">' + rows.map(p => {
      const m = margin(p);
      return `<div class="pc-card" role="button" tabindex="0" onclick="go('prodf',${Number(p.id)})" onkeydown="if(event.key==='Enter')go('prodf',${Number(p.id)})" title="Ouvrir la fiche du produit">
        <div class="pc-media ${tint(p)}">${img(p, 'pc-pic')}<span class="pc-cat">${esc(catName(p))}</span>${stateBadge(p)}</div>
        <div class="pc-info">
          <div class="pc-name">${esc(p.name)}</div>
          <div class="pc-sub">${sub(p)}</div>
          <div class="pc-line"><b class="pc-price">${f(p.sell_price)}</b>${showCost() ? `<span class="pc-mg ${mcls(m)}">${mtxt(m)}</span>` : ''}</div>
          <div class="pc-stk">Stock : <b>${fl(p.stock)}</b> ${esc(p.unit || '')}</div>
        </div></div>`;
    }).join('') + '</div>';
  }

  function render() {
    const host = document.getElementById('pc-body'); if (!host) return;
    const rows = visible();
    const cnt = document.getElementById('pc-count');
    if (cnt) cnt.textContent = rows.length === PSC.length ? `${PSC.length} article(s) au catalogue` : `${rows.length} sur ${PSC.length} article(s)`;
    host.innerHTML = rows.length ? (getView() === 'grid' ? gridHtml(rows) : listHtml(rows)) : '<p class="pc-empty">Aucun produit ne correspond à votre recherche.</p>';
    document.querySelectorAll('.pc-vt button').forEach(b => b.classList.toggle('on', b.dataset.v === getView()));
    if (typeof hydrateImages === 'function') hydrateImages();
  }

  window.pcSet = (k, v) => { FILT[k] = v; render(); };
  // Export PDF / Excel : respecte la recherche et les filtres affichés (et la vue actifs / inactifs)
  window.pcExport = fmt => {
    const qs = new URLSearchParams({ format: fmt, active: CTX.inactiveView ? 'false' : 'true' });
    if (FILT.q.trim()) qs.set('q', FILT.q.trim());
    if (FILT.cat) qs.set('category', FILT.cat);
    if (FILT.stock) qs.set('stock', FILT.stock);
    dlFile('/exports/products?' + qs.toString(), 'produits-' + new Date().toISOString().slice(0, 10));
  };
  window.pcImport = () => { if (typeof impStart === 'function') impStart('products'); else go('imports'); };
  window.pcView = v => { setView(v); render(); };

  VM.prod = async function () {
    const hasArch = typeof archQuery === 'function';
    const inactiveView = !!(hasArch && typeof ARCH !== 'undefined' && ARCH.products);
    CTX = { hasArch, inactiveView };
    PSC = await G('/products' + (hasArch ? archQuery('products') : ''));
    FILT = { q: '', cat: '', stock: '' };
    const cats = []; PSC.forEach(p => { if (p.category && !cats.some(c => c[0] === p.category)) cats.push([p.category, catName(p)]); });
    cats.sort((a, b) => a[1].localeCompare(b[1], 'fr'));
    const v = getView();
    return `<div class="pc-head"><div><h2 class="pc-title">Produits &amp; services</h2><div class="pc-subtitle" id="pc-count">${PSC.length} article(s) au catalogue</div></div>
      <div class="pc-actions">
        ${can('price.edit') && !inactiveView ? '<button onclick="addP()">＋ Nouveau produit</button>' : ''}
        ${can('price.edit') && !inactiveView ? '<button class="b2" onclick="pcImport()" title="Importer des produits depuis un fichier Excel">⬆ Importer</button><button class="b2" onclick="typeof impDownload===\'function\'&&impDownload(\'products\')" title="Télécharger le modèle Excel à remplir">Modèle</button>' : ''}
        ${can('price.edit') || can('stock.adjust') || can('report.view') ? '<button class="b2" onclick="pcExport(\'pdf\')">📄 Exporter PDF</button><button class="b2" onclick="pcExport(\'xlsx\')">📊 Exporter Excel</button>' : ''}
        ${can('settings.edit') ? '<button class="b2" onclick="manageProductCategories()">Catégories</button>' : ''}
        ${can('stock.adjust') ? '<button class="b2" onclick="addMv()">Mouvement de stock</button>' : ''}
        <button class="b2" onclick="go('stock')">Vue stocks</button>
        <button class="b2" onclick="go('rapports')">Rapports</button>
        ${hasArch && typeof archToggleBtn === 'function' ? archToggleBtn('products') : ''}
      </div></div>
      ${hasArch && typeof archBanner === 'function' ? archBanner('products', PSC.length) : ''}
      <div class="pc-filters">
        <input class="pc-q" type="search" placeholder="Nom, référence, code-barres…" oninput="pcSet('q',this.value)">
        <select onchange="pcSet('cat',this.value)"><option value="">Toutes catégories</option>${cats.map(c => `<option value="${esc(c[0])}">${esc(c[1])}</option>`).join('')}</select>
        <select onchange="pcSet('stock',this.value)"><option value="">Tous les stocks</option><option value="ok">En stock</option><option value="low">Stock faible</option><option value="out">Rupture</option></select>
        <div class="pc-vt" role="group" aria-label="Affichage"><button type="button" data-v="list" class="${v === 'list' ? 'on' : ''}" onclick="pcView('list')">☰ Liste</button><button type="button" data-v="grid" class="${v === 'grid' ? 'on' : ''}" onclick="pcView('grid')">▦ Mosaïque</button></div>
      </div>
      <div id="pc-body">${PSC.length ? (v === 'grid' ? gridHtml(PSC) : listHtml(PSC)) : '<p class="pc-empty">Aucun produit.</p>'}</div>`;
  };
})();
