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

  /* Abonnement serveur : permet de recevoir les notifications même application fermée. */
  async function serverSubscribe() {
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !window.TK || (window.ME && ME.is_global)) return false;
      if (Notification.permission !== 'granted') return false;
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        const k = await G('/push/key');
        const raw = atob(String(k.key).replace(/-/g, '+').replace(/_/g, '/'));
        const keyBytes = Uint8Array.from(raw, c => c.charCodeAt(0));
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes });
      }
      const j = sub.toJSON ? sub.toJSON() : {}; const kk = (j && j.keys) || {};
      await Po('/push/subscribe', { endpoint: sub.endpoint, user_agent: String(navigator.userAgent || '').slice(0, 280), p256dh: kk.p256dh, auth: kk.auth });
      return true;
    } catch (_) { return false; }
  }
  async function serverUnsubscribe() {
    try {
      const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription();
      if (sub) { await Po('/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe(); }
    } catch (_) { /* rien à désabonner */ }
  }
  window.smpPushSync = serverSubscribe;

  window.enablePushNotifications = async function () {
    const ok = await ensurePermission();
    if (!ok) return;
    setEnabled(true);
    serverSubscribe().then(ok => { if (ok) toast('Notifications téléphone activées (même application fermée)', 'success'); });
    toast('Notifications navigateur activées', 'success');
    pollAlerts();
    startPushPolling();
  };

  window.disablePushNotifications = function () {
    setEnabled(false);
    serverUnsubscribe();
    if (timer) clearInterval(timer);
    timer = null;
    toast('Notifications navigateur désactivées', 'info');
  };

  function startPushPolling() {
    if (timer) clearInterval(timer);
    if (!enabled()) return;
    setTimeout(serverSubscribe, 6000);
    timer = setInterval(pollAlerts, 60000);
    setTimeout(pollAlerts, 4000);
  }



  // ── Temps d'utilisation : un battement par minute tant que l'application est ouverte et visible ──
  setInterval(function () {
    try {
      if (document.visibilityState !== 'visible' || !window.TK || (typeof ME !== 'undefined' && ME && ME.is_global)) return;
      Po('/usage/ping', {}).catch(function () {});
    } catch (_) { /* mesure facultative */ }
  }, 60000);

  // ── Son de cloche (facultatif, par appareil) ──
  function soundOn() { try { return localStorage.getItem('smp_bell_sound') === '1'; } catch (_) { return false; } }
  window.smpBellBeep = function () {
    if (!soundOn()) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      const ctx = new AC(); const t = ctx.currentTime;
      [880, 1175].forEach(function (f, i) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = f; o.connect(g); g.connect(ctx.destination);
        g.gain.setValueAtTime(0.0001, t + i * 0.18); g.gain.exponentialRampToValueAtTime(0.25, t + i * 0.18 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.18 + 0.16);
        o.start(t + i * 0.18); o.stop(t + i * 0.18 + 0.2);
      });
      setTimeout(function () { try { ctx.close(); } catch (_) { /* déjà fermé */ } }, 800);
    } catch (_) { /* son indisponible */ }
  };
  window.smpToggleBellSound = function () {
    try { localStorage.setItem('smp_bell_sound', soundOn() ? '0' : '1'); } catch (_) { /* stockage indisponible */ }
    if (soundOn()) window.smpBellBeep();
    if (typeof toast === 'function') toast(soundOn() ? 'Son de la cloche activé' : 'Son de la cloche coupé');
  };

  // ── État du système (Superadmin) ──
  window.smpSystemStatus = async function () {
    let d;
    try { d = await G('/admin/system-status'); } catch (e) { return toast('État indisponible : ' + (e.message || e)); }
    const fmt = function (x) { return x ? new Date(x).toLocaleString('fr-FR') : '—'; };
    const row = function (l, v, ok) { return '<tr><td style="padding:6px 8px;color:var(--m)">' + l + '</td><td style="padding:6px 8px"><b>' + v + '</b>' + (ok === undefined ? '' : (ok ? ' ✅' : ' ❌')) + '</td></tr>'; };
    const up = Math.floor((d.uptime_s || 0) / 3600) + ' h ' + Math.floor(((d.uptime_s || 0) % 3600) / 60) + ' min';
    modal('<h3>État du système</h3><table style="width:100%;border-collapse:collapse">'
      + row('Version', esc(d.version || '—')) + row('Serveur (Node)', esc(d.node || '—')) + row('En marche depuis', up)
      + row('Base de données', d.db && d.db.ok ? 'OK — ' + d.db.latency_ms + ' ms' : 'Erreur', !!(d.db && d.db.ok))
      + row('Migrations appliquées', d.migrations && d.migrations.n != null ? d.migrations.n : '—')
      + row('Clients', d.clients && d.clients.n != null ? d.clients.n : '—')
      + row('Appareils abonnés aux notifications', d.push && d.push.subscriptions != null ? d.push.subscriptions + ' (' + d.push.users + ' utilisateur(s))' : '—')
      + row('Dernier envoi push réussi', fmt(d.push && d.push.last_ok))
      + row('Messages (24 h)', d.messages && d.messages.last_24h != null ? d.messages.last_24h + ' dont ' + d.messages.system_24h + ' alerte(s) auto' : '—')
      + row('Dernier message', fmt(d.messages && d.messages.last_at))
      + row('Actions journalisées (24 h)', d.activity && d.activity.audit_24h != null ? d.activity.audit_24h : '—')
      + row('Heure du serveur', fmt(d.time))
      + '</table><div style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end"><button class="btn" onclick="smpSystemStatus()">↻ Actualiser</button><button class="btn" onclick="closeM()">Fermer</button></div>');
  };

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
    if (um && !document.getElementById('bell-sound-link')) {
      const b = document.createElement('a');
      b.id = 'bell-sound-link'; b.setAttribute('role', 'menuitem'); b.tabIndex = 0;
      b.textContent = soundOn() ? '🔊 Son de la cloche : ON' : '🔈 Son de la cloche : OFF';
      b.onclick = function () { if (typeof closeUserMenu === 'function') closeUserMenu(); smpToggleBellSound(); b.textContent = soundOn() ? '🔊 Son de la cloche : ON' : '🔈 Son de la cloche : OFF'; };
      um.appendChild(b);
    }
    if (um && !document.getElementById('sys-status-link') && typeof ME !== 'undefined' && ME && ME.is_global) {
      const c = document.createElement('a');
      c.id = 'sys-status-link'; c.setAttribute('role', 'menuitem'); c.tabIndex = 0; c.textContent = '🩺 État du système';
      c.onclick = function () { if (typeof closeUserMenu === 'function') closeUserMenu(); smpSystemStatus(); };
      um.appendChild(c);
    }
  };

  // Auto-start if already enabled
  if (document.readyState === 'complete') startPushPolling();
  else window.addEventListener('load', startPushPolling);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && enabled()) pollAlerts();
  });
})();
