/* PWA — SW + bannière d'installation + file hors-ligne visible */
(function () {
  'use strict';

  var deferredPrompt = null;
  var BANNER_DISMISS_KEY = 'smp-pwa-banner-dismissed';

  function isStandalone() {
    try {
      return window.matchMedia('(display-mode: standalone)').matches
        || window.navigator.standalone === true;
    } catch (e) {
      return false;
    }
  }
  window.pwaIsStandalone = isStandalone;

  /* ---------- Service Worker ---------- */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js', { scope: '/' })
        .then(function (reg) {
          reg.addEventListener('updatefound', function () {
            var nw = reg.installing;
            if (!nw) return;
            nw.addEventListener('statechange', function () {
              if (nw.state === 'installed' && navigator.serviceWorker.controller) {
                showUpdateBanner();
              }
            });
          });
        })
        .catch(function () { /* HTTP non sécurisé hors localhost */ });
    });
  }

  function showUpdateBanner() {
    if (document.getElementById('pwa-update-banner')) return;
    var el = document.createElement('div');
    el.id = 'pwa-update-banner';
    el.className = 'pwa-banner pwa-banner-update';
    el.innerHTML = '<span>Une mise à jour de l\'application est disponible.</span>' +
      '<button type="button" class="b1" id="pwa-reload-btn">Recharger</button>' +
      '<button type="button" class="b2" id="pwa-update-dismiss">Plus tard</button>';
    document.body.appendChild(el);
    document.getElementById('pwa-reload-btn').onclick = function () { location.reload(); };
    document.getElementById('pwa-update-dismiss').onclick = function () { el.remove(); };
  }

  /* ---------- Installation ---------- */
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    showInstallButtons(true);
    maybeShowInstallBanner();
  });

  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    showInstallButtons(false);
    hideInstallBanner();
    if (typeof toast === 'function') toast('Application installée sur cet appareil', 'success');
  });

  function showInstallButtons(visible) {
    document.querySelectorAll('[data-pwa-install]').forEach(function (btn) {
      btn.hidden = !visible;
    });
  }

  function maybeShowInstallBanner() {
    if (isStandalone()) return;
    if (!deferredPrompt) return;
    try {
      if (sessionStorage.getItem(BANNER_DISMISS_KEY) === '1') return;
    } catch (e) {}
    if (document.getElementById('pwa-install-banner')) return;
    var el = document.createElement('div');
    el.id = 'pwa-install-banner';
    el.className = 'pwa-banner pwa-banner-install';
    el.setAttribute('role', 'dialog');
    el.innerHTML = '<div class="pwa-banner-text">' +
      '<b>Installer Manager PRO</b>' +
      '<span>Accès rapide depuis l\'écran d\'accueil, même hors connexion partielle.</span>' +
      '</div>' +
      '<div class="pwa-banner-actions">' +
      '<button type="button" class="b1" id="pwa-banner-install">Installer</button>' +
      '<button type="button" class="b2" id="pwa-banner-dismiss">Pas maintenant</button>' +
      '</div>';
    document.body.appendChild(el);
    document.getElementById('pwa-banner-install').onclick = function () { window.pwaInstall(); };
    document.getElementById('pwa-banner-dismiss').onclick = function () {
      try { sessionStorage.setItem(BANNER_DISMISS_KEY, '1'); } catch (e) {}
      hideInstallBanner();
    };
  }

  function hideInstallBanner() {
    var el = document.getElementById('pwa-install-banner');
    if (el) el.remove();
  }

  window.pwaInstall = async function () {
    if (!deferredPrompt) {
      var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent || '');
      var msg = isIOS
        ? 'Sur iPhone / iPad : bouton Partager → « Sur l\'écran d\'accueil »'
        : 'Installation non proposée (déjà installée, ou navigateur non compatible).';
      if (typeof toast === 'function') toast(msg, 'info');
      else alert(msg);
      return;
    }
    deferredPrompt.prompt();
    try { await deferredPrompt.userChoice; } catch (e) {}
    deferredPrompt = null;
    showInstallButtons(false);
    hideInstallBanner();
  };

  if (isStandalone()) showInstallButtons(false);

  /* ---------- File hors-ligne : compteur + liste ---------- */
  window.listOfflineQueue = async function () {
    if (typeof openOfflineDb !== 'function' && !window.__smpOpenOfflineDb) {
      // openOfflineDb is local in improvements — reimplement minimal open
    }
    try {
      var db = await openOfflineDbCompat();
      var tx = db.transaction('queue', 'readonly');
      return await new Promise(function (res) {
        var r = tx.objectStore('queue').getAll();
        r.onsuccess = function () { res(r.result || []); };
        r.onerror = function () { res([]); };
      });
    } catch (e) {
      return [];
    }
  };

  function openOfflineDbCompat() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open('smp-offline-v1', 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains('queue')) {
          db.createObjectStore('queue', { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  window.refreshOfflineBadge = async function () {
    var items = await window.listOfflineQueue();
    var pending = items.filter(function (x) { return x.status === 'pending'; }).length;
    var failed = items.filter(function (x) { return x.status === 'failed'; }).length;
    var el = document.getElementById('offline-queue-badge');
    if (!el) {
      el = document.createElement('button');
      el.id = 'offline-queue-badge';
      el.type = 'button';
      el.className = 'offline-queue-badge';
      el.title = 'Actions en attente de synchronisation';
      el.onclick = function () {
        if (typeof go === 'function') go('offlineq');
      };
      document.body.appendChild(el);
    }
    if (pending > 0 || failed > 0) {
      el.style.display = 'block';
      el.textContent = (pending ? pending + ' hors-ligne' : '') + (pending && failed ? ' · ' : '') + (failed ? failed + ' refusée(s)' : '');
      el.style.background = failed ? '#b42318' : '';
    } else {
      el.style.display = 'none';
    }
    return pending;
  };

  window.addEventListener('online', function () {
    setTimeout(function () {
      if (typeof flushOfflineQueue === 'function') flushOfflineQueue().then(function () {
        window.refreshOfflineBadge();
      });
    }, 500);
  });
  setInterval(function () {
    if (document.visibilityState === 'visible') window.refreshOfflineBadge();
  }, 15000);
  setTimeout(function () { window.refreshOfflineBadge(); }, 2000);
})();
