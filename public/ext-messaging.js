/* Messagerie interne — Manager PRO
   Feature flags : can_use_messaging, messaging_attachments, messaging_groups,
   messaging_broadcast, can_use_auto_alerts (actifs par défaut sur nouveaux contrats ; Super Admin peut désactiver).
*/
(function () {
  if (typeof V === 'undefined' || typeof VM === 'undefined') return;

  V.msg = ['Messagerie', '*'];
  // Permission affichage : tout utilisateur authentifié non-global ; le backend enforce le contrat

  const state = { presence: {}, conversations: [], current: null, status: null, users: [], alertConfig: null, systemAlerts: [], pendingFiles: [] };

  function featureBox(feat) {
    if (!feat || feat.enabled) return '';
    const row = (t, v) => (v ? `<p><b>${t}</b> ${esc(v)}</p>` : '');   // aucune rubrique vide
    return `<div class="card" style="max-width:520px;margin:24px auto;padding:20px;border-left:4px solid var(--o,#d97706)">
      <h3 style="margin:0 0 8px">${esc(feat.label || '🔒 Fonctionnalité désactivée')}</h3>
      ${row('Pourquoi ?', feat.why)}${row("Qui peut l'activer ?", feat.who)}${row("Comment l'obtenir ?", feat.how)}
      ${feat.after ? `<p style="font-size:12px;color:var(--m)">${esc(feat.after)}</p>` : ''}
    </div>`;
  }

  async function loadStatus() {
    try {
      state.status = await G('/messaging/status');
    } catch (e) {
      // Erreur technique (serveur, droits) : on le dit clairement au lieu d'afficher « fonctionnalité désactivée ».
      state.status = { enabled: false, features: { messaging: { enabled: false, label: '⚠️ Messagerie indisponible', why: e.message || 'Erreur' } } };
    }
    return state.status;
  }

  async function loadConversations() {
    state.conversations = await G('/messaging/conversations');
    return state.conversations;
  }

  /* ===== Présence « En ligne » ===== */
  async function loadPresence() {
    try { const r = await G('/messaging/presence'); state.presence = (r && r.presence) || {}; } catch (_) { /* présence indisponible : on garde la dernière valeur */ }
  }
  const isOn = id => !!(state.presence[id] && state.presence[id].online);
  function peersOf(c) { return (c && !c.is_broadcast && !c.is_support ? c.members : null) || []; }
  function directPeer(c) { return c && !c.is_group && !c.is_broadcast ? (c.members || [])[0] : null; }
  function convOnline(c) { const p = directPeer(c); return !!(p && isOn(p.id)); }
  function lastSeenLabel(iso) {
    const d = new Date(iso); if (!iso || isNaN(d)) return 'Hors ligne';
    const now = new Date(), y = new Date(now); y.setDate(now.getDate() - 1);
    if (sameDay(d, now)) { const mn = Math.floor((now - d) / 60000); return mn < 1 ? 'Vu à l’instant' : 'Vu aujourd’hui à ' + hhmm(d); }
    if (sameDay(d, y)) return 'Vu hier à ' + hhmm(d);
    return 'Vu le ' + d.toLocaleDateString() + ' à ' + hhmm(d);
  }
  function presenceText(c) {
    if (!c) return { text: '', on: false };
    const p = directPeer(c);
    if (p) { const pr = state.presence[p.id]; return pr && pr.online ? { text: 'En ligne', on: true } : { text: lastSeenLabel(pr && pr.last_seen_at), on: false }; }
    if (c.is_broadcast) return { text: '', on: false };
    const n = (c.members || []).filter(m => isOn(m.id)).length;
    return { text: n ? n + ' en ligne' : '', on: n > 0 };
  }
  function refreshHeaderPresence() {
    const el = document.getElementById('wa-presence'); if (!el || !state.current) return;
    const c = state.conversations.find(x => Number(x.id) === Number(state.current)); if (!c) return;
    const base = c.is_support ? 'Support client' : c.is_broadcast ? 'Annonce' : c.is_system_conv ? 'Notification privée' + ((c.members || []).length ? ' · ' + ((c.members || []).length + 1) + ' destinataires' : '') : c.is_group ? 'Discussion de groupe' : '';
    const pt = presenceText(c);
    el.innerHTML = (pt.text ? `<span class="wa-pres${pt.on ? ' on' : ''}">${pt.on ? '<i class="wa-dot-inline"></i>' : ''}${esc(pt.text)}</span>` : '') + (pt.text && base ? ' · ' : '') + esc(base);
    const av = document.querySelector('.wa-head .wa-av'); if (av) av.classList.toggle('wa-online', convOnline(c));
  }

  function convLabel(c) {
    if (c.is_broadcast) return '📢 ' + (c.title || 'Annonce');
    if (c.is_system_conv) return '🔔 ' + (c.title || 'Notification');
    if (c.is_group) return '👥 ' + (c.title || 'Groupe');
    const m = (c.members || [])[0];
    if (m) return (m.full_name || m.login || 'Conversation');
    return c.title || 'Conversation';
  }

  function canManageAlerts() { return !ME?.is_global && Array.isArray(ME?.permissions) && (ME.permissions.includes('settings.edit') || ME.permissions.includes('user.manage')); }

  /* ===== Interface « discussions » : liste à gauche, conversation à droite ===== */
  state.filter = 'all'; state.q = ''; state.lastSig = null;

  const favKey = () => 'smp_msg_fav_' + (ME && ME.id);
  function favSet() { try { return new Set(JSON.parse(localStorage.getItem(favKey()) || '[]')); } catch (_) { return new Set(); } }
  function favSave(set) { try { localStorage.setItem(favKey(), JSON.stringify([...set])); } catch (_) { /* stockage indisponible */ } }

  function plainLabel(c) { return String(convLabel(c)).replace(/^(👥|📢|🔔)\s*/, ''); }
  function initials(name) {
    const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
    const first = (parts[0] || '?').charAt(0);
    return (first + (parts.length > 1 ? parts[parts.length - 1].charAt(0) : '')).toUpperCase();
  }
  function avatarHtml(c, small) {
    const name = plainLabel(c);
    const inner = c.is_broadcast ? '📢' : c.is_system_conv ? '🔔' : c.is_group ? '👥' : esc(initials(name));
    const peer = directPeer(c);
    const ph = peer && peer.has_photo ? ` data-puid="${Number(peer.id)}"` : '';   // photo de profil du correspondant, si ajoutée
    return `<span class="wa-av${small ? ' wa-av-sm' : ''}${convOnline(c) ? ' wa-online' : ''}"${ph}>${inner}</span>`;
  }
  /* Petit avatar à côté des messages reçus : photo de profil de l'expéditeur si elle existe, sinon initiales */
  function senderAvatarHtml(m) {
    const nm = m.sender_name || m.sender_login || '?';
    const ph = m.sender_has_photo ? ` data-puid="${Number(m.sender_id)}"` : '';
    return `<span class="wa-av wa-av-xs" title="${esc(nm)}"${ph}>${esc(initials(nm))}</span>`;
  }

  /* ===== Photos de profil (chargées avec le jeton, mises en cache par utilisateur) ===== */
  const photoCache = {};
  function photoUrl(uid) {
    if (!photoCache[uid]) {
      photoCache[uid] = (async () => {
        try {
          const headers = { Authorization: 'Bearer ' + TK };
          if (typeof SID !== 'undefined' && SID) headers['X-Station-Id'] = String(SID);
          const r = await fetch('/api/messaging/users/' + encodeURIComponent(uid) + '/photo', { headers, cache: 'no-store' });
          if (!r.ok) return null;
          return URL.createObjectURL(await r.blob());
        } catch (_) { return null; }
      })();
    }
    return photoCache[uid];
  }
  async function hydratePhotos() {
    const els = document.querySelectorAll('[data-puid]:not([data-ph])');
    for (const el of els) {
      el.dataset.ph = '1';
      const url = await photoUrl(el.dataset.puid);
      if (url && el.isConnected) el.innerHTML = `<img src="${url}" alt="">`;
    }
  }

  /* ===== Taille du texte de la messagerie, réglable par chaque utilisateur (80 % à 180 %) ===== */
  const fsKey = () => 'smp_msg_fs_' + (ME && ME.id);
  function fsGet() { try { const v = parseInt(localStorage.getItem(fsKey()), 10); return v >= 80 && v <= 180 ? v : 100; } catch (_) { return 100; } }
  function fsApply() {
    const v = fsGet(), app = document.getElementById('wa-app');
    if (app && app.style.getPropertyValue('--msg-fs') !== String(v / 100)) app.style.setProperty('--msg-fs', String(v / 100));
    document.querySelectorAll('.wa-fs-val').forEach(e => { const t = v + ' %'; if (e.textContent !== t) e.textContent = t; });
    document.querySelectorAll('.wa-fs input[type=range]').forEach(e => { if (Number(e.value) !== v) e.value = v; });
  }
  window.waFontSet = function (v) {
    v = Math.max(80, Math.min(180, Math.round(Number(v) / 5) * 5));
    try { localStorage.setItem(fsKey(), String(v)); } catch (_) { /* stockage indisponible : réglage valable pour cette session seulement */ }
    fsApply();
  };
  window.waFontStep = function (d) { window.waFontSet(fsGet() + d * 10); };
  function fontControlHtml() {
    return `<details class="wa-menu wa-fs"><summary title="Taille du texte" aria-label="Taille du texte">Aa</summary>
      <div class="wa-menu-list wa-fs-panel">
        <div class="wa-fs-row"><button type="button" class="wa-fs-sm" title="Plus petit" onclick="waFontStep(-1)">A−</button>
          <input type="range" min="80" max="180" step="5" value="${fsGet()}" aria-label="Taille du texte" oninput="waFontSet(this.value)">
          <button type="button" class="wa-fs-lg" title="Plus grand" onclick="waFontStep(1)">A+</button></div>
        <div class="wa-fs-val">${fsGet()} %</div>
        <button type="button" class="wa-fs-reset" onclick="waFontSet(100)">Taille par défaut</button>
      </div></details>`;
  }
  /* Les listes et conversations sont redessinées souvent : un observateur léger applique photos et taille à chaque rendu */
  if (!window.__msgUiObs && window.MutationObserver) {
    let queued = false;
    window.__msgUiObs = new MutationObserver(() => {
      if (queued) return; queued = true;
      requestAnimationFrame(() => { queued = false; if (!document.getElementById('wa-app')) return; fsApply(); hydratePhotos(); });
    });
    window.__msgUiObs.observe(document.body, { childList: true, subtree: true });
  }
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const hhmm = d => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  function listTime(v) {
    const d = new Date(v); if (isNaN(d)) return '';
    const now = new Date(), y = new Date(now); y.setDate(now.getDate() - 1);
    if (sameDay(d, now)) return hhmm(d);
    if (sameDay(d, y)) return 'Hier';
    return d.toLocaleDateString();
  }
  function dayLabel(d) {
    const now = new Date(), y = new Date(now); y.setDate(now.getDate() - 1);
    if (sameDay(d, now)) return 'Aujourd’hui';
    if (sameDay(d, y)) return 'Hier';
    return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }

  function rowsHtml() {
    const favs = favSet(), q = String(state.q || '').trim().toLowerCase();
    let list = state.conversations.filter(c => {
      if (state.filter === 'unread' && !(c.unread > 0)) return false;
      if (state.filter === 'fav' && !favs.has(c.id)) return false;
      if (q) {
        const hay = (plainLabel(c) + ' ' + ((c.last_message && c.last_message.body) || '')).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    list = list.slice().sort((a, b) => (favs.has(b.id) ? 1 : 0) - (favs.has(a.id) ? 1 : 0));
    if (!list.length) return `<p class="wa-empty-list">${state.conversations.length ? 'Aucune discussion ne correspond.' : 'Aucune conversation.'}</p>`;
    return list.map(c => {
      const last = c.last_message;
      const mine = !!(last && ME && last.sender_id === ME.id);
      const prev = last ? (mine ? 'Vous : ' : '') + esc((last.body || '').slice(0, 80)) : '';
      const fav = favs.has(c.id);
      const id = Number(c.id);
      return `<div class="wa-row${Number(state.current) === id ? ' on' : ''}" data-id="${id}" title="${esc(convLabel(c))}" onclick="openConv(${id})">
        ${avatarHtml(c)}
        <div class="wa-row-main">
          <div class="wa-row-top"><b class="wa-name">${esc(plainLabel(c))}</b><span class="wa-time${c.unread > 0 ? ' unread' : ''}">${last ? esc(listTime(last.created_at)) : ''}</span></div>
          <div class="wa-row-bot"><span class="wa-prev">${prev || '&nbsp;'}</span>${c.unread > 0 ? `<span class="wa-badge">${Number(c.unread)}</span>` : ''}<button type="button" class="wa-btn wa-star${fav ? ' on' : ''}" title="Favori" onclick="event.stopPropagation();waFav(${id})">${fav ? '★' : '☆'}</button></div>
        </div>
      </div>`;
    }).join('');
  }
  function refreshRows() { const el = document.getElementById('msg-list'); if (el) el.innerHTML = rowsHtml(); }

  window.waFav = function (id) {
    const set = favSet(); id = Number(id);
    if (set.has(id)) set.delete(id); else set.add(id);
    favSave(set); refreshRows();
  };
  window.waSearch = function (v) { state.q = String(v || ''); refreshRows(); };
  window.waFilter = function (f) {
    state.filter = f;
    document.querySelectorAll('.wa-chip').forEach(b => b.classList.toggle('on', b.dataset.f === f));
    refreshRows();
  };

  function placeholderHtml() {
    return '<div class="wa-placeholder"><div class="wa-ph-ico">💬</div><h3>Messagerie Manager PRO</h3><p>Sélectionnez une discussion pour afficher les messages.</p></div>';
  }

  function renderList() {
    const sa = ME && ME.is_global;
    // B5 : le contact support est visible uniquement pour l'administrateur local.
    // Le serveur applique le même contrôle indépendamment de cette visibilité.
    const localAdmin = !sa && ME?.role === 'ADMIN';
    const supportBtn = (!sa && localAdmin && (state.status?.features?.support?.enabled || state.status?.features?.messaging?.enabled))
      ? '<button type="button" onclick="msgSupportToAdmin()">Contacter le SuperAdmin</button>' : '';
    const alertOn = !sa && canManageAlerts() && state.status?.features?.auto_alerts?.enabled;
    const menuItems = [
      !sa && state.status?.features?.groups?.enabled ? '<button type="button" onclick="msgNewGroup()">Nouveau groupe</button>' : '',
      !sa && state.status?.features?.broadcast?.enabled ? '<button type="button" onclick="msgBroadcast()">Message à tous</button>' : '',
      supportBtn,
      alertOn ? '<button type="button" onclick="msgAlertConfigOpen()">Configurer les alertes</button>' : '',
      alertOn ? '<button type="button" onclick="msgAlertCenterOpen()">Centre des alertes</button>' : ''
    ].filter(Boolean).join('');
    const menu = menuItems ? `<details class="wa-menu"><summary title="Plus d’options" aria-label="Plus d’options">⋮</summary><div class="wa-menu-list">${menuItems}</div></details>` : '';
    const newBtn = sa
      ? '<button type="button" class="wa-btn wa-ico wa-new" title="Support client" aria-label="Support client" onclick="msgSupportOpen()">＋</button>'
      : '<button type="button" class="wa-btn wa-ico wa-new" title="Nouveau message" aria-label="Nouveau message" onclick="msgNewDirect()">＋</button>';
    const chip = (k, t) => `<button type="button" class="wa-btn wa-chip${state.filter === k ? ' on' : ''}" data-f="${k}" onclick="waFilter('${k}')">${t}</button>`;
    return `<div id="wa-app" class="wa-app">
      <aside class="wa-side">
        <div class="wa-side-head"><h3>Discussions</h3><div class="wa-head-actions">${fontControlHtml()}${newBtn}${menu}</div></div>
        <div class="wa-search"><input id="wa-search" type="search" autocomplete="off" placeholder="Rechercher ou démarrer une discussion" oninput="waSearch(this.value)"></div>
        <div class="wa-chips">${chip('all', 'Toutes')}${chip('unread', 'Non lues')}${chip('fav', 'Favoris')}</div>
        <div id="msg-list" class="wa-list">${rowsHtml()}</div>
      </aside>
      <section id="msg-thread" class="wa-main">${placeholderHtml()}</section>
    </div>`;
  }

  /* ===== « Vu » : ✓ envoyé · ✓✓ vu (par tous) · « Vu par 2/5 » dans un groupe ===== */
  function seenHtml(m) {
    const total = Number(m.recipients_count || 0), seen = Number(m.seen_count || 0);
    if (!total) return '<span class="msg-tick" title="Envoyé">✓</span>';
    const who = (m.seen_by || []).map(x => x.name + ' — ' + (x.read_at ? hhmm(new Date(x.read_at)) : '')).join('\n');
    if (seen >= total) {
      const last = (m.seen_by || []).map(x => new Date(x.read_at)).filter(x => !isNaN(x)).sort((a, b) => b - a)[0];
      const label = total > 1 ? 'Vu par tous' : 'Vu' + (last ? ' ' + hhmm(last) : '');
      return `<span class="msg-tick seen" title="${esc(who || 'Vu')}">✓✓ ${esc(label)}</span>`;
    }
    if (seen > 0) return `<span class="msg-tick part" title="${esc(who)}">✓✓ Vu par ${seen}/${total}</span>`;
    return '<span class="msg-tick" title="Envoyé, pas encore vu">✓</span>';
  }
  function bubblesHtml(msgs, conv) {
    const showNames = !conv || conv.is_group || conv.is_broadcast;
    let lastDay = '';
    return msgs.map(m => {
      const d = new Date(m.created_at), key = isNaN(d) ? '' : d.toDateString();
      let sep = '';
      if (key && key !== lastDay) { lastDay = key; sep = `<div class="wa-day"><span>${esc(dayLabel(d))}</span></div>`; }
      const mine = m.sender_id === ME.id;
      const atts = (m.attachments || []).map(a =>
        `<button class="tag" type="button" onclick="msgDownloadAttachment(${Number(a.id)})">📎 ${esc(a.file_name)}</button>`
      ).join(' ');
      return sep + `<div class="msg-line ${mine ? 'msg-line-mine' : 'msg-line-other'}">
        ${!mine && !m.is_system ? senderAvatarHtml(m) : ''}
        <div class="msg-bubble ${mine ? 'msg-bubble-mine' : 'msg-bubble-other'}">
          ${m.is_system ? '<small class="msg-sender">⚡ Alerte système</small><br>' : (!mine && showNames ? `<small class="msg-sender">${esc(m.sender_name || m.sender_login)}</small><br>` : '')}
          <div class="msg-body">${esc(m.body).replace(/\n/g, '<br>')}</div>
          ${atts ? '<div class="msg-attachments">' + atts + '</div>' : ''}
          <div class="msg-meta">${isNaN(d) ? '' : esc(hhmm(d))}${mine && !m.is_system ? seenHtml(m) : ''}${mine && !m.is_system ? `<button type="button" class="msg-del" title="Supprimer ce message" aria-label="Supprimer ce message" onclick="msgDelete(${Number(m.id)})">🗑</button>` : ''}</div>
        </div>
      </div>`;
    }).join('');
  }
  const sigOf = msgs => msgs.length + ':' + (msgs.length ? msgs[msgs.length - 1].id : 0) + ':' + msgs.reduce((n, m) => n + Number(m.seen_count || 0), 0);

  function paintBubbles(id, msgs, forceScroll) {
    if (Number(state.current) !== Number(id)) return;
    const box = document.getElementById('msg-bubbles'); if (!box) return;
    const nearBottom = forceScroll || box.scrollHeight - box.scrollTop - box.clientHeight < 90;
    const conv = state.conversations.find(c => Number(c.id) === Number(id));
    box.innerHTML = bubblesHtml(msgs, conv);
    state.lastSig = sigOf(msgs);
    if (nearBottom) box.scrollTop = box.scrollHeight;
  }
  async function refreshBubbles(id, forceScroll) {
    const msgs = await G('/messaging/conversations/' + id + '/messages');
    paintBubbles(id, msgs, forceScroll);
  }

  async function renderThread(convId) {
    convId = Number(convId);
    const msgs = await G('/messaging/conversations/' + convId + '/messages');
    state.current = convId;
    state.lastSig = sigOf(msgs);
    let c = state.conversations.find(x => Number(x.id) === convId);
    if (!c) { try { await loadConversations(); } catch (_) { /* liste indisponible */ } c = state.conversations.find(x => Number(x.id) === convId); }
    c = c || { id: convId, title: 'Conversation' };
    const canAttach = state.status?.features?.attachments?.enabled;
    await loadPresence();

    return `<div class="wa-head">
      <button type="button" class="wa-btn wa-back" onclick="msgBack()" title="Retour" aria-label="Retour">←</button>
      ${avatarHtml(c, true)}
      <div class="wa-head-txt"><b>${esc(plainLabel(c))}</b><small id="wa-presence"></small></div>
      ${fontControlHtml()}
    </div>
    <div id="msg-bubbles" class="wa-msgs">${bubblesHtml(msgs, c)}</div>
    <div id="msg-pending-files" class="wa-pending"></div>
    <div class="wa-compose">
      ${canAttach ? '<button type="button" class="wa-btn wa-ico" title="Joindre un fichier" aria-label="Joindre" onclick="msgAttach()">📎</button><input id="msg-file-input" type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.doc,.docx,.xls,.xlsx" hidden onchange="msgFilesSelected(this.files)">' : ''}
      <input id="msg-input" type="text" placeholder="Écrire un message…" autocomplete="off" onkeydown="if(event.key==='Enter')msgSend()">
      <button type="button" class="wa-btn wa-send" title="Envoyer" aria-label="Envoyer" onclick="msgSend()">➤</button>
    </div>`;
  }

  /* ===== Temps réel : le serveur pousse chaque nouveau message (Server-Sent Events) ===== */
  const rt = { ctrl: null, running: false, retry: 0, blockedUntil: 0, tokenUsed: null };
  async function onRealtimeMessage(d) {
    try { if (typeof window.refreshBell === 'function') window.refreshBell(); } catch (_) { /* cloche indisponible */ }
    // Pop-up immédiat, sauf pour mes propres messages ou si la conversation est déjà ouverte à l'écran.
    const mine = d.sender_id && ME && Number(d.sender_id) === Number(ME.id);
    const viewing = !!document.getElementById('wa-app') && Number(state.current) === Number(d.conversation_id);
    if (!mine && !viewing && !document.hidden && d.message_id && !d.deleted && typeof window.showIncomingMessageToast === 'function') window.showIncomingMessageToast(d.message_id);
    if (!document.getElementById('wa-app')) return;
    try {
      await loadConversations();
      const cur = state.current;
      if (cur && Number(cur) === Number(d.conversation_id)) {
        const c = state.conversations.find(x => Number(x.id) === Number(cur)); if (c) c.unread = 0;
        await refreshBubbles(cur, false);
      }
      refreshRows();
    } catch (_) { /* rattrapé par l'actualisation périodique */ }
  }
  function handleRtChunk(block) {
    let ev = 'message', data = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) ev = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    if (ev !== 'message' && ev !== 'presence' && ev !== 'read') return;
    let d = {}; try { d = JSON.parse(data || '{}'); } catch (_) { /* évènement illisible */ }
    if (ev === 'presence') {   // quelqu'un se connecte / se déconnecte
      if (d.user_id) state.presence[d.user_id] = { online: !!d.online, last_seen_at: d.last_seen_at || null };
      if (document.getElementById('wa-app')) { refreshRows(); refreshHeaderPresence(); }
      return;
    }
    if (ev === 'read') {       // mes messages viennent d'être lus : « Vu » en direct
      if (document.getElementById('wa-app') && state.current && Number(state.current) === Number(d.conversation_id)) refreshBubbles(state.current, false).catch(() => {});
      return;
    }
    onRealtimeMessage(d);
  }
  async function openRealtime() {
    if (rt.running || typeof TK === 'undefined' || !TK || Date.now() < rt.blockedUntil) return;
    rt.running = true; rt.tokenUsed = TK; rt.ctrl = new AbortController();
    try {
      const headers = { Authorization: 'Bearer ' + TK };
      if (typeof SID !== 'undefined' && SID) headers['X-Station-Id'] = SID;
      const r = await fetch('/api/messaging/stream', { headers, signal: rt.ctrl.signal, cache: 'no-store' });
      if (r.status === 401 || r.status === 403 || r.status === 404) { rt.blockedUntil = Date.now() + 5 * 60 * 1000; return; }
      if (!r.ok || !r.body) throw new Error('flux indisponible');
      rt.retry = 0;
      const reader = r.body.getReader(), dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) { handleRtChunk(buf.slice(0, i)); buf = buf.slice(i + 2); }
      }
      onRealtimeMessage({}); // reconnexion : on rattrape ce qui a pu être manqué
    } catch (_) {
      rt.blockedUntil = Date.now() + Math.min(30000, 2000 * Math.pow(2, rt.retry++));
    } finally { rt.running = false; rt.ctrl = null; }
  }
  setInterval(() => {
    const logged = typeof TK !== 'undefined' && !!TK;
    if (!logged || (rt.tokenUsed && rt.tokenUsed !== TK)) { if (rt.ctrl) rt.ctrl.abort(); rt.tokenUsed = null; if (!logged) return; }
    openRealtime();
  }, 3000);

  let pollTimer = null;
  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(async () => {
      if (!document.getElementById('wa-app')) { clearInterval(pollTimer); pollTimer = null; return; }
      if (document.hidden) return;
      try {
        await loadConversations();
        await loadPresence();
        const cur = state.current;
        if (cur) { const c = state.conversations.find(x => Number(x.id) === Number(cur)); if (c) c.unread = 0; }
        refreshRows(); refreshHeaderPresence();
        if (cur) {
          const msgs = await G('/messaging/conversations/' + cur + '/messages');
          if (Number(state.current) === Number(cur) && sigOf(msgs) !== state.lastSig) paintBubbles(cur, msgs, false);
        }
      } catch (_) { /* réseau indisponible : nouvel essai au prochain cycle */ }
    }, 20000);
  }

  const alertKinds = [
    ['cash_variance', 'Écart de caisse / fermeture de quart'],
    ['shift_close', 'Écart à la clôture d’un quart'],
    ['counter_anomaly', 'Jaugeage ou compteur incohérent'],
    ['stock_anomaly', 'Écart de stock'], ['purchase_variance', 'Écart sur facture fournisseur'],
    ['absence', 'Absence'], ['late_arrival', 'Retard'],
    ['account_inactive', 'Compte inactif'], ['account_locked', 'Compte bloqué'],
    ['payroll_anomaly', 'Anomalie de paie'], ['payroll_pending', 'Bulletins de paie en attente'],
    ['incident_note', 'Note d’incident'], ['license_expiring', 'Licence bientôt expirée'],
    ['stock_low', 'Stock sous le minimum'], ['backup_failure', 'Échec de sauvegarde']
  ];
  const thresholdKinds = new Set(['cash_variance', 'shift_close', 'counter_anomaly', 'stock_anomaly', 'purchase_variance', 'late_arrival', 'account_inactive', 'license_expiring']);

  window.msgAlertCenterOpen = async function () {
    try {
      if (!canManageAlerts()) throw new Error('Permission de consultation des alertes requise.');
      const data = await G('/messaging/system-alerts?limit=100');
      state.systemAlerts = data.alerts || [];
      const rows = state.systemAlerts.map(a => {
        const status = a.alert_status === 'resolved' ? 'Résolue' : a.alert_status === 'acknowledged' ? 'Prise en charge' : 'Nouvelle';
        const action = a.alert_status === 'open'
          ? `<button class="b2" onclick="msgAlertAction(${Number(a.id)},'acknowledge')">Prendre en charge</button>`
          : a.alert_status === 'acknowledged' ? `<button class="b1" onclick="msgAlertAction(${Number(a.id)},'resolve')">Résoudre</button>` : '';
        return `<div class="card" style="padding:12px;margin:8px 0"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><b>${esc(a.kind || 'Alerte')}</b><span class="tag">${status}</span></div><p>${esc(a.body || '')}</p><small class="muted">${new Date(a.created_at).toLocaleString()}${a.resolved_by_name ? ' · Résolue par '+esc(a.resolved_by_name) : ''}</small>${a.resolution_note ? `<p><b>Résolution :</b> ${esc(a.resolution_note)}</p>` : ''}<div class="r" style="margin-top:8px">${action}</div></div>`;
      }).join('') || '<p class="muted">Aucune alerte pour les destinataires de ce compte.</p>';
      modal(`<h3>Centre de suivi des alertes</h3><p class="muted">Les alertes sont visibles uniquement par leurs destinataires autorisés. Prenez-les en charge puis marquez-les comme résolues après vérification.</p><div style="max-height:65vh;overflow:auto">${rows}</div><div class="r"><button class="b2" onclick="closeM()">Fermer</button></div>`);
    } catch (e) { toast(e.message || 'Impossible de charger les alertes.', 'err'); }
  };

  window.msgAlertAction = async function (id, action) {
    try {
      const note = action === 'resolve' ? (window.prompt('Note de résolution (facultatif) :') || '') : '';
      await api('PATCH', '/messaging/system-alerts/' + Number(id), { action, note });
      toast(action === 'resolve' ? 'Alerte marquée comme résolue.' : 'Alerte prise en charge.');
      await msgAlertCenterOpen();
    } catch (e) { toast(e.message || 'Impossible de mettre à jour cette alerte.', 'err'); }
  };

  window.msgAlertConfigOpen = async function () {
    try {
      if (!canManageAlerts()) throw new Error('Permission de configuration des alertes requise.');
      state.alertConfig = await G('/messaging/alert-config');
      const rows = (state.alertConfig.configs || []).map((c, i) => {
        const kind = alertKinds.find(x => x[0] === c.alert_kind)?.[1] || c.alert_kind;
        const threshold = c.threshold_value == null ? 'Seuil non défini' : `${c.threshold_value} ${c.threshold_unit || ''}`;
        return `<div class="card" style="padding:10px;margin:8px 0"><div style="display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap"><div><b>${esc(kind)}</b><div class="muted" style="font-size:12px">${esc(threshold)} · ${(c.copy_user_ids || []).length} destinataire(s) · ${c.active ? 'Active' : 'Désactivée'}</div></div><button class="b2" onclick="msgAlertRuleEdit(${i})">Modifier</button></div></div>`;
      }).join('') || '<p class="muted">Aucune règle configurée. Créez une règle pour commencer.</p>';
      modal(`<h3>Alertes automatiques</h3><p class="muted">Choisissez l’événement, au moins un destinataire et, pour les écarts, un seuil positif avec son unité.</p><div id="alert-config-list">${rows}</div><div class="r" style="flex-wrap:wrap"><button class="b2" onclick="closeM()">Fermer</button><button class="b2" onclick="msgReportSchedulesOpen()">Programmer les rapports</button><button class="b1" onclick="msgAlertRuleNew()">Nouvelle règle</button></div>`);
    } catch (e) { toast(e.message || 'Impossible de charger les règles d’alerte.', 'err'); }
  };

  window.msgAlertRuleNew = function () { msgAlertRuleForm(null); };
  window.msgAlertRuleEdit = function (i) { msgAlertRuleForm(state.alertConfig?.configs?.[i] || null); };

  window.msgAlertRuleForm = function (cfg) {
    if (!canManageAlerts() || !state.alertConfig?.enabled) { toast('Configuration des alertes non autorisée.', 'err'); return; }
    const kind = cfg?.alert_kind || 'cash_variance';
    const kindOptions = alertKinds.map(([v, label]) => `<option value="${v}" ${v === kind ? 'selected' : ''}>${esc(label)}</option>`).join('');
    const users = state.alertConfig.users || [];
    const selected = new Set((cfg?.copy_user_ids || []).map(Number));
    const userOptions = users.map(u => `<label style="display:flex;gap:8px;align-items:center;padding:5px 0"><input type="checkbox" class="alert-recipient" value="${Number(u.id)}" ${selected.has(Number(u.id)) ? 'checked' : ''}><span>${esc(u.full_name || u.login)} <small class="muted">${esc(u.role_label || u.role || '')}</small></span></label>`).join('') || '<p class="muted">Aucun utilisateur actif disponible dans ce compte client.</p>';
    modal(`<h3>${cfg ? 'Modifier la règle' : 'Nouvelle règle d’alerte'}</h3>
      <label>Type d’alerte<select id="alert-kind">${kindOptions}</select></label>
      <div id="alert-threshold-fields" style="margin-top:10px">
        <label>Seuil obligatoire pour les écarts<input id="alert-threshold" type="number" min="0.001" step="0.001" value="${cfg?.threshold_value ?? ''}" placeholder="Ex. 25000"></label>
        <label>Unité du seuil<select id="alert-unit">
          <option value="XOF" ${cfg?.threshold_unit === 'XOF' ? 'selected' : ''}>XOF / FCFA</option>
          <option value="percent" ${cfg?.threshold_unit === 'percent' ? 'selected' : ''}>Pourcentage (%)</option>
          <option value="litres" ${cfg?.threshold_unit === 'litres' ? 'selected' : ''}>Litres</option>
          <option value="units" ${cfg?.threshold_unit === 'units' ? 'selected' : ''}>Unités / quantité</option>
          <option value="days" ${cfg?.threshold_unit === 'days' ? 'selected' : ''}>Jours</option>
          <option value="minutes" ${cfg?.threshold_unit === 'minutes' ? 'selected' : ''}>Minutes</option>
        </select></label>
        <label>Seuil complémentaire en pourcentage (facultatif)<input id="alert-threshold-percent" type="number" min="0.001" max="1000" step="0.001" value="${cfg?.threshold_percent ?? ''}" placeholder="Ex. 2.5"></label>
        <small class="muted">Caisse/facture : XOF ou %. Jaugeage : litres ou %. Stock : unités, litres ou %. Retard : minutes. Inactivité et licence : jours.</small>
      </div>
      <div style="margin-top:12px"><b>Destinataires obligatoires</b><div style="max-height:190px;overflow:auto;border:1px solid var(--bd);border-radius:8px;padding:8px;margin-top:6px">${userOptions}</div></div>
      <label style="display:flex;gap:8px;align-items:center;margin-top:10px"><input id="alert-notify-employee" type="checkbox" ${cfg?.notify_employee ? 'checked' : ''}> Ajouter aussi l’employé concerné (si applicable)</label>
      <label style="display:flex;gap:8px;align-items:center;margin-top:8px"><input id="alert-active" type="checkbox" ${cfg ? (cfg.active ? 'checked' : '') : 'checked'}> Règle active</label>
      <div class="r"><button class="b2" onclick="msgAlertConfigOpen()">Annuler</button><button id="alert-rule-save" class="b1">Enregistrer</button></div>`);
    const kindEl = document.getElementById('alert-kind');
    const thresholdFields = document.getElementById('alert-threshold-fields');
    const updateThresholdVisibility = () => {
      if (thresholdFields) thresholdFields.style.display = thresholdKinds.has(kindEl.value) ? 'block' : 'none';
      const defaults = { cash_variance: 'XOF', shift_close: 'XOF', counter_anomaly: 'litres', stock_anomaly: 'units', purchase_variance: 'XOF', late_arrival: 'minutes', account_inactive: 'days', license_expiring: 'days' };
      const allowed = { cash_variance: ['XOF','percent'], shift_close: ['XOF','percent'], purchase_variance: ['XOF','percent'], counter_anomaly: ['litres','percent'], stock_anomaly: ['units','litres','percent'], late_arrival: ['minutes'], account_inactive: ['days'], license_expiring: ['days'] };
      const unitEl = document.getElementById('alert-unit');
      if (unitEl && allowed[kindEl.value] && !allowed[kindEl.value].includes(unitEl.value)) unitEl.value = defaults[kindEl.value];
    };
    kindEl?.addEventListener('change', updateThresholdVisibility); updateThresholdVisibility();
    document.getElementById('alert-rule-save')?.addEventListener('click', async () => {
      const button = document.getElementById('alert-rule-save');
      const recipients = Array.from(document.querySelectorAll('.alert-recipient:checked')).map(el => Number(el.value)).filter(Number.isSafeInteger);
      const edge = thresholdKinds.has(kindEl.value);
      const rawThreshold = document.getElementById('alert-threshold')?.value;
      const threshold = rawThreshold === '' ? null : Number(rawThreshold);
      const unit = document.getElementById('alert-unit')?.value || null;
      const rawPercent = document.getElementById('alert-threshold-percent')?.value;
      const percent = rawPercent === '' ? null : Number(rawPercent);
      if (!recipients.length) { toast('Sélectionnez au moins un destinataire.', 'err'); return; }
      if (edge && (!(Number.isFinite(threshold) && threshold > 0) || !unit)) { toast('Un seuil positif et son unité sont obligatoires pour ce type d’alerte.', 'err'); return; }
      if (percent !== null && !(Number.isFinite(percent) && percent > 0 && percent <= 1000)) { toast('Le seuil en pourcentage doit être supérieur à 0 et inférieur ou égal à 1000.', 'err'); return; }
      button.disabled = true;
      try {
        await api('PUT', '/messaging/alert-config', {
          alert_kind: kindEl.value, station_id: null,
          notify_employee: !!document.getElementById('alert-notify-employee')?.checked,
          copy_user_ids: recipients, active: !!document.getElementById('alert-active')?.checked,
          threshold_value: edge ? threshold : null, threshold_unit: edge ? unit : null,
          threshold_percent: edge ? percent : null
        });
        toast('Règle d’alerte enregistrée.');
        await msgAlertConfigOpen();
      } catch (e) { toast(e.message || 'Échec de l’enregistrement.', 'err'); }
      finally { const current = document.getElementById('alert-rule-save'); if (current) current.disabled = false; }
    });
  };


  window.msgReportSchedulesOpen = async function () {
    try {
      if (!canManageAlerts()) throw new Error('Permission de configuration des alertes requise.');
      state.reportSchedules = await G('/messaging/report-schedules');
      const rows = (state.reportSchedules.schedules || []).map(s => {
        const when = s.frequency === 'once' ? `Une fois · ${esc(String(s.scheduled_date || '').slice(0,10))}` : s.frequency === 'weekly' ? `Chaque semaine · jour ${Number(s.day_of_week)}` : `Chaque mois · le ${Number(s.day_of_month)}`;
        const time = s.send_mode === 'random' ? `Aléatoire entre ${esc(String(s.random_start||'').slice(0,5))} et ${esc(String(s.random_end||'').slice(0,5))}` : `À ${esc(String(s.send_time||'').slice(0,5))}`;
        const channels=(s.delivery_channels||['app']).map(x=>x==='email'?'Email':'Centre de notifications').join(' + ');
        const reportNames={financial_summary:'Situation financière',operational_alerts:'Alertes opérationnelles',stock_summary:'Synthèse des stocks',hr_summary:'Synthèse RH'};
        const reportLabels=(s.report_types||[]).map(x=>reportNames[x]||x).join(', ');
        return `<div class="card" style="padding:10px;margin:8px 0"><b>${esc(s.title)}</b><div class="muted" style="font-size:12px">${when} · ${time} · ${(s.recipient_user_ids||[]).length} destinataire(s) · ${channels} · ${s.active?'Actif':'Suspendu'}</div><div class="muted" style="font-size:12px">Rapports : ${esc(reportLabels||'—')}</div><div class="muted" style="font-size:12px">Prochaine exécution : ${esc(new Date(s.next_run_at).toLocaleString('fr-FR'))}</div>${s.last_error?`<p class="warn">Dernière erreur : ${esc(s.last_error)}</p>`:''}<div class="r" style="margin-top:6px"><button class="b2" onclick="msgReportScheduleToggle(${Number(s.id)},${!s.active})">${s.active?'Suspendre':'Activer'}</button><button class="b2" onclick="msgReportScheduleDelete(${Number(s.id)})">Supprimer</button></div></div>`;
      }).join('') || '<p class="muted">Aucun rapport programmé.</p>';
      modal(`<h3>Rapports programmés</h3><p class="muted">Fuseau horaire : Africa/Bamako. Email prioritaire : aucun coût de canal ajouté par l’application, mais votre fournisseur email/SMTP peut appliquer ses propres limites ou tarifs. ${state.reportSchedules.email_configured?'Serveur email configuré.':'Email suspendu : le serveur SMTP doit être configuré avant programmation.'} WhatsApp : Pas dispo actuellement.</p><div style="max-height:55vh;overflow:auto">${rows}</div><div class="r" style="flex-wrap:wrap"><button class="b2" onclick="msgAlertConfigOpen()">Retour</button><button class="b1" onclick="msgReportScheduleNew()">Nouvelle programmation</button></div>`);
    } catch(e) { toast(e.message || 'Impossible de charger les programmations.', 'err'); }
  };
  window.msgReportScheduleNew = function () {
    if (!canManageAlerts() || !state.reportSchedules?.enabled) { toast('Programmation non autorisée.', 'err'); return; }
    const users = state.reportSchedules.users || [];
    const userOptions = users.map(u=>`<label style="display:flex;gap:8px;padding:4px 0"><input type="checkbox" class="report-recipient" value="${Number(u.id)}"><span>${esc(u.full_name||u.login)} <small class="muted">${esc(u.role_label||u.role||'')}</small></span></label>`).join('');
    modal(`<h3>Programmer un rapport</h3><label>Nom du rapport<input id="report-title" maxlength="120" value="Synthèse opérationnelle"></label>
      <label>Fréquence<select id="report-frequency"><option value="monthly" selected>Mensuelle</option><option value="weekly">Hebdomadaire</option><option value="once">À une date précise</option></select></label>
      <div id="report-weekday-wrap"><label>Jour de la semaine<select id="report-weekday"><option value="1">Lundi</option><option value="2">Mardi</option><option value="3">Mercredi</option><option value="4">Jeudi</option><option value="5">Vendredi</option><option value="6">Samedi</option><option value="0">Dimanche</option></select></label></div>
      <div id="report-monthday-wrap" style="display:none"><label>Jour du mois<select id="report-monthday">${Array.from({length:28},(_,i)=>`<option value="${i+1}" ${i===0?'selected':''}>${i+1}</option>`).join('')}</select></label></div>
      <div id="report-date-wrap" style="display:none"><label>Date d’envoi<input id="report-date" type="date" min="${new Date().toISOString().slice(0,10)}"></label></div>
      <label>Mode horaire<select id="report-mode"><option value="fixed">Heure fixe</option><option value="random">Heure aléatoire dans une plage</option></select></label>
      <div id="report-fixed-wrap"><label>Heure d’envoi<input id="report-time" type="time" value="08:00"></label></div>
      <div id="report-random-wrap" style="display:none"><label>Entre<input id="report-random-start" type="time" value="08:00"></label><label>Et<input id="report-random-end" type="time" value="10:00"></label><small class="muted">Une heure est tirée au sort dans cette plage pour chaque occurrence.</small></div>
      <b>Destinataires obligatoires</b><div style="max-height:150px;overflow:auto;border:1px solid var(--bd);border-radius:8px;padding:8px">${userOptions||'<p class="muted">Aucun utilisateur actif disponible.</p>'}</div>
      <b style="display:block;margin-top:10px">Rapports à envoyer</b><label>Choisissez un ou plusieurs rapports dans la liste (Ctrl/Cmd pour plusieurs)<select id="report-types" multiple size="4" style="min-height:100px"><option value="financial_summary" selected>Situation financière mensuelle (CA, dépenses et différence indicative)</option><option value="operational_alerts">Alertes opérationnelles</option><option value="stock_summary">Synthèse des stocks</option><option value="hr_summary">Synthèse du personnel (effectifs)</option></select></label>
      <b style="display:block;margin-top:10px">Rubriques des alertes (si sélectionnées)</b>${[['operations','Opérations et quarts'],['cash','Caisse et finances'],['stock','Stocks'],['staff','Personnel'],['payroll','Paie'],['incidents','Incidents'],['accounts','Comptes et contrats']].map(([v,l])=>`<label style="display:inline-flex;gap:5px;margin:5px 10px 5px 0"><input type="checkbox" class="report-category" value="${v}" checked>${l}</label>`).join('')}
      <b style="display:block;margin-top:10px">Canaux d’envoi</b><label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="report-channel-app" checked>Centre de notifications de l’application</label><label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="report-channel-email">Email (prioritaire)</label><label>Adresses email destinataires (séparées par des virgules)<textarea id="report-emails" rows="2" placeholder="direction@entreprise.com, comptable@entreprise.com"></textarea></label><label style="display:flex;gap:8px;align-items:center;opacity:.65"><input type="checkbox" disabled>WhatsApp — Pas dispo actuellement</label><small class="muted">WhatsApp pourra être activé ultérieurement après configuration du service et vérification d’un éventuel abonnement. L’option reste indisponible pour le moment.</small>
      <div class="r" style="margin-top:12px"><button class="b2" onclick="msgReportSchedulesOpen()">Annuler</button><button id="report-schedule-save" class="b1">Enregistrer</button></div>`);
    const freq=document.getElementById('report-frequency'), mode=document.getElementById('report-mode');
    const update=()=>{const f=freq.value;document.getElementById('report-weekday-wrap').style.display=f==='weekly'?'block':'none';document.getElementById('report-monthday-wrap').style.display=f==='monthly'?'block':'none';document.getElementById('report-date-wrap').style.display=f==='once'?'block':'none';const random=mode.value==='random';document.getElementById('report-fixed-wrap').style.display=random?'none':'block';document.getElementById('report-random-wrap').style.display=random?'block':'none';};
    freq.addEventListener('change',update);mode.addEventListener('change',update);update();
    document.getElementById('report-schedule-save').addEventListener('click',async()=>{
      const button=document.getElementById('report-schedule-save');
      const recipients=Array.from(document.querySelectorAll('.report-recipient:checked')).map(e=>Number(e.value));
      const categories=Array.from(document.querySelectorAll('.report-category:checked')).map(e=>e.value);
      const report_types=Array.from(document.getElementById('report-types').selectedOptions).map(e=>e.value);
      const delivery_channels=[]; if(document.getElementById('report-channel-app').checked)delivery_channels.push('app'); if(document.getElementById('report-channel-email').checked)delivery_channels.push('email');
      const email_recipients=document.getElementById('report-emails').value.split(/[;,\n]/).map(x=>x.trim()).filter(Boolean);
      const frequency=freq.value, send_mode=mode.value;
      if(!recipients.length){toast('Choisissez au moins un destinataire.','err');return;}
      if(!categories.length){toast('Choisissez au moins une rubrique.','err');return;}
      if(!report_types.length){toast('Choisissez au moins un rapport dans la liste.','err');return;}
      if(!delivery_channels.length){toast('Choisissez au moins un canal disponible.','err');return;}
      if(delivery_channels.includes('email')&&!state.reportSchedules.email_configured){toast('Email suspendu : le serveur SMTP doit être configuré avant programmation.','err');return;}
      if(delivery_channels.includes('email')&&!email_recipients.length){toast('Ajoutez au moins une adresse email.','err');return;}
      const data={title:document.getElementById('report-title').value,frequency,send_mode,recipient_user_ids:recipients,categories,report_types,delivery_channels,email_recipients,active:true};
      if(frequency==='once')data.scheduled_date=document.getElementById('report-date').value;
      if(frequency==='weekly')data.day_of_week=Number(document.getElementById('report-weekday').value);
      if(frequency==='monthly')data.day_of_month=Number(document.getElementById('report-monthday').value);
      if(send_mode==='fixed')data.send_time=document.getElementById('report-time').value;
      else {data.random_start=document.getElementById('report-random-start').value;data.random_end=document.getElementById('report-random-end').value;}
      if(!data.title.trim() || (frequency==='once'&&!data.scheduled_date) || (send_mode==='fixed'&&!data.send_time) || (send_mode==='random'&&(!data.random_start||!data.random_end||data.random_start>=data.random_end))){toast('Complétez les champs obligatoires et vérifiez la date/plage horaire.','err');return;}
      button.disabled=true;
      try{await api('POST','/messaging/report-schedules',data);toast('Rapport programmé.');await msgReportSchedulesOpen();}
      catch(e){toast(e.message||'Échec de la programmation.','err');}
      finally{const b=document.getElementById('report-schedule-save');if(b)b.disabled=false;}
    });
  };
  window.msgReportScheduleToggle = async function(id,active){try{await api('PATCH','/messaging/report-schedules/'+Number(id),{active:!!active});await msgReportSchedulesOpen();}catch(e){toast(e.message||'Impossible de modifier cette programmation.','err');}};
  window.msgReportScheduleDelete = async function(id){if(!window.confirm('Supprimer cette programmation ?'))return;try{await api('DELETE','/messaging/report-schedules/'+Number(id));await msgReportSchedulesOpen();}catch(e){toast(e.message||'Impossible de supprimer cette programmation.','err');}};

  VM.msg = async function () {
    try { await loadStatus(); } catch (e) {
      return '<p class="warn">Impossible de charger la messagerie : ' + esc((e && e.message) || e) +
        '</p><div class="bar"><button class="b2" onclick="go(\'alertcfg\')">Configurer les alertes</button>' +
        '<button class="b2" onclick="go(\'alert\')">Centre d\'alertes</button></div>';
    }
    if (!state.status?.enabled) {
      const feat = state.status?.features?.messaging || {};
      const alertAccess = canManageAlerts() && state.status?.features?.auto_alerts?.enabled;
      if (alertAccess) return `${featureBox(feat)}<div class="bar" style="justify-content:center;margin:12px;gap:8px;flex-wrap:wrap"><button class="b1" onclick="msgAlertConfigOpen()">Configurer les alertes automatiques</button><button class="b2" onclick="msgAlertCenterOpen()">Centre des alertes</button></div>`;
      return featureBox(feat) || '<p class="warn">Messagerie indisponible.</p>';
    }
    await loadConversations();
    await loadPresence();
    state.current = null; state.q = ''; state.lastSig = null;
    startPolling();
    return renderList();
  };

  window.openConv = async function (id) {
    id = Number(id);
    try {
      const thread = await renderThread(id);
      const th = document.getElementById('msg-thread');
      if (!th) return;
      th.innerHTML = thread;
      document.getElementById('wa-app')?.classList.add('wa-open');
      renderPendingFiles();
      refreshHeaderPresence();
      const box = document.getElementById('msg-bubbles');
      if (box) box.scrollTop = box.scrollHeight;
      const c = state.conversations.find(x => Number(x.id) === id);
      if (c) c.unread = 0;
      refreshRows();
      if (window.innerWidth > 760) document.getElementById('msg-input')?.focus();
    } catch (e) { toast(e.message || 'Conversation inaccessible', 'err'); }
  };

  window.msgBack = async function () {
    state.current = null; state.lastSig = null;
    document.getElementById('wa-app')?.classList.remove('wa-open');
    const th = document.getElementById('msg-thread');
    if (th) th.innerHTML = placeholderHtml();
    try { await loadConversations(); } catch (_) { /* liste indisponible */ }
    refreshRows();
  };

  window.msgSend = async function () {
    const input = document.getElementById('msg-input');
    if (!input || !input.value.trim() || !state.current) return;
    const body = input.value.trim(), convId = state.current;
    input.value = '';
    try {
      await Po('/messaging/conversations/' + convId + '/messages', { body });
      await refreshBubbles(convId, true);
      loadConversations().then(refreshRows).catch(() => { /* rafraîchi au prochain cycle */ });
      input.focus();
    } catch (e) { input.value = body; toast(e.message || 'Erreur d\'envoi', 'err'); }
  };

  window.msgDelete = async function (id) {
    id = Number(id);
    const convId = state.current;
    if (!id || !convId) return;
    if (!window.confirm('Supprimer ce message ? Il disparaîtra aussi pour les autres participants.')) return;
    try {
      await api('DELETE', '/messaging/messages/' + id);
      await refreshBubbles(convId, false);
      loadConversations().then(refreshRows).catch(() => { /* rafraîchi au prochain cycle */ });
      toast('Message supprimé.', 'success');
    } catch (e) { toast(e.message || 'Impossible de supprimer ce message.', 'err'); }
  };

  window.msgSupportOpen = safe(async function () {
    if (!ME?.is_global) return toast('Réservé au Super Admin', 'err');
    const clients = await G('/messaging/support/clients');
    if (!clients.length) return toast('Aucun client disponible pour le support.', 'info');
    form('Ouvrir un support client', [
      ['client_id', 'Client', 's', clients.map(c => [String(c.id), c.name + (c.code ? ' · ' + c.code : '')])],
      ['subject', 'Sujet du support']
    ], { subject: 'Support Manager PRO' }, async d => {
      const conv = await Po('/messaging/support/open', { client_id: Number(d.client_id), subject: d.subject || undefined });
      closeM(); go('msg'); setTimeout(() => openConv(conv.id), 300);
    });
  });

  window.msgSupportToAdmin = safe(async function () {
    if (ME?.is_global) return toast('Cette action est réservée aux comptes clients.', 'err');
    form('Contacter le Super Admin', [
      ['subject', 'Sujet'],
      ['body', 'Message', 'textarea']
    ], { subject: 'Demande de support' }, async d => {
      if (!String(d.body || '').trim()) return toast('Veuillez saisir votre message.', 'err');
      const conv = await Po('/messaging/support/to-admin', { subject: d.subject || undefined, body: d.body });
      closeM(); go('msg'); setTimeout(() => openConv(conv.id), 300);
    });
  });

  window.msgNewDirect = function () {
    // Recherche et sélection par nom, identifiant ou poste plutôt que de demander un ID opaque.
    modal(`<h3>Nouveau message</h3>
      <label for="msg-recipient-search">Rechercher un employé</label>
      <input id="msg-recipient-search" type="search" autocomplete="off" placeholder="Nom, prénom, matricule, poste ou identifiant…" style="width:100%">
      <div id="msg-recipient-results" role="listbox" aria-label="Résultats des employés" style="max-height:28vh;overflow:auto;margin:8px 0"></div>
      <p id="msg-recipient-selected" class="muted" aria-live="polite">Aucun destinataire sélectionné.</p>
      <label for="msg-direct-body">Message</label><textarea id="msg-direct-body" rows="4" style="width:100%" placeholder="Votre message…"></textarea>
      <div class="r"><button class="b2" onclick="closeM()">Annuler</button><button id="msg-direct-send" class="b1" disabled>Ouvrir la conversation</button></div>`);
    const search = document.getElementById('msg-recipient-search');
    const results = document.getElementById('msg-recipient-results');
    const selectedLabel = document.getElementById('msg-recipient-selected');
    const send = document.getElementById('msg-direct-send');
    let selected = null;
    let requestId = 0;
    const selectUser = (u) => {
      selected = u;
      selectedLabel.textContent = `Destinataire : ${u.full_name || u.login} · ${u.login} · ${u.role_label || u.role || 'Employé'}`;
      send.disabled = false;
      results.querySelectorAll('[aria-selected="true"]').forEach(el => el.setAttribute('aria-selected', 'false'));
    };
    const searchUsers = async () => {
      const thisRequest = ++requestId;
      const q = search.value.trim();
      results.innerHTML = '<p class="muted">Recherche…</p>';
      try {
        const users = await G('/messaging/users?q=' + encodeURIComponent(q));
        if (thisRequest !== requestId) return;
        state.users = users;
        results.replaceChildren();
        if (!users.length) {
          results.innerHTML = '<p class="muted">Aucun employé trouvé dans votre compte client.</p>';
          return;
        }
        users.forEach(u => {
          const b = document.createElement('button');
          b.type = 'button'; b.className = 'b2'; b.style.cssText = 'display:block;width:100%;text-align:left;margin:4px 0;white-space:normal';
          b.setAttribute('role', 'option'); b.setAttribute('aria-selected', String(selected?.id === u.id));
          const name = document.createElement('strong'); name.textContent = u.full_name || u.login || ('Employé #' + u.id);
          const detail = document.createElement('small'); detail.className = 'muted'; detail.textContent = ` · ${u.matricule ? 'Mat. ' + u.matricule + ' · ' : ''}${u.job_title || u.role_label || u.role || ''} · ${u.login || ''}`;
          b.append(name, detail);
          b.addEventListener('click', () => selectUser(u));
          results.appendChild(b);
        });
      } catch (e) {
        if (thisRequest !== requestId) return;
        results.innerHTML = '<p class="warn">Impossible de rechercher les employés. Vérifiez votre connexion puis réessayez.</p>';
      }
    };
    let searchTimer = null;
    search.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(searchUsers, 200); });
    send.addEventListener('click', async () => {
      if (!selected) return toast('Sélectionnez un destinataire.', 'err');
      send.disabled = true;
      try {
        const conv = await Po('/messaging/conversations/direct', { user_id: Number(selected.id) });
        const body = document.getElementById('msg-direct-body').value.trim();
        if (body) await Po('/messaging/conversations/' + conv.id + '/messages', { body });
        closeM(); go('msg'); setTimeout(() => openConv(conv.id), 300);
      } catch (e) {
        send.disabled = false;
        toast(e.message || 'Impossible de créer la conversation.', 'err');
      }
    });
    search.focus();
    searchUsers(); // affiche d'emblée les employés du compte client ; la saisie filtre ensuite la liste
  };

  window.msgNewGroup = function () {
    if (!state.status?.features?.groups?.enabled) {
      toast('Groupes non autorisés', 'err');
      return;
    }
    form('Nouveau groupe', [
      ['title', 'Nom du groupe'],
      ['user_ids', 'IDs membres (séparés par virgule)']
    ], {}, async d => {
      const ids = String(d.user_ids || '').split(/[,;\s]+/).map(Number).filter(Boolean);
      await Po('/messaging/conversations/group', { title: d.title, user_ids: ids });
      closeM();
      go('msg');
    });
  };

  window.msgBroadcast = function () {
    if (!state.status?.features?.broadcast?.enabled) {
      toast('Message à tous non autorisé', 'err');
      return;
    }
    form('Message à tous les employés', [
      ['title', 'Titre (optionnel)'],
      ['body', 'Message', 'textarea']
    ], {}, async d => {
      const r = await Po('/messaging/broadcast', { title: d.title || undefined, body: d.body });
      toast('Envoyé à ' + r.recipients + ' employé(s)');
      closeM();
      go('msg');
    });
  };

  window.msgAttach = function () {
    if (!state.status?.features?.attachments?.enabled) {
      toast('Pièces jointes non autorisées', 'err');
      return;
    }
    document.getElementById('msg-file-input')?.click();
  };

  window.msgFilesSelected = function (fileList) {
    const allowed = new Set(['application/pdf','image/jpeg','image/png','image/gif','image/webp','text/plain','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);
    const incoming = Array.from(fileList || []);
    for (const file of incoming) {
      if (file.size > 10 * 1024 * 1024) { toast(file.name + ' dépasse 10 Mo.', 'err'); continue; }
      if (file.type && !allowed.has(file.type.toLowerCase())) { toast('Type de fichier refusé : ' + file.name, 'err'); continue; }
      if (state.pendingFiles.length >= 10) { toast('Maximum 10 fichiers par envoi.', 'err'); break; }
      state.pendingFiles.push(file);
    }
    const input = document.getElementById('msg-file-input'); if (input) input.value = '';
    renderPendingFiles();
  };

  function renderPendingFiles() {
    const box = document.getElementById('msg-pending-files'); if (!box) return;
    box.innerHTML = state.pendingFiles.length ? '<div style="margin-top:8px"><b>Fichiers à envoyer</b><ul style="margin:4px 0;padding-left:20px">' + state.pendingFiles.map((f,i) => `<li>${esc(f.name)} (${(f.size/1024/1024).toFixed(2)} Mo) <button class="b2" type="button" onclick="msgRemovePendingFile(${i})">Retirer</button></li>`).join('') + '</ul><button class="b1" type="button" onclick="msgSendAttachments()">Envoyer les fichiers</button></div>' : '';
  }

  window.msgRemovePendingFile = function (index) { state.pendingFiles.splice(index, 1); renderPendingFiles(); };

  window.msgSendAttachments = async function () {
    if (!state.current || !state.pendingFiles.length) return;
    const convId = state.current, files = state.pendingFiles.slice();
    try {
      for (const file of files) {
        const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
        await Po('/messaging/conversations/' + convId + '/attachments', { file_name: file.name, data_url: dataUrl, message: document.getElementById('msg-input')?.value.trim() || undefined });
        state.pendingFiles.shift(); renderPendingFiles();
      }
      const input = document.getElementById('msg-input'); if (input) input.value = '';
      toast('Pièce(s) jointe(s) envoyée(s).', 'success');
      await openConv(convId);
    } catch (e) { toast(e.message || 'Échec de l’envoi de la pièce jointe.', 'err'); }
  };

  window.msgDownloadAttachment = async function (id, fileName) {
    try {
      const headers = { ...(typeof TK !== 'undefined' && TK ? { Authorization: 'Bearer ' + TK } : {}), ...(typeof SID !== 'undefined' && SID ? { 'X-Station-Id': SID } : {}) };
      const response = await fetch('/api/messaging/attachments/' + encodeURIComponent(id) + '/download', { headers });
      if (!response.ok) { let msg = 'Téléchargement refusé'; try { const j = await response.json(); msg = j.error || msg; } catch {} throw new Error(msg); }
      const blob = await response.blob(), url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = fileName || 'piece-jointe'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch (e) { toast(e.message || 'Échec du téléchargement.', 'err'); }
  };

  // Badge non-lus dans la navigation (si shell le permet)
  window.msgRefreshBadge = async function () {
    try {
      const s = await G('/messaging/status');
      const n = s.unread || 0;
      const el = document.getElementById('msg-badge');
      if (el) {
        el.textContent = n > 0 ? n : '';
        el.hidden = n === 0;
      }
    } catch {}
  };

  // Helper global pour les autres modules : envoyer un document
  window.sendDocByMessaging = async function (userId, filePath, fileName, mime, message) {
    const s = await loadStatus();
    if (!s.features?.attachments?.enabled) {
      toast('Pièces jointes non activées pour votre compte', 'err');
      return null;
    }
    return Po('/messaging/send-document', {
      user_id: userId,
      file_path: filePath,
      file_name: fileName,
      mime_type: mime,
      message: message
    });
  };
})();
