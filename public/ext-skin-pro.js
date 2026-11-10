/* ext-skin-pro.js — habillage « Pro » : choix du thème, slogan centré, photo de bandeau (par client), fil d'Ariane.
   Retour au design précédent : localStorage.setItem('smp-skin','classic') ou ?skin=classic ; setSkin('classic'|'pro'). */
(function () {
  'use strict';
  var d = document.documentElement;
  function pref() {
    try { var q = new URLSearchParams(location.search).get('skin'); if (q === 'classic' || q === 'pro') { localStorage.setItem('smp-skin', q); return q; } return localStorage.getItem('smp-skin') === 'classic' ? 'classic' : 'pro'; }
    catch (_) { return 'pro'; }
  }
  d.dataset.skin = pref();
  window.setSkin = function (s) { s = s === 'classic' ? 'classic' : 'pro'; try { localStorage.setItem('smp-skin', s); } catch (_) {} d.dataset.skin = s; };
  if (typeof window.G === 'undefined' && typeof G === 'undefined') { /* écran de connexion seulement */ }
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); };

  /* ---- Bandeau : slogan centré + photo ---- */
  var bannerUrl = null, bannerKey = null;
  async function paintBanner() {
    var bar = document.getElementById('tenant-brandbar'); if (!bar || d.dataset.skin !== 'pro') return;
    var st = (typeof AP !== 'undefined' && AP && AP.station) || {}, sc = typeof ME !== 'undefined' && ME && ME.is_global;
    var sl = bar.querySelector('.skin-slogan');
    if (!sl) { sl = document.createElement('div'); sl.className = 'skin-slogan'; var right = bar.querySelector('.brandbar-right'); bar.insertBefore(sl, right); }
    sl.textContent = sc ? '' : (st.tagline || '');
    var bn = bar.querySelector('.skin-banner');
    if (!bn) { bn = document.createElement('div'); bn.className = 'skin-banner'; bn.setAttribute('aria-hidden', 'true'); bar.insertBefore(bn, bar.querySelector('.brandbar-right')); }
    if (sc || !st.has_banner || typeof SID === 'undefined' || !SID) { bn.style.removeProperty('--skin-banner'); bannerKey = null; return; }
    var key = String(SID);
    try {
      if (bannerKey !== key || !bannerUrl) {
        var r = await fetch('/api/images/banner/' + encodeURIComponent(key), { headers: { Authorization: 'Bearer ' + TK, 'X-Station-Id': String(SID) }, cache: 'no-store' });
        if (!r.ok) throw new Error('banner');
        if (bannerUrl) URL.revokeObjectURL(bannerUrl);
        bannerUrl = URL.createObjectURL(await r.blob()); bannerKey = key;
      }
      bn.style.setProperty('--skin-banner', 'url("' + bannerUrl + '")');
    } catch (_) { bn.style.removeProperty('--skin-banner'); }
  }
  window.skinResetBanner = function () { bannerKey = null; if (bannerUrl) { URL.revokeObjectURL(bannerUrl); bannerUrl = null; } return paintBanner(); };

  /* ---- Fil d'Ariane : Accueil › Section › Page (cliquables), + date et heure ---- */
  function homeKey() { try { return typeof defaultView === 'function' ? defaultView() : 'dash'; } catch (_) { return 'dash'; } }
  function tickTime() {
    var t = document.querySelector('#skin-crumbbar .skin-time'); if (!t) return;
    try { t.textContent = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); } catch (_) {}
  }
  function crumbGo(a) {
    var k = a && a.getAttribute('data-go'); if (!k || typeof go !== 'function') return;
    try { var nav = document.getElementById('nav'); if (nav) nav.querySelectorAll('.nav-node.open').forEach(function (n) { n.classList.remove('open'); }); } catch (_) {}
    go(k);
  }
  function paintCrumbs() {
    var pg = document.getElementById('pg'); if (!pg || d.dataset.skin !== 'pro') return;
    var bar = document.getElementById('skin-crumbbar');
    if (!bar) {
      bar = document.createElement('div'); bar.id = 'skin-crumbbar'; bar.className = 'skin-crumbbar'; pg.parentNode.insertBefore(bar, pg);
      bar.addEventListener('click', function (e) { var a = e.target.closest('a.skin-crumb-link'); if (a && bar.contains(a)) { e.preventDefault(); crumbGo(a); } });
      bar.addEventListener('keydown', function (e) { if (e.key !== 'Enter' && e.key !== ' ') return; var a = e.target.closest('a.skin-crumb-link'); if (a && bar.contains(a)) { e.preventDefault(); crumbGo(a); } });
    }
    var ttl = document.getElementById('ttl'), title = ttl ? ttl.textContent.trim() : '';
    var node = document.querySelector('#nav .nav-node.has-active'), lab = node && node.querySelector(':scope > .nav-parent .nav-label'), sec = lab ? lab.textContent.trim() : '';
    var first = node && node.querySelector(':scope > .flyout a.nav-link[data-go]'), secKey = first ? first.getAttribute('data-go') : '';   // la rubrique ouvre sa première page
    var date = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    var link = function (k, txt, label) { return '<a class="skin-crumb-link" role="link" tabindex="0" data-go="' + esc(k) + '" title="' + esc(label) + '" aria-label="' + esc(label) + '">' + txt + '</a>'; };
    var html = '<div class="skin-crumb">' + link(homeKey(), '<span aria-hidden="true">⌂</span>', 'Accueil') + '<span>›</span>'
      + (sec && sec !== title ? (secKey ? link(secKey, esc(sec), 'Ouvrir ' + sec) : '<span>' + esc(sec) + '</span>') + '<span>›</span>' : '')
      + '<b>' + esc(title) + '</b></div><div class="skin-datepill"><span class="skin-date">' + esc(date.charAt(0).toUpperCase() + date.slice(1)) + '</span><b class="skin-time"></b></div>';
    if (bar.__h !== html) { bar.innerHTML = html; bar.__h = html; }
    tickTime(); if (!window.__skinClock) window.__skinClock = setInterval(tickTime, 1000);
  }
  function boot() {
    paintBanner(); paintCrumbs();
    var ttl = document.getElementById('ttl');
    if (ttl && !ttl.__skinObs) { ttl.__skinObs = new MutationObserver(function () { setTimeout(paintCrumbs, 60); }); ttl.__skinObs.observe(ttl, { childList: true, characterData: true, subtree: true }); }
    var nav = document.getElementById('nav');
    if (nav && !nav.__skinObs) { nav.__skinObs = new MutationObserver(function () { setTimeout(paintCrumbs, 60); }); nav.__skinObs.observe(nav, { attributes: true, subtree: true, attributeFilter: ['class'] }); }
  }
  /* ---- Tous les formulaires / fenêtres : en-tête avec icône, boutons Annuler (orange) / Enregistrer (bleu) ---- */
  var ICONS = [[/vente de produit|boutique/i, '🛒'], [/vente|carburant|pompe|index|compteur/i, '⛽'], [/facture|bon de|devis|écriture|compta|fiscal|tva|déclaration/i, '🧾'], [/client|fournisseur|contrat|licence|carte|flotte/i, '🤝'],
    [/employ|rôle|role|congé|salaire|paie|dette|avance|écart|rh\b|personnel|mot de passe/i, '👤'], [/produit|stock|cuve|jauge|catégorie|inventaire|achat|réception/i, '📦'],
    [/caisse|trésor|compte|paiement|rapprochement|relevé|banque|mobile/i, '💰'], [/message|alerte|notif|rapport|programm|whatsapp/i, '🔔'], [/photo|logo|couleur|menu|import|marque|bandeau/i, '🎨'],
    [/nouveau|nouvelle|ajouter|créer/i, '＋'], [/modifier|éditer/i, '✏️']];
  function iconFor(t) { for (var i = 0; i < ICONS.length; i++) if (ICONS[i][0].test(t)) return ICONS[i][1]; return '📝'; }
  function enhanceModal() {
    if (d.dataset.skin !== 'pro') return;
    var m = document.getElementById('m'), div = m && m.firstElementChild; if (!div || div.dataset.pf) return;
    div.dataset.pf = div.querySelectorAll('.g > label').length > 8 || div.querySelector('table') ? 'wide' : '1';
    if (div.querySelector('.sp')) return;                                   // écran de vente : déjà au format complet
    var h = div.querySelector('h3');
    if (h && !h.closest('.pf-head') && !div.querySelector('.pf-head')) {
      var head = document.createElement('div'); head.className = 'pf-head';
      var ico = document.createElement('div'); ico.className = 'pf-ico'; ico.setAttribute('aria-hidden', 'true'); ico.textContent = iconFor(h.textContent || '');
      h.parentNode.insertBefore(head, h); head.appendChild(ico); head.appendChild(h);
    }
    var bars = div.querySelectorAll('.r'); var bar = bars[bars.length - 1];
    if (bar) {
      bar.classList.add('pf-actions');
      bar.querySelectorAll('button').forEach(function (b) {
        var tx = (b.textContent || '').trim();
        if (/^(✕\s*)?(annuler|fermer|retour|non)\b/i.test(tx)) { b.classList.add('pf-cancel'); if (/^(✕\s*)?annuler/i.test(tx)) b.classList.add('b-orange'); }
        else if (!b.classList.contains('b2') && !b.classList.contains('bd') && !b.classList.contains('bg')) b.classList.add('pf-save');
      });
    }
  }
  function watchModal() {
    var m = document.getElementById('m'); if (!m || m.__skinObs) return;
    m.__skinObs = new MutationObserver(function () { enhanceModal(); }); m.__skinObs.observe(m, { childList: true });
    enhanceModal();
  }
  window.addEventListener('load', function () { watchModal(); setTimeout(watchModal, 600); });
  // Après chaque (re)dessin de l'identité du client et à l'ouverture de session
  function wrap(name) {
    if (typeof window[name] !== 'function' || window[name].__skin) return false;
    var o = window[name]; window[name] = function () { var r = o.apply(this, arguments); Promise.resolve(r).then(boot, boot); return r; }; window[name].__skin = true; return true;
  }
  function hook() { wrap('refreshTenantBrand'); wrap('initShell'); wrap('applyAppearance'); }
  window.addEventListener('load', function () { hook(); setTimeout(hook, 800); setTimeout(boot, 1200); });
  /* Photo de bandeau : mise à jour après téléversement / suppression (modale « Photo / logo » existante) */
  var _up = window.uploadImage;
  if (typeof _up === 'function') window.uploadImage = async function (ent) { var r = await _up.apply(this, arguments); if (ent === 'banner') { try { if (window.applyAppearance) await applyAppearance(); } catch (_) {} await window.skinResetBanner(); } return r; };
  var _api = window.api;
  if (typeof _api === 'function' && !_api.__skin) { window.api = async function (m, p) { var r = await _api.apply(this, arguments); if (m === 'DELETE' && /^\/images\/banner\//.test(p || '')) { try { if (window.applyAppearance) await applyAppearance(); } catch (_) {} window.skinResetBanner(); } return r; }; window.api.__skin = true; }
})();
