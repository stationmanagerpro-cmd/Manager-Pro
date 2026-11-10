/* Notifications push navigateur (stock, licence, écarts, alertes) */
(function () {
  'use strict';
  const STORAGE_KEY = 'smp_push_seen';
  const PREF_KEY = 'smp_push_enabled';
  let timer = null;
  let lastPoll = 0;

  function seenSet() {
    try { return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')); }
    catch (_) { return new Set(); }
  }
  function saveSeen(set) {
    const arr = [...set].slice(-200);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(arr)); } catch (_) {}
  }
  function enabled() {
    return localStorage.getItem(PREF_KEY) === '1';
  }
  function setEnabled(v) {
    localStorage.setItem(PREF_KEY, v ? '1' : '0');
  }

  async function ensurePermission() {
    if (!('Notification' in window)) {
      toast('Notifications non supportées par ce navigateur', 'error');
      return false;
    }
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') {
      toast('Notifications bloquées dans les paramètres du navigateur', 'error');
      return false;
    }
    const p = await Notification.requestPermission();
    return p === 'granted';
  }

  function showNative(title, body, tag) {
    if (Notification.permission !== 'granted') return;
    try {
      const n = new Notification(title, {
        body: body || '',
        tag: tag || 'smp-alert',
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        renotify: true
      });
      n.onclick = function () {
        window.focus();
        n.close();
        if (typeof go === 'function') go('alerts');
      };
      // SW fallback
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
          type: 'smp-notify',
          title: title,
          body: body,
          tag: tag
        });
      }
    } catch (e) { /* silent */ }
  }

  async function pollAlerts() {
    if (!enabled() || !window.TK || ME && ME.is_global) return;
    if (!window.SID) return;
    if (document.visibilityState === 'hidden' && Date.now() - lastPoll < 120000) return;
    lastPoll = Date.now();
    try {
      const data = await G('/alerts/center').catch(() => null);
      if (!data) return;
      const items = data.items || data.alerts || data || [];
      if (!Array.isArray(items)) return;
      const seen = seenSet();
      const important = items.filter(a => {
        const lvl = String(a.level || '').toLowerCase();
        return lvl === 'critical' || lvl === 'warning' || lvl === 'error' || a.type === 'STOCK' || a.type === 'ECART';
      });
      let newCount = 0;
      for (const a of important) {
        const key = String(a.source || 'x') + ':' + String(a.id || a.message || '');
        if (seen.has(key)) continue;
        seen.add(key);
        newCount++;
        if (newCount <= 3) {
          const title = a.type === 'STOCK' ? 'Stock bas' :
            a.type === 'ECART' ? 'Écart de caisse' :
            (a.level === 'critical' ? 'Alerte critique' : 'Alerte Station Manager');
          showNative(title, a.message || '', key);
        }
      }
      if (newCount) saveSeen(seen);
      // Badge cloche
      if (typeof refreshBell === 'function') refreshBell();
    } catch (_) {}
  }

  window.enablePushNotifications = async function () {
    const ok = await ensurePermission();
    if (!ok) return;
    setEnabled(true);
    toast('Notifications navigateur activées', 'success');
    pollAlerts();
    startPushPolling();
  };

  window.disablePushNotifications = function () {
    setEnabled(false);
    if (timer) clearInterval(timer);
    timer = null;
    toast('Notifications navigateur désactivées', 'info');
  };

  function startPushPolling() {
    if (timer) clearInterval(timer);
    if (!enabled()) return;
    timer = setInterval(pollAlerts, 60000);
    setTimeout(pollAlerts, 4000);
  }

  // Entrée menu utilisateur
  const prevInit = window.initShell;
  window.initShell = async function () {
    if (typeof prevInit === 'function') await prevInit();
    // bouton préférences dans user menu si présent
    const um = document.getElementById('user-menu');
    if (um && !document.getElementById('push-toggle-link')) {
      const a = document.createElement('a');
      a.id = 'push-toggle-link';
      a.setAttribute('role', 'menuitem');
      a.tabIndex = 0;
      a.onclick = function () {
        if (typeof closeUserMenu === 'function') closeUserMenu();
        if (enabled()) disablePushNotifications();
        else enablePushNotifications();
        a.textContent = enabled() ? '🔔 Notifications : ON' : '🔔 Activer les notifications';
      };
      a.textContent = enabled() ? '🔔 Notifications : ON' : '🔔 Activer les notifications';
      um.appendChild(a);
    }
  };

  // Auto-start if already enabled
  if (document.readyState === 'complete') startPushPolling();
  else window.addEventListener('load', startPushPolling);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && enabled()) pollAlerts();
  });
})();
