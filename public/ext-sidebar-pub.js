/* ZONE INFOS en bas du menu de gauche.
 * - Images publiées par le Super Admin pour le client (jusqu'à 5), lues via GET /me/advertising.
 * - Ordre aléatoire à chaque chargement ; si plusieurs images, elles défilent selon le délai fixé par le Super Admin (60 s par défaut).
 * - Clic sur une image : petit pop-up d'agrandissement (fermeture : clic, croix ou Échap).
 * - Rien n'est affiché si le panneau n'est pas activé ET publié, ou s'il n'y a aucune image. Le Super Admin n'a pas de zone PUB. */
(function () {
  let urls = [], order = [], idx = 0, timer = null, userId = null, lastLoad = 0, loading = false, interval = 60;

  const revoke = () => { urls.forEach(u => { try { URL.revokeObjectURL(u); } catch (_) { /* déjà libérée */ } }); urls = []; };
  const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
  function removeZone() { stop(); revoke(); ['nav-pub', 'pub-mobile'].forEach(id => { const z = document.getElementById(id); if (z) z.remove(); }); }

  function shuffle(n) {
    const a = Array.from({ length: n }, (_, i) => i);
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  function show(i) {
    if (!urls.length) return;
    const src = urls[order[i % order.length]];
    document.querySelectorAll('#nav-pub .nav-pub-img, #pub-mobile .pub-mobile-img').forEach(img => {
      img.classList.remove('in'); void img.offsetWidth; img.src = src; img.classList.add('in');
    });
  }
  // Téléphone / petit écran : le menu est masqué, la zone PUB du menu ne se voit donc jamais.
  // Une bannière compacte est alors placée sous la barre du haut (fermable pour la session).
  let mobileClosed = false;
  function ensureMobile() {
    const head = document.getElementById('app-header');
    if (!head || !urls.length || mobileClosed) return;
    if (document.getElementById('pub-mobile')) return;
    const m = document.createElement('div');
    m.id = 'pub-mobile'; m.className = 'pub-mobile'; m.setAttribute('role', 'complementary'); m.setAttribute('aria-label', 'Publicité');
    m.innerHTML = '<button type="button" class="pub-mobile-btn" aria-label="Agrandir la publicité"><img class="pub-mobile-img" alt="Publicité"></button><button type="button" class="pub-mobile-x" aria-label="Masquer la publicité">×</button>';
    head.appendChild(m);
    m.querySelector('.pub-mobile-btn').onclick = () => { const s = m.querySelector('.pub-mobile-img').src; if (s) openPopup(s); };
    m.querySelector('.pub-mobile-x').onclick = () => { mobileClosed = true; m.remove(); };
    show(idx);
    syncPub();
  }

  // Place insuffisante : la ZONE INFOS ne doit jamais masquer les sous-onglets. Elle n'est affichée que si, une fois le menu
  // (sous-menus ouverts compris) placé, il reste assez de hauteur ; sinon elle est masquée et la bannière compacte du haut prend le relais.
  let pubH = 0;
  function fitPub() {
    const z = document.getElementById('nav-pub'), nav = document.getElementById('nav'); if (!z || !nav) return;
    const scroll = nav.querySelector('.nav-scroll'); if (!scroll) return;
    const off = z.classList.contains('nav-pub-off');
    if (!off && z.offsetHeight) { const cs = getComputedStyle(z); pubH = z.offsetHeight + (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0); }
    const need = pubH || 260;
    let others = 0; Array.from(nav.children).forEach(c => { if (c !== scroll && c !== z && getComputedStyle(c).position !== 'absolute') others += c.offsetHeight; });
    const cs2 = getComputedStyle(scroll);
    const content = Array.from(scroll.children).reduce((h, c) => h + c.offsetHeight, 0) + (parseFloat(cs2.paddingTop) || 0) + (parseFloat(cs2.paddingBottom) || 0);
    const top = Math.max(0, nav.getBoundingClientRect().top);
    const free = (window.innerHeight || nav.clientHeight) - top - others;   // le tiroir peut être « à hauteur du contenu » : on borne par l'écran
    const fits = content + need + 8 <= free;
    if (fits === !off) return;
    z.classList.toggle('nav-pub-off', !fits);
    syncPub();
  }

  // La bannière n'apparaît que si la « ZONE INFOS » du menu n'est pas visible (menu masqué, réduit, téléphone, écran peu haut).
  function syncPub() {
    const m = document.getElementById('pub-mobile'); if (!m) return;
    const z = document.getElementById('nav-pub');
    const zoneVisible = !!(z && z.getClientRects().length && z.offsetHeight > 0);
    m.classList.toggle('show', !zoneVisible);
  }

  function ensureZone() {
    ensureMobile();
    const nav = document.getElementById('nav'); if (!nav || !urls.length) return;
    if (document.getElementById('nav-pub')) return;
    const z = document.createElement('div');
    z.id = 'nav-pub'; z.className = 'nav-pub'; z.setAttribute('role', 'complementary'); z.setAttribute('aria-label', 'Zone infos');
    z.innerHTML = '<span class="nav-pub-label">ZONE INFOS</span><button type="button" class="nav-pub-btn" title="Agrandir" aria-label="Agrandir la publicité"><img class="nav-pub-img" alt="Publicité"></button>';
    nav.appendChild(z);
    z.querySelector('.nav-pub-btn').onclick = () => { const s = z.querySelector('.nav-pub-img').src; if (s) openPopup(s); };
    show(idx);
    syncPub();
    setTimeout(fitPub, 50);
  }

  function openPopup(src) {
    if (document.getElementById('pub-popup')) return;
    const o = document.createElement('div');
    o.id = 'pub-popup'; o.className = 'pub-popup'; o.setAttribute('role', 'dialog'); o.setAttribute('aria-label', 'Publicité');
    o.innerHTML = '<div class="pub-popup-box"><button type="button" class="pub-popup-x" aria-label="Fermer">×</button><img alt="Publicité"></div>';
    o.querySelector('img').src = src;
    const close = () => { o.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = e => { if (e.key === 'Escape') close(); };
    o.addEventListener('click', close); document.addEventListener('keydown', onKey);
    document.body.appendChild(o);
  }

  async function load() {
    if (loading) return; loading = true;
    try {
      if (typeof ME === 'undefined' || !ME || ME.is_global || typeof TK === 'undefined' || !TK) { if (userId !== null) { userId = null; removeZone(); } return; }
      if (userId !== ME.id) { removeZone(); userId = ME.id; }
      const ad = await G('/me/advertising');
      const srcs = ad && ad.enabled && Array.isArray(ad.images) ? ad.images : [];
      lastLoad = Date.now();
      if (!srcs.length) { removeZone(); return; }
      const next = [];
      for (const s of srcs) {
        try { const r = await fetch(s, { headers: { Authorization: 'Bearer ' + TK, ...(typeof SID !== 'undefined' && SID ? { 'X-Station-Id': SID } : {}) }, cache: 'no-store' }); if (r.ok) next.push(URL.createObjectURL(await r.blob())); } catch (_) { /* image ignorée */ }
      }
      stop(); revoke(); urls = next;
      if (!urls.length) { ['nav-pub', 'pub-mobile'].forEach(id => { const z = document.getElementById(id); if (z) z.remove(); }); return; }
      order = shuffle(urls.length); idx = 0;
      interval = Math.max(10, Number(ad.interval_sec) || 60);
      ['nav-pub', 'pub-mobile'].forEach(id => { const old = document.getElementById(id); if (old) old.remove(); });
      ensureZone();
      if (urls.length > 1) timer = setInterval(() => { idx = (idx + 1) % order.length; show(idx); }, interval * 1000);
    } catch (_) { /* publicité facultative : jamais bloquante */ }
    finally { loading = false; }
  }

  // Le menu est reconstruit par l'application : on remet la zone en place sans refaire de requête.
  function watchNav() {
    const nav = document.getElementById('nav'); if (!nav) return setTimeout(watchNav, 400);
    new MutationObserver(() => { if (urls.length && !document.getElementById('nav-pub')) ensureZone(); syncPub(); fitPub(); }).observe(nav, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
    nav.addEventListener('click', () => { setTimeout(fitPub, 60); setTimeout(fitPub, 300); });
    window.addEventListener('resize', () => { syncPub(); fitPub(); });
  }
  watchNav();

  // Chargement après connexion, puis relecture de la configuration toutes les 5 minutes (changements du Super Admin).
  setInterval(() => {
    const logged = typeof ME !== 'undefined' && ME && !ME.is_global && typeof TK !== 'undefined' && TK;
    if (!logged) { if (userId !== null) { userId = null; removeZone(); } return; }
    if (userId !== ME.id || Date.now() - lastLoad > 300000) load();
    else syncPub();
  }, 3000);
})();
