/* Quart en cours — mise en page « tableau de bord » (maquette validée).
 * Données : GET /shifts/current (quart, totaux, équipe, pumps[] avec recette / volume / ventes par pompe).
 * Utilisé par vQuart (app.js) ; si absent, l'ancien bloc reste affiché. Aucune donnée n'est inventée :
 * les avatars sont des initiales, les photos d'employés n'existent pas dans l'application. */
(function () {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Montants du quart : entiers en FCFA, comme la maquette (« 5 000 FCFA »).
  const money = n => Number(n || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' ' + (window.CUR || 'FCFA');
  const num = (n, d = 0) => Number(n || 0).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const ini = name => String(name || '').trim().split(/\s+/).slice(0, 2).map(w => w.charAt(0).toUpperCase()).join('') || '—';
  const SVG = (d) => '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  const ICON = {
    pump: SVG('<rect x="4" y="3" width="10" height="18" rx="1.5"/><path d="M14 9h2a2 2 0 0 1 2 2v5a1.5 1.5 0 0 0 3 0V8l-2-2"/><path d="M7 7h4"/>'),
    clock: SVG('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    wallet: SVG('<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M16 12h2"/><path d="M3 9h18"/>'),
    chart: SVG('<path d="M4 19V5"/><path d="M4 19h16"/><path d="M8 15l4-4 3 3 5-6"/>'),
    card: SVG('<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>'),
    drop: SVG('<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>'),
    receipt: SVG('<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>'),
    person: SVG('<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>'),
    cart: SVG('<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M3 4h2l2.5 11h10L20 7H6"/>'),
    gap: SVG('<path d="M12 3v18M5 8h14M5 16h14"/>')
  };

  function tile(label, icon, value, sub) {
    return '<div class="qv-tile"><span class="qv-tico">' + icon + '</span><div><small>' + esc(label) + '</small>' +
      '<b>' + value + '</b>' + (sub ? '<em>' + sub + '</em>' : '') + '</div></div>';
  }

  // Recette et volume par produit (Gasoil, Super…). Sans vente : une ligne « Recette » à 0.
  function productRows(p) {
    const list = (p.products || []).filter(x => Number(x.recette) || Number(x.volume));
    if (!list.length) return '<li><span>' + ICON.drop + ' Recette</span><b>' + money(0) + '</b></li>';
    return list.map(x => '<li><span>' + ICON.drop + ' Recette ' + esc(x.name) + '</span><b>' + money(x.recette) + '</b></li>' +
      '<li><span>' + ICON.chart + ' Volume ' + esc(x.name) + '</span><b>' + num(x.volume, 0) + ' litre</b></li>').join('');
  }

  function pumpCard(p) {
    const on = (p.employees || []).length > 0;
    const who = on ? p.employees.map(e => e.name).filter(Boolean).join(' · ') : 'Aucun employé affecté';
    const role = on ? (p.employees[0].role || 'Employé') : '—';
    return '<article class="qv-pump">' +
      '<header><span class="qv-pico">' + ICON.pump + '</span><b>Pompe ' + esc(p.number) + '</b>' +
      '<span class="qv-chip ' + (on ? 'ok' : 'off') + '">' + (on ? 'Affectée' : 'Non affectée') + '</span></header>' +
      '<div class="qv-pbody"><div class="qv-av' + (on ? '' : ' off') + '">' + esc(on ? ini(p.employees[0].name) : '–') + '</div>' +
      '<div class="qv-pname"><b>' + esc(who) + '</b><small>' + esc(role) + ' – ' + esc(p.name || ('Pompe ' + p.number)) + '</small></div>' +
      '<ul class="qv-pstats">' + productRows(p) +
      '<li><span>' + ICON.receipt + ' Nombre de ventes</span><b>' + num(p.n, 0) + '</b></li>' +
      '</ul></div>' +
      '<footer><span>Total recette Pompe ' + esc(p.number) + '</span><b>' + money(p.recette) + '</b></footer>' +
      '</article>';
  }

  window.quartPanelHtml = function (cu, opts) {
    const pumps = Array.isArray(cu.pumps) ? cu.pumps : [];
    const prodTotal = Number((cu.sales || {}).total || 0), prodN = Number((cu.sales || {}).n || 0);
    const fuelTotal = pumps.reduce((a, p) => a + Number(p.recette || 0), 0);
    const fuelLiters = pumps.reduce((a, p) => a + Number(p.volume || 0), 0);
    const fuelN = pumps.reduce((a, p) => a + Number(p.n || 0), 0);
    const general = prodTotal + fuelTotal;
    const gap = cu.cash_gap != null ? money(cu.cash_gap) : '—';
    const liters = Number((cu.fuel_declared || {}).liters || fuelLiters);
    return '<section class="qv" aria-label="Quart en cours">' +
      '<div class="qv-top">' +
        '<div class="qv-id"><span class="qv-idico">' + ICON.pump + '</span>' +
          '<div><h2>Quart N° ' + esc(cu.number) + '</h2>' +
          '<span class="qv-open">✔ OUVERT</span>' + (opts && opts.past ? ' <span class="qv-open past">passé</span>' : '') + '</div>' +
          '<div class="qv-clock">' + ICON.clock + '<span id="shift-timer" data-start="' + esc(cu.opened_at) + '" title="Temps écoulé depuis l\'ouverture du quart">00:00:00</span></div>' +
        '</div>' +
        '<div class="qv-kpis">' +
          tile('Caisse initiale', ICON.wallet, money(cu.opening_cash)) +
          tile('Ventes de produits', ICON.chart, money(prodTotal)) +
          tile('Crédit', ICON.card, money((cu.credit || {}).total || 0)) +
          tile('Carburant déclaré', ICON.drop, num(liters, 0) + ' L') +
          tile('Dépense', ICON.receipt, money((cu.expenses || {}).total || 0)) +
          tile('Chef de quart', ICON.person, esc(cu.chief || '—')) +
        '</div>' +
      '</div>' +
      '<div class="qv-pumps' + (pumps.length > 2 ? ' qv-many' : '') + '">' + (pumps.length ? pumps.map(pumpCard).join('') : '<p class="qv-empty">Aucune pompe active sur cette station.</p>') + '</div>' +
      ((typeof can === 'function' && can('sale.create')) ? '<div class="qv-actions"><button type="button" class="qv-scan" onclick="openScanSale()">📷 Vente par scan</button></div>' : '') +
      '<div class="qv-total">' +
        '<div class="qv-tlabel"><span class="qv-tico big">' + ICON.gap + '</span><b>Total Général du Quart</b></div>' +
        '<div class="qv-tamount">' + money(general) + '</div>' +
        '<div class="qv-tstat"><span>' + ICON.drop + ' Total Litres</span><b>' + num(fuelLiters, 0) + ' L</b></div>' +
        '<div class="qv-tstat"><span>' + ICON.cart + ' Total Ventes</span><b>' + num(prodN + fuelN, 0) + '</b></div>' +
        '<div class="qv-tstat"><span>' + ICON.gap + ' Écart Caisse</span><b>' + gap + '</b></div>' +
      '</div>' +
    '</section>';
  };
})();
