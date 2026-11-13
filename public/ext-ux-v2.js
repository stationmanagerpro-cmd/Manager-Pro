/* UX v2 — Dashboard horizontal, profils enrichis, caisse/prêts, menus réorganisés */
(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof VM === 'undefined') return;

  /* ========== 1. Horloge temps réel + en-tête utilisateur ========== */
  function startClock() {
    var el = document.getElementById('live-clock');
    if (!el) return;
    function tick() {
      try {
        var now = new Date();
        var loc = (typeof I18N !== 'undefined' ? I18N.locale() : 'fr-FR');
        el.textContent = now.toLocaleDateString(loc, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }) +
          ' · ' + now.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      } catch (e) {}
    }
    tick();
    if (!window.__clockTimer) window.__clockTimer = setInterval(tick, 1000);
  }

  function renderUserHeader() {
    if (!ME) return '';
    var role = ME.role || '';
    var name = ME.login || ME.name || 'Utilisateur';
    return '<div id="user-header" class="user-header">' +
      '<div class="uh-left">' +
      '<span class="uh-avatar">' + (name.charAt(0) || 'U').toUpperCase() + '</span>' +
      '<div><strong>' + esc(name) + '</strong><br><small style="color:var(--m)">' + esc(role) + '</small></div>' +
      '</div>' +
      '<div id="live-clock" class="uh-clock">—</div>' +
      '</div>';
  }

  /* ========== 2. Menu horizontal supérieur ========== */
  function renderTopBar(current) {
    // Raccourcis demandés : planning (quarts), journal/audit, alertes + items principaux
    var items = [
      { k: 'dash', label: 'Accueil', icon: '🏠' },
      { k: 'quart', label: 'Quarts', icon: '⏱️' },
      { k: 'ventes', label: 'Ventes', icon: '🛒' },
      { k: 'caisse', label: 'Caisse', icon: '💰' },
      { k: 'cli', label: 'Clients', icon: '👥' },
      { k: 'four', label: 'Fournisseurs', icon: '🏭' },
      { k: 'emp', label: 'RH', icon: '👤' },
      { k: 'alert', label: 'Alertes', icon: '🔔' },
      { k: 'audit', label: 'Journal', icon: '📋' },
      { k: 'admin', label: 'Paramètres', icon: '⚙️' }
    ];
    var html = items.filter(function (x) {
      if (!V[x.k]) return x.k === 'admin' ? can('user.manage|settings.edit|appearance.manage') : false;
      return can(V[x.k][1]);
    }).map(function (x) {
      return '<a class="topbar-item' + (x.k === current ? ' on' : '') + '" onclick="go(\'' + x.k + '\')">' +
        '<span class="ico">' + x.icon + '</span><span class="tbl">' + x.label + '</span></a>';
    }).join('');
    return '<nav id="topbar" class="topbar" aria-label="Menu principal">' + html + '</nav>';
  }

  /* Inject topbar + user header after navigation renders */
  var _origGoNav = null;
  function enhanceShell() {
    return;   // remplacé par ext-shell.js : barre supérieure contextuelle (profil, date/heure, alertes) et menu vertical à sous-menus flottants
    var top = document.querySelector('main .top');
    if (!top) return;
    if (!document.getElementById('user-header')) {
      var uh = document.createElement('div');
      uh.innerHTML = renderUserHeader();
      top.insertBefore(uh.firstChild, top.firstChild);
      startClock();
    }
    if (!document.getElementById('topbar')) {
      var tb = document.createElement('div');
      tb.innerHTML = renderTopBar(cur);
      var main = document.querySelector('main');
      if (main) main.insertBefore(tb.firstChild, main.firstChild.nextSibling);
    } else {
      document.getElementById('topbar').outerHTML = renderTopBar(cur);
    }
  }

  /* Hook go to refresh topbar */
  if (typeof go === 'function') {
    var prevGo = go;
    window.go = async function (k, a) {
      var r = await prevGo(k, a);
      setTimeout(enhanceShell, 30);
      return r;
    };
  }
  setTimeout(enhanceShell, 800);

  /* ========== 3. Réorganisation menus : Produits / Pompes sous Paramètres ========== */
  // On garde les routes mais on retire de la nav latérale principale via override V labels
  // Les raccourcis restent dans topbar (alert, audit) et admin hub
  if (typeof V !== 'undefined') {
    // Ne pas supprimer — accessibles via admin / recherche / topbar
    // Ajouter alias paramètres
    Object.assign(V, {
      settings_hub: ['Paramètres station', 'settings.edit|user.manage']
    });
    if (typeof VM !== 'undefined' && typeof vParamHub === 'function') VM.settings_hub = vParamHub;
  }

  /* ========== 4. Profils Clients enrichis (dashboard + graphiques) ========== */
  window.showCli = safe(async function (id) {
    var h = await G('/customers/' + id + '/history').catch(function () { return {}; });
    var c = h.customer || (await G('/customers/' + id).catch(function () { return {}; }));
    var sales = h.sales || [];
    var pays = h.payments || [];
    var credits = h.credits || [];
    var totalSales = sales.reduce(function (s, x) { return s + Number(x.total || 0); }, 0);
    var totalPaid = pays.reduce(function (s, x) { return s + Number(x.amount || 0); }, 0);
    var chartId = 'cliChart' + id + Date.now();

    var salesRows = sales.slice(0, 30).map(function (s) {
      return [esc(s.invoice_no || s.id), dt(s.sold_at), f(s.total), esc(s.status || '')];
    });
    var payRows = pays.slice(0, 20).map(function (p) {
      return [dt(p.paid_at), esc(p.method || ''), f(p.amount)];
    });
    var credRows = credits.map(function (x) {
      return [f(x.amount), f(x.remaining), esc(x.reason || ''), esc(x.status || '')];
    });

    modal('<div style="max-width:720px">' +
      '<h3 style="margin-top:0">' + esc(c.name || '') + '</h3>' +
      '<div class="cards" style="margin-bottom:12px">' +
      (can('receivable.view') ? '<div class="card"><small>Solde / dette</small><b>' + f(c.balance || 0) + '</b></div>' : '') +
      '<div class="card"><small>Limite crédit</small><b>' + f(c.credit_limit || 0) + '</b></div>' +
      '<div class="card"><small>Fidélité</small><b>' + esc(c.loyalty_tier || 'standard') + '</b></div>' +
      '<div class="card"><small>CA cumulé</small><b>' + f(totalSales) + '</b></div>' +
      '</div>' +
      '<div class="bar">' +
      '<button class="b2" onclick="editCli(' + id + ')">Modifier</button>' +
      '<button onclick="payCli(' + id + ',' + (c.balance || 0) + ')">Encaisser</button>' +
      '<button class="b2" onclick="addCliCredit(' + id + ')">Avoir</button>' +
      '</div>' +
      '<div class="chart-wrap" style="min-height:180px;margin:12px 0"><canvas id="' + chartId + '" height="160"></canvas></div>' +
      '<div class="tabs" id="cli-tabs">' +
      '<a class="on" data-t="sales">Ventes (' + sales.length + ')</a>' +
      '<a data-t="pays">Règlements (' + pays.length + ')</a>' +
      '<a data-t="creds">Avoirs (' + credits.length + ')</a></div>' +
      '<div id="cli-pane-sales">' + T(['Facture', 'Date', 'Total', 'Statut'], salesRows) + '</div>' +
      '<div id="cli-pane-pays" style="display:none">' + T(['Date', 'Mode', 'Montant'], payRows) + '</div>' +
      '<div id="cli-pane-creds" style="display:none">' + T(['Montant', 'Restant', 'Motif', 'Statut'], credRows) + '</div>' +
      '<div class="r"><button class="b2" onclick="closeM()">Fermer</button></div></div>');

    // Tabs
    var tabBox = document.getElementById('cli-tabs');
    if (tabBox) {
      tabBox.querySelectorAll('a').forEach(function (a) {
        a.onclick = function () {
          tabBox.querySelectorAll('a').forEach(function (x) { x.classList.remove('on'); });
          a.classList.add('on');
          ['sales', 'pays', 'creds'].forEach(function (t) {
            var el = document.getElementById('cli-pane-' + t);
            if (el) el.style.display = a.getAttribute('data-t') === t ? '' : 'none';
          });
        };
      });
    }
    // Chart CA par mois (agrégation simple)
    setTimeout(function () {
      if (typeof Chart === 'undefined') return;
      var ctx = document.getElementById(chartId);
      if (!ctx) return;
      var byMonth = {};
      sales.forEach(function (s) {
        var d = (s.sold_at || '').slice(0, 7);
        if (!d) return;
        byMonth[d] = (byMonth[d] || 0) + Number(s.total || 0);
      });
      var labels = Object.keys(byMonth).sort().slice(-12);
      new Chart(ctx, {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [{ label: 'CA', data: labels.map(function (l) { return byMonth[l]; }), backgroundColor: 'rgba(13,122,107,0.75)', borderRadius: 4 }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
      });
    }, 80);
  });

  // Les boutons de la fiche fournisseur appellent des actions réelles et contrôlées.
  window.editFour = function (id) {
    if (typeof window.editSup !== 'function') return toast('Modification fournisseur indisponible dans cette vue.', 'error');
    return window.editSup(Number(id));
  };
  window.payFour = safe(async function (id) {
    if (!can('purchase.pay')) return toast('Permission de paiement fournisseur refusée.', 'error');
    var h = await G('/suppliers/' + Number(id) + '/history');
    var pending = (h.purchases || []).filter(function (p) { return p.status === 'facture' && Number(p.invoice_total || 0) > Number(p.paid || 0); });
    if (!pending.length) return toast('Aucune facture fournisseur impayée pour ce fournisseur.', 'info');
    modal('<h3>Factures fournisseur à régler</h3>' + T(['Commande', 'Facture', 'Reste à payer', 'Action'], pending.map(function (p) {
      var left = Math.max(0, Number(p.invoice_total || 0) - Number(p.paid || 0));
      return [esc(p.order_no || p.id), esc(p.invoice_no || '—'), f(left), '<button class="b2" onclick="closeM();showPO(' + Number(p.id) + ')">Ouvrir le paiement</button>'];
    })) + '<div class="r"><button class="b2" onclick="closeM()">Fermer</button></div>');
  });

  window.showFour = safe(async function (id) {
    var h = await G('/suppliers/' + id + '/history').catch(function () { return {}; });
    var s = h.supplier || (await G('/suppliers/' + id).catch(function () { return {}; }));
    var purchases = h.purchases || [];
    var pays = h.payments || [];
    var total = purchases.reduce(function (a, x) { return a + Number(x.total || 0); }, 0);
    var chartId = 'supChart' + id + Date.now();
    modal('<div style="max-width:720px">' +
      '<h3 style="margin-top:0">' + esc(s.name || '') + '</h3>' +
      '<div class="cards">' +
      (can('debt.view') ? '<div class="card"><small>Dette fournisseur</small><b>' + f(s.balance_due || 0) + '</b></div>' : '') +
      '<div class="card"><small>Achats cumulés</small><b>' + f(total) + '</b></div>' +
      '<div class="card"><small>Délai paiement</small><b>' + (s.payment_terms_days != null ? s.payment_terms_days + ' j' : '—') + '</b></div>' +
      '</div>' +
      '<div class="bar">' + (can('supplier.edit') ? '<button class="b2" onclick="editFour(' + id + ')">Modifier</button>' : '') +
      (can('purchase.pay') ? '<button onclick="payFour(' + id + ')">Régler</button>' : '') + '</div>' +
      '<div class="chart-wrap" style="min-height:160px"><canvas id="' + chartId + '" height="150"></canvas></div>' +
      '<h4>Achats</h4>' + T(['N°', 'Date', 'Total', 'Statut'], purchases.slice(0, 25).map(function (p) {
        return [esc(p.order_no || p.id), dt(p.ordered_at || p.created_at), f(p.total), esc(p.status || '')];
      })) +
      '<h4>Règlements</h4>' + T(['Date', 'Montant', 'Mode'], pays.slice(0, 15).map(function (p) {
        return [dt(p.paid_at), f(p.amount), esc(p.method || '')];
      })) +
      '<div class="r"><button class="b2" onclick="closeM()">Fermer</button></div></div>');
    setTimeout(function () {
      if (typeof Chart === 'undefined') return;
      var ctx = document.getElementById(chartId);
      if (!ctx) return;
      var byMonth = {};
      purchases.forEach(function (p) {
        var d = ((p.ordered_at || p.created_at) || '').slice(0, 7);
        if (!d) return;
        byMonth[d] = (byMonth[d] || 0) + Number(p.total || 0);
      });
      var labels = Object.keys(byMonth).sort().slice(-12);
      new Chart(ctx, {
        type: 'line',
        data: { labels: labels, datasets: [{ label: 'Achats', data: labels.map(function (l) { return byMonth[l]; }), borderColor: '#0d7a6b', tension: 0.3, fill: false }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
      });
    }, 80);
  });

  /* ========== 5. Caisse enrichie : prêts + multi-comptes + graph ========== */
  var _vCaisse = VM.caisse;
  VM.caisse = async function () {
    var base = '';
    try { base = typeof _vCaisse === 'function' ? await _vCaisse() : ''; } catch (e) { base = ''; }

    var loans = [];
    try { loans = await G('/finance/loans').catch(function () { return []; }); } catch (e) {}
    var openLoans = (loans || []).filter(function (l) { return l.status === 'open' || l.status === 'partial'; });
    var totalLent = openLoans.reduce(function (s, l) { return s + (Number(l.amount) - Number(l.repaid_amount || 0)); }, 0);

    var loanHtml = '<div class="card" style="margin-top:16px">' +
      '<div class="bar" style="justify-content:space-between">' +
      '<h3 style="margin:0">Prêts hors-exploitation</h3>' +
      '<button onclick="addPersonalLoan()">Nouveau prêt</button></div>' +
      '<p style="color:var(--m);font-size:13px">Encours : <b>' + f(totalLent) + '</b> · ' + openLoans.length + ' prêt(s) ouvert(s)</p>' +
      T(['Emprunteur', 'Montant', 'Remboursé', 'Solde', 'Échéance', 'Statut', ''],
        (loans || []).slice(0, 20).map(function (l) {
          var bal = Number(l.amount) - Number(l.repaid_amount || 0);
          return [
            esc(l.borrower_name), f(l.amount), f(l.repaid_amount || 0), f(bal),
            l.due_date ? esc(l.due_date) : '—',
            '<span class="tag' + (l.status === 'open' || l.status === 'partial' ? ' x' : '') + '">' + esc(l.status) + '</span>',
            ((l.status === 'open' || l.status === 'partial')
              ? '<button class="b2" onclick="repayPersonalLoan(' + l.id + ',' + bal + ')">Rembourser</button> ' : '') +
              (Number(l.repaid_amount || 0) > 0 ? '<button class="b2" onclick="loanPayments(' + l.id + ')">Historique</button>' : '')
          ];
        })) +
      '</div>';

    return (base || '<h2>Caisse & liquidités</h2>') + loanHtml;
  };

  window.addPersonalLoan = async function () {
    if (typeof refreshPmAccounts === 'function') await refreshPmAccounts();
    var opts = typeof pmAccOpts === 'function' ? pmAccOpts(['credit']) : [];
    if (!opts.length) {
      toast('Aucun compte / moyen disponible : rattachez un moyen de paiement à un compte (Finance).', 'error');
      return;
    }
    form('Nouveau prêt hors-exploitation', [
      ['borrower_name', 'Nom de l\'emprunteur'],
      ['borrower_phone', 'Téléphone'],
      ['amount', 'Montant', 'number'],
      ['method', 'Compte de sortie des fonds', 's', opts],
      ['loan_date', 'Date du prêt', 'date'],
      ['due_date', 'Date de retour promise', 'date'],
      ['notes', 'Notes', 'textarea']
    ], { loan_date: new Date().toISOString().slice(0, 10), method: opts[0][0] }, async function (d) {
      d.amount = +d.amount;
      if (!d.method) { toast('Sélectionnez le compte / mode de sortie', 'error'); return; }
      await Po('/finance/loans', d);
      closeM();
      toast('Prêt enregistré — liquidité débitée sur le compte choisi', 'success');
      go('caisse');
    });
  };

  window.repayPersonalLoan = async function (id, bal) {
    if (typeof refreshPmAccounts === 'function') await refreshPmAccounts();
    var opts = typeof pmAccOpts === 'function' ? pmAccOpts(['credit']) : [];
    if (!opts.length) {
      toast('Aucun compte / moyen disponible : rattachez un moyen de paiement à un compte (Finance).', 'error');
      return;
    }
    form('Remboursement dette hors-exploitation (solde ' + fl(bal) + ')', [
      ['amount', 'Montant', 'number'],
      ['method', 'Compte / mode d\'encaissement', 's', opts],
      ['notes', 'Notes']
    ], { amount: bal, method: opts[0][0] }, async function (d) {
      d.amount = +d.amount;
      if (!d.method) { toast('Sélectionnez le compte / mode de règlement', 'error'); return; }
      await Po('/finance/loans/' + id + '/repay', d);
      closeM();
      toast('Remboursement enregistré — compte crédité', 'success');
      go('caisse');
    });
  };

  /* ========== 6. Espace employé : mes alertes personnelles ========== */
  var _vMoi = VM.moi;
  VM.moi = async function () {
    var base = '';
    try { base = typeof _vMoi === 'function' ? await _vMoi() : ''; } catch (e) {}
    var alertsHtml = '';
    try {
      var me = await G('/hr/me').catch(function () { return null; });
      if (me && me.id) {
        var gaps = await G('/hr/employees/' + me.id + '/gaps').catch(function () { return []; });
        var debts = await G('/hr/employees/' + me.id + '/debts').catch(function () { return []; });
        var advances = await G('/hr/employees/' + me.id + '/advances').catch(function () { return []; });
        alertsHtml = '<div class="card" style="margin-top:12px"><h3 style="margin-top:0">Mes alertes personnelles</h3>' +
          '<div class="cards">' +
          '<div class="card"><small>Écarts en cours</small><b>' + (Array.isArray(gaps) ? gaps.filter(function (g) { return g.status !== 'cloture'; }).length : 0) + '</b></div>' +
          '<div class="card"><small>Dettes solde</small><b>' + f((debts || []).reduce(function (s, d) { return s + Number(d.balance || 0); }, 0)) + '</b></div>' +
          '<div class="card"><small>Avances</small><b>' + f((advances || []).reduce(function (s, a) { return s + Number(a.remaining || a.amount || 0); }, 0)) + '</b></div>' +
          '</div></div>';
      }
    } catch (e) {}
    var motionMode = 'subtle';
    try { var motionPrefs = await G('/me/preferences/motion'); motionMode = ['off','subtle','full'].includes(motionPrefs.mode) ? motionPrefs.mode : 'subtle'; } catch (e) {}
    var motionHtml = '<section class="card" style="margin-top:12px" aria-labelledby="motion-title">' +
      '<h3 id="motion-title" style="margin-top:0">Animations et effets visuels</h3>' +
      '<p class="detail-meta">Choisissez des effets légers pour les cartes et les boutons. Aucun compteur animé ni effet qui tourne en arrière-plan.</p>' +
      '<label for="profile-motion-mode">Niveau des animations</label>' +
      '<select id="profile-motion-mode" style="max-width:360px;width:100%;margin:8px 0 12px">' +
      '<option value="off"' + (motionMode === 'off' ? ' selected' : '') + '>Désactivées — priorité à la rapidité</option>' +
      '<option value="subtle"' + (motionMode === 'subtle' ? ' selected' : '') + '>Discrètes — transitions et léger soulèvement</option>' +
      '<option value="full"' + (motionMode === 'full' ? ' selected' : '') + '>Renforcées — zoom léger et transitions plus visibles</option>' +
      '</select> <button type="button" class="b1" onclick="saveMotionPreference()">Enregistrer</button>' +
      '<small class="detail-meta" style="display:block;margin-top:8px">La préférence est enregistrée pour votre utilisateur. Si le système demande de réduire les animations, cette règle reste prioritaire.</small></section>';
    return motionHtml + alertsHtml + (base || '');
  };
  window.saveMotionPreference = async function () {
    var select = document.getElementById('profile-motion-mode'); if (!select) return;
    var mode = ['off','subtle','full'].includes(select.value) ? select.value : 'subtle';
    try {
      await api('PUT', '/me/preferences/motion', { mode: mode });
      document.documentElement.dataset.motion = mode;
      try { if (ME && ME.id) localStorage.setItem('smp-motion-user-' + ME.id, mode); } catch (_) {}
      if (typeof toast === 'function') toast('Préférence d’animations enregistrée', 'success');
    } catch (e) { if (typeof toast === 'function') toast(typeof errMsg === 'function' ? errMsg(e) : (e.message || 'Enregistrement impossible'), 'error'); }
  };
  if (!V.moi) Object.assign(V, { moi: ['Mon profil', '*'] });

  /* ========== 7. Admin : config emails backup secondaires ========== */
  // Exposed helper for admin settings UI
  window.editBackupEmails = safe(async function () {
    var cur = { primary: '', secondary: ['', ''] };
    try {
      var s = await G('/settings').catch(function () { return {}; });
      if (s.backup_emails) cur = s.backup_emails;
    } catch (e) {}
    form('E-mails de notification sauvegarde', [
      ['primary', 'E-mail principal'],
      ['sec1', 'E-mail secondaire 1'],
      ['sec2', 'E-mail secondaire 2']
    ], {
      primary: cur.primary || '',
      sec1: (cur.secondary && cur.secondary[0]) || '',
      sec2: (cur.secondary && cur.secondary[1]) || ''
    }, async function (d) {
      var secondary = [d.sec1, d.sec2].filter(Boolean).slice(0, 2);
      await api('PUT', '/settings/backup_emails', { primary: d.primary || null, secondary: secondary, max_secondary: 2 });
      closeM();
      toast('E-mails sauvegarde mis à jour', 'success');
    });
  });

  console.info('[SMP] UX v2 chargé (topbar, profils, prêts, espace employé)');
})();
