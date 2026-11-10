/* Pack modernisation professionnelle — additive, ne remplace pas les modules existants */
(function () {
  'use strict';
  if (typeof V === 'undefined' || typeof VM === 'undefined') return;

  /* ---------- Helpers UI ---------- */
  window.emptyState = function (opts) {
    opts = opts || {};
    var title = opts.title || 'Aucune donnée';
    var desc = opts.desc || 'Les éléments apparaîtront ici dès qu’ils seront créés.';
    var action = opts.action || '';
    var icon = opts.icon || '📭';
    return '<div class="empty-state">' +
      '<div class="empty-state-icon">' + icon + '</div>' +
      '<h3>' + (typeof esc === 'function' ? esc(title) : title) + '</h3>' +
      '<p>' + (typeof esc === 'function' ? esc(desc) : desc) + '</p>' +
      (action || '') +
      '</div>';
  };

  function onboardKey() {
    return 'smp-onboard-done-' + (ME && ME.id ? ME.id : 'x');
  }
  function stepKey() {
    return 'smp-onboard-steps-' + (ME && ME.id ? ME.id : 'x');
  }

  /* ---------- Onboarding 5 étapes (gérant) / 3 (employé) ---------- */
  async function vOnboardingPro() {
    if (ME && ME.is_global) {
      return '<h2 style="margin-top:0">Espace plateforme</h2>' +
        '<p class="muted">Vous êtes Super Admin. Gérez les clients, licences et l’identité de l’application.</p>' +
        '<div class="cards">' +
        '<div class="card"><b>Comptes clients</b><p class="muted">Créer et paramétrer les contrats</p><button onclick="go(\'clients\')">Ouvrir</button></div>' +
        '<div class="card"><b>Identité / login</b><p class="muted">Logo, couleurs, panneau de connexion</p><button class="b2" onclick="go(\'admin\')">Centre admin</button></div>' +
        '</div>';
    }
    var isManager = !ME.is_global && (ME.role === 'GERANT' || ME.role === 'ADMIN' ||
      (Array.isArray(ME.permissions) && (ME.permissions.indexOf('user.manage') >= 0 || ME.permissions.indexOf('settings.edit') >= 0)));
    var steps = isManager ? [
      { id: 'station', title: '1. Identité de la station', desc: 'Nom, adresse, devise, logo.', action: 'admin', label: 'Administration', check: 'station' },
      { id: 'pompes', title: '2. Pompes et compteurs', desc: 'Configurez chaque pompe et l’index de départ.', action: 'pompes', label: 'Pompes', check: 'pompes' },
      { id: 'prod', title: '3. Produits et seuils stock', desc: 'Carburants, prix, stock minimum pour les alertes.', action: 'prod', label: 'Produits', check: 'prod' },
      { id: 'emp', title: '4. Employés et accès', desc: 'Fiches employés puis octroi de comptes utilisateurs.', action: 'emp', label: 'Employés', check: 'emp' },
      { id: 'quart', title: '5. Premier quart de service', desc: 'Ouvrez un quart avec équipe, pompes et index.', action: 'quart', label: 'Quarts', check: 'quart' }
    ] : [
      { id: 'moi', title: '1. Mon profil', desc: 'Vérifiez votre profil, votre rôle et vos autorisations.', action: 'moi', label: 'Mon profil', check: 'moi' },
      { id: 'alert', title: '2. Alertes', desc: 'Consultez les notifications importantes.', action: 'alert', label: 'Alertes', check: 'alert' },
      { id: 'work', title: '3. Travail du jour', desc: 'Accédez aux modules autorisés (ventes, quarts…).', action: 'dash', label: 'Dashboard', check: 'work' }
    ];

    var doneMap = {};
    try { doneMap = JSON.parse(localStorage.getItem(stepKey()) || '{}') || {}; } catch (e) {}

    // Auto-detect progress from APIs (best effort)
    try {
      if (isManager) {
        var pumps = await G('/pumps').catch(function () { return []; });
        var products = await G('/products').catch(function () { return []; });
        var emps = await G('/employees').catch(function () { return []; });
        var shifts = await G('/shifts').catch(function () { return []; });
        if (pumps && pumps.length) doneMap.pompes = true;
        if (products && products.length) doneMap.prod = true;
        if (emps && emps.length) doneMap.emp = true;
        if (shifts && shifts.length) doneMap.quart = true;
        doneMap.station = true;
      }
    } catch (e) {}

    var completed = steps.filter(function (s) { return doneMap[s.check]; }).length;
    var pct = Math.round((completed / steps.length) * 100);

    var cards = steps.map(function (s) {
      var ok = !!doneMap[s.check];
      return '<div class="card onboard-card' + (ok ? ' onboard-done' : '') + '" style="text-align:left">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px">' +
        '<b>' + esc(s.title) + '</b>' +
        (ok ? '<span class="tag g">Fait</span>' : '<span class="tag">À faire</span>') +
        '</div>' +
        '<p style="color:var(--m);font-size:13.5px;margin:8px 0 12px">' + esc(s.desc) + '</p>' +
        '<button class="' + (ok ? 'b2' : '') + '" onclick="go(\'' + s.action + '\')">' + esc(s.label) + '</button>' +
        '</div>';
    }).join('');

    return '<h2 style="margin-top:0">Premiers pas</h2>' +
      '<p style="color:var(--m)">Bienvenue dans <b>' + esc(typeof brandName === 'function' ? brandName() : 'Manager PRO') +
      '</b>. Suivez ces étapes pour être opérationnel rapidement.</p>' +
      '<div class="card" style="margin-bottom:14px">' +
      '<div style="display:flex;justify-content:space-between;margin-bottom:6px"><span>Progression</span><b>' + completed + ' / ' + steps.length + ' (' + pct + '%)</b></div>' +
      '<div class="progress-bar"><div class="progress-bar-fill" style="width:' + pct + '%"></div></div>' +
      '</div>' +
      '<div class="cards">' + cards + '</div>' +
      '<div class="r" style="margin-top:16px;flex-wrap:wrap;gap:8px">' +
      '<button class="b2" onclick="go(\'direction\')">Vue direction</button>' +
      '<button class="b2" onclick="go(\'dash\')">Dashboard classique</button>' +
      '<button onclick="modernMarkOnboardDone()">J\'ai terminé le guide</button>' +
      '</div>';
  }

  window.modernMarkOnboardDone = function () {
    try { localStorage.setItem(onboardKey(), '1'); } catch (e) {}
    toast('Guide marqué comme terminé', 'success');
    go('direction');
  };

  /* ---------- Digest direction : boutons « Envoyer digest e-mail » et « Programmer digest 20h » ---------- */
  function digestErr(e) { toast(typeof errMsg === 'function' ? errMsg(e) : (e && e.message) || 'Action impossible', 'error'); }
  window.modernSendDigestNow = async function () {
    try {
      var to = prompt('E-mail destinataire (laisser vide = e-mail de la station) :');
      if (to === null) return;   // annulé
      to = (to || '').trim();
      if (to && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) { toast('Adresse e-mail invalide.', 'error'); return; }
      var r = await Po('/notifications/email-digest', to ? { to: to } : {});
      if (r && r.sent) toast('Digest envoyé à ' + r.to, 'success');
      else toast((r && r.note) || 'Rien à envoyer : vérifiez la configuration e-mail (SMTP).', 'error');
    } catch (e) { digestErr(e); }
  };
  window.modernPresetDailyDigest = async function () {
    try {
      var raw = prompt('Envoyer le digest chaque jour à quelle heure ? (HH:MM)', '20:00');
      if (raw === null) return;
      var time = (raw || '20:00').trim();
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) { toast('Heure invalide : utilisez le format HH:MM (ex. 20:00).', 'error'); return; }
      var mail = prompt('E-mail destinataire (laisser vide = notification dans l’application seulement) :');
      if (mail === null) return;
      mail = (mail || '').trim();
      if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) { toast('Adresse e-mail invalide.', 'error'); return; }
      var body = { send_time: time };
      if (mail) body.email_recipients = [mail];
      await Po('/messaging/report-schedules/preset-direction', body);
      toast('Digest quotidien programmé à ' + time + '.', 'success');
    } catch (e) { digestErr(e); }
  };

  /* ---------- Dashboard Direction (1 écran) ---------- */
  async function vDirection() {
    if (ME && ME.is_global) {
      return '<p class="warn">La vue direction est destinée aux comptes clients. Utilisez le centre de contrôle plateforme.</p>' +
        '<button onclick="go(\'admin\')">Centre admin</button>';
    }

    var jour = await G('/dashboard/jour').catch(function (e) { return { error: e.message }; });
    var overview = await G('/stations/overview').catch(function () { return null; });
    var alerts = await G('/notifications').catch(function () { return []; });
    var openAlerts = (alerts || []).filter(function (a) { return !a.read_at; }).slice(0, 8);

    if (jour && jour.error) {
      return '<p class="warn">' + esc(jour.error) + '</p>';
    }

    var k = (jour && jour.kpis) || {};
    var low = (jour && jour.low_stock) || [];
    var totals = (overview && overview.totals) || null;
    var stations = (overview && overview.stations) || [];

    var kpi = function (label, val, hint) {
      return '<div class="card dir-kpi"><small>' + esc(label) + '</small><b>' + val + '</b>' +
        (hint ? '<div class="muted" style="font-size:11px;margin-top:4px">' + esc(hint) + '</div>' : '') + '</div>';
    };

    var money = function (n) {
      try { return typeof f === 'function' ? f(n) : Number(n || 0).toLocaleString('fr-FR'); } catch (e) { return String(n); }
    };

    var html = '<h2 style="margin-top:0">Pilotage direction</h2>' +
      '<p class="muted" style="margin-top:0">Synthèse du jour' +
      (jour && jour.date ? ' — ' + esc(jour.date) : '') +
      '. Les totaux multi-stations agrègent vos stations accessibles sans mélanger les opérations.</p>';

    html += '<div class="cards">' +
      kpi('Ventes produits', money(k.product_sales)) +
      kpi('Carburant (montant)', money(k.fuel_amount)) +
      kpi('Litres', (k.fuel_liters != null ? Number(k.fuel_liters).toLocaleString('fr-FR') : '—') + ' L') +
      kpi('Dépenses', money(k.expenses)) +
      kpi('Quarts ouverts', totals ? String(totals.open_shifts) : ((jour.open_shift || (jour.kpis && jour.kpis.open)) ? 'Oui' : '0')) +
      kpi('Stock bas', totals ? String(totals.low_stock) : String(low.length)) +
      kpi('Employés actifs', totals ? String(totals.employees) : '—') +
      kpi('Ventes jour (toutes stations)', totals && totals.sales_today != null ? money(totals.sales_today) : '—') +
      '</div>';

    html += '<div class="bar" style="margin:14px 0;flex-wrap:wrap;gap:8px">' +
      '<button onclick="go(\'eod\')">Rapport fin de journée</button>' +
      '<button class="b2" onclick="go(\'jour\')">Détail Jour J</button>' +
      '<button class="b2" onclick="go(\'dash\')">Dashboard complet</button>' +
      '<button class="b2" onclick="go(\'stations\')">Mes stations</button>' +
      '<button class="b2" onclick="go(\'alert\')">Centre d\'alertes</button>' +
      '<button class="b2" onclick="modernSendDigestNow()">Envoyer digest e-mail</button>' +
      '<button class="b2" onclick="modernPresetDailyDigest()">Programmer digest 20h</button>' +
      '</div>';

    // Alertes non lues
    html += '<div class="card" style="text-align:left;margin-bottom:12px"><h3 style="margin-top:0">Alertes à traiter</h3>';
    if (openAlerts.length) {
      html += '<ul style="margin:0;padding-left:18px;font-size:13px">' +
        openAlerts.map(function (a) {
          return '<li><span class="tag ' + (a.level === 'info' ? '' : 'x') + '">' + esc(a.level || '') +
            '</span> ' + esc(a.message || '') + '</li>';
        }).join('') + '</ul>';
    } else {
      html += emptyState({ icon: '✅', title: 'Aucune alerte non lue', desc: 'Le centre d\'alertes est à jour pour cette station.' });
    }
    html += '</div>';

    // Stock bas
    html += '<div class="card" style="text-align:left;margin-bottom:12px"><h3 style="margin-top:0">Stock sous minimum (station active)</h3>';
    if (low.length) {
      html += T(['Produit', 'Qté', 'Min'], low.map(function (x) {
        return [esc(x.name), x.quantity, x.min_stock];
      }));
    } else {
      html += emptyState({ icon: '📦', title: 'Aucun produit sous seuil', desc: 'Les seuils min_stock sont respectés.' });
    }
    html += '</div>';

    // Multi-stations snapshot
    if (stations.length > 1) {
      html += '<div class="card" style="text-align:left"><h3 style="margin-top:0">Par station</h3>' +
        T(['Station', 'Quarts ouverts', 'Stock bas', 'Employés', 'Ventes jour', ''], stations.map(function (s) {
          return [
            esc(s.name) + (s.is_current ? ' <span class="tag">Active</span>' : ''),
            s.open_shifts != null ? String(s.open_shifts) : '—',
            s.low_stock != null ? String(s.low_stock) : '—',
            s.employees != null ? String(s.employees) : '—',
            s.sales_today != null ? money(s.sales_today) : '—',
            s.is_current ? '—' : '<button class="b2" onclick="chSt(' + Number(s.id) + ')">Basculer</button>'
          ];
        })) + '</div>';
    }

    return html;
  }

  /* ---------- Rapport fin de journée ---------- */
  async function vEndOfDay() {
    if (ME && ME.is_global) {
      return '<p class="warn">Réservé aux comptes station.</p>';
    }
    var day = (typeof P !== 'undefined' && P === 'custom' && typeof CA !== 'undefined' && CA) ? CA : new Date().toISOString().slice(0, 10);
    var jour = await G('/dashboard/jour?date=' + encodeURIComponent(day)).catch(function (e) { return { error: e.message }; });
    if (jour.error) return '<p class="warn">' + esc(jour.error) + '</p>';
    var k = jour.kpis || {};
    var shifts = await G('/shifts').catch(function () { return []; });
    var closedToday = (shifts || []).filter(function (s) {
      return s.closed_at && String(s.closed_at).slice(0, 10) === day;
    });

    var html = '<h2 style="margin-top:0">Rapport fin de journée</h2>' +
      '<p class="muted">Date de référence : <b>' + esc(day) + '</b> — station active uniquement.</p>' +
      '<div class="bar"><input type="date" id="eod_date" value="' + esc(day) + '">' +
      '<button class="b2" onclick="(function(){var d=document.getElementById(\'eod_date\').value;if(d){window.__eodDate=d;go(\'eod\');}})()">Actualiser</button>' +
      '<button onclick="window.print()">Imprimer / PDF navigateur</button>' +
      '<button class="b2" onclick="go(\'direction\')">Vue direction</button></div>';

    html += '<div class="cards">' +
      '<div class="card"><small>Ventes produits</small><b>' + (typeof f === 'function' ? f(k.product_sales) : k.product_sales) + '</b></div>' +
      '<div class="card"><small>Carburant</small><b>' + (typeof f === 'function' ? f(k.fuel_amount) : k.fuel_amount) + '</b></div>' +
      '<div class="card"><small>Litres</small><b>' + (k.fuel_liters != null ? Number(k.fuel_liters).toLocaleString('fr-FR') : '—') + '</b></div>' +
      '<div class="card"><small>Dépenses</small><b>' + (typeof f === 'function' ? f(k.expenses) : k.expenses) + '</b></div>' +
      '</div>';

    html += '<div class="card" style="text-align:left;margin-top:12px"><h3 style="margin-top:0">Quarts clôturés ce jour</h3>';
    if (closedToday.length) {
      html += T(['N°', 'Type', 'Fermé', 'Écart caisse'], closedToday.map(function (s) {
        return [s.number, esc(s.kind), s.closed_at ? dt(s.closed_at) : '—', typeof f === 'function' ? f(s.cash_gap) : s.cash_gap];
      }));
    } else {
      html += emptyState({ icon: '📋', title: 'Aucun quart clôturé ce jour', desc: 'Les quarts fermés apparaîtront ici.' });
    }
    html += '</div>';

    var low = jour.low_stock || [];
    html += '<div class="card" style="text-align:left;margin-top:12px"><h3 style="margin-top:0">Stock bas en fin de journée</h3>';
    if (low.length) {
      html += T(['Produit', 'Qté', 'Min'], low.map(function (x) {
        return [esc(x.name), x.quantity, x.min_stock];
      }));
    } else {
      html += emptyState({ icon: '✅', title: 'Pas de rupture signalée', desc: 'Aucun produit sous le seuil minimum.' });
    }
    html += '</div>';

    html += '<p class="muted" style="margin-top:16px;font-size:12px">Document généré le ' +
      new Date().toLocaleString('fr-FR') + ' — Manager PRO. Vérifiez les écarts de caisse dans les fiches de quart avant validation comptable.</p>';

    return html;
  }

  // Prefer __eodDate if set
  var _prevEod = vEndOfDay;
  vEndOfDay = async function () {
    if (window.__eodDate) {
      // monkey-patch date via query only inside function - re-read
    }
    return _prevEod();
  };
  // simpler: read __eodDate at start
  async function vEndOfDay2() {
    if (ME && ME.is_global) return '<p class="warn">Réservé aux comptes station.</p>';
    // Période par défaut = aujourd'hui (comportement historique, ou dernier jour choisi) ; une seule date = un seul jour.
    RT.register('eod', { view: 'eod', defFrom: function () { return window.__eodDate || RT.today(); }, defTo: function () { return window.__eodDate || RT.today(); }, pdf: eodPdf });
    var rg = RT.range('eod'), jour;
    try { jour = await G('/reports/eod-period?' + RT.query('eod')); } catch (e) { jour = { error: e.message }; }
    var bar = RT.bar('eod');
    if (jour.error) return '<h2 style="margin-top:0">Rapport fin de journée</h2>' + bar + '<p class="warn">' + esc(jour.error) + '</p>';
    window.__eodView = jour;
    var k = jour.kpis || {}, m = function (v) { return typeof f === 'function' ? f(v) : v; };
    var html = '<h2 style="margin-top:0">Rapport fin de journée</h2>' +
      '<p class="muted">Période : <b>' + esc(RT.label('eod')) + '</b></p>' + bar +
      '<div class="bar" style="flex-wrap:wrap;gap:8px"><button class="b2" onclick="window.print()">Imprimer</button>' +
      '<button class="b2" onclick="go(\'direction\')">Vue direction</button></div>' +
      '<div class="cards">' +
      '<div class="card"><small>Ventes produits</small><b>' + m(k.product_sales) + '</b></div>' +
      '<div class="card"><small>Carburant</small><b>' + m(k.fuel_amount) + '</b></div>' +
      '<div class="card"><small>Litres</small><b>' + (k.fuel_liters != null ? Number(k.fuel_liters).toLocaleString('fr-FR') : '—') + '</b></div>' +
      '<div class="card"><small>Dépenses</small><b>' + m(k.expenses) + '</b></div>' +
      '<div class="card"><small>Résultat brut</small><b>' + m(k.result) + '</b></div>' +
      '</div>';
    if ((jour.by_day || []).length > 1) {
      html += '<div class="card" style="text-align:left;margin-top:12px"><h3 style="margin-top:0">Détail par jour</h3>' +
        T(['Date', 'Ventes produits', 'Carburant', 'Litres', 'Dépenses', 'Résultat', 'Quarts clôturés', 'Écart caisse'], jour.by_day.map(function (x) {
          return [esc(RT.fr(x.date)), m(x.product_sales), m(x.fuel_amount), Number(x.fuel_liters).toLocaleString('fr-FR'), m(x.expenses), m(x.result), x.shifts_closed, m(x.cash_gap)];
        }).concat([['<b>Total</b>', '<b>' + m(k.product_sales) + '</b>', '<b>' + m(k.fuel_amount) + '</b>', '<b>' + Number(k.fuel_liters).toLocaleString('fr-FR') + '</b>', '<b>' + m(k.expenses) + '</b>', '<b>' + m(k.result) + '</b>', '<b>' + k.shifts_closed + '</b>', '<b>' + m(k.cash_gap) + '</b>']])) + '</div>';
    }
    html += '<div class="card" style="text-align:left;margin-top:12px"><h3 style="margin-top:0">Quarts clôturés</h3>';
    if ((jour.shifts || []).length) {
      html += T(['N°', 'Type', 'Fermé', 'Écart'], jour.shifts.map(function (s) {
        return [s.number, esc(s.kind), s.closed_at ? dt(s.closed_at) : '—', m(s.cash_gap)];
      }));
    } else {
      html += emptyState({ icon: '📋', title: 'Aucun quart clôturé', desc: 'Aucun quart clôturé sur la période sélectionnée.' });
    }
    html += '</div>';
    var low = jour.low_stock || [];
    html += '<div class="card" style="text-align:left;margin-top:12px"><h3 style="margin-top:0">Stock bas <small class="muted">(état actuel)</small></h3>';
    if (low.length) {
      html += T(['Produit', 'Qté', 'Min'], low.map(function (x) { return [esc(x.name), x.quantity, x.min_stock]; }));
    } else {
      html += emptyState({ icon: '✅', title: 'OK', desc: 'Aucun produit sous seuil.' });
    }
    html += '</div><p class="muted" style="font-size:12px;margin-top:12px">Généré le ' + new Date().toLocaleString('fr-FR') + '</p>' +
      '<div class="card" style="margin-top:14px;text-align:left"><h3 style="margin-top:0">Exports comptables</h3>' +
      '<p class="muted" style="font-size:13px">Téléchargements pour la période sélectionnée (CSV compatible Excel, séparateur point-virgule).</p>' +
      '<div class="bar" style="flex-wrap:wrap;gap:8px">' +
      '<button class="b2" onclick="modernExportCompta(\'sales\',\'csv\')">Ventes CSV</button>' +
      '<button class="b2" onclick="modernExportCompta(\'expenses\',\'csv\')">Dépenses CSV</button>' +
      '<button class="b2" onclick="modernExportCompta(\'payments\',\'csv\')">Paiements CSV</button>' +
      '<button class="b2" onclick="modernExportCompta(\'financial_events\',\'xlsx\')">Journal XLSX</button>' +
      '</div></div>';
    return html;
  }

  /** PDF fin de journée : exactement les données de l'écran (même réponse serveur, même période). */
  function eodPdf() {
    var j = window.__eodView; if (!j || !j.kpis) { toast('Rien à exporter', 'info'); return null; }
    var k = j.kpis, cur = RT.H.cur(), sections = [];
    sections.push(RT.H.kv('Filtres appliqués', [['Période', RT.label('eod')], ['Nombre de jours', String(j.days)]]));
    sections.push(RT.H.kpis([
      { label: 'Ventes produits (' + cur + ')', value: k.product_sales }, { label: 'Carburant (' + cur + ')', value: k.fuel_amount }, { label: 'Litres pompés', value: k.fuel_liters },
      { label: 'Dépenses (' + cur + ')', value: k.expenses }, { label: 'Résultat brut (' + cur + ')', value: k.result, note: 'ventes + carburant - dépenses' }, { label: 'Quarts clôturés', value: k.shifts_closed }
    ], 'Synthèse'));
    sections.push({ type: 'table', title: j.by_day.length > 1 ? 'Détail par jour' : 'Détail du jour', head: ['Date', 'Ventes produits', 'Carburant', 'Litres', 'Dépenses', 'Résultat', 'Quarts clôturés', 'Écart caisse'],
      rows: j.by_day.map(function (x) { return [RT.fr(x.date), x.product_sales, x.fuel_amount, x.fuel_liters, x.expenses, x.result, x.shifts_closed, x.cash_gap]; }),
      totals: ['TOTAL', k.product_sales, k.fuel_amount, k.fuel_liters, k.expenses, k.result, k.shifts_closed, k.cash_gap],
      notes: ['Carburant : relevés des quarts fermés dans la période (le chiffre carburant apparaît à la clôture du quart).'] });
    sections.push({ type: 'table', title: 'Quarts clôturés', head: ['N°', 'Type', 'Fermeture', 'Écart de caisse'], rows: (j.shifts || []).map(function (s) { return [s.number, s.kind || '', RT.H.dateTime(s.closed_at), Number(s.cash_gap) || 0]; }),
      totals: (j.shifts || []).length ? ['TOTAL', '', '', k.cash_gap] : undefined });
    sections.push({ type: 'table', title: 'Stock sous le minimum (état actuel)', head: ['Produit', 'Quantité', 'Minimum'], rows: (j.low_stock || []).map(function (x) { return [x.name, Number(x.quantity), Number(x.min_stock)]; }) });
    return { title: 'Rapport fin de journée', subtitle: 'Synthèse d\u2019exploitation', period: RT.label('eod'), sections: sections, filename: 'fin-de-journee' };
  }

  /* ---------- Centre d'alertes unifié (enrichit VM.alert si possible) ---------- */
  var prevAlert = VM.alert;
  VM.alert = async function () {
    var base = '';
    if (typeof prevAlert === 'function') {
      try { base = await prevAlert(); } catch (e) { base = ''; }
    }
    if (!base) {
      var ls = await G('/notifications').catch(function () { return []; });
      if (!ls.length) {
        base = emptyState({
          icon: '🔔',
          title: 'Aucune notification',
          desc: 'Lancez un scan ou attendez les alertes automatiques.',
          action: can('settings.edit') || can('user.manage')
            ? '<button onclick="opsScanNotif()">Scanner les alertes</button>' : ''
        });
      } else {
        base = T(['Date', 'Niveau', 'Message', ''], ls.map(function (n) {
          return [
            dt(n.created_at),
            '<span class="tag ' + (n.level === 'info' ? '' : 'x') + '">' + esc(n.level) + '</span>',
            esc(n.message),
            n.read_at ? '' : '<button class="b2" onclick="Po(\'/notifications/' + n.id + '/read\').then(function(){go(\'alert\')})">Lu</button>'
          ];
        }));
      }
    }
    var extra = '<div class="card" style="margin-top:14px;text-align:left">' +
      '<h3 style="margin-top:0">Centre d\'alertes</h3>' +
      '<p class="muted" style="font-size:13px">Notifications station + alertes système (messagerie) si le contrat l\'autorise.</p>' +
      '<div class="bar" style="flex-wrap:wrap;gap:8px">' +
      ((can('settings.edit') || can('user.manage')) ? '<button onclick="opsScanNotif()">Scanner</button>' : '') +
      '<button class="b2" onclick="go(\'alertcfg\')">Configurer les alertes</button>' +
      '<button class="b2" onclick="typeof msgAlertConfigOpen===\'function\'?msgAlertConfigOpen():go(\'alertcfg\')">Messagerie / alertes auto</button>' +
      '<button class="b2" onclick="go(\'direction\')">Vue direction</button>' +
      '</div></div>';
    return '<h2 style="margin-top:0">Alertes</h2>' + base + extra;
  };


  async function vOfflineQueue() {
    var items = [];
    if (typeof listOfflineQueue === 'function') items = await listOfflineQueue();
    var pending = items.filter(function (x) { return x.status === 'pending'; });
    var html = '<h2 style="margin-top:0">File hors-ligne</h2>' +
      '<p class="muted">Actions enregistrées sur cet appareil en attendant le réseau. Elles sont renvoyées automatiquement une fois en ligne.</p>' +
      '<div class="bar" style="flex-wrap:wrap;gap:8px">' +
      '<button onclick="(async function(){ if(typeof flushOfflineQueue===\'function\'){ var r=await flushOfflineQueue(); toast((r&&r.flushed||0)+\' synchronisée(s)\',\'success\'); if(typeof refreshOfflineBadge===\'function\')refreshOfflineBadge(); go(\'offlineq\'); } })()">Synchroniser maintenant</button>' +
      '<button class="b2" onclick="go(\'direction\')">Retour</button></div>';
    if (!pending.length) {
      html += emptyState({
        icon: '☁️',
        title: 'File vide',
        desc: navigator.onLine ? 'Aucune action en attente. Vous êtes en ligne.' : 'Hors ligne : les prochaines actions compatibles pourront être mises en file.'
      });
    } else {
      html += T(['Heure', 'Méthode', 'Chemin', ''], pending.map(function (it) {
        return [
          it.created_at ? new Date(it.created_at).toLocaleString('fr-FR') : '—',
          esc(it.method || 'POST'),
          esc(it.path || '—'),
          '<span class="tag">pending</span>'
        ];
      }));
    }
    html += '<p class="muted" style="font-size:12px;margin-top:12px">Statut réseau : <b>' +
      (navigator.onLine ? 'En ligne' : 'Hors ligne') + '</b>' +
      (typeof pwaIsStandalone === 'function' && pwaIsStandalone() ? ' · Application installée' : '') +
      '</p>';
    return html;
  }


  
  

  window.modernDownloadEodPdf = async function (day) {
    day = day || window.__eodDate || new Date().toISOString().slice(0, 10);
    try {
      var r = await fetch('/api/reports/eod.pdf?date=' + encodeURIComponent(day), {
        headers: Object.assign(
          { Accept: 'application/pdf' },
          typeof TK !== 'undefined' && TK ? { Authorization: 'Bearer ' + TK } : {},
          typeof SID !== 'undefined' && SID ? { 'X-Station-Id': String(SID) } : {}
        )
      });
      if (!r.ok) {
        var j = await r.json().catch(function () { return null; });
        throw new Error((j && j.error) || ('Erreur ' + r.status));
      }
      var blob = await r.blob();
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'fin-journee-' + day + '.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 2500);
      toast('PDF téléchargé', 'success');
    } catch (e) {
      toast(typeof errMsg === 'function' ? errMsg(e) : (e.message || String(e)), 'error');
    }
  };
  window.modernExportCompta = async function (kind, fmt) {
    var rg = (window.RT && RT.range('eod')) || { from: window.__eodDate || new Date().toISOString().slice(0, 10), to: window.__eodDate || new Date().toISOString().slice(0, 10) };
    var day = rg.from === rg.to ? rg.from : rg.from + '_' + rg.to;
    fmt = fmt || 'csv';
    var path = '/api/exports/' + encodeURIComponent(kind) + '?format=' + encodeURIComponent(fmt) + '&from=' + rg.from + '&to=' + rg.to;
    try {
      var r = await fetch(path, {
        headers: Object.assign(
          {},
          typeof TK !== 'undefined' && TK ? { Authorization: 'Bearer ' + TK } : {},
          typeof SID !== 'undefined' && SID ? { 'X-Station-Id': String(SID) } : {}
        )
      });
      if (!r.ok) {
        var j = await r.json().catch(function () { return null; });
        throw new Error((j && j.error) || ('Erreur ' + r.status));
      }
      var blob = await r.blob();
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = kind + '-' + day + '.' + fmt;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 2500);
      toast('Export téléchargé', 'success');
    } catch (e) {
      toast(typeof errMsg === 'function' ? errMsg(e) : (e.message || String(e)), 'error');
    }
  };

  Object.assign(V, {
    onboard: ['Premiers pas', '*'],
    direction: ['Pilotage direction', 'report.view|finance.view|user.manage'],
    eod: ['Fin de journée', 'report.view|finance.view|shift.close'],
    offlineq: ['File hors-ligne', '*']
  });
  Object.assign(VM, {
    onboard: vOnboardingPro,
    direction: vDirection,
    eod: vEndOfDay2,
    offlineq: vOfflineQueue
  });
  if (typeof NAV_ICONS !== 'undefined') {
    NAV_ICONS.onboard = '🚀';
    NAV_ICONS.direction = '📊';
    NAV_ICONS.eod = '日落';
  }
  // fix icon - use emoji ascii
  if (typeof NAV_ICONS !== 'undefined') { NAV_ICONS.eod = '📑'; NAV_ICONS.offlineq = '📡'; }
})();

/* --- Rapprochement + commissions (extensions gratuites) --- */
(function () {
  if (typeof V === 'undefined' || typeof VM === 'undefined') return;

  var REC_STATE = { reconciled: ['Rapprochée', 'ok'], gap: ['Avec écart', 'x'], unreconciled: ['Non rapprochée', ''] };
  var REC_ORDER = ['gap', 'unreconciled', 'reconciled'];

  async function vReconciliation() {
    if (ME && ME.is_global) return '<p class="warn">Réservé aux comptes station.</p>';
    // Période par défaut = jour choisi (ou aujourd'hui) ; « Réinitialiser » y revient.
    RT.register('reconcile', { view: 'reconcile', defFrom: function () { return window.__recDate || RT.today(); }, defTo: function () { return window.__recDate || RT.today(); }, pdf: recPdf });
    var data = await G('/reports/reconciliation?' + RT.query('reconcile')).catch(function (e) {
      return { error: e.message || String(e) };
    });
    var bar = RT.bar('reconcile', {});
    var head = '<h2 style="margin-top:0">Rapprochement pompes / ventes / caisse</h2>' +
      '<p class="muted">Contrôle de la période — lecture seule, sans coût. Comparez litres pompés, ventes et écarts de caisse.</p>' + bar;
    if (data.error) return head + '<p class="warn">' + esc(data.error) + '</p>';
    window.__recView = data;
    var money = function (n) { try { return typeof f === 'function' ? f(n) : Number(n || 0).toLocaleString('fr-FR'); } catch (e) { return String(n); } };
    var cnt = (data.summary && data.summary.counts) || { total: 0, reconciled: 0, gap: 0, unreconciled: 0 };
    var html = head +
      '<div class="bar"><button class="b2" onclick="go(\'eod\')">Fin de journée</button></div>' +
      '<div class="cards">' +
      '<div class="card"><small>Litres pompés (quarts fermés)</small><b>' + Number(data.pumps && data.pumps.total_liters || 0).toLocaleString('fr-FR') + '</b></div>' +
      '<div class="card"><small>Montant carburant index</small><b>' + money(data.pumps && data.pumps.total_amount) + '</b></div>' +
      '<div class="card"><small>Ventes produits</small><b>' + money(data.sales && data.sales.product_sales) + '</b></div>' +
      '<div class="card"><small>Dépenses</small><b>' + money(data.expenses) + '</b></div>' +
      '<div class="card"><small>Écarts de caisse (total)</small><b>' + money(data.cash && data.cash.total_gap) + '</b></div>' +
      '</div>' +
      '<div class="cards">' +
      '<div class="card"><small>Opérations rapprochées</small><b style="color:var(--g)">' + cnt.reconciled + '</b></div>' +
      '<div class="card"><small>Opérations avec écart</small><b style="color:var(--r)">' + cnt.gap + '</b></div>' +
      '<div class="card"><small>Non rapprochées</small><b style="color:#d97706">' + cnt.unreconciled + '</b></div>' +
      '</div>';

    var ops = data.operations || [];
    html += '<div class="card" style="text-align:left;margin-top:12px"><h3 style="margin-top:0">Opérations de rapprochement (quarts)</h3>' +
      '<p class="muted" style="font-size:12px;margin:0 0 6px">Rapprochée = quart fermé, caisse comptée, écart nul · Avec écart = caisse comptée avec écart · Non rapprochée = quart ouvert ou caisse non comptée.</p>' +
      T(['Réf.', 'Ouvert le', 'Fermé le', 'Carburant', 'Théorique', 'Compté', 'Écart', 'Statut'], REC_ORDER.reduce(function (acc, st) {
        return acc.concat(ops.filter(function (o) { return o.state === st; }).map(function (o) {
          var tg = REC_STATE[o.state];
          return ['Quart ' + esc(o.number) + ' <small class="muted">' + esc(o.kind || '') + '</small>', o.opened_at ? dt(o.opened_at) : '—', o.closed_at ? dt(o.closed_at) : '—',
            money(o.fuel_amount), o.theoretical != null ? money(o.theoretical) : '—', o.counted != null ? money(o.counted) : '—', o.gap != null ? money(o.gap) : '—',
            '<span class="tag ' + tg[1] + '">' + tg[0] + '</span>'];
        }));
      }, [])) + '</div>';

    if (data.pumps && data.pumps.lines && data.pumps.lines.length) {
      html += '<div class="card" style="text-align:left;margin-top:12px"><h3 style="margin-top:0">Détail compteurs</h3>' +
        T(['Quart', 'Produit', 'Litres', 'Montant', 'Index début', 'Index fin'], data.pumps.lines.map(function (x) {
          return [x.shift_number, esc(x.product), x.liters, money(x.amount), x.index_start, x.index_end];
        })) + '</div>';
    }
    if (data.payments && data.payments.length) {
      html += '<div class="card" style="text-align:left;margin-top:12px"><h3 style="margin-top:0">Paiements par mode</h3>' +
        T(['Mode', 'Montant'], data.payments.map(function (x) {
          return [esc(x.label || x.kind), money(x.amount)];
        })) + '</div>';
    }
    html += '<p class="muted" style="font-size:12px;margin-top:12px">' + esc((data.summary && data.summary.fuel_vs_sales_note) || '') + '</p>';
    return html;
  }

  /** PDF rapprochement : réponse serveur affichée à l'écran, opérations regroupées par statut (écarts, non rapprochées, rapprochées). */
  function recPdf() {
    var d = window.__recView; if (!d) { toast('Rien à exporter', 'info'); return null; }
    var cur = RT.H.cur(), cnt = (d.summary && d.summary.counts) || { total: 0, reconciled: 0, gap: 0, unreconciled: 0 }, ops = d.operations || [], sections = [];
    sections.push(RT.H.kv('Filtres appliqués', [['Période', RT.label('reconcile')], ['Opérations (quarts)', String(cnt.total)]]));
    sections.push(RT.H.kpis([
      { label: 'Litres pompés', value: d.pumps ? d.pumps.total_liters : 0 }, { label: 'Carburant index (' + cur + ')', value: d.pumps ? d.pumps.total_amount : 0 },
      { label: 'Ventes produits (' + cur + ')', value: d.sales ? d.sales.product_sales : 0 }, { label: 'Dépenses (' + cur + ')', value: d.expenses || 0 },
      { label: 'Écarts de caisse (' + cur + ')', value: d.cash ? d.cash.total_gap : 0 }, { label: 'Rapprochées / écart / non rapprochées', value: cnt.reconciled + ' / ' + cnt.gap + ' / ' + cnt.unreconciled }
    ], 'Synthèse'));
    var head = ['Réf. (quart)', 'Type', 'Ouvert le', 'Fermé le', 'Carburant (L)', 'Carburant (' + cur + ')', 'Théorique', 'Compté', 'Écart', 'Statut'];
    var titles = { gap: 'Opérations présentant un écart', unreconciled: 'Opérations non rapprochées', reconciled: 'Opérations rapprochées' };
    REC_ORDER.forEach(function (st) {
      var list = ops.filter(function (o) { return o.state === st; });
      if (!list.length) { sections.push({ type: 'text', title: titles[st], text: 'Aucune opération.' }); return; }
      var sum = function (k) { return Math.round(list.reduce(function (a, o) { return a + (Number(o[k]) || 0); }, 0) * 100) / 100; };
      sections.push({ type: 'table', title: titles[st] + ' (' + list.length + ')', head: head,
        rows: list.map(function (o) { return ['Quart ' + o.number, o.kind || '', RT.H.dateTime(o.opened_at), o.closed_at ? RT.H.dateTime(o.closed_at) : '—', o.fuel_liters || 0, o.fuel_amount || 0, o.theoretical != null ? o.theoretical : '', o.counted != null ? o.counted : '', o.gap != null ? o.gap : '', REC_STATE[o.state][0]]; }),
        totals: ['TOTAL', '', '', '', sum('fuel_liters'), sum('fuel_amount'), sum('theoretical'), sum('counted'), sum('gap'), ''] });
    });
    if (d.pumps && d.pumps.lines && d.pumps.lines.length) {
      sections.push({ type: 'table', title: 'Détail des compteurs', head: ['Quart', 'Produit', 'Litres', 'Montant (' + cur + ')', 'Index début', 'Index fin'],
        rows: d.pumps.lines.map(function (x) { return [x.shift_number, x.product, Number(x.liters) || 0, Number(x.amount) || 0, Number(x.index_start) || 0, Number(x.index_end) || 0]; }),
        totals: ['TOTAL', '', d.pumps.total_liters, d.pumps.total_amount, '', ''] });
    }
    if (d.payments && d.payments.length) {
      sections.push({ type: 'table', title: 'Paiements par mode', head: ['Mode', 'Montant (' + cur + ')'], rows: d.payments.map(function (x) { return [x.label || x.kind, Number(x.amount) || 0]; }),
        totals: ['TOTAL', Math.round(d.payments.reduce(function (a, x) { return a + (Number(x.amount) || 0); }, 0) * 100) / 100] });
    }
    sections.push({ type: 'text', text: (d.summary && d.summary.fuel_vs_sales_note) || '' });
    return { title: 'Rapprochement pompes / ventes / caisse', subtitle: 'Contrôle des quarts', period: RT.label('reconcile'), sections: sections, landscape: true, filename: 'rapprochement' };
  }

  async function vMmCommission() {
    if (ME && ME.is_global) return '<p class="warn">Réservé aux comptes station.</p>';
    var rates = await G('/money/commission-rates').catch(function () { return {}; });
    // Période par défaut = aujourd'hui (comportement historique) ; « Réinitialiser » y revient.
    RT.register('mmcomm', { view: 'mmcomm', defFrom: RT.today, defTo: RT.today, pdf: mmPdf });
    var repErr = '';
    var report = await G('/money/commission-report?' + RT.query('mmcomm')).catch(function (e) { repErr = (e && e.message) || ''; return null; });
    var hist = Array.isArray(rates.history) ? rates.history : [];
    window.__mmView = { rates: rates, report: report, hist: hist };
    var html = '<h2 style="margin-top:0">Commissions Mobile Money</h2>' +
      '<p class="muted">Calcul <b>local et gratuit</b> : aucun lien payant avec Wave / Orange. Vous saisissez le % ; l’app estime le coût sur vos encaissements.</p>' +
      '<div class="card" style="text-align:left"><h3 style="margin-top:0">Taux (%)</h3>' +
      '<div class="g">' +
      '<label>Wave <input id="mm_wave" type="number" step="0.01" value="' + (rates.wave != null ? rates.wave : 0) + '"></label>' +
      '<label>Orange Money <input id="mm_om" type="number" step="0.01" value="' + (rates.orange_money != null ? rates.orange_money : 0) + '"></label>' +
      '<label>Mobile Money (générique) <input id="mm_gen" type="number" step="0.01" value="' + (rates.mobile_money != null ? rates.mobile_money : 0) + '"></label>' +
      '</div>' +
      (can('money.manage') || can('settings.edit')
        ? '<button style="margin-top:10px" onclick="modernSaveMmRates()">Enregistrer les taux</button>'
        : '<p class="warn">Permission money.manage ou settings.edit pour modifier.</p>') +
      '</div>';
    html += RT.bar('mmcomm') + (repErr ? '<p class="warn">' + esc(repErr) + '</p>' : '');
    if (report && report.lines) {
      html += '<div class="card" style="text-align:left;margin-top:12px"><h3 style="margin-top:0">Estimation — ' + esc(RT.label('mmcomm')) + '</h3>' +
        T(['Mode', 'Brut', 'Taux %', 'Commission', 'Net'], report.lines.map(function (x) {
          return [esc(x.label), (typeof f === 'function' ? f(x.gross) : x.gross), x.rate_pct,
            (typeof f === 'function' ? f(x.commission) : x.commission),
            (typeof f === 'function' ? f(x.net) : x.net)];
        })) +
        '<p style="margin-top:8px"><b>Total encaissé (brut) :</b> ' + (typeof f === 'function' ? f(report.total_gross) : report.total_gross) +
        ' · <b>Total commissions estimées :</b> ' + (typeof f === 'function' ? f(report.total_commission) : report.total_commission) +
        ' · <b>Net :</b> ' + (typeof f === 'function' ? f(report.total_gross - report.total_commission) : (report.total_gross - report.total_commission)) + '</p></div>';
    }
    // Historique des taux appliqués
    html += '<div class="card" style="text-align:left;margin-top:12px"><h3 style="margin-top:0">Historique des taux appliqués</h3>';
    if (!hist.length) {
      html += '<p class="muted" style="font-size:13px">Aucun changement de taux enregistré pour le moment. Les prochaines modifications apparaîtront ici.</p>';
    } else {
      html += T(['Date', 'Par', 'Wave %', 'Orange Money %', 'Mobile Money %'], hist.slice(0, 30).map(function (h) {
        return [
          (typeof dt === 'function' ? dt(h.at) : (h.at || '')),
          esc(h.by || '—'),
          h.wave != null ? h.wave : '—',
          h.orange_money != null ? h.orange_money : '—',
          h.mobile_money != null ? h.mobile_money : '—'
        ];
      }));
    }
    html += '</div>';
    return html;
  }

  /** PDF commissions : encaissements de la période, taux appliqués, commission estimée et net ; historique des taux tel qu'affiché. */
  function mmPdf() {
    var v = window.__mmView || {}, r = v.report, rates = v.rates || {}, cur = RT.H.cur(), hist = v.hist || [];
    if (!r || !r.lines) { toast('Aucune donnée à exporter', 'info'); return null; }
    var gross = Number(r.total_gross) || 0, comm = Number(r.total_commission) || 0, sections = [];
    sections.push(RT.H.kv('Filtres appliqués', [['Période', RT.label('mmcomm')]]));
    sections.push(RT.H.kpis([{ label: 'Total encaissé brut (' + cur + ')', value: gross }, { label: 'Commissions estimées (' + cur + ')', value: comm }, { label: 'Net après commissions (' + cur + ')', value: Math.round((gross - comm) * 100) / 100 }], 'Synthèse'));
    sections.push(RT.H.kv('Taux configurés (%)', [['Wave', rates.wave != null ? rates.wave : 0], ['Orange Money', rates.orange_money != null ? rates.orange_money : 0], ['Mobile Money (générique)', rates.mobile_money != null ? rates.mobile_money : 0]]));
    sections.push({ type: 'table', title: 'Estimation par mode de paiement', head: ['Mode', 'Brut (' + cur + ')', 'Taux %', 'Commission (' + cur + ')', 'Net (' + cur + ')'],
      rows: r.lines.map(function (x) { return [x.label, Number(x.gross) || 0, Number(x.rate_pct) || 0, Number(x.commission) || 0, Number(x.net) || 0]; }),
      totals: ['TOTAL', gross, '', comm, Math.round((gross - comm) * 100) / 100],
      notes: ['Estimation locale : montant encaissé x taux saisi ; aucun lien avec les opérateurs.'] });
    if (hist.length) {
      sections.push({ type: 'table', title: 'Historique des taux appliqués (30 derniers changements)', head: ['Date', 'Par', 'Wave %', 'Orange Money %', 'Mobile Money %'],
        rows: hist.slice(0, 30).map(function (h) { return [RT.H.dateTime(h.at), h.by || '—', h.wave != null ? h.wave : '—', h.orange_money != null ? h.orange_money : '—', h.mobile_money != null ? h.mobile_money : '—']; }) });
    }
    return { title: 'Commissions Mobile Money', subtitle: 'Estimation des frais opérateurs', period: RT.label('mmcomm'), sections: sections, filename: 'commissions-mobile-money' };
  }

  window.modernSaveMmRates = async function () {
    try {
      var body = {
        wave: parseFloat(document.getElementById('mm_wave').value) || 0,
        orange_money: parseFloat(document.getElementById('mm_om').value) || 0,
        mobile_money: parseFloat(document.getElementById('mm_gen').value) || 0
      };
      await api('PUT', '/money/commission-rates', body);
      toast('Taux enregistrés', 'success');
      go('mmcomm');
    } catch (e) {
      toast(typeof errMsg === 'function' ? errMsg(e) : e.message, 'error');
    }
  };

  Object.assign(V, {
    reconcile: ['Rapprochement', 'report.view|finance.view|shift.close'],
    mmcomm: ['Commissions Mobile Money', 'finance.view|cash.manage|money.manage']
  });
  Object.assign(VM, { reconcile: vReconciliation, mmcomm: vMmCommission });
  if (typeof NAV_ICONS !== 'undefined') {
    NAV_ICONS.reconcile = '🔗';
    NAV_ICONS.mmcomm = '📱';
  }
})();
