/* Manager PRO - Pack ameliorations P21+ */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  /* 1. Messages d'erreur enrichis */
  window.errMsg = function (e) {
    if (!e) return 'Erreur inconnue';
    var msg = e.message || String(e);
    var details = e.details || e.issues || [];
    if (Array.isArray(details) && details.length) {
      var lines = details.map(function (d) {
        if (typeof d === 'string') return d;
        var path = Array.isArray(d.path) ? d.path.join('.') : (d.path || d.field || '');
        var m = d.message || d.description || d.msg || '';
        return path ? path + ' : ' + m : m;
      }).filter(Boolean);
      if (lines.length) msg += '\n• ' + lines.join('\n• ');
    }
    var map = {
      'Non authentifié': 'Session expirée — reconnectez-vous.',
      'Permission refusée': 'Vous n\'avez pas les droits nécessaires pour cette action.',
      'Solde de caisse insuffisant': 'Solde de caisse insuffisant pour cette opération.',
      'LICENCE EXPIRÉE': 'Licence expirée — contactez l\'administrateur principal.'
    };
    for (var k in map) {
      if (msg.indexOf(k) !== -1) {
        msg = map[k] + (msg.length > k.length ? ' (' + msg + ')' : '');
        break;
      }
    }
    return msg;
  };

  /* 2. Filtres persistants */
  window.saveFilter = function (key, value) {
    try { sessionStorage.setItem('smp-filter-' + key, JSON.stringify(value)); } catch (e) {}
  };
  window.loadFilter = function (key, fallback) {
    try {
      var v = sessionStorage.getItem('smp-filter-' + key);
      return v != null ? JSON.parse(v) : fallback;
    } catch (e) { return fallback; }
  };
  setInterval(function () {
    try {
      if (typeof P !== 'undefined') saveFilter('dash-period', { P: P, CA: CA, CB: CB });
      if (typeof EPER !== 'undefined') saveFilter('emp-period', EPER);
      if (typeof EMON !== 'undefined') saveFilter('emp-month', EMON);
    } catch (e) {}
  }, 2000);
  try {
    var dp = loadFilter('dash-period');
    if (dp && dp.P) { window.P = dp.P; if (dp.CA) window.CA = dp.CA; if (dp.CB) window.CB = dp.CB; }
    var ep = loadFilter('emp-period');
    if (ep && ep.from) window.EPER = ep;
    var em = loadFilter('emp-month');
    if (em) window.EMON = em;
  } catch (e) {}

  /* 3. Overlay raccourcis clavier */
  var SHORTCUTS = [
    ['/', 'Recherche globale'],
    ['N', 'Nouvelle vente'],
    ['Q', 'Quarts'],
    ['D', 'Tableau de bord'],
    ['Shift + F', 'Mode Focus pompiste'],
    ['?', 'Afficher / masquer cette aide'],
    ['Échap', 'Fermer modal / quitter Focus']
  ];
  function showShortcutsHelp() {
    var rows = SHORTCUTS.map(function (x) {
      return '<tr><td style="padding:6px 12px;font-family:ui-monospace,monospace;font-weight:600;white-space:nowrap">' +
        esc(x[0]) + '</td><td style="padding:6px 12px">' + esc(x[1]) + '</td></tr>';
    }).join('');
    modal('<h3 style="margin-top:0">Raccourcis clavier</h3><table style="width:100%;border-collapse:collapse">' +
      rows + '</table><div class="r" style="margin-top:14px"><button class="b2" onclick="closeM()">Fermer</button></div>');
  }
  document.addEventListener('keydown', function (e) {
    if (e.target.matches && e.target.matches('input, textarea, select')) return;
    if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      showShortcutsHelp();
    }
    if (e.key === 'Escape') {
      var m = document.getElementById('m');
      if (m && m.style.display === 'flex') closeM();
      else if (document.body.classList.contains('focus-mode') && typeof toggleFocusMode === 'function') {
        toggleFocusMode();
      }
    }
  });

  /* 4. Mode Focus pompiste ultra-minimal */
  window.renderFocusQuickSale = async function () {
    // CORR-045 : l'ancien écran appelait une route inexistante (/fuel-sales) avec un format périmé. Il utilise désormais /sales/fuel (compteur + mode litres/montant, espèces).
    var pumps = [], shift = null;
    try {
      pumps = await G('/pumps').catch(function () { return []; });
      shift = await G('/shifts/current').catch(function () { return null; });
    } catch (e) {}
    if (!shift) return '<div class="focus-quick" style="max-width:420px;margin:24px auto;padding:20px"><h2 style="text-align:center;margin-top:0">Vente rapide</h2><p style="text-align:center">Aucun quart ouvert : ouvrez un quart avant de vendre.</p><div class="r" style="justify-content:center"><button class="b2" onclick="toggleFocusMode()">Quitter Focus</button></div></div>';
    var opts = [];
    (pumps || []).forEach(function (p) { (p.counters || []).forEach(function (c) { opts.push('<option value="' + c.id + '" data-pump="' + p.id + '">' + esc(p.name || ('Pompe ' + p.id)) + ' · cpt ' + c.counter_number + ' · ' + esc(c.product || '') + '</option>'); }); });
    var team = (shift.team || []);
    var empSel = team.length > 1 ? '<label style="margin-top:10px">Pompiste<select id="fq-emp">' + team.map(function (t) { var pids = Array.isArray(t.pump_ids) ? t.pump_ids : (t.pump_id != null ? [t.pump_id] : []); return '<option value="' + (t.employee_id || t.id) + '" data-pumps=",' + pids.join(',') + ',">' + esc(t.name || t.full_name || ('#' + (t.employee_id || t.id))) + '</option>'; }).join('') + '</select></label><p id="fq-emp-note" style="font-size:12px;color:var(--m);margin:4px 0 0"></p>' : '';
    // La pompe fait foi : le pompiste est celui à qui la pompe du compteur est affectée (sinon, choix manuel).
    setTimeout(function () { window.fqSyncEmp && window.fqSyncEmp(); }, 0);
    return '<div class="focus-quick" style="max-width:420px;margin:24px auto;padding:20px">' +
      '<h2 style="text-align:center;margin-top:0">Vente rapide</h2>' +
      '<label>Compteur<select id="fq-counter" onchange="fqSyncEmp()">' + (opts.join('') || '<option value="">Aucune pompe</option>') + '</select></label>' + empSel +
      '<label style="margin-top:10px">Mode<select id="fq-mode"><option value="litres">Litres</option><option value="montant">Montant</option></select></label>' +
      '<label style="margin-top:10px">Valeur<input type="number" id="fq-val" step="any" min="0" placeholder="0"></label>' +
      '<p style="font-size:12px;color:var(--m)">Paiement en espèces. Pour mobile money, crédit ou carte, utilisez l’écran Ventes.</p>' +
      '<div class="r" style="margin-top:18px;justify-content:center;gap:10px">' +
      '<button onclick="submitFocusSale()" style="min-width:140px">Enregistrer</button>' +
      '<button class="b2" onclick="toggleFocusMode()">Quitter Focus</button></div>' +
      '<p style="text-align:center;color:var(--m);font-size:12px;margin-top:16px">Appuyez sur <kbd>?</kbd> pour les raccourcis</p></div>';
  };
  window.fqSyncEmp = function () {
    var c = document.getElementById('fq-counter'), e = document.getElementById('fq-emp'), note = document.getElementById('fq-emp-note');
    if (!c || !e) return;
    var opt = c.options[c.selectedIndex], pump = opt ? opt.getAttribute('data-pump') : null, found = null;
    if (pump != null) Array.prototype.forEach.call(e.options, function (o) { if (!found && (o.getAttribute('data-pumps') || '').indexOf(',' + pump + ',') !== -1) found = o; });
    if (found) { e.value = found.value; e.disabled = true; if (note) note.textContent = 'Pompe affectée à ' + found.textContent + ' : la vente sera enregistrée à son nom.'; }
    else { e.disabled = false; if (note) note.textContent = 'Cette pompe n\u2019a pas de responsable sur le quart : choisissez le pompiste.'; }
  };
  window.submitFocusSale = async function () {
    var cEl = document.getElementById('fq-counter'), modeEl = document.getElementById('fq-mode'), valEl = document.getElementById('fq-val'), eEl = document.getElementById('fq-emp');
    var counterId = cEl ? +cEl.value : 0, mode = modeEl ? modeEl.value : 'litres', val = valEl ? parseFloat(valEl.value) : 0;
    if (!counterId) return toast('Choisissez un compteur', 'error');
    if (!val || val <= 0) return toast('Saisissez une valeur valide', 'error');
    var body = { mode: mode, counter_id: counterId };
    if (mode === 'litres') body.liters = val; else body.amount = val;
    if (eEl && eEl.value) body.employee_id = +eEl.value;
    try {
      var sent = window.smpFuelSale ? await smpFuelSale(body) : await Po('/sales/fuel', body);
      toast(sent && sent.queued ? 'Hors ligne : vente gardée sur l’appareil' : 'Vente enregistrée', sent && sent.queued ? 'info' : 'success');
      if (valEl) valEl.value = '';
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };

  /* 5. Page Premiers pas */
  async function vOnboarding() {
    var manager = !ME.is_global && (ME.role === 'GERANT' || ME.role === 'ADMIN');
    var steps = manager ? [
      { title: '1. Configurer la station', desc: 'Vérifiez l’identité, la devise et les paramètres d’exploitation.', action: 'param', label: 'Paramètres' },
      { title: '2. Produits & pompes', desc: 'Créez les carburants, fixez les prix et configurez les pompes / compteurs.', action: 'prod', label: 'Produits' },
      { title: '3. Créer les employés', desc: 'Ajoutez les membres de l’équipe et déléguez uniquement les droits autorisés.', action: 'emp', label: 'Employés' },
      { title: '4. Ouvrir un quart', desc: 'Ouvrez le premier quart avec le chef, les participants, les pompes et les index.', action: 'quart', label: 'Quarts' }
    ] : [
      { title: '1. Découvrir vos droits', desc: 'Consultez les fonctions auxquelles votre gérant vous a donné accès.', action: 'moi', label: 'Mon profil' },
      { title: '2. Vérifier les alertes', desc: 'Consultez vos notifications et les informations importantes.', action: 'alert', label: 'Alertes' },
      { title: '3. Commencer', desc: 'Utilisez les modules disponibles dans votre espace de travail.', action: 'dash', label: 'Dashboard' }
    ];
    var cards = steps.map(function (s) {
      return '<div class="card" style="text-align:left"><b>' + esc(s.title) + '</b>' +
        '<p style="color:var(--m);font-size:13.5px;margin:8px 0 12px">' + esc(s.desc) + '</p>' +
        '<button class="b2" onclick="go(\'' + s.action + '\')">' + esc(s.label) + '</button></div>';
    }).join('');
    return '<h2 style="margin-top:0">Premiers pas</h2>' +
      '<p style="color:var(--m)">Bienvenue dans ' + esc(brandName()) + '. Suivez ces étapes pour être opérationnel rapidement.</p>' +
      '<div class="cards">' + cards + '</div>' +
      '<div class="r" style="margin-top:16px">' +
      '<button class="b2" onclick="go(\'dash\')">Continuer vers le dashboard</button></div>';
  }

  /* 6. File hors-ligne IndexedDB */
  var OFFLINE_DB = 'smp-offline-v1';
  var OFFLINE_STORE = 'queue';
  function openOfflineDb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(OFFLINE_DB, 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(OFFLINE_STORE)) {
          db.createObjectStore(OFFLINE_STORE, { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }
  window.enqueueOffline = async function (action) {
    try {
      var db = await openOfflineDb();
      var tx = db.transaction(OFFLINE_STORE, 'readwrite');
      tx.objectStore(OFFLINE_STORE).add(Object.assign({}, action, { created_at: Date.now(), status: 'pending' }));
      return new Promise(function (res, rej) {
        tx.oncomplete = function () { try { if (typeof refreshOfflineBadge === 'function') refreshOfflineBadge(); } catch (e) {} res(true); };
        tx.onerror = function () { rej(tx.error); };
      });
    } catch (e) {
      console.warn('[offline] enqueue failed', e);
      return false;
    }
  };
  window.flushOfflineQueue = async function () {
    if (!navigator.onLine || !TK) return { flushed: 0 };
    try {
      var db = await openOfflineDb();
      var tx = db.transaction(OFFLINE_STORE, 'readonly');
      var items = await new Promise(function (res) {
        var r = tx.objectStore(OFFLINE_STORE).getAll();
        r.onsuccess = function () { res(r.result || []); };
      });
      var flushed = 0;
      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        if (item.status !== 'pending') continue;
        try {
          await api(item.method || 'POST', item.path, item.body);
          var wtx = db.transaction(OFFLINE_STORE, 'readwrite');
          wtx.objectStore(OFFLINE_STORE).delete(item.id);
          flushed++;
        } catch (e) {
          console.warn('[offline] flush item failed', item, e);
        }
      }
      if (flushed) toast(flushed + ' action(s) hors-ligne synchronisée(s)', 'success');
      return { flushed: flushed };
    } catch (e) {
      console.warn('[offline] flush failed', e);
      return { flushed: 0 };
    }
  };
  window.addEventListener('online', function () { flushOfflineQueue(); });

  function updateNetBadge() {
    var el = document.getElementById('net-badge');
    if (!el) {
      el = document.createElement('div');
      el.id = 'net-badge';
      el.style.cssText = 'position:fixed;bottom:12px;left:12px;z-index:90;font-size:11px;padding:4px 10px;border-radius:20px;background:var(--c);border:1px solid var(--bd);box-shadow:var(--shadow);display:none';
      document.body.appendChild(el);
    }
    if (!navigator.onLine) {
      el.style.display = 'block';
      el.textContent = 'Hors ligne — les actions seront synchronisées plus tard';
      el.style.color = 'var(--o)';
    } else {
      el.style.display = 'none';
    }
  }
  window.addEventListener('online', updateNetBadge);
  window.addEventListener('offline', updateNetBadge);
  setTimeout(updateNetBadge, 500);

  /* 7. Skeletons systematiques */
  if (typeof go === 'function') {
    var _go = go;
    window.go = async function (k, a) {
      var pg = document.getElementById('pg');
      if (pg && !document.body.classList.contains('focus-mode')) {
        pg.innerHTML = typeof skeleton === 'function' ? skeleton('page') : '<p>Chargement…</p>';
      }
      return _go(k, a);
    };
  }

  /* 8. Helper journal activite */
  window.renderAuditFilters = function () {
    return '<div class="bar" style="flex-wrap:wrap;gap:8px;margin-bottom:12px">' +
      '<input type="search" id="af-q" placeholder="Rechercher…" style="min-width:160px">' +
      '<select id="af-module"><option value="">Tous modules</option>' +
      '<option value="auth">Auth</option><option value="hr">RH</option>' +
      '<option value="sales">Ventes</option><option value="cash">Caisse</option>' +
      '<option value="stock">Stock</option><option value="admin">Admin</option></select>' +
      '<input type="date" id="af-from"><input type="date" id="af-to">' +
      '<button class="b2" id="af-btn">Filtrer</button></div>';
  };

  /* 9. Enregistrement vues */
  if (typeof V !== 'undefined' && typeof VM !== 'undefined') {
    Object.assign(V, { onboard: ['Premiers pas', '*'] });
    Object.assign(VM, { onboard: vOnboarding });
    if (typeof NAV_ICONS !== 'undefined') NAV_ICONS.onboard = '🚀';
  }

  console.info('[SMP] Pack ameliorations charge');
})();
