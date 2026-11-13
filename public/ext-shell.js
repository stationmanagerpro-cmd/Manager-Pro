/* ext-shell.js — coquille de l'application
   - menu vertical gauche (déployé / réduit en icônes avec infobulles) avec sous-menus FLOTTANTS (survol souris, clic/toucher, menus imbriqués)
   - barre supérieure contextuelle : recherche, raccourcis, alertes, date et heure dynamiques, profil réel de l'utilisateur connecté
   Les vues et leurs permissions restent celles déjà enregistrées dans V : ce fichier n'invente aucune route et ne contourne aucun contrôle
   (l'interface n'est qu'un confort : chaque API est de toute façon protégée côté serveur). */
(function () {
  'use strict';
  if (typeof V === 'undefined' || typeof can !== 'function') return;

  const store = {
    get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* stockage indisponible */ } }
  };
  const mq = q => { try { return !!(window.matchMedia && window.matchMedia(q).matches); } catch (e) { return false; } };   // tolérant (tests jsdom)
  const isMobile = () => mq('(max-width: 860px)');
  const canHover = () => mq('(hover: hover)') && !isMobile();
  let collapsed = store.get('smp-nav-collapsed') === '1';
  let navHidden = store.get('smp-nav-hidden') === '1';

  /* ---------- Arbre de navigation : regroupe les vues existantes (clés de V) ---------- */
  const TREE = [
    { label: 'Tableau de bord', icon: '📊', keys: ['direction', 'dash', 'moidash', 'consolidee', 'parstation', 'eod', 'reconcile'] },
    { label: 'Exploitation', icon: '⛽', keys: ['jour', 'quart', 'ventes', 'prixjour', 'factures', 'bcommande', 'prod', 'stock', 'previsions', 'transferts', 'pompes', 'cuves', 'histcompteurs', 'risque', 'caisse', 'periodlock', 'alert'] },
    { label: 'Gestion commerciale', icon: '🤝', keys: ['cli', 'flotte', 'fidelite', 'espaceclient', 'four', 'achats', 'vendeurs'] },
    {
      label: 'Ressources humaines', icon: '👥', keys: ['emp'], children: [
        { label: 'Pilotage RH', icon: '📋', keys: ['rhdash', 'rh', 'rhalerts', 'rhr', 'audrh', 'rhme'] },
        { label: 'Suivi du personnel', icon: '🗓️', keys: ['rhatt', 'rhleaves', 'rhot', 'rhsched', 'rhteams', 'rhcontracts', 'rhdocs', 'rhskills', 'rhtrain', 'rheval', 'rhdisc'] },
        { label: 'Paie', icon: '💵', keys: ['rhctl', 'rhperiods', 'rhrules', 'declarations', 'act'] }
      ]
    },
    { label: 'Finance & rapports', icon: '📈', keys: ['treso', 'dettes', 'profit', 'rapports', 'fin', 'mmcomm', 'finevents', 'reconcile', 'exports', 'archive', 'imports'] },
    { label: 'Comptabilité', icon: '📒', keys: ['compta'] },
    { label: 'La Fiscalité', icon: '⚖️', keys: ['fiscalhub', 'fiscal', 'fiscalest', 'fiscal2', 'fiscal3', 'fiscaldash', 'fiscaldl', 'fiscalcheck', 'fiscalaudit', 'fiscalrulesview', 'fiscalstorage', 'fiscalscore', 'fiscalactivity', 'fiscalyear'] },
    { label: 'Communication', icon: '💬', keys: ['msg'] },
    { label: 'Administration', icon: '🛡️', keys: ['admin', 'stations', 'carte', 'param', 'teamroles', 'roles', 'dashcfg', 'settings_hub', 'rhsettings', 'licence', 'audit', 'auditx', 'packs'] },
    { label: 'Mon profil & aide', icon: '🙋', keys: ['moi', 'clients', 'onboard', 'aide'] }
  ];

  // Arbre du Superadmin : uniquement l'administration de la plateforme (aucune rubrique d'exploitation ou de RH de station)
  const SA_TREE = [
    { label: 'Tableau de bord', icon: 'dashboard', keys: ['admin'] },
    { label: 'Clients & licences', icon: 'clients', keys: ['clients', 'packs', 'carte'] },
    { label: 'Finance & rapports', icon: 'finance', keys: ['pfin'] },
    { label: 'Messagerie', icon: 'messagerie', keys: ['msg'] },
    { label: 'Administration', icon: 'settings', keys: ['roles', 'homeadmin', 'accesskeys'] }
  ];
  const treeFor = () => (ME && ME.is_global ? SA_TREE : TREE);
  // Dernier onglet du menu, pour tous les comptes (vue enregistrée par ext-about.js ; texte modifiable par le Superadmin).
  const ABOUT_NODE = { label: 'A propos de Manager PRO', icon: 'ℹ️', keys: ['apropos'] };

  // Icônes SVG locales : cohérentes, nettes en mode clair/sombre et sans dépendance externe.
  const SVG_PATHS = {
    dashboard: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/>',
    clients: '<path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    finance: '<path d="M3 3v18h18"/><path d="m7 14 4-4 4 3 5-7"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.7a8 8 0 0 1-1.7 1l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.7-1l-1.7.7-1.4-2.4 1.4-1.1a7 7 0 0 1 0-2l-1.4-1.1 1.4-2.4 1.7.7a8 8 0 0 1 1.7-1l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.7 1l1.7-.7 1.4 2.4-1.4 1.1a7 7 0 0 1 0 2Z"/>',
    roles: '<path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="m17 11 2 2 4-4"/>',
    homeadmin: '<path d="m3 10 9-7 9 7"/><path d="M5 9v12h14V9M9 21v-7h6v7"/>',
    accesskeys: '<circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 8.7-8.7 2 2-2 2 2 2-2 2-2-2-4 4"/>',
    packs: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/>',
    admin: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9 9h6M9 13h6M9 17h3"/>',
    messagerie: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12Z"/><path d="M8.5 11h7M8.5 14h4"/>',
    apropos: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><circle cx="12" cy="7.8" r=".6"/>'
  };
  const svgIcon = name => SVG_PATHS[name] ? `<svg class="nav-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${SVG_PATHS[name]}</svg>` : '';
  const ico = k => {
    const saIcons = { admin: 'admin', clients: 'clients', packs: 'packs', pfin: 'finance', roles: 'roles', homeadmin: 'homeadmin', accesskeys: 'accesskeys', msg: 'messagerie', apropos: 'apropos' };
    if (ME && ME.is_global && saIcons[k]) return svgIcon(saIcons[k]);
    return (typeof NAV_ICONS !== 'undefined' && NAV_ICONS[k]) || '•';
  };
  // 'packs' est réservé à l'administrateur principal (la vue le vérifie aussi) : on ne l'affiche pas aux autres
const visible = k => V[k] && (typeof canView === 'function' ? canView(k) : can(V[k][1])) && !(k === 'packs' && !(ME && ME.is_global));

  function link(k, on, used) {
    used.add(k);
    return `<a class="nav-link${k === on ? ' on' : ''}" role="menuitem" tabindex="0" data-go="${k}" data-tip="${esc(V[k][0])}"><span class="ico">${ico(k)}</span><span class="nav-label">${esc(V[k][0])}</span></a>`;
  }
  // Retourne { html, active } ou null si rien de visible
  function node(g, on, used, level) {
    const leaves = (g.keys || []).filter(visible);
    const subs = (g.children || []).map(c => node(c, on, used, level + 1)).filter(Boolean);
    if (!leaves.length && !subs.length) return null;
    const activeLeaf = leaves.includes(on), active = activeLeaf || subs.some(s => s.active);
    if (leaves.length === 1 && !subs.length && level === 1) {   // un seul élément : lien direct, sans sous-menu
      return { html: link(leaves[0], on, used), active };
    }
    const inner = leaves.map(k => link(k, on, used)).join('') + subs.map(s => s.html).join('');
    return {
      active,
      html: `<div class="nav-node lvl${level}${active ? ' has-active' : ''}">
        <a class="nav-link nav-parent" role="menuitem" tabindex="0" aria-haspopup="true" aria-expanded="false" data-tip="${esc(g.label)}">
          <span class="ico">${ME && ME.is_global ? (svgIcon(g.icon) || '•') : (g.icon || '•')}</span><span class="nav-label">${esc(g.label)}</span><span class="chev" aria-hidden="true">›</span></a>
        <div class="flyout" role="menu" aria-label="${esc(g.label)}"><div class="flyout-title">${esc(g.label)}</div>${inner}</div>
      </div>`
    };
  }

  window.renderNav = function (on) {
    const nav = document.getElementById('nav');
    if (!nav) return;
    const used = new Set();
    const parts = treeFor().map(g => node(g, on, used, 1)).filter(Boolean).map(x => x.html);
    // « A propos de Manager PRO » : construit avant le filet de sécurité pour ne pas tomber dans « Autres », puis placé TOUT EN BAS du menu.
    const tail = node(ABOUT_NODE, on, used, 1);
    // Filet de sécurité : toute vue accessible non classée reste atteignable (rien ne disparaît du menu)
    const rest = Object.keys(V).filter(k => !used.has(k) && visible(k));
    if (rest.length) { const o = node({ label: 'Autres', icon: '📁', keys: rest }, on, used, 1); if (o) parts.push(o.html); }
    if (tail) parts.push(tail.html);
    nav.classList.add('nav2');
    nav.classList.toggle('collapsed', collapsed && !isMobile());
    nav.classList.toggle('user-hidden', navHidden);
    // Identité du menu : toujours celle du site (« Manager Pro » + son logo), pour tous les comptes.
    // L'identité de la station / du client reste affichée dans la barre du haut.
    const siteLogo = BRAND.has_logo ? brandMarkInner() : '<img src="/icons/icon-192.png" alt="Station Manager PRO">';
    const navMark = siteLogo, navName = brandName();
    const navMarkScope = 'platform';
    nav.innerHTML = `<div class="nav-head">
        <div class="nav-logo" data-brand="mark" data-brand-scope="${navMarkScope}">${navMark}</div>
        <div class="nav-title"><b data-brand="name" data-brand-scope="${navMarkScope}">${esc(navName)}</b><small data-brand="tagline" data-brand-scope="${navMarkScope}" ${BRAND.tagline ? '' : 'hidden'}>${esc(BRAND.tagline || '')}</small></div>
        <a class="nav-collapse" role="button" tabindex="0" title="Réduire / développer le menu" aria-label="Réduire ou développer le menu" onclick="toggleNavCollapse()">${collapsed ? '›' : '‹'}</a>
        <a class="nav-hide" role="button" tabindex="0" title="Masquer complètement le menu" aria-label="Masquer complètement le menu" onclick="hideNavCompletely()">×</a>
      </div>
      <div class="nav-scroll" role="menu">${parts.join('')}</div>`;
    bindNav(nav);
    fitNavName();
  };
  /* Ajuste la taille du nom du site pour qu'il tienne toujours sur une seule ligne */
  window.fitNavName = function () {
    const run = () => {
      const b = document.querySelector('#nav .nav-title b'), box = b && b.parentElement; if (!b || !box) return;
      /* Nom du site : UNE seule ligne, toujours droit et aligné à gauche à côté du logo.
         Taille de départ modérée (17 px), réduite automatiquement (jusqu'à 10 px) si le nom est long. */
      let size = 17; b.style.fontSize = size + 'px';
      while (size > 10 && b.scrollWidth > box.clientWidth + 1) { size -= 0.5; b.style.fontSize = size + 'px'; }
      b.title = b.textContent || '';
      if (!window.__navNameObs && window.ResizeObserver) {
        window.__navNameObs = new ResizeObserver(() => window.fitNavName());
        window.__navNameObs.observe(box);
      }
      if (!b.__fitMo && window.MutationObserver) {   // nom modifié (marque personnalisée) : on réajuste
        b.__fitMo = new MutationObserver(() => window.fitNavName());
        b.__fitMo.observe(b, { childList: true, characterData: true, subtree: true });
      }
    };
    requestAnimationFrame(run); setTimeout(run, 300);
  };
  window.addEventListener('resize', () => window.fitNavName && window.fitNavName());

  /* ---------- Comportement : survol, clic, clavier, fermeture ---------- */
  function setOpen(n, state, by) {
    const b = n.querySelector(':scope > .nav-parent');
    n.classList.toggle('open', state);
    if (b) b.setAttribute('aria-expanded', state ? 'true' : 'false');
    if (state) { n.dataset.by = by || 'hover'; if (!isMobile()) place(n); }
    else n.querySelectorAll('.nav-node.open').forEach(c => setOpen(c, false));
  }
  function closeAll(except) {
    document.querySelectorAll('#nav .nav-node.open').forEach(n => { if (!except || !n.contains(except)) setOpen(n, false); });
  }
  function place(n) {   // positionne le sous-menu flottant à droite de son parent, sans jamais sortir de l'écran
    const fly = n.querySelector(':scope > .flyout'), btn = n.querySelector(':scope > .nav-parent');
    if (!fly || !btn) return;
    const r = btn.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
    // Ancrage : bord droit du menu principal (ou du sous-menu parent) : le sous-menu ne recouvre jamais son parent
    const host = n.parentElement.closest('.flyout') || document.getElementById('nav'), hr = host ? host.getBoundingClientRect() : r;
    fly.style.maxHeight = (vh - 16) + 'px';
    fly.style.left = (hr.right + 2) + 'px';
    fly.style.top = Math.max(8, r.top - 6) + 'px';
    const w = fly.offsetWidth, h = fly.offsetHeight;
    if (hr.right + 2 + w > vw - 8) fly.style.left = Math.max(8, hr.left - w - 2) + 'px';   // pas de place à droite : s'ouvre à gauche
    fly.style.top = Math.max(8, Math.min(r.top - 6, vh - h - 8)) + 'px';
  }
  window.navGo = function (k) { closeAll(); closeNavDrawer(); go(k); return false; };

  function bindNav(nav) {
    nav.querySelectorAll('.nav-node').forEach(n => {
      n.addEventListener('mouseenter', () => {
        if (!canHover()) return;
        clearTimeout(n._t);
        const sib = n.parentElement.querySelectorAll(':scope > .nav-node.open');
        sib.forEach(s => { if (s !== n) setOpen(s, false); });
        if (!n.classList.contains('open')) setOpen(n, true, 'hover');
      });
      n.addEventListener('mouseleave', () => {
        if (!canHover()) return;
        clearTimeout(n._t);
        n._t = setTimeout(() => setOpen(n, false), 220);   // petit délai : traverser l'espace entre parent et sous-menu sans fermer
      });
    });
    nav.querySelectorAll('.nav-parent').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      const n = b.parentElement;
      if (n.classList.contains('open')) { if (n.dataset.by === 'hover' && canHover()) n.dataset.by = 'click'; else setOpen(n, false); }
      else {
        n.parentElement.querySelectorAll(':scope > .nav-node.open').forEach(s => setOpen(s, false));
        setOpen(n, true, 'click');
      }
    }));
    nav.querySelectorAll('[data-go]').forEach(a => a.addEventListener('click', e => { e.stopPropagation(); navGo(a.dataset.go); }));
    nav.querySelectorAll('.nav-link').forEach(a => a.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); a.click(); }
      if (e.key === 'ArrowRight' && a.classList.contains('nav-parent')) { e.preventDefault(); const n = a.parentElement; setOpen(n, true, 'click'); const f = n.querySelector('.flyout .nav-link'); if (f) f.focus(); }
      if (e.key === 'ArrowLeft') { const n = a.closest('.nav-node'); if (n) { const p = n.querySelector(':scope > .nav-parent'); setOpen(n, false); if (p) p.focus(); } }
    }));
    // Infobulles lorsque le menu est réduit à ses icônes
    nav.querySelectorAll('.nav-scroll > .nav-link').forEach(a => {
      a.addEventListener('mouseenter', () => showTip(a));
      a.addEventListener('mouseleave', hideTip);
    });
  }
  let tipEl = null;
  function showTip(a) {
    if (!collapsed || isMobile()) return;
    if (!tipEl) { tipEl = document.createElement('div'); tipEl.id = 'nav-tip'; document.body.appendChild(tipEl); }
    const r = a.getBoundingClientRect();
    tipEl.textContent = a.dataset.tip || ''; tipEl.style.display = 'block';
    tipEl.style.left = (r.right + 8) + 'px'; tipEl.style.top = (r.top + r.height / 2 - tipEl.offsetHeight / 2) + 'px';
  }
  function hideTip() { if (tipEl) tipEl.style.display = 'none'; }

  document.addEventListener('click', e => { if (!e.target.closest('#nav .nav-node')) closeAll(); if (!e.target.closest('#user-chip')) closeUserMenu(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeAll(); closeUserMenu(); closeNavDrawer(); } });
  window.addEventListener('resize', () => { closeAll(); if (!isMobile()) closeNavDrawer(); const nav = document.getElementById('nav'); if (nav) nav.classList.toggle('collapsed', collapsed && !isMobile());
    nav.classList.toggle('user-hidden', navHidden); });
  window.addEventListener('scroll', () => closeAll(), true);

  
  window.toggleNavHorizontal = function () {
    try {
      document.body.classList.toggle('nav-horizontal');
      const on = document.body.classList.contains('nav-horizontal');
      try { localStorage.setItem('smp-nav-horizontal', on ? '1' : '0'); } catch (_) {}
      toast(on ? 'Menu horizontal activé (écrans larges)' : 'Menu vertical rétabli', 'info');
      if (typeof paintNav === 'function') paintNav();
      else if (typeof initShell === 'function') { /* redraw on next go */ }
    } catch (e) { console.warn(e); }
  };

  window.toggleNavCollapse = function () {
    collapsed = !collapsed; store.set('smp-nav-collapsed', collapsed ? '1' : '0'); hideTip(); closeAll();
    if (typeof go === 'function') go(cur, arg);
  };

  /* ---------- Tiroir de navigation sur mobile ---------- */
  function overlay() {
    let o = document.getElementById('nav-overlay');
    if (!o) { o = document.createElement('div'); o.id = 'nav-overlay'; o.onclick = closeNavDrawer; document.body.appendChild(o); }
    return o;
  }
  function closeNavDrawer() {
    const nav = document.getElementById('nav'); if (nav) nav.classList.remove('drawer-open');
    const o = document.getElementById('nav-overlay'); if (o) o.classList.remove('show');
    const t = document.getElementById('nav-toggle'); if (t) t.setAttribute('aria-expanded', 'false');
  }
  window.hideNavCompletely = function () {
    navHidden = true; store.set('smp-nav-hidden', '1');
    const nav = document.getElementById('nav'); if (nav) nav.classList.add('user-hidden');
    closeNavDrawer();
  };
  window.toggleNavDrawer = function () {
    const nav = document.getElementById('nav'); if (!nav) return;
    if (!isMobile()) {
      if (navHidden) { navHidden = false; store.set('smp-nav-hidden', '0'); nav.classList.remove('user-hidden'); if (typeof renderNav === 'function') renderNav(typeof cur !== 'undefined' ? cur : ''); }
      else { navHidden = true; store.set('smp-nav-hidden', '1'); nav.classList.add('user-hidden'); }
      return;
    }
    if (navHidden) { navHidden = false; store.set('smp-nav-hidden', '0'); nav.classList.remove('user-hidden'); }
    const open = !nav.classList.contains('drawer-open');
    nav.classList.toggle('drawer-open', open); overlay().classList.toggle('show', open);
    const t = document.getElementById('nav-toggle'); if (t) t.setAttribute('aria-expanded', open ? 'true' : 'false');
  };

  /* ---------- Barre supérieure : profil réel, date / heure dynamiques, alertes, raccourcis ---------- */
  const loc = () => (typeof I18N !== 'undefined' ? I18N.locale() : 'fr-FR');
  function tick() {
    const d = document.querySelector('#live-clock .clk-date'), t = document.querySelector('#live-clock .clk-time');
    if (!d || !t) return;
    const now = new Date();
    const narrow = (typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 560px)').matches);
    // Format adaptatif : long sur grand écran, compact sur téléphone (même ligne que le nom client)
    d.textContent = narrow
      ? now.toLocaleDateString(loc(), { weekday: 'short', day: '2-digit', month: 'short' })
      : now.toLocaleDateString(loc(), { weekday: 'short', day: '2-digit', month: 'long', year: 'numeric' });
    t.textContent = now.toLocaleTimeString(loc(), { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  // Notifications du Superadmin : demandes de renouvellement de licence en attente (API d'administration, jamais les alertes d'une station)
  async function platformNotifs() {
    const d = await G('/admin/licenses/dashboard');
    return (d && d.pending_renewal_requests) || [];
  }
  // Source unique pour le compteur ET le contenu de la cloche : le chiffre affiché correspond toujours à ce que la fenêtre liste.
  async function bellItems() {
    const unread = await G('/messaging/unread').catch(() => []);
    const messages = Array.isArray(unread) ? unread : [];
    let platform = [], alerts = [];
    if (ME && ME.is_global) platform = await platformNotifs().catch(() => []);
    else {
      const all = await G('/notifications').catch(() => []);
      alerts = (Array.isArray(all) ? all : []).filter(x => !x.read_at);
    }
    return { messages, platform: Array.isArray(platform) ? platform : [], alerts };
  }
  async function refreshBell() {
    const b = document.getElementById('bell-n'); if (!b || !TK) return;
    try {
      const it = await bellItems();
      const n = it.messages.length + it.platform.length + it.alerts.length;
      b.hidden = !n; b.textContent = n > 99 ? '99+' : String(n);
      b.setAttribute('aria-label', n + ' notification(s) non lue(s)');
    } catch (e) { /* notifications indisponibles : on n'affiche rien */ }
  }
  window.refreshBell = refreshBell; // appelé aussi par la messagerie dès qu'un message arrive en temps réel
  // File de notifications de messagerie : une par écran, espacées de cinq minutes.
  const messageToastQueue = [];
  const messageToastQueued = new Set();
  const messageToastSeen = new Set();
  let messageToastLastShownAt = 0;
  let messageToastVisibleId = null;
  let messageToastTimer = null;
  const MESSAGE_TOAST_GAP_MS = 5 * 60 * 1000;

  function hideMessageToast() {
    const node = document.getElementById('message-unread-toast');
    if (node) node.remove();
    messageToastVisibleId = null;
    if (messageToastTimer) { clearTimeout(messageToastTimer); messageToastTimer = null; }
  }

  function showMessageToast(item) {
    hideMessageToast();
    const node = document.createElement('div');
    node.id = 'message-unread-toast';
    node.className = 'message-unread-toast';
    node.setAttribute('role', 'status');
    node.setAttribute('aria-live', 'polite');
    const sender = item.sender_name || item.sender_login || 'Nouveau message';
    const preview = String(item.body || 'Pièce jointe').slice(0, 180);
    const label = item.is_support ? 'Support' : (item.conversation_title || 'Messagerie');
    node.innerHTML = `<button type="button" class="message-unread-toast-open" aria-label="Ouvrir le message de ${esc(sender)}"><span class="message-unread-toast-head"><b>${esc(sender)}</b><span>${esc(label)}</span></span><span class="message-unread-toast-body">${esc(preview)}</span><span class="message-unread-toast-foot">Message non lu · Cliquer pour ouvrir</span></button><button type="button" class="message-unread-toast-close" aria-label="Fermer la notification">×</button>`;
    node.querySelector('.message-unread-toast-open').addEventListener('click', () => {
      hideMessageToast();
      go('msg');
      window.setTimeout(() => { if (typeof window.openConv === 'function') window.openConv(Number(item.conversation_id)); }, 300);
    });
    node.querySelector('.message-unread-toast-close').addEventListener('click', hideMessageToast);
    document.body.appendChild(node);
    messageToastVisibleId = Number(item.message_id);
    messageToastLastShownAt = Date.now();
    messageToastTimer = window.setTimeout(() => {
      hideMessageToast();
    }, 12000);
  }

  async function refreshUnreadMessageToasts() {
    if (!TK) return;
    try {
      const rows = await G('/messaging/unread');
      const unreadIds = new Set((Array.isArray(rows) ? rows : []).map(x => Number(x.message_id)));
      // Les messages lus sont retirés immédiatement de la file et de l’historique anti-doublon.
      for (const id of [...messageToastQueued]) if (!unreadIds.has(id)) messageToastQueued.delete(id);
      for (const id of [...messageToastSeen]) if (!unreadIds.has(id)) messageToastSeen.delete(id);
      for (let i = messageToastQueue.length - 1; i >= 0; i--) {
        if (!unreadIds.has(Number(messageToastQueue[i].message_id))) messageToastQueue.splice(i, 1);
      }
      if (messageToastVisibleId !== null && !unreadIds.has(messageToastVisibleId)) hideMessageToast();
      for (const item of (Array.isArray(rows) ? rows : [])) {
        const id = Number(item.message_id);
        if (!id || messageToastQueued.has(id) || messageToastSeen.has(id)) continue;
        messageToastQueue.push(item);
        messageToastQueued.add(id);
      }
      messageToastQueue.sort((a, b) => new Date(a.created_at) - new Date(b.created_at) || Number(a.message_id) - Number(b.message_id));
      if (messageToastVisibleId !== null || !messageToastQueue.length) return;
      if (Date.now() - messageToastLastShownAt < MESSAGE_TOAST_GAP_MS) return;
      const next = messageToastQueue.shift();
      const id = Number(next.message_id);
      messageToastQueued.delete(id);
      messageToastSeen.add(id);
      showMessageToast(next);
    } catch (e) {
      // Pas de toast si la messagerie n’est pas activée ou si l’utilisateur n’y a pas accès.
    }
  }

  // Pop-up immédiat à l'arrivée d'un message en temps réel (sans attendre le prochain cycle ni l'intervalle de cinq minutes).
  window.showIncomingMessageToast = async function (messageId) {
    try {
      const rows = await G('/messaging/unread');
      const item = (Array.isArray(rows) ? rows : []).find(x => Number(x.message_id) === Number(messageId));
      if (!item) return;
      const id = Number(item.message_id);
      messageToastQueued.delete(id);
      messageToastSeen.add(id);
      const q = messageToastQueue.findIndex(x => Number(x.message_id) === id);
      if (q >= 0) messageToastQueue.splice(q, 1);
      showMessageToast(item);
    } catch (e) { /* pas de pop-up si la messagerie est indisponible */ }
  };

  // La cloche ouvre la file des messages non lus pour tous les rôles autorisés,
  // et conserve les demandes de renouvellement réservées au Superadmin.
  window.bellClick = async function () {
    try {
      const it = await bellItems();
      const messages = it.messages, platformRows = it.platform;
      const alertRowsAll = it.alerts, alertRows = alertRowsAll.slice(0, 30);
      const messageRows = messages.map(item => {
        const sender = esc(item.sender_name || item.sender_login || 'Utilisateur');
        const title = esc(item.is_support ? 'Support' : (item.conversation_title || 'Messagerie'));
        const preview = esc(String(item.body || 'Pièce jointe').slice(0, 140));
        const when = item.created_at ? dt(item.created_at) : '—';
        const id = Number(item.conversation_id);
        return [sender, title, preview, when,
          `<button class="b2" onclick="closeM();go('msg');setTimeout(()=>{if(typeof window.openConv==='function')window.openConv(${Number.isSafeInteger(id) && id > 0 ? id : 0})},300)">Ouvrir</button>`];
      });
      const messageHtml = messageRows.length
        ? `<h4>Messages non lus (${messageRows.length})</h4>${T(['Expéditeur', 'Conversation', 'Aperçu', 'Date', ''], messageRows)}`
        : '<p style="color:var(--m)">Aucun message non lu.</p>';
      const platformHtml = (ME && ME.is_global)
        ? `<h4>Demandes de renouvellement (${platformRows.length})</h4>${platformRows.length ? T(['Client', 'Demandeur', 'Date', ''], platformRows.map(r => [esc(r.client_name), esc(r.requester_login || ''), r.requested_at ? dt(r.requested_at) : '—', `<button class="b2" onclick="closeM();go('clients')">Traiter</button>`])) : '<p style="color:var(--m)">Aucune demande de renouvellement en attente.</p>'}`
        : '';
      const alertHtml = (ME && ME.is_global) ? '' : (alertRows.length
        ? `<h4>Alertes non lues (${alertRowsAll.length})</h4>${T(['Date', 'Niveau', 'Message', ''], alertRows.map(n => [dt(n.created_at), `<span class="tag ${n.level === 'info' ? '' : 'x'}">${esc(n.level)}</span>`, esc(n.message),
          `<button class="b2" onclick="Po('/notifications/${Number(n.id)}/read').then(()=>{closeM();bellClick();refreshBell()})">Lu</button>`]))}<p><a href="#" onclick="closeM();go('alert');return false">Voir toutes les alertes</a></p>`
        : '');
      const nothing = !messages.length && !alertRowsAll.length && !platformRows.length;
      modal(`<h3>Notifications</h3>${nothing ? '<p style="color:var(--m)">Aucune notification non lue.</p>' : messageHtml + alertHtml + platformHtml}<div class="r"><button class="b2" onclick="closeM()">Fermer</button></div>`);
    } catch (e) { toast(errMsg(e), 'error'); }
  };
  const displayName = () => (ME && (ME.full_name || ME.login)) || '';
  const roleText = () => {
    if (!ME) return '';
    if (ME.is_global) return 'Superadmin · Administrateur principal';
    const role = ME.role_label || ME.role || '';
    return ME.job_title && ME.job_title !== role ? ME.job_title + ' · ' + role : role;
  };
  async function loadAvatar() {
    const av = document.getElementById('my-av'); if (!av || !ME || !ME.has_photo) return;
    try {
      const r = await fetch('/api/me/photo', { headers: { Authorization: 'Bearer ' + TK }, cache: 'no-store' });
      if (!r.ok) throw 0;
      if (window.__myPhotoUrl) URL.revokeObjectURL(window.__myPhotoUrl);
      window.__myPhotoUrl = URL.createObjectURL(await r.blob());
      document.querySelectorAll('.avatar-me').forEach(e => { e.innerHTML = `<img src="${window.__myPhotoUrl}" alt="">`; });
    } catch (e) { /* on garde les initiales */ }
  }
  function chipHtml() {
    const name = displayName(), init = (name.trim().split(/\s+/).slice(0, 2).map(x => x[0] || '').join('') || '?').toUpperCase();
    const lang = typeof I18N !== 'undefined' ? (I18N.getLang() === 'fr' ? 'English' : 'Français') : '';
    return `<div class="uc-btn" id="uc-btn" role="button" tabindex="0" aria-haspopup="true" aria-expanded="false" onclick="toggleUserMenu(event)" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleUserMenu(event)}">
        <span class="avatar avatar-me" id="my-av">${esc(init)}</span>
        <span class="uc-text"><b>${esc(name)}</b><small>${esc(roleText())}</small></span><span class="uc-caret" aria-hidden="true">▾</span>
      </div>
      <div class="user-menu" id="user-menu" role="menu">
        <div class="um-head"><span class="avatar big avatar-me">${esc(init)}</span><div><b>${esc(name)}</b><small>${esc(ME.login || '')}</small><small>${esc(roleText())}</small></div></div>
        <a role="menuitem" tabindex="0" onclick="closeUserMenu();pickMyPhoto()">📷 Changer ma photo</a>
        <a role="menuitem" tabindex="0" data-pwa-install hidden onclick="closeUserMenu();pwaInstall()">📲 Installer l'application</a>
        <a role="menuitem" tabindex="0" onclick="closeUserMenu();go('offlineq')">📡 File hors-ligne</a>
        ${window.AndroidBridge && AndroidBridge.openSettings ? '<a role="menuitem" tabindex="0" onclick="closeUserMenu();AndroidBridge.openSettings()">⚙ Réglages de l\'application</a>' : ''}
        <a role="menuitem" tabindex="0" onclick="closeUserMenu();typeof personalThemeEditor==='function'&&personalThemeEditor()">🎨 Mon thème</a>
        <a role="menuitem" tabindex="0" onclick="closeUserMenu();typeof personalNavColorsEditor==='function'&&personalNavColorsEditor()">🎨 Couleurs du menu</a>
        <a role="menuitem" tabindex="0" onclick="closeUserMenu();typeof toggleDayNight==='function'&&toggleDayNight()">🌓 Jour / Nuit</a>
        ${lang ? `<a role="menuitem" tabindex="0" id="lang-toggle" onclick="closeUserMenu();I18N.setLang(I18N.getLang()==='fr'?'en':'fr')">🌐 ${lang}</a>` : ''}
        <a role="menuitem" tabindex="0" onclick="closeUserMenu();chgPwd()">🔑 Mot de passe</a>
        <a role="menuitem" tabindex="0" class="um-danger" onclick="closeUserMenu();logout()">⏻ Déconnexion</a>
      </div>`;
  }
  window.closeUserMenu = function () {
    const m = document.getElementById('user-menu'), b = document.getElementById('uc-btn');
    if (m) m.classList.remove('show'); if (b) b.setAttribute('aria-expanded', 'false');
  };
  window.toggleUserMenu = function (e) {
    if (e) e.stopPropagation();
    const m = document.getElementById('user-menu'), b = document.getElementById('uc-btn'); if (!m) return;
    const open = !m.classList.contains('show');
    m.classList.toggle('show', open); if (b) b.setAttribute('aria-expanded', open ? 'true' : 'false');
  };

  // Photo de profil : PNG / JPEG, 2 Mo maximum (contrôle d'après les octets côté serveur)
  window.pickMyPhoto = function () {
    modal(`<h3>Ma photo de profil</h3><p style="color:var(--m)">PNG ou JPEG, 2 Mo maximum.</p>
      <input type="file" id="mpf" accept="image/png,image/jpeg">
      <div style="margin:12px 0"><img id="mpp" class="avatar big" style="display:none;width:96px;height:96px;border-radius:50%;object-fit:cover" alt=""></div>
      <div class="r"><button class="b2" onclick="closeM()">Annuler</button>
      ${ME.has_photo ? '<button class="b2 bd" id="mpd">Supprimer</button>' : ''}<button id="mpo" disabled>Enregistrer</button></div>`);
    let data = null;
    document.getElementById('mpf').onchange = e => {
      const f = e.target.files[0]; if (!f) return;
      if (!/^image\/(png|jpeg)$/.test(f.type)) return toast('Format refusé : PNG ou JPEG uniquement', 'error');
      if (f.size > 2 * 1024 * 1024) return toast('Fichier trop volumineux (2 Mo maximum)', 'error');
      const rd = new FileReader();
      rd.onload = () => { data = rd.result; const p = document.getElementById('mpp'); p.src = data; p.style.display = 'block'; document.getElementById('mpo').disabled = false; };
      rd.readAsDataURL(f);
    };
    document.getElementById('mpo').onclick = async () => {
      try { await api('PUT', '/me/photo', { data_url: data }); ME.has_photo = true; closeM(); toast('Photo enregistrée', 'success'); refreshChip(); }
      catch (e) { toast(errMsg(e), 'error'); }
    };
    const del = document.getElementById('mpd');
    if (del) del.onclick = async () => {
      try { await api('DELETE', '/me/photo'); ME.has_photo = false; closeM(); toast('Photo supprimée', 'success'); refreshChip(); } catch (e) { toast(errMsg(e), 'error'); }
    };
  };

  function shortcutsHtml() {
    const out = [];
    if (ME && ME.is_global) return '';
    if (can('sale.create') && typeof addS === 'function') out.push('<button class="b2 sc" onclick="addS()" title="Nouvelle vente produit ou carburant (N)">＋ Vente</button>');
    if (V.caisse && can(V.caisse[1])) out.push('<button class="b2 sc" onclick="go(\'caisse\')" title="Caisse et dépenses">💰 Caisse</button>');
    return out.join('');
  }
  window.refreshTenantBrand = async function () {
    const host = document.getElementById('tenant-brand'); if (!host || !ME) return;
    // SuperAdmin : identité plateforme (Manager Pro). Client : identité station/client uniquement — jamais le logo du site.
    let name = brandName(), subtitle = BRAND.tagline || '';
    let logoHtml = brandMarkInner();
    if (!ME.is_global) {
      const st = (typeof AP !== 'undefined' && AP && AP.station) ? (AP.station || {}) : {};
      name = st.name || st.client_name || (Array.isArray(ME.stations) && ME.stations[0] && ME.stations[0].name) || 'Station';
      subtitle = st.tagline || '';   // slogan saisi dans Paramètres > Général
      const initial = (String(name).trim().charAt(0) || 'S').toUpperCase();
      logoHtml = esc(initial); // repli neutre — pas le logo Manager Pro
      if (st.has_logo && typeof SID !== 'undefined' && SID) {
        const key = String(SID);
        try {
          if (window.__tenantLogoKey !== key || !window.__tenantLogoUrl) {
            const response = await fetch('/api/images/stations/' + encodeURIComponent(key), { headers: { Authorization: 'Bearer ' + TK, 'X-Station-Id': String(SID) }, cache: 'no-store' });
            if (!response.ok) throw new Error('Logo de station indisponible');
            if (window.__tenantLogoUrl) URL.revokeObjectURL(window.__tenantLogoUrl);
            window.__tenantLogoUrl = URL.createObjectURL(await response.blob()); window.__tenantLogoKey = key;
          }
          logoHtml = `<img src="${window.__tenantLogoUrl}" alt="Logo ${esc(name)}">`;
        } catch (_) { logoHtml = esc(initial); }
      }
    }
    host.innerHTML = `<span class="tenant-brand-mark">${logoHtml}</span><span class="tenant-brand-copy"><b title="${esc(name)}">${esc(name)}</b><small>${esc(subtitle)}</small>${(!ME.is_global && typeof AP !== 'undefined' && AP.footer && AP.footer.forced_signature) ? `<small class="tenant-sig">✍ ${esc(AP.footer.forced_signature)}</small>` : ''}</span>`;
    host.style.setProperty('--tenant-accent', getComputedStyle(document.documentElement).getPropertyValue('--p').trim() || '#0d7a6b');
  };
  function refreshChip() {
    const c = document.getElementById('user-chip'); if (c && ME) { c.innerHTML = chipHtml(); loadAvatar(); }
  }
  window.initShell = function () {
    refreshChip();
    // L'identité de l'entreprise est affichée sur toutes les pages client,
    // mais pas dans l'espace du Superadmin qui gère plusieurs clients.
    const tenantBar = document.getElementById('tenant-brandbar');
    if (tenantBar) tenantBar.hidden = !!(ME && ME.is_global);
    const fb = document.querySelector('.top-focus'); if (fb) fb.hidden = !!(ME && ME.is_global);
    const sc = document.getElementById('top-shortcuts'); if (sc) sc.innerHTML = shortcutsHtml();
    if (typeof updateThemeToggleBtn === 'function') updateThemeToggleBtn();
    tick(); if (!window.__shellClock) window.__shellClock = setInterval(tick, 1000);   // date et heure mises à jour sans rechargement
    refreshBell(); if (!window.__shellBell) window.__shellBell = setInterval(refreshBell, 60000);
    refreshUnreadMessageToasts(); if (!window.__messageUnreadToasts) window.__messageUnreadToasts = setInterval(refreshUnreadMessageToasts, 60000);
    applyBrand();
    if (typeof refreshTenantBrand === 'function') refreshTenantBrand();
  };
})();
