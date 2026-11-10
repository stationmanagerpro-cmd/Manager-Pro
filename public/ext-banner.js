/* ext-banner.js — grand bandeau d'accueil du tableau de bord, personnalisable par la station (client) :
   photo, titre (par défaut le nom de la station), slogan, position et couleur du texte.
   Contrôle de lisibilité : le texte doit avoir un contraste d'au moins 4,5:1 sur la photo choisie ; sinon le client est averti
   et l'enregistrement est bloqué (le serveur refuse aussi un verdict « warn »). */
(function () {
  'use strict';
  var d = document.documentElement, MIN = 4.5, DARK = [11, 27, 58];
  function E(s) { return typeof esc === 'function' ? esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  /* Le bandeau ne se modifie que dans Administration → Paramètres → Apparence (droit appearance.manage). */
  function canEdit() { try { return can('appearance.manage'); } catch (_) { return false; } }
  window.openBannerSettings = function () { try { SEC = 'app'; } catch (_) {} if (typeof go === 'function') go('param'); };
  function logoOf(s) { try { return (s.has_logo && window.__tenantLogoKey === String(SID) && window.__tenantLogoUrl) || null; } catch (_) { return null; } }
  function st() { return (typeof AP !== 'undefined' && AP && AP.station) || {}; }
  function styleOf(s) { var x = (s && s.banner_style) || {}; return { align: /^(left|center|right)$/.test(x.align) ? x.align : 'left', color: x.color === 'dark' ? 'dark' : 'light', overlay: Math.max(0, Math.min(80, +x.overlay >= 0 ? +x.overlay : 35)) }; }

  /* ---------- image de la station (blob mis en cache) ---------- */
  var cache = { url: null, key: null };
  async function stationImageUrl() {
    var s = st(); if (!s.has_banner || typeof SID === 'undefined' || !SID) return null;
    var key = SID + ':' + (window.__heroV || 0);
    if (cache.key === key && cache.url) return cache.url;
    var r = await fetch('/api/images/banner/' + encodeURIComponent(SID), { headers: { Authorization: 'Bearer ' + TK, 'X-Station-Id': String(SID) }, cache: 'no-store' });
    if (!r.ok) return null;
    if (cache.url) URL.revokeObjectURL(cache.url);
    cache = { url: URL.createObjectURL(await r.blob()), key: key }; return cache.url;
  }
  function resetImage() { window.__heroV = (window.__heroV || 0) + 1; }
  function loadImg(url) { return new Promise(function (ok, ko) { var i = new Image(); i.onload = function () { ok(i); }; i.onerror = ko; i.src = url; }); }

  /* ---------- contrôle de lisibilité ---------- */
  function lin(c) { c /= 255; return c <= .03928 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4); }
  function lum(r, g, b) { return .2126 * lin(r) + .7152 * lin(g) + .0722 * lin(b); }
  var ZONE = { left: [.04, .62], center: [.2, .8], right: [.38, .96] };
  var ASPECTS = [4, 2.2];   // bandeau large (ordinateur) et bandeau haut (petit écran) : on retient le pire cas
  var rawCache = new WeakMap();
  function raw(img, align, ar) {
    var m = rawCache.get(img); if (!m) { m = {}; rawCache.set(img, m); }
    var k = align + ar; if (m[k]) return m[k];
    var cw = 320, ch = Math.round(cw / ar), c = document.createElement('canvas'); c.width = cw; c.height = ch;
    var x = c.getContext('2d', { willReadFrequently: true }), sc = Math.max(cw / img.naturalWidth, ch / img.naturalHeight);
    x.drawImage(img, (cw - img.naturalWidth * sc) / 2, (ch - img.naturalHeight * sc) / 2, img.naturalWidth * sc, img.naturalHeight * sc);
    var z = ZONE[align], x0 = Math.floor(cw * z[0]), x1 = Math.ceil(cw * z[1]), y0 = Math.floor(ch * .18), y1 = Math.ceil(ch * .82);
    m[k] = { data: x.getImageData(x0, y0, x1 - x0, y1 - y0).data }; return m[k];
  }
  function ratioFor(img, o) {   // o = {align, color, overlay}
    var a = o.overlay / 100, worst = 99;
    ASPECTS.forEach(function (ar) {
      var px = raw(img, o.align, ar).data, H = new Uint32Array(512), n = 0;
      for (var i = 0; i < px.length; i += 4) {
        var r = px[i], g = px[i + 1], b = px[i + 2];
        if (o.color === 'light') { r *= 1 - a; g *= 1 - a; b *= 1 - a; } else { r = r * (1 - a) + 255 * a; g = g * (1 - a) + 255 * a; b = b * (1 - a) + 255 * a; }
        H[Math.min(511, Math.floor(lum(r, g, b) * 511))]++; n++;
      }
      var target = o.color === 'light' ? n * .92 : n * .08, acc = 0, L = 0;
      for (var j = 0; j < 512; j++) { acc += H[j]; if (acc >= target) { L = j / 511; break; } }
      var rt = o.color === 'light' ? 1.05 / (L + .05) : (L + .05) / (lum(DARK[0], DARK[1], DARK[2]) + .05);
      if (rt < worst) worst = rt;
    });
    return Math.round(worst * 10) / 10;
  }
  // Cherche le réglage le plus discret qui atteint le contraste voulu ; garde la position choisie si possible.
  function optimize(img, cur) {
    var best = null, aligns = [cur.align].concat(['left', 'center', 'right'].filter(function (x) { return x !== cur.align; }));
    aligns.forEach(function (al, idx) {
      ['light', 'dark'].forEach(function (tone) {
        for (var ov = 0; ov <= 80; ov += 5) {
          var rt = ratioFor(img, { align: al, color: tone, overlay: ov });
          var cost = ov + (idx ? 12 : 0) + (tone === 'dark' ? 2 : 0), pass = rt >= MIN;
          if (!best || (pass && !best.pass) || (pass === best.pass && (pass ? cost < best.cost : rt > best.ratio))) best = { align: al, color: tone, overlay: ov, ratio: rt, pass: pass, cost: cost };
          if (pass) break;
        }
      });
    });
    return best;
  }
  window.bannerLegibility = { ratioFor: ratioFor, optimize: optimize, MIN: MIN };

  /* ---------- rendu du bandeau ---------- */
  function scrim(o) {
    var c = o.color === 'light' ? '0,0,0' : '255,255,255', a = o.overlay / 100, S = 'rgba(' + c + ',' + a + ')', T = 'rgba(' + c + ',0)';
    if (o.align === 'left') return 'linear-gradient(90deg,' + S + ' 0%,' + S + ' 62%,' + T + ' 100%)';
    if (o.align === 'right') return 'linear-gradient(270deg,' + S + ' 0%,' + S + ' 62%,' + T + ' 100%)';
    return 'linear-gradient(90deg,' + T + ' 0%,' + S + ' 18%,' + S + ' 82%,' + T + ' 100%)';
  }
  function build(o) {   // o = {name, slogan, style, img, cta, edit, warn, preview}
    var h = document.createElement('div'), sy = o.style;
    h.className = 'hero' + (o.preview ? '' : ' hero-top') + (o.compact ? ' hero-compact' : '') + ' al-' + sy.align + (o.img ? ' has-img tone-' + sy.color : '') + (o.preview ? ' is-preview' : '') + (String(o.name || '').length > 42 ? ' len-l' : String(o.name || '').length > 26 ? ' len-m' : '');
    if (o.img) { h.style.setProperty('--hero-img', 'url("' + o.img + '")'); h.style.setProperty('--hero-fg', sy.color === 'light' ? '#fff' : 'rgb(' + DARK.join(',') + ')'); h.style.setProperty('--hero-scrim', scrim(sy)); }
    var ini = (String(o.name || '').trim().charAt(0) || 'S').toUpperCase();
    h.innerHTML = '<div class="hero-in"><span class="hero-logo" aria-hidden="true">' + (o.logo ? '<img alt="" src="' + E(o.logo) + '">' : E(ini)) + '</span><div class="hero-txt"><h1 class="hero-name">' + E(o.name) + '</h1><p class="hero-slogan">' + E(o.slogan || '') + '</p>' + (o.cta ? '<button type="button" class="hero-cta" onclick="go(\'ventes\')">Accéder aux ventes →</button>' : '') + '</div></div>'
      + (o.warn ? '<button type="button" class="hero-warn" onclick="openBannerSettings()">⚠ Nom difficile à lire sur cette image — corriger (Paramètres → Apparence)</button>' : '');
    return h;
  }
  var busy = false, paintSeq = 0;
  /* Un seul bandeau dans la page : on supprime tout autre élément #hero / .hero-top (course entre deux rendus asynchrones). */
  function purgeHeroes(keep) { Array.prototype.slice.call(document.querySelectorAll('#hero, .hero-top')).forEach(function (n) { if (n !== keep) n.remove(); }); }
  async function paint() {
    var my = ++paintSeq;   // un rendu plus récent annule les rendus en attente (évite deux bandeaux superposés)
    var pg = document.getElementById('pg'), hd = document.getElementById('app-header'), host = hd && hd.parentNode; if (!pg || !host) return;
    var sa = typeof ME !== 'undefined' && ME && ME.is_global;   // Superadmin : bandeau aux couleurs de la plateforme (nom, logo, slogan du site)
    var on = typeof cur !== 'undefined' && cur && typeof ME !== 'undefined' && ME && (sa || (typeof SID !== 'undefined' && SID));
    var ex = document.getElementById('hero');
    if (!on) { purgeHeroes(null); if (d.dataset.hero) delete d.dataset.hero; return; }
    if (sa) {
      var B = (typeof BRAND !== 'undefined' && BRAND) || {}, bn = (typeof brandName === 'function' && brandName()) || 'Station Manager PRO', lg = B.has_logo ? '/api/branding/logo?v=' + (B.v || 0) : '/icons/icon-192.png', hm = cur === 'admin';
      var bi = B.has_banner ? '/api/branding/banner?v=' + (B.v || 0) : null, sg = JSON.stringify(['sa', hm, bn, B.tagline || '', lg, bi]);
      if (ex && ex.__sig === sg && ex.nextElementSibling === hd) { d.dataset.hero = '1'; return; }
      var hs = build({ name: bn, slogan: B.tagline || '', style: styleOf({ banner_style: { overlay: 45 } }), img: bi, logo: lg, compact: !hm });
      hs.id = 'hero'; hs.__sig = sg; hs.setAttribute('role', 'banner');
      purgeHeroes(null); host.insertBefore(hs, hd); d.dataset.hero = '1'; return;
    }
    var s = st(), sy = styleOf(s), url = null;
    try { url = await stationImageUrl(); } catch (_) {}
    if (my !== paintSeq) return;   // un autre rendu a démarré pendant le chargement de l'image
    ex = document.getElementById('hero');   // relu après l'attente : un autre rendu a pu insérer le bandeau entre-temps
    var logo = logoOf(s), home = cur === 'dash';   // accueil : grand bandeau ; autres pages : même bandeau, hauteur réduite
    var sig = JSON.stringify([home, s.name, s.tagline, s.banner_title, sy, !!url, s.banner_legibility, canEdit(), cache.key, logo]);
    if (ex && ex.__sig === sig && ex.nextElementSibling === hd) { purgeHeroes(ex); d.dataset.hero = '1'; return; }
    var h = build({ name: s.banner_title || s.name || '', slogan: s.tagline, style: sy, img: url, logo: logo, compact: !home, warn: canEdit() && url && s.banner_legibility === 'warn',
      cta: home && (function () { try { return can('sale.create'); } catch (_) { return false; } })() });
    h.id = 'hero'; h.__sig = sig; h.setAttribute('role', 'banner');
    purgeHeroes(null); host.insertBefore(h, hd); d.dataset.hero = '1';   // tout en haut de la page, au-dessus de la barre d'en-tête
  }
  function schedule() { if (busy) return; busy = true; setTimeout(function () { busy = false; paint(); }, 40); }
  function watch() { var pg = document.getElementById('pg'); if (!pg || pg.__heroObs) return; pg.__heroObs = new MutationObserver(function () { schedule(); }); pg.__heroObs.observe(pg, { childList: true }); schedule(); }
  window.addEventListener('load', function () { watch(); setTimeout(watch, 700); setTimeout(watch, 2000); });
  window.paintHeroBanner = function () { var ex = document.getElementById('hero'); if (ex) ex.__sig = ''; return paint(); };
  ['applyAppearance', 'refreshTenantBrand', 'loadBrand'].forEach(function (n) { var t = setInterval(function () { if (typeof window[n] === 'function' && !window[n].__hero) { var o = window[n]; window[n] = function () { var r = o.apply(this, arguments); Promise.resolve(r).then(function () { watch(); schedule(); }); return r; }; window[n].__hero = true; clearInterval(t); } }, 300); setTimeout(function () { clearInterval(t); }, 8000); });

  /* ---------- fenêtre « Personnaliser le bandeau » ---------- */
  function fileToImage(file) {   // redimensionne (1920 px max) et compresse sous ~1,8 Mo
    return new Promise(function (ok, ko) {
      var fr = new FileReader(); fr.onerror = function () { ko(new Error('Lecture impossible')); };
      fr.onload = function () { loadImg(fr.result).then(function (im) {
        var sc = Math.min(1, 1920 / im.naturalWidth), c = document.createElement('canvas'); c.width = Math.round(im.naturalWidth * sc); c.height = Math.round(im.naturalHeight * sc);
        var x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0, c.width, c.height);
        var q = .88, u = c.toDataURL('image/jpeg', q); while (u.length > 2.4e6 && q > .4) { q -= .1; u = c.toDataURL('image/jpeg', q); }
        if (u.length > 2.6e6) return ko(new Error('Image trop lourde même après compression')); loadImg(u).then(function (i2) { ok({ dataUrl: u, img: i2 }); }, ko);
      }, function () { ko(new Error('Image illisible')); }); };
      fr.readAsDataURL(file);
    });
  }
  window.openBannerDialog = async function () {
    if (!canEdit()) return toast('Permission refusée');
    var s = st(), S = { title: s.banner_title || '', tagline: s.tagline || '', style: styleOf(s), pending: null, removed: false, img: null, url: null };
    try { S.url = await stationImageUrl(); if (S.url) S.img = await loadImg(S.url); } catch (_) {}
    modal('<h3>Personnaliser le bandeau</h3><div id="bn-prev"></div><div id="bn-verdict" class="bn-verdict"></div>'
      + '<div class="g"><label>Photo de couverture<input type="file" id="bn-file" accept="image/png,image/jpeg,image/webp"></label>'
      + '<div><button type="button" class="b2" id="bn-rm">Retirer la photo</button> <small style="color:var(--m)">Format large conseillé (ex. 1600 × 400). Redimensionnée automatiquement.</small></div>'
      + '<label>Titre du bandeau<input id="bn-title" maxlength="60" placeholder="' + E(s.name || '') + '" value="' + E(S.title) + '"><small style="color:var(--m)">Laissez vide pour afficher le nom officiel de la station.</small></label>'
      + '<label>Slogan<input id="bn-tag" maxlength="120" value="' + E(S.tagline) + '" placeholder="ex. Votre carburant, notre engagement"></label>'
      + '<div><b style="font-size:13px">Position du texte</b><br><span class="bn-seg" id="bn-al"><button type="button" data-v="left">Gauche</button><button type="button" data-v="center">Centre</button><button type="button" data-v="right">Droite</button></span></div>'
      + '<div><b style="font-size:13px">Couleur du texte</b><br><span class="bn-seg" id="bn-co"><button type="button" data-v="light">Blanc</button><button type="button" data-v="dark">Noir</button></span></div>'
      + '<label><span>Assombrir / éclaircir derrière le texte : <b><span id="bn-ovv"></span> %</b></span><input type="range" id="bn-ov" min="0" max="80" step="5"></label>'
      + '<div><button type="button" class="b2" id="bn-auto">✨ Optimiser automatiquement la lisibilité</button></div></div>'
      + '<div class="r"><button type="button" class="b2" onclick="closeM()">Annuler</button><button type="button" id="bn-save">Enregistrer</button></div>');
    var $$ = function (i) { return document.getElementById(i); }, last = { ratio: null, ok: true };
    function refresh() {
      var name = ($$('bn-title').value.trim() || s.name || ''), slogan = $$('bn-tag').value.trim();
      S.style.overlay = +$$('bn-ov').value; $$('bn-ovv').textContent = S.style.overlay;
      var pv = $$('bn-prev'); pv.innerHTML = ''; pv.appendChild(build({ name: name, slogan: slogan, style: S.style, img: S.img ? (S.pending ? S.pending.dataUrl : S.url) : null, logo: logoOf(s), preview: true }));
      [['bn-al', S.style.align], ['bn-co', S.style.color]].forEach(function (p) { $$(p[0]).querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b.dataset.v === p[1]); }); });
      var v = $$('bn-verdict'); $$('bn-rm').style.display = S.img ? '' : 'none'; $$('bn-co').parentNode.style.opacity = S.img ? 1 : .5; $$('bn-auto').disabled = !S.img;
      if (!S.img) { last = { ratio: null, ok: true }; v.className = 'bn-verdict ok'; v.textContent = '✅ Sans photo, le bandeau utilise les couleurs de votre station : le nom est toujours lisible.'; }
      else {
        var rt = ratioFor(S.img, S.style); last = { ratio: rt, ok: rt >= MIN };
        v.className = 'bn-verdict ' + (last.ok ? 'ok' : 'warn');
        v.innerHTML = last.ok ? '✅ Le nom de la station est lisible sur cette photo (contraste ' + String(rt).replace('.', ',') + ' : 1, minimum ' + String(MIN).replace('.', ',') + ' : 1).'
          : '⚠ <b>Attention : le nom de la station risque d’être illisible sur cette photo</b> (contraste ' + String(rt).replace('.', ',') + ' : 1, minimum ' + String(MIN).replace('.', ',') + ' : 1). Cliquez sur « Optimiser automatiquement », changez la position ou la couleur du texte, ou choisissez une photo plus uniforme. L’enregistrement est bloqué tant que le nom n’est pas lisible.';
      }
      var bad = !!(S.img && !last.ok); $$('bn-save').disabled = bad; $$('bn-save').textContent = bad ? 'Corrigez la lisibilité pour enregistrer' : 'Enregistrer';
    }
    $$('bn-ov').value = S.style.overlay;
    $$('bn-al').onclick = function (e) { var b = e.target.closest('button'); if (b) { S.style.align = b.dataset.v; refresh(); } };
    $$('bn-co').onclick = function (e) { var b = e.target.closest('button'); if (b) { S.style.color = b.dataset.v; refresh(); } };
    ['bn-ov', 'bn-title', 'bn-tag'].forEach(function (i) { $$(i).oninput = refresh; });
    $$('bn-auto').onclick = function () { var b = optimize(S.img, S.style); S.style = { align: b.align, color: b.color, overlay: b.overlay }; $$('bn-ov').value = b.overlay; refresh(); toast(b.pass ? 'Réglage optimisé : le nom est lisible' : 'Même optimisé, le nom reste peu lisible : choisissez une photo plus uniforme'); };
    $$('bn-rm').onclick = function () { S.img = null; S.pending = null; S.removed = true; $$('bn-file').value = ''; refresh(); };
    $$('bn-file').onchange = async function (e) {
      var f = e.target.files[0]; if (!f) return;
      if (!/^image\/(png|jpeg|webp)$/.test(f.type)) { e.target.value = ''; return toast('Format refusé : PNG, JPEG ou WebP uniquement'); }
      if (f.size > 12 * 1024 * 1024) { e.target.value = ''; return toast('Fichier trop volumineux (12 Mo maximum avant compression)'); }
      try { var r = await fileToImage(f); S.pending = r; S.img = r.img; S.removed = false; var b = optimize(r.img, S.style); S.style = { align: b.align, color: b.color, overlay: b.overlay }; $$('bn-ov').value = b.overlay; refresh(); if (!b.pass) toast('Photo peu adaptée : le nom restera difficile à lire'); }
      catch (err) { toast(err.message || 'Image refusée'); }
    };
    $$('bn-save').onclick = async function () {
      var btn = this; if (S.img && !last.ok) return toast('Le nom de la station est illisible sur cette photo : corrigez le réglage ou changez de photo'); btn.disabled = true;
      try {
        if (S.pending) await api('PUT', '/images/banner/' + SID, { data_url: S.pending.dataUrl });
        else if (S.removed && s.has_banner) await api('DELETE', '/images/banner/' + SID);
        var legib = S.img ? (last.ok ? 'ok' : 'warn') : null;
        await api('PUT', '/station-banner', { title: $$('bn-title').value.trim() || null, tagline: $$('bn-tag').value.trim() || null, align: S.style.align, color: S.style.color, overlay: S.style.overlay, legibility: legib, ratio: last.ratio });
        resetImage(); try { if (window.skinResetBanner) await window.skinResetBanner(); } catch (_) {}
        closeM(); if (window.applyAppearance) await applyAppearance(); await window.paintHeroBanner();
        toast('Bandeau enregistré');
        if (typeof cur !== 'undefined' && cur === 'param') go('param');
      } catch (e) { btn.disabled = false; toast(e.message || 'Enregistrement impossible'); }
    };
    refresh();
  };
})();
