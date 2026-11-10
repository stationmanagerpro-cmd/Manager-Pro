/* Pont application Android + saisie des téléphones.
 * 1) Téléphones : format international obligatoire, +223 par défaut (Mali).
 * 2) Dans l'app Android :
 *    - Capacitor : Capacitor.Plugins.NativeBridge (saveAndOpen, openExternal, printPage, printHtml)
 *    - Ancien WebView : window.AndroidBridge (même API synchrone)
 *    - navigateur web classique : seuls les téléphones sont actifs.
 * Exports PDF / Excel / CSV : enregistrés dans Téléchargements puis ouverts / partagés.
 * WhatsApp, mailto, tel : application native.
 * Impression : dialogue Android (« Enregistrer au format PDF »).
 */
(function () {
  'use strict';

  function notify(msg, type) {
    try {
      if (typeof toast === 'function') toast(msg, type || 'error');
      else alert(msg);
    } catch (e) { /* sans effet */ }
  }

  /* ===================== 1. Téléphones ===================== */
  function fmt8(d) { return d.replace(/(\d{2})(?=\d)/g, '$1 ').trim(); }
  function normPhone(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s) return { ok: true, value: '' };
    var t = s.replace(/[\s.\-()]/g, ''), d, intl = false;
    if (t.indexOf('+') === 0) { d = t.slice(1).replace(/\D/g, ''); intl = true; }
    else if (t.indexOf('00') === 0) { d = t.slice(2).replace(/\D/g, ''); intl = true; }
    else d = t.replace(/\D/g, '');
    if (d.indexOf('223') === 0 && d.length === 11) return { ok: true, value: '+223 ' + fmt8(d.slice(3)) };
    if (!intl) return d.length === 8 ? { ok: true, value: '+223 ' + fmt8(d) } : { ok: false };
    return d.length >= 8 && d.length <= 15 ? { ok: true, value: '+' + d } : { ok: false };
  }
  var MSG_TEL = 'Numéro invalide : saisissez-le au format +223 XX XX XX XX (ou +indicatif d’un autre pays).';
  function isPhoneInput(el) {
    return el && el.tagName === 'INPUT' && /(^|_|-)(phone|telephone|tel|whatsapp)($|_|-)/i.test(String(el.id || el.name || ''));
  }
  function checkPhone(el) {
    var r = normPhone(el.value);
    if (r.ok) { el.value = r.value; el.style.outline = ''; el.removeAttribute('aria-invalid'); }
    else { el.style.outline = '2px solid #dc3545'; el.setAttribute('aria-invalid', 'true'); }
    return r.ok;
  }
  document.addEventListener('focusin', function (e) {
    var el = e.target; if (!isPhoneInput(el)) return;
    if (!el.placeholder) el.placeholder = '+223 XX XX XX XX';
    if (!el.value.trim()) el.value = '+223 ';
  });
  document.addEventListener('focusout', function (e) {
    var el = e.target; if (!isPhoneInput(el)) return;
    if (/^\+223\s*$/.test(el.value)) { el.value = ''; return; }
    checkPhone(el);
  });
  document.addEventListener('submit', function (e) {
    var bad = false;
    document.querySelectorAll('#m input').forEach(function (el) {
      if (!isPhoneInput(el)) return;
      if (/^\+223\s*$/.test(el.value)) el.value = '';
      if (!checkPhone(el)) bad = true;
    });
    if (bad) { e.preventDefault(); e.stopImmediatePropagation(); notify(MSG_TEL); }
  }, true);

  /* ===================== 2. Résolution du pont natif ===================== */
  function getCapPlugin() {
    try {
      var C = window.Capacitor;
      if (!C) return null;
      // Capacitor 3+ : Plugins.NativeBridge
      if (C.Plugins && C.Plugins.NativeBridge) return C.Plugins.NativeBridge;
      // API registerPlugin
      if (typeof C.Plugins === 'object' && C.Plugins.NativeBridge) return C.Plugins.NativeBridge;
      return null;
    } catch (e) { return null; }
  }

  function isNativeApp() {
    if (window.AndroidBridge) return true;
    try {
      var C = window.Capacitor;
      if (C && typeof C.isNativePlatform === 'function' && C.isNativePlatform()) return true;
      if (C && C.getPlatform && C.getPlatform() === 'android') return true;
    } catch (e) { /* */ }
    return !!getCapPlugin();
  }

  /** Appels unifiés (Capacitor async ou AndroidBridge sync) */
  var Bridge = {
    available: function () { return !!(window.AndroidBridge || getCapPlugin()); },
    saveAndOpen: function (name, mime, b64) {
      var ab = window.AndroidBridge;
      if (ab && typeof ab.saveAndOpen === 'function') {
        try { ab.saveAndOpen(String(name || 'fichier'), mime || 'application/octet-stream', b64); return Promise.resolve(); }
        catch (e) { return Promise.reject(e); }
      }
      var p = getCapPlugin();
      if (p && typeof p.saveAndOpen === 'function') {
        return p.saveAndOpen({ name: String(name || 'fichier'), mime: mime || 'application/octet-stream', data: b64 });
      }
      return Promise.reject(new Error('Pont natif indisponible'));
    },
    openExternal: function (url) {
      var ab = window.AndroidBridge;
      if (ab && typeof ab.openExternal === 'function') {
        try { ab.openExternal(String(url)); return Promise.resolve(); }
        catch (e) { return Promise.reject(e); }
      }
      var p = getCapPlugin();
      if (p && typeof p.openExternal === 'function') {
        return p.openExternal({ url: String(url) });
      }
      return Promise.reject(new Error('Pont natif indisponible'));
    },
    printPage: function (title) {
      var ab = window.AndroidBridge;
      if (ab && typeof ab.print === 'function') {
        try { ab.print(String(title || 'Document')); return Promise.resolve(); }
        catch (e) { return Promise.reject(e); }
      }
      var p = getCapPlugin();
      if (p && typeof p.printPage === 'function') {
        return p.printPage({ title: String(title || 'Document') });
      }
      return Promise.reject(new Error('Impression native indisponible'));
    },
    printHtml: function (html) {
      var ab = window.AndroidBridge;
      if (ab && typeof ab.printHtml === 'function') {
        try { ab.printHtml(String(html || '')); return Promise.resolve(); }
        catch (e) { return Promise.reject(e); }
      }
      var p = getCapPlugin();
      if (p && typeof p.printHtml === 'function') {
        return p.printHtml({ html: String(html || '') });
      }
      return Promise.reject(new Error('Impression native indisponible'));
    }
  };

  // Exposé pour les modules (Mes stations, exports…)
  window.ManageProNative = Bridge;

  if (!isNativeApp() && !Bridge.available()) {
    // Navigateur classique : pas d'interception fichiers / impression
    return;
  }

  /* ===================== 3. Interception exports & liens ===================== */
  var BLOBS = new Map();
  var origCreate = URL.createObjectURL, origRevoke = URL.revokeObjectURL;
  URL.createObjectURL = function (o) {
    var u = origCreate.apply(URL, arguments);
    try { if (o instanceof Blob) BLOBS.set(u, o); } catch (e) { /* sans effet */ }
    return u;
  };
  URL.revokeObjectURL = function (u) {
    setTimeout(function () { BLOBS.delete(u); }, 15000);
    return origRevoke.apply(URL, arguments);
  };

  function sendToNative(blob, name) {
    var r = new FileReader();
    r.onload = function () {
      var s = String(r.result || '');
      var b64 = s.indexOf(',') >= 0 ? s.slice(s.indexOf(',') + 1) : s;
      Bridge.saveAndOpen(String(name || 'fichier'), blob.type || 'application/octet-stream', b64)
        .then(function () { notify('Fichier enregistré dans Téléchargements', 'success'); })
        .catch(function (e) { notify('Ouverture du fichier impossible : ' + (e && (e.message || e))); });
    };
    r.onerror = function () { notify('Lecture du fichier impossible.'); };
    r.readAsDataURL(blob);
  }

  var EXTERNAL = /^(https?:\/\/(wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com)\/|whatsapp:|mailto:|tel:|sms:|intent:)/i;
  function openExternal(url) {
    Bridge.openExternal(url).catch(function () { notify('Application externe introuvable.'); });
  }

  /* a.click() programmatique (exports : a.download + blob) */
  var origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    var h = this.href || '';
    if (this.hasAttribute('download') && /^blob:/.test(h) && BLOBS.has(h)) {
      sendToNative(BLOBS.get(h), this.getAttribute('download'));
      return;
    }
    if (EXTERNAL.test(h)) { openExternal(h); return; }
    return origClick.apply(this, arguments);
  };

  /* vrais clics sur un lien */
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    var h = a.href || '';
    if (a.hasAttribute('download') && /^blob:/.test(h) && BLOBS.has(h)) {
      e.preventDefault();
      sendToNative(BLOBS.get(h), a.getAttribute('download'));
    } else if (EXTERNAL.test(h)) {
      e.preventDefault();
      openExternal(h);
    }
  }, true);

  /* window.open : blob, WhatsApp, ou fenêtre HTML → printHtml */
  var origOpen = window.open;
  window.open = function (url) {
    var u = String(url == null ? '' : url);
    if (/^blob:/.test(u) && BLOBS.has(u)) {
      var blob = BLOBS.get(u);
      var ext = /pdf/i.test(blob.type) ? 'pdf' : (/sheet|excel|csv/i.test(blob.type) ? 'csv' : 'bin');
      sendToNative(blob, 'document.' + ext);
      return null;
    }
    if (EXTERNAL.test(u)) { openExternal(u); return null; }
    if (u === '' || u === 'about:blank') {
      var buf = '';
      var fake = {
        closed: false,
        focus: function () {},
        print: function () {
          Bridge.printHtml(buf).catch(function () { notify('Impression indisponible.'); });
        },
        close: function () { this.closed = true; },
        document: {
          write: function (h) { buf += h; },
          writeln: function (h) { buf += h + '\n'; },
          open: function () {},
          close: function () {
            Bridge.printHtml(buf).catch(function () { notify('Impression indisponible.'); });
          }
        }
      };
      return fake;
    }
    return origOpen.apply(window, arguments);
  };

  /* window.print → impression Android */
  window.print = function () {
    Bridge.printPage(document.title || 'Document')
      .catch(function () { notify('Impression indisponible.'); });
  };

  /* Capacitor charge parfois après le script : ré-essai court */
  if (!Bridge.available()) {
    var tries = 0;
    var t = setInterval(function () {
      tries += 1;
      if (Bridge.available() || tries > 20) clearInterval(t);
    }, 250);
  }
})();
