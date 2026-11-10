/* Priorité 6 — Stock & pompes */
(function () {
  if (typeof V === 'undefined' || typeof VM === 'undefined') return;

  async function vStock() {
    const d = await G('/stock/overview').catch(e => ({ error: e.message }));
    if (d.error) return `<p class="warn">${esc(d.error)}</p>`;
    const low = d.low_stock || [];
    const mv = d.recent_movements || [];
    return `<h2 style="margin-top:0">Stock</h2>
      <div class="cards">
        ${card('Produits', d.products_count || 0)}
        ${card('Sous minimum', d.low_count || 0)}
        ${card('Valeur achat', d.stock_value_buy)}
        ${card('Valeur vente', d.stock_value_sell)}
      </div>
      ${(d.low_count > 0) ? `<div class="warn">${d.low_count} produit(s) sous le stock minimum</div>` : ''}
      <h3>Alertes stock bas</h3>
      ${T(['Produit', 'Qté', 'Min', 'Unité'], low.map(p => [esc(p.name), p.quantity, p.min_stock, esc(p.unit)]))}
      <h3>Mouvements récents</h3>
      ${T(['Date', 'Produit', 'Type', 'Qté', 'Par', 'Note'], mv.map(m => [
        dt(m.created_at), esc(m.product), esc(m.kind), m.quantity, esc(m.login || ''), esc(m.comment || '')
      ]))}
      <div class="bar">
        <button class="b2" onclick="go('prod')">Produits</button>
        <button class="b2" onclick="go('pompes')">Pompes</button>
        ${can('stock.adjust') ? `<button onclick="addStockMove()">Mouvement stock</button>` : ''}
      </div>`;
  }

  window.addStockMove = safe(async () => {
    const products = await G('/products');
    const opts = products.map(p => [String(p.id), p.name + ' (' + p.stock + ')']);
    form('Mouvement de stock', [
      ['product_id', 'Produit', 's', opts],
      ['kind', 'Type', 's', ['entree', 'retour', 'perte', 'casse', 'correction']],
      ['quantity', 'Quantité', 'number'],
      ['comment', 'Motif (obligatoire, 3 caractères min.)']
    ], {}, async d => {
      if (String(d.comment || '').trim().length < 3) { toast('Motif obligatoire (3 caractères minimum).', 'error'); return; }
      let qty = +d.quantity;
      if (['perte', 'casse'].includes(d.kind) && qty > 0) qty = -qty;
      if (d.kind === 'correction') { /* signed as entered */ }
      if (['entree', 'retour'].includes(d.kind) && qty < 0) qty = Math.abs(qty);
      await Po('/stock/movements', { product_id: +d.product_id, kind: d.kind, quantity: qty, comment: d.comment });
      closeM(); toast('Mouvement enregistré', 'success'); go('stock');
    });
  });

  // Enrichir page pompes avec statut
  const prevPompes = VM.pompes;
  VM.pompes = async function () {
    let base = '';
    if (typeof prevPompes === 'function') {
      try { base = await prevPompes(); } catch (_) { base = ''; }
    }
    const st = await G('/pumps/status').catch(() => null);
    if (!st) return base || '<p>Pompes indisponibles</p>';
    const rows = [];
    for (const p of (st.pumps || [])) {
      for (const c of (p.counters || [])) {
        rows.push([
          esc(p.name), p.status, c.counter_number, esc(c.product || '—'),
          c.current_index, c.last_closed_index != null ? c.last_closed_index : '—',
          c.last_closed_at ? dt(c.last_closed_at) : '—'
        ]);
      }
      if (!(p.counters || []).length) {
        rows.push([esc(p.name), p.status, '—', '—', '—', '—', '—']);
      }
    }
    return `<h2 style="margin-top:0">Pompes & compteurs</h2>
      <p style="font-size:12px;color:var(--m)">${esc(st.note || '')}</p>
      ${T(['Pompe', 'Statut', 'Compteur', 'Produit', 'Index courant', 'Dernier clôturé', 'Clôture'], rows)}
      <div class="bar"><button class="b2" onclick="go('stock')">Stock</button><button class="b2" onclick="go('quart')">Quarts</button></div>
      ${base ? '<hr/>' + base : ''}`;
  };

  Object.assign(V, { stock: ['Stock', 'stock.adjust|report.view|sale.create'] });
  Object.assign(VM, { stock: vStock });
})();
