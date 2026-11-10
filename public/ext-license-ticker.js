/* ext-license-ticker.js — A moins de 15 jours de la fin de licence : message flottant défilant
   (de droite à gauche) sur une ligne horizontale tout en haut du site. 100 % automatique :
   réservé à l'admin local du client et au gérant (aucun autre rôle, ni Super Admin) ; aucun réglage ni action de l'utilisateur, il apparaît à la connexion et disparaît dès que la licence est renouvelée
   (> 15 jours), expirée (écran C2 plein écran) ou à la déconnexion. */
(function () {
  'use strict';
  var THRESHOLD = 15;          // jours
  var REFRESH_MS = 10 * 60 * 1000;   // relecture du statut côté serveur
  var TICK_MS = 4000;          // surveillance connexion / déconnexion
  var SPEED = 90;              // px / seconde
  var lastUser = null, lastFetch = 0, busy = false, shown = null;

  function bar() { return document.getElementById('lic-ticker'); }
  function remove() {
    var b = bar(); if (b) b.remove();
    document.body.classList.remove('lic-ticker-on');
    document.documentElement.style.setProperty('--lic-h', '0px');
    shown = null;
  }
  /* Supprime un éventuel ancien bandeau fixe « Votre licence expire dans … » (remplacé par le défilant). */
  function purgeStatic() {
    var t = bar();
    var cand = document.querySelectorAll('body > div, body > section, body > header, #app > div, #app > section');
    for (var i = 0; i < cand.length; i++) {
      var el = cand[i];
      if (el === t || (t && t.contains(el)) || el.id === 'login') continue;
      var txt = (el.textContent || '').trim();
      if (txt.length < 220 && /^Votre licence expire dans/i.test(txt)) el.remove();
    }
  }
  function mk(message, days) {
    var b = bar();
    if (!b) {
      b = document.createElement('div');
      b.id = 'lic-ticker'; b.setAttribute('role', 'status'); b.setAttribute('aria-live', 'polite');
      b.innerHTML = '<span class="lic-ico" aria-hidden="true">\u26A0</span><div class="lic-view"><span class="lic-track"></span></div>';
      document.body.insertBefore(b, document.body.firstChild);
    }
    b.classList.toggle('lic-urgent', days <= 3);
    var track = b.querySelector('.lic-track');
    if (shown !== message) { track.textContent = message; shown = message; }
    document.body.classList.add('lic-ticker-on');
    document.documentElement.style.setProperty('--lic-h', b.offsetHeight + 'px');
    // Durée proportionnelle à la longueur : vitesse de lecture constante, quelle que soit la largeur d'écran.
    var view = b.querySelector('.lic-view'), w = view.clientWidth || window.innerWidth, tw = track.scrollWidth || 600;
    track.style.setProperty('--lic-from', w + 'px');
    track.style.setProperty('--lic-dur', Math.max(8, (w + tw) / SPEED).toFixed(1) + 's');
    track.style.animation = 'none'; void track.offsetWidth; track.style.animation = '';   // relance proprement
    purgeStatic();
  }
  function loggedUser() {
    try { return (typeof ME !== 'undefined' && ME && !ME.is_global && (ME.role === 'ADMIN' || ME.role === 'GERANT') && ME.id != null && typeof TK !== 'undefined' && TK) ? String(ME.id) : null; }
    catch (_) { return null; }
  }
  function applies(s) {
    if (!s || s.is_indefinite) return false;
    if (s.status === 'EXPIREE' || s.status === 'SUSPENDUE') return false;
    var d = Number(s.days_remaining);
    return isFinite(d) && s.days_remaining != null && d >= 0 && d <= THRESHOLD;
  }
  async function refresh(force) {
    if (busy) return; busy = true;
    try {
      var u = loggedUser();
      if (!u) { lastUser = null; lastFetch = 0; remove(); return; }
      if (!force && u === lastUser && Date.now() - lastFetch < REFRESH_MS) { purgeStatic(); return; }
      var s = await G('/me/license/status-message');
      lastUser = u; lastFetch = Date.now();
      if (!applies(s)) { remove(); return; }
      var d = Math.max(0, Math.floor(Number(s.days_remaining)));
      var msg = String(s.message || '').trim() ||
        ('Votre licence expire dans ' + d + ' jour(s). Contactez l\'administrateur pour renouveler.');
      var phone = String(s.superadmin_phone || '').trim();
      if (phone) msg += ' — Tél. : ' + phone;
      mk(msg, d);
    } catch (_) { /* silencieux : le bandeau ne doit jamais gêner l'application */ }
    finally { busy = false; }
  }
  window.refreshLicenseTicker = function () { return refresh(true); };
  window.addEventListener('resize', function () { var b = bar(); if (b && shown) mk(shown, b.classList.contains('lic-urgent') ? 3 : 15); });
  function start() { refresh(false); setInterval(function () { refresh(false); }, TICK_MS); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
