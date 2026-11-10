/* CORR-043 — Vente carburant hors ligne : mise en file locale, envoi automatique au retour du réseau, rejets visibles.
 * - Chaque vente porte une référence unique (client_ref) : un renvoi ne crée jamais de doublon (contrôle serveur).
 * - L'heure réelle de la saisie (offline_at) est conservée ; le serveur refuse une vente qui n'appartient plus au quart ouvert.
 * - Réseau coupé / erreur serveur : la vente reste en attente. Refus métier (4xx) : statut « failed » + message, jamais de nouvel essai silencieux.
 * - Cartes flotte exclues : PIN, plafonds et blocage exigent le serveur (aucun PIN n'est jamais stocké sur l'appareil). */
(function () {
  'use strict';
  var DB = 'smp-offline-v1', STORE = 'queue';

  function uuid() {
    try { if (window.crypto && crypto.randomUUID) return 'off-' + crypto.randomUUID(); } catch (e) {}
    return 'off-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  }
  function isNetworkError(e) { return !!e && !e.status && (e.name === 'TypeError' || /failed to fetch|network|load failed/i.test(String(e.message || ''))); }
  /** 'retry' : on garde en attente (réseau, serveur, session) ; 'reject' : refus métier définitif. */
  function classify(e) {
    if (isNetworkError(e)) return 'retry';
    var s = e && e.status;
    if (!s || s >= 500 || s === 401 || s === 408 || s === 429) return 'retry';
    return 'reject';
  }
  function rejectMessage(e) {
    var d = e && e.details; var extra = Array.isArray(d) ? ' (' + d.join(' ; ') + ')' : '';
    return ((e && e.message) || 'Refusée par le serveur') + extra;
  }

  function openDb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB, 1);
      req.onupgradeneeded = function () { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true }); };
      req.onsuccess = function () { resolve(req.result); }; req.onerror = function () { reject(req.error); };
    });
  }
  function idbStore() {
    function run(mode, fn) { return openDb().then(function (db) { return new Promise(function (res, rej) { var tx = db.transaction(STORE, mode), out = fn(tx.objectStore(STORE)); tx.oncomplete = function () { res(out && out.result !== undefined ? out.result : undefined); }; tx.onerror = function () { rej(tx.error); }; }); }); }
    return {
      getAll: function () { return run('readonly', function (s) { return s.getAll(); }).then(function (r) { return r || []; }); },
      put: function (item) { return run('readwrite', function (s) { return s.put(item); }); },
      add: function (item) { return run('readwrite', function (s) { return s.add(item); }); },
      del: function (id) { return run('readwrite', function (s) { return s.delete(id); }); }
    };
  }

  var flushing = false;
  /** Envoie les éléments en attente dans l'ordre de saisie. store/send injectables (tests). */
  async function flush(opts) {
    opts = opts || {};
    var store = opts.store || idbStore(), send = opts.send || function (m, p, b) { return api(m, p, b); };
    var station = opts.station !== undefined ? opts.station : (typeof SID !== 'undefined' ? SID : null);
    if (flushing) return { flushed: 0, rejected: 0, busy: true };
    flushing = true;
    var flushed = 0, rejected = 0, rejectedLabels = [];
    try {
      var items = (await store.getAll()).filter(function (x) { return (x.status || 'pending') === 'pending'; }).sort(function (a, b) { return (a.created_at || 0) - (b.created_at || 0); });
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (it.station != null && station != null && String(it.station) !== String(station)) continue;   // jamais envoyée vers une autre station
        try {
          await send(it.method || 'POST', it.path, it.body);
          await store.del(it.id); flushed++;
        } catch (e) {
          if (classify(e) === 'retry') break;                                                           // réseau/serveur/session : on s'arrête, tout reste en attente
          await store.put(Object.assign({}, it, { status: 'failed', error: rejectMessage(e), failed_at: Date.now() }));
          rejected++; rejectedLabels.push(it.label || it.path);
        }
      }
    } finally { flushing = false; }
    return { flushed: flushed, rejected: rejected, rejectedLabels: rejectedLabels };
  }

  function notify(r) {
    try {
      if (r.flushed && typeof toast === 'function') toast(r.flushed + ' vente(s) hors ligne synchronisée(s)', 'success');
      if (r.rejected && typeof toast === 'function') toast(r.rejected + ' vente(s) hors ligne REFUSÉE(S) par le serveur : ouvrez « File hors-ligne » et ressaisissez-les', 'error');
      if (typeof refreshOfflineBadge === 'function') refreshOfflineBadge();
    } catch (e) {}
  }
  window.flushOfflineQueue = async function () {
    if (!navigator.onLine || (typeof TK !== 'undefined' && !TK)) return { flushed: 0, rejected: 0 };
    var r = await flush(); notify(r); return r;
  };

  /** Envoie une vente carburant ; si le réseau manque, la met en file. Retourne { queued:true } ou la réponse serveur. */
  async function fuelSale(body, deps) {
    deps = deps || {};
    var send = deps.send || function (m, p, b) { return api(m, p, b); }, store = deps.store || idbStore();
    var online = deps.online !== undefined ? deps.online : navigator.onLine;
    body.client_ref = body.client_ref || uuid();
    var canQueue = !body.fleet_card;
    function queue() {
      var label = 'Vente carburant ' + (body.liters ? body.liters + ' L' : body.amount ? body.amount + ' F' : 'par index');
      return store.add({ type: 'fuel_sale', method: 'POST', path: '/sales/fuel', label: label, station: (typeof SID !== 'undefined' ? SID : null), user: (typeof ME !== 'undefined' && ME ? ME.id : null),
        body: Object.assign({}, body, { offline_at: new Date().toISOString() }), created_at: Date.now(), status: 'pending' })
        .then(function () { try { if (typeof refreshOfflineBadge === 'function') refreshOfflineBadge(); } catch (e) {} return { queued: true, client_ref: body.client_ref }; });
    }
    if (!online) {
      if (!canQueue) throw Object.assign(new Error('Carte flotte : le réseau est obligatoire (PIN et plafonds contrôlés par le serveur).'), { status: 0, offlineBlocked: true });
      return queue();
    }
    try { return await send('POST', '/sales/fuel', body); }
    catch (e) { if (isNetworkError(e) && canQueue) return queue(); throw e; }
  }
  window.smpFuelSale = fuelSale;

  /** Supprime un élément refusé (après ressaisie ou décision du gérant). */
  window.offlineDiscard = async function (id) {
    if (!confirm('Supprimer cette vente hors ligne refusée ? Elle ne sera plus jamais envoyée.')) return;
    try { await idbStore().del(id); if (typeof refreshOfflineBadge === 'function') await refreshOfflineBadge(); if (typeof go === 'function') go('offlineq'); } catch (e) { if (typeof toast === 'function') toast('Suppression impossible', 'error'); }
  };

  window.SMPOffline = { classify: classify, flush: flush, fuelSale: fuelSale, isNetworkError: isNetworkError };
  window.addEventListener('online', function () { setTimeout(function () { window.flushOfflineQueue(); }, 800); });
})();
