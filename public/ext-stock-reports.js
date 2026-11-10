/* Gestion des stocks + Centre de rapports — hubs dédiés (gratuit) */
(function () {
  'use strict';
  if (typeof V === 'undefined' || typeof VM === 'undefined') return;

  function money(n) {
    try { return typeof f === 'function' ? f(n) : Number(n || 0).toLocaleString('fr-FR'); } catch (e) { return String(n); }
  }
  function qty(n) {
    try { return typeof fl === 'function' ? fl(n) : Number(n || 0).toLocaleString('fr-FR'); } catch (e) { return String(n); }
  }

  /* ========== STOCK ========== */
  V.stock = ['Gestion des stocks', 'stock.adjust|report.view|sale.create|price.edit'];
  if (typeof NAV_ICONS !== 'undefined') NAV_ICONS.stock = '📦';

  async function vStock() {
    if (ME && ME.is_global) {
      return '<p class="warn">La gestion des stocks est réservée aux comptes station.</p>';
    }
    var overview = await G('/stock/overview').catch(function (e) {
      return { error: e.message || String(e) };
    });
    if (overview && overview.error) {
      return '<p class="warn">' + esc(overview.error) + '</p><button class="b2" onclick="go(\'prod\')">Produits</button>';
    }

    var products = await G('/products').catch(function () { return []; });
    var low = overview.low_stock || [];
    var recent = overview.recent_movements || [];

    var html = '<h2 style="margin-top:0">Gestion des stocks</h2>' +
      '<p class="muted">Pilotage des quantités, seuils, mouvements et valorisation. Les ventes et achats mettent le stock à jour automatiquement.</p>';

    html += '<div class="cards">' +
      '<div class="card"><small>Produits</small><b>' + (overview.products_count || products.length || 0) + '</b></div>' +
      '<div class="card"><small>Alertes stock bas</small><b style="' + ((overview.low_count || 0) > 0 ? 'color:var(--r)' : '') + '">' + (overview.low_count || 0) + '</b></div>' +
      (can('cost.view') ? '<div class="card"><small>Valeur au prix d\'achat</small><b>' + money(overview.stock_value_buy) + '</b></div>' : '') +
      '<div class="card"><small>Valeur au prix de vente</small><b>' + money(overview.stock_value_sell) + '</b></div>' +
      '</div>';

    html += '<div class="bar" style="margin:14px 0;flex-wrap:wrap;gap:8px">' +
      (can('price.edit') ? '<button onclick="go(\'prod\')">Catalogue produits</button>' : '') +
      (can('stock.adjust') ? '<button onclick="typeof addMv===\'function\'?addMv():go(\'prod\')">Mouvement de stock</button>' : '') +
      (can('purchase.manage') ? '<button class="b2" onclick="go(\'four\')">Achats / réceptions</button>' : '') +
      '<button class="b2" onclick="go(\'rapports\')">Rapports</button>' +
      '<button class="b2" onclick="go(\'exports\')">Exporter le stock</button>' +
      (typeof opsScanNotif === 'function' ? '<button class="b2" onclick="opsScanNotif()">Scanner alertes stock</button>' : '') +
      '</div>';

    // Low stock
    html += '<div class="card" style="text-align:left;margin-bottom:12px"><h3 style="margin-top:0">Stock sous le seuil minimum</h3>';
    if (low.length) {
      html += T(['Produit', 'Catégorie', 'Qté', 'Seuil', 'Unité'], low.map(function (p) {
        return [esc(p.name), esc(p.category || ''), qty(p.quantity), p.min_stock, esc(p.unit || '')];
      }));
    } else {
      html += (typeof emptyState === 'function'
        ? emptyState({ icon: '✅', title: 'Aucun produit sous seuil', desc: 'Les quantités respectent les minima définis.' })
        : '<p class="muted">Aucun produit sous seuil.</p>');
    }
    html += '</div>';

    // Full inventory table
    html += '<div class="card" style="text-align:left;margin-bottom:12px"><h3 style="margin-top:0">Inventaire</h3>' +
      '<div class="bar"><input class="q" placeholder="Filtrer…" oninput="flt(this)"></div>';
    if (products.length) {
      var costOn = can('cost.view');   // RG-03 : prix et valeur d'achat réservés à « cost.view »
      html += T(['Produit', 'Catégorie', 'Qté', 'Seuil'].concat(costOn ? ['P.Achat'] : [], ['P.Vente'], costOn ? ['Val. achat'] : []), products.map(function (p) {
        var q = Number(p.stock != null ? p.stock : p.quantity) || 0;
        var min = Number(p.min_stock) || 0;
        var tag = q <= min ? ' <span class="tag x">bas</span>' : '';
        return [
          esc(p.name) + tag,
          esc(p.category || ''),
          qty(q) + ' ' + esc(p.unit || ''),
          min
        ].concat(costOn ? [money(p.buy_price)] : [], [money(p.sell_price)], costOn ? [money(q * Number(p.buy_price || 0))] : []);
      }));
    } else {
      html += (typeof emptyState === 'function'
        ? emptyState({ icon: '📦', title: 'Aucun produit', desc: 'Créez des produits pour gérer le stock.', action: can('price.edit') ? '<button onclick="go(\'prod\')">Ajouter un produit</button>' : '' })
        : '<p class="muted">Aucun produit.</p>');
    }
    html += '</div>';

    // Recent movements
    html += '<div class="card" style="text-align:left"><h3 style="margin-top:0">Derniers mouvements</h3>';
    if (recent.length) {
      html += T(['Date', 'Produit', 'Type', 'Qté', 'Par', 'Commentaire'], recent.map(function (m) {
        return [
          typeof dt === 'function' ? dt(m.created_at) : m.created_at,
          esc(m.product),
          '<span class="tag">' + esc(m.kind) + '</span>',
          qty(m.quantity),
          esc(m.login || '—'),
          esc(m.comment || '')
        ];
      }));
    } else {
      html += '<p class="muted">Aucun mouvement récent.</p>';
    }
    html += '</div>';

    return html;
  }

  /* ========== RAPPORTS ========== */
  V.rapports = ['Rapports', 'report.view|finance.view|export.customers|stock.adjust'];
  if (typeof NAV_ICONS !== 'undefined') NAV_ICONS.rapports = '📑';

  async function vRapports() {
    if (ME && ME.is_global) {
      return '<p class="warn">Les rapports station sont réservés aux comptes clients. Utilisez Finance plateforme / exports Super Admin.</p>';
    }
    var day = new Date().toISOString().slice(0, 10);

    var cards = [
      { title: 'Pilotage direction', desc: 'KPI du jour, multi-stations, alertes.', go: 'direction', need: 'report.view|finance.view|user.manage' },
      { title: 'Fin de journée', desc: 'Synthèse + PDF + exports CSV.', go: 'eod', need: 'report.view|finance.view|shift.close' },
      { title: 'Rapprochement', desc: 'Pompes, ventes, caisse et écarts.', go: 'reconcile', need: 'report.view|finance.view|shift.close' },
      { title: 'Dashboard', desc: 'Graphiques et période personnalisable.', go: 'dash', need: 'report.view|finance.view' },
      { title: 'Jour J', desc: 'Détail opérationnel du jour.', go: 'jour', need: 'report.view|finance.view' },
      { title: 'Gestion des stocks', desc: 'Inventaire, seuils, mouvements.', go: 'stock', need: 'stock.adjust|report.view' },
      { title: 'Exports PDF / Excel / CSV', desc: 'Ventes, stocks, caisse, quarts…', go: 'exports', need: 'report.view|finance.view|sale.create' },
      { title: 'Commissions Mobile Money', desc: 'Estimation des frais opérateurs.', go: 'mmcomm', need: 'finance.view|cash.manage' },
      { title: 'Facturation', desc: 'Factures clients et PDF.', go: 'factures', need: 'sale.create|finance.view|customer.view' },
      { title: 'Journal d\'audit', desc: 'Qui a fait quoi, quand.', go: 'audit', need: 'audit.view' }
    ];

    var html = '<h2 style="margin-top:0">Centre de rapports</h2>' +
      '<p class="muted">Accès rapide à tous les rapports et exports de la station. Date de référence : <b>' + esc(day) + '</b>.</p>' +
      '<div class="cards">';

    cards.forEach(function (c) {
      var ok = !c.need || (typeof can === 'function' && can(c.need));
      if (!ok && typeof canView === 'function') {
        // still show disabled if view exists
      }
      if (!ok) return;
      html += '<div class="card" style="text-align:left">' +
        '<b>' + esc(c.title) + '</b>' +
        '<p style="color:var(--m);font-size:13px;margin:8px 0 12px">' + esc(c.desc) + '</p>' +
        '<button class="b2" onclick="go(\'' + c.go + '\')">Ouvrir</button>' +
        '</div>';
    });
    html += '</div>';

    // Quick export strip
    html += '<div class="card" style="margin-top:14px;text-align:left">' +
      '<h3 style="margin-top:0">Exports rapides (aujourd\'hui)</h3>' +
      '<div class="bar" style="flex-wrap:wrap;gap:8px">' +
      '<button class="b2" onclick="typeof modernExportCompta===\'function\'&&modernExportCompta(\'sales\',\'csv\')">Ventes CSV</button>' +
      '<button class="b2" onclick="typeof modernExportCompta===\'function\'&&modernExportCompta(\'expenses\',\'csv\')">Dépenses CSV</button>' +
      '<button class="b2" onclick="typeof modernExportCompta===\'function\'&&modernExportCompta(\'stock\',\'xlsx\')">Stock Excel</button>' +
      '<button class="b2" onclick="typeof modernDownloadEodPdf===\'function\'&&modernDownloadEodPdf()">PDF fin de journée</button>' +
      '<button class="b2" onclick="go(\'exports\')">Tous les exports…</button>' +
      '</div></div>';

    return html;
  }

  Object.assign(VM, { stock: vStock, rapports: vRapports });
})();
