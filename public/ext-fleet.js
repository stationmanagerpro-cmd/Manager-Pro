/* Cartes carburant / flottes : cartes par véhicule d'un client entreprise, plafonds, blocage, historique, relevé mensuel. CORR-040 */
(function () {
  'use strict';
  if (typeof V === 'undefined' || typeof VM === 'undefined') return;

  var ST = { active: ['Active', 'ok'], blocked: ['Bloquée', 'x'], lost: ['Perdue', 'x'], expired: ['Expirée', 'x'] };
  var REASONS = {
    CARTE_INACTIVE: 'Carte bloquée, perdue ou expirée', CARTE_EXPIREE: 'Carte expirée', PIN_INVALIDE: 'PIN incorrect', PRODUIT_NON_AUTORISE: 'Produit non autorisé',
    JOUR_NON_AUTORISE: 'Jour non autorisé', HORAIRE_NON_AUTORISE: 'Hors des horaires autorisés', PLAFOND_TRANSACTION_L: 'Plafond par prise (L)', PLAFOND_TRANSACTION_MONTANT: 'Plafond par prise (montant)',
    PLAFOND_JOUR_L: 'Plafond du jour (L)', PLAFOND_JOUR_MONTANT: 'Plafond du jour (montant)', PLAFOND_MOIS_L: 'Plafond du mois (L)', PLAFOND_MOIS_MONTANT: 'Plafond du mois (montant)',
    NB_TRANSACTIONS_JOUR: 'Nombre de prises du jour atteint', KILOMETRAGE_REQUIS: 'Kilométrage obligatoire', KILOMETRAGE_INCOHERENT: 'Kilométrage inférieur au dernier relevé'
  };
  var state = { customer: '' };
  function canEdit() { return typeof can === 'function' && can('customer.edit'); }
  function n1(x) { return Number(x || 0).toLocaleString(typeof loc === 'function' ? loc() : 'fr-FR', { maximumFractionDigits: 1 }); }
  function useBar(used, max, unit) {
    if (!max) return '<span class="muted">' + n1(used) + ' ' + unit + ' · sans plafond</span>';
    var pct = Math.min(100, Math.round(used / max * 100)), col = pct >= 100 ? 'var(--r)' : pct >= 80 ? '#d97706' : 'var(--g)';
    return '<div style="min-width:130px"><div style="font-size:12px">' + n1(used) + ' / ' + n1(max) + ' ' + unit + '</div><div style="height:5px;background:color-mix(in srgb,var(--m) 20%,transparent);border-radius:3px"><div style="height:5px;width:' + pct + '%;background:' + col + ';border-radius:3px"></div></div></div>';
  }
  function limitsLine(c) {
    var a = [];
    if (c.max_liters_tx) a.push(n1(c.max_liters_tx) + ' L/prise'); if (c.max_liters_day) a.push(n1(c.max_liters_day) + ' L/jour');
    if (c.max_tx_day) a.push(c.max_tx_day + ' prises/jour'); if (c.hours_from) a.push(String(c.hours_from).slice(0, 5) + '–' + String(c.hours_to).slice(0, 5));
    if (c.allowed_days && c.allowed_days.length) a.push('jours ' + c.allowed_days.join(','));
    if (c.requires_odometer) a.push('km obligatoire'); if (c.has_pin) a.push('PIN');
    return a.length ? a.join(' · ') : 'aucune restriction';
  }
  function csvDays(s) { return String(s || '').split(/[,\s;]+/).map(Number).filter(function (x) { return x >= 1 && x <= 7; }); }
  function orNull(x) { return x > 0 ? x : null; }

  async function vFleet() {
    // Filtre par période (RT) : le serveur ajoute `period` (prises, litres, montant, refus) et ne garde que les cartes actives sur la période.
    var rt = window.RT, per = rt ? rt.applied('flotte') : null, qs = [];
    if (rt) rt.register('flotte', { view: 'flotte', pdf: fleetPdf });
    if (state.customer) qs.push('customer_id=' + encodeURIComponent(state.customer));
    if (per) qs.push('from=' + per.from, 'to=' + per.to, 'active_only=1');
    var res = await Promise.all([G('/customers'), G('/fleet/cards' + (qs.length ? '?' + qs.join('&') : ''))]);
    var customers = (res[0] || []).filter(function (c) { return c.active !== false; }), cards = res[1];
    var tot = cards.reduce(function (a, c) { var p = c.period || {}; a.uses += p.uses || 0; a.liters += p.liters || 0; a.amount += p.amount || 0; a.declines += p.declines || 0; return a; }, { uses: 0, liters: 0, amount: 0, declines: 0 });
    tot.liters = Math.round(tot.liters * 1000) / 1000; tot.amount = Math.round(tot.amount * 100) / 100;
    window.__fleetView = { cards: cards, customers: customers, period: per, customerId: state.customer, totals: tot };
    var html = '<h2 style="margin-top:0">Cartes flotte</h2>' +
      '<p class="muted">Une carte par véhicule, rattachée à un client entreprise. À la vente carburant, la carte est contrôlée (plafonds, produit, horaires, PIN, kilométrage) et la vente est facturée au client. Une prise hors règles est refusée.</p>' +
      '<div class="bar" style="flex-wrap:wrap;gap:8px;align-items:end"><label>Client<select id="fl_cust" onchange="fleetFilter(this.value)"><option value="">Tous</option>' +
      customers.map(function (c) { return '<option value="' + c.id + '"' + (String(c.id) === String(state.customer) ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') + '</select></label>' +
      (canEdit() ? '<button class="b1" onclick="fleetAdd()">Nouvelle carte</button>' : '') + '<button class="b2" onclick="fleetStatement()">Relevé mensuel</button>' + (canEdit() ? '<button class="b1" onclick="fleetInvoices()">Facturer les mois écoulés</button>' : '') + '<button class="b2" onclick="go(\'flotte\')">Actualiser</button></div>' +
      (rt ? rt.bar('flotte') : '') +
      (per ? '<div class="cards">' + card('Cartes actives sur la période', cards.length) + card('Prises', tot.uses) + card('Litres', n1(tot.liters) + ' L') + card('Montant', f(tot.amount), tot.declines ? tot.declines + ' refus' : '') + '</div>' +
        '<p class="muted" style="font-size:12px;margin:4px 0 8px">Période ' + esc(rt.label('flotte')) + ' : cartes ayant au moins une prise ou un refus. Prises = ventes valides (hors annulées), comme le relevé mensuel.</p>' : '') +
      '<div class="card" style="overflow:auto"><table><thead><tr><th>Carte</th><th>Véhicule / conducteur</th><th>Client</th><th>Statut</th>' + (per ? '<th>Prises</th><th>Litres</th><th>Montant</th><th>Refus</th>' : '') + '<th>Aujourd’hui</th><th>Ce mois</th><th>Règles</th><th></th></tr></thead><tbody>' +
      (cards.length ? cards.map(function (c) {
        var s = ST[c.status] || [c.status, 'x'];
        return '<tr><td><b>' + esc(c.card_number) + '</b></td><td>' + esc(c.label) + (c.driver_name ? '<br><span class="muted">' + esc(c.driver_name) + '</span>' : '') + '</td><td>' + esc(c.customer_name) + '</td>' +
          '<td><span class="tag ' + s[1] + '">' + s[0] + '</span>' + (c.blocked_reason ? '<div class="muted" style="font-size:12px">' + esc(c.blocked_reason) + '</div>' : '') + '</td>' +
          (per ? '<td>' + (c.period.uses || 0) + '</td><td>' + n1(c.period.liters) + '</td><td>' + n1(c.period.amount) + '</td><td>' + (c.period.declines || 0) + '</td>' : '') +
          '<td>' + useBar(c.usage.dayLiters, c.max_liters_day, 'L') + '</td><td>' + useBar(c.usage.monthLiters, c.max_liters_month, 'L') + '</td><td style="font-size:12px">' + esc(limitsLine(c)) + '</td><td style="white-space:nowrap">' +
          (canEdit() ? '<button class="b2" onclick="fleetEdit(' + c.id + ')">Modifier</button> ' + (c.status === 'active' ? '<button class="b2" onclick="fleetBlock(' + c.id + ')">Bloquer</button> ' : '<button class="b2" onclick="fleetUnblock(' + c.id + ')">Réactiver</button> ') : '') +
          '<button class="b2" onclick="fleetEvents(' + c.id + ')">Historique</button></td></tr>';
      }).join('') : '<tr><td colspan="' + (per ? 12 : 8) + '" class="muted">' + (per ? 'Aucune carte active sur cette période.' : 'Aucune carte' + (canEdit() ? '. Cliquez sur « Nouvelle carte ».' : '.')) + '</td></tr>') + '</tbody>' +
      (per && cards.length ? '<tfoot><tr><th colspan="4">Total période</th><th>' + tot.uses + '</th><th>' + n1(tot.liters) + '</th><th>' + n1(tot.amount) + '</th><th>' + tot.declines + '</th><th colspan="4"></th></tr></tfoot>' : '') + '</table></div>';
    window.__fleetCards = cards; window.__fleetCustomers = customers;
    return html;
  }
  window.fleetFilter = function (v) { state.customer = v; go('flotte'); };

  /** Rapport PDF des cartes flotte : exactement les cartes affichées (client + période appliqués). */
  function fleetPdf() {
    var v = window.__fleetView || { cards: [], totals: {} }, rt = window.RT, per = v.period, cards = v.cards || [];
    if (!cards.length && !per) { toast('Aucune carte à exporter', 'info'); return null; }
    var cust = v.customerId ? ((v.customers || []).filter(function (c) { return String(c.id) === String(v.customerId); })[0] || {}).name : 'Tous les clients';
    var T0 = v.totals || {}, sections = [];
    sections.push(rt.H.kv('Filtres appliqués', [['Client', cust], ['Période', per ? rt.label('flotte') : 'Toutes les dates (pas de filtre de période)'], ['Cartes listées', String(cards.length)]]));
    if (per) {
      sections.push(rt.H.kpis([{ label: 'Cartes actives sur la période', value: cards.length }, { label: 'Prises', value: T0.uses || 0 }, { label: 'Litres', value: T0.liters || 0 }, { label: 'Montant (' + rt.H.cur() + ')', value: T0.amount || 0 }, { label: 'Refus', value: T0.declines || 0 }], 'Synthèse de la période'));
    } else {
      var act = cards.filter(function (c) { return c.status === 'active'; }).length;
      sections.push(rt.H.kpis([{ label: 'Cartes', value: cards.length }, { label: 'Actives', value: act }, { label: 'Bloquées / perdues / expirées', value: cards.length - act }, { label: 'Litres du jour', value: Math.round(cards.reduce(function (a, c) { return a + (c.usage ? c.usage.dayLiters : 0); }, 0) * 1000) / 1000 }, { label: 'Litres du mois', value: Math.round(cards.reduce(function (a, c) { return a + (c.usage ? c.usage.monthLiters : 0); }, 0) * 1000) / 1000 }], 'Synthèse'));
    }
    var head = ['Carte', 'Véhicule', 'Conducteur', 'Client', 'Statut'], rows;
    if (per) {
      head = head.concat(['Prises', 'Litres', 'Montant (' + rt.H.cur() + ')', 'Refus', 'Règles']);
      rows = cards.map(function (c) { var s = ST[c.status] || [c.status]; return [c.card_number, c.label, c.driver_name || '', c.customer_name, s[0] + (c.blocked_reason ? ' (' + c.blocked_reason + ')' : ''), c.period.uses || 0, c.period.liters || 0, c.period.amount || 0, c.period.declines || 0, limitsLine(c)]; });
    } else {
      head = head.concat(['Aujourd’hui (L)', 'Ce mois (L)', 'Règles']);
      rows = cards.map(function (c) { var s = ST[c.status] || [c.status]; return [c.card_number, c.label, c.driver_name || '', c.customer_name, s[0] + (c.blocked_reason ? ' (' + c.blocked_reason + ')' : ''), c.usage.dayLiters, c.usage.monthLiters, limitsLine(c)]; });
    }
    var tbl = { type: 'table', title: 'Cartes flotte', head: head, rows: rows };
    if (per) tbl.totals = ['TOTAL', '', '', '', '', T0.uses || 0, T0.liters || 0, T0.amount || 0, T0.declines || 0, ''];
    sections.push(tbl);
    return { title: 'Cartes flotte', subtitle: cust, period: per ? rt.label('flotte') : 'Toutes les dates', sections: sections, landscape: true, filename: 'cartes-flotte' };
  }

  async function productOpts() {
    var p = await G('/products').catch(function () { return []; });
    return [['', 'Tous les produits']].concat((p || []).filter(function (x) { return x.category_has_meter; }).map(function (x) { return [x.id, x.name]; }));
  }
  function bodyFrom(d, isNew) {
    var b = { label: d.label, driver_name: d.driver_name || null, max_liters_tx: orNull(d.max_liters_tx), max_liters_day: orNull(d.max_liters_day), max_liters_month: orNull(d.max_liters_month),
      max_amount_month: orNull(d.max_amount_month), max_tx_day: orNull(d.max_tx_day), hours_from: d.hours_from || null, hours_to: d.hours_to || null,
      allowed_days: csvDays(d.allowed_days), allowed_product_ids: d.product_id ? [Number(d.product_id)] : [], requires_odometer: d.requires_odometer === 'oui', expires_on: d.expires_on || null };
    if (d.pin) b.pin = String(d.pin).trim();
    if (isNew) b.customer_id = Number(d.customer_id);
    return b;
  }
  function fields(isNew, prods, customers) {
    var f = [];
    if (isNew) f.push(['customer_id', 'Client (entreprise)', 's', customers.map(function (c) { return [c.id, c.name]; })]);
    f.push(['label', 'Véhicule (plaque)'], ['driver_name', 'Conducteur (facultatif)'], ['pin', isNew ? 'Code PIN 4 à 6 chiffres (facultatif)' : 'Nouveau PIN (laisser vide pour conserver)'],
      ['product_id', 'Produit autorisé', 's', prods], ['max_liters_tx', 'Plafond par prise (L, 0 = aucun)', 'number'], ['max_liters_day', 'Plafond par jour (L, 0 = aucun)', 'number'],
      ['max_liters_month', 'Plafond par mois (L, 0 = aucun)', 'number'], ['max_amount_month', 'Plafond par mois (FCFA, 0 = aucun)', 'number'], ['max_tx_day', 'Prises max par jour (0 = aucune limite)', 'number'],
      ['hours_from', 'Heure de début (HH:MM, facultatif)'], ['hours_to', 'Heure de fin (HH:MM)'], ['allowed_days', 'Jours autorisés (1 = lundi … 7 = dimanche, ex. 1,2,3,4,5 ; vide = tous)'],
      ['requires_odometer', 'Kilométrage obligatoire à chaque prise', 's', [['non', 'Non'], ['oui', 'Oui']]], ['expires_on', 'Expire le (AAAA-MM-JJ, facultatif)']);
    return f;
  }
  window.fleetAdd = async function () {
    var prods = await productOpts(), cu = window.__fleetCustomers || [];
    if (!cu.length) { toast('Créez d’abord un client entreprise', 'error'); return; }
    form('Nouvelle carte flotte', fields(true, prods, cu), {}, async function (d) {
      var r = await Po('/fleet/cards', bodyFrom(d, true)); closeM(); toast('Carte créée : ' + r.card_number, 'success'); go('flotte');
    });
  };
  window.fleetEdit = async function (id) {
    var c = (window.__fleetCards || []).find(function (x) { return x.id === id; }); if (!c) return;
    var prods = await productOpts();
    var v = { label: c.label, driver_name: c.driver_name || '', product_id: (c.allowed_product_ids || [])[0] || '', max_liters_tx: c.max_liters_tx || 0, max_liters_day: c.max_liters_day || 0, max_liters_month: c.max_liters_month || 0,
      max_amount_month: c.max_amount_month || 0, max_tx_day: c.max_tx_day || 0, hours_from: c.hours_from ? String(c.hours_from).slice(0, 5) : '', hours_to: c.hours_to ? String(c.hours_to).slice(0, 5) : '',
      allowed_days: (c.allowed_days || []).join(','), requires_odometer: c.requires_odometer ? 'oui' : 'non', expires_on: c.expires_on ? String(c.expires_on).slice(0, 10) : '' };
    form('Modifier la carte ' + c.card_number, fields(false, prods, []), v, async function (d) {
      await api('PATCH', '/fleet/cards/' + id, bodyFrom(d, false)); closeM(); toast('Carte modifiée', 'success'); go('flotte');
    });
  };
  window.fleetBlock = function (id) {
    form('Bloquer la carte', [['status', 'Motif', 's', [['blocked', 'Bloquée (suspension)'], ['lost', 'Perdue ou volée']]], ['reason', 'Précision (facultatif)']], {}, async function (d) {
      await Po('/fleet/cards/' + id + '/block', { status: d.status, reason: d.reason || undefined }); closeM(); toast('Carte bloquée : plus aucune prise possible', 'success'); go('flotte');
    });
  };
  window.fleetUnblock = async function (id) {
    if (!confirm('Réactiver cette carte ?')) return;
    try { await Po('/fleet/cards/' + id + '/unblock'); toast('Carte réactivée', 'success'); go('flotte'); } catch (e) { toast(typeof errMsg === 'function' ? errMsg(e) : e.message, 'error'); }
  };
  window.fleetEvents = async function (id) {
    var rows = await G('/fleet/cards/' + id + '/events'), K = { use: 'Prise', decline: 'Refus', block: 'Blocage', unblock: 'Réactivation', create: 'Création', update: 'Modification' };
    modal('<h3>Historique de la carte</h3><div style="max-height:55vh;overflow:auto"><table><thead><tr><th>Date</th><th>Événement</th><th>Litres</th><th>Montant</th><th>Km</th><th>Détail</th></tr></thead><tbody>' +
      (rows.length ? rows.map(function (e) {
        var det = e.reasons && e.reasons.length ? e.reasons.map(function (c) { return REASONS[c] || c; }).join(' ; ') : (e.note || e.product_name || '');
        return '<tr><td>' + dt(e.created_at) + '</td><td>' + (K[e.kind] || e.kind) + '</td><td>' + (e.liters != null ? n1(e.liters) : '') + '</td><td>' + (e.amount != null ? n1(e.amount) : '') + '</td><td>' + (e.odometer_km != null ? n1(e.odometer_km) : '') + '</td><td style="font-size:12px">' + esc(det) + '</td></tr>';
      }).join('') : '<tr><td colspan="6" class="muted">Aucun événement.</td></tr>') + '</tbody></table></div><div class="r"><button class="b2" onclick="closeM()">Fermer</button></div>');
  };
  window.fleetStatement = function () {
    var cu = window.__fleetCustomers || [], m = new Date().toISOString().slice(0, 7);
    form('Relevé mensuel', [['customer_id', 'Client', 's', cu.map(function (c) { return [c.id, c.name]; })], ['month', 'Mois (AAAA-MM)']], { customer_id: state.customer || '', month: m }, async function (d) {
      var s = await G('/fleet/statement?customer_id=' + d.customer_id + '&month=' + encodeURIComponent(d.month)); closeM();
      modal('<h3>Relevé ' + esc(s.month) + ' — ' + esc(s.customer.name) + '</h3><div style="max-height:55vh;overflow:auto"><table><thead><tr><th>Carte</th><th>Véhicule</th><th>Prises</th><th>Litres</th><th>Montant</th><th>Consommation</th></tr></thead><tbody>' +
        (s.cards.length ? s.cards.map(function (c) { return '<tr><td>' + esc(c.card_number) + '</td><td>' + esc(c.label) + '</td><td>' + c.lines.length + '</td><td>' + n1(c.liters) + '</td><td>' + n1(c.amount) + '</td><td>' + (c.consumption ? c.consumption.l_per_100km + ' L/100 km' : '—') + '</td></tr>'; }).join('') : '<tr><td colspan="6" class="muted">Aucune prise ce mois-ci.</td></tr>') +
        '</tbody><tfoot><tr><th colspan="2">Total</th><th>' + s.total.transactions + '</th><th>' + n1(s.total.liters) + '</th><th>' + n1(s.total.amount) + '</th><th></th></tr></tfoot></table></div>' +
        '<div class="r"><button class="b2" onclick="dlFile(\'/fleet/statement?customer_id=' + d.customer_id + '&month=' + encodeURIComponent(d.month) + '&format=csv\',\'releve-flotte-' + esc(d.month) + '.csv\')">Télécharger (CSV)</button><button class="b2" onclick="closeM()">Fermer</button></div>');
    });
  };

  window.fleetInvoices = async function () {
    var rows = await G('/fleet/invoices/pending');
    modal('<h3>Factures flotte à émettre</h3><p class="muted">Mois terminés avec des prises carte non facturées. La facture regroupe les prises par carte et produit ; elle ne crée pas de chiffre d’affaires supplémentaire (déjà enregistré à la vente) et son paiement réduit le solde du client.</p>' +
      '<div style="max-height:55vh;overflow:auto"><table><thead><tr><th>Client</th><th>Mois</th><th>Prises</th><th>Litres</th><th>Montant</th><th></th></tr></thead><tbody>' +
      (rows.length ? rows.map(function (x) { return '<tr><td>' + esc(x.customer_name) + '</td><td>' + esc(x.month) + '</td><td>' + x.transactions + '</td><td>' + n1(Number(x.liters)) + '</td><td>' + n1(Number(x.amount)) + '</td><td><button class="b1" onclick="fleetInvoiceGo(' + x.customer_id + ',\'' + esc(x.month) + '\')">Facturer</button></td></tr>'; }).join('') : '<tr><td colspan="6" class="muted">Rien à facturer.</td></tr>') +
      '</tbody></table></div><div class="r"><button class="b2" onclick="closeM()">Fermer</button></div>');
  };
  window.fleetInvoiceGo = function (customerId, month) {
    form('Facturer ' + month, [['due_days', 'Échéance (jours)', 'number']], { due_days: 30 }, async function (d) {
      try {
        var inv = await Po('/fleet/invoices/generate', { customer_id: customerId, month: month, due_days: Number(d.due_days) || 30 });
        closeM(); toast('Facture ' + inv.invoice_no + ' émise (' + inv.events_count + ' prises)', 'success'); window.fleetInvoices();
      } catch (e) { toast(typeof errMsg === 'function' ? errMsg(e) : (e.message || 'Erreur'), 'error'); }
    });
  };

  V.flotte = ['Cartes flotte', 'customer.view|sale.create|customer.edit'];
  VM.flotte = vFleet;
  if (typeof NAV_ICONS !== 'undefined') NAV_ICONS.flotte = '💳';
})();
