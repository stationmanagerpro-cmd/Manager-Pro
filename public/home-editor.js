/* home-editor.js — éditeur visuel de la page d'accueil (Super Admin).
   Gauche : ajouter (sections, éléments) · calques · bibliothèque d'images illimitée.
   Centre : page en direct (clic = sélection, double-clic = édition du texte), aperçu ordinateur / tablette / mobile.
   Droite : propriétés de l'élément sélectionné (contenu, lien, disposition, taille, position, espacement, typographie,
   remplissage, bordure, effets). En mode Tablette / Mobile, chaque réglage est une surcharge propre à cet appareil. */
(function () {
  'use strict';
  const H = window.HomeCore;
  if (!H) return;
  const E = H.esc;
  const q = (s, r) => (r || document).querySelector(s);
  const qa = (s, r) => Array.from((r || document).querySelectorAll(s));
  const DEV = { desktop: { w: '100%', layer: 's', label: 'Ordinateur', note: '' }, tablet: { w: '820px', layer: 'st', label: 'Tablette', note: 'jusqu’à 1000 px' }, mobile: { w: '390px', layer: 'sm', label: 'Mobile', note: 'jusqu’à 600 px' } };
  const TLABEL = { section: 'Section', box: 'Boîte', text: 'Texte', button: 'Bouton', image: 'Image', icon: 'Icône', mockup: 'Maquette' };
  const TICON = { section: '▭', box: '▢', text: 'T', button: '⬭', image: '🖼', icon: '☺', mockup: '▥' };
  const SEC_KEYS = ['Accueil', 'Fonctionnalités', 'Nos solutions'];
  let S = null;            // état de l'éditeur
  const blobs = {}, loading = {};

  /* ------------------------------------------------------------ utilitaires */
  const toastMsg = (m, k) => { try { toast(m, k || 'success'); } catch (_) { /* hors application */ } };
  const errText = e => { try { return errMsg(e); } catch (_) { return (e && e.message) || 'Erreur'; } };
  const cur = () => (S && S.sel ? (H.find(S.doc, S.sel) || {}).node || null : null);
  const layerKey = () => DEV[S.dev].layer;
  function effOf(n, k) {
    const s = n.s || {};
    if (S.dev === 'desktop') return s[k];
    const t = Object.assign({}, s, n.st || {});
    return S.dev === 'tablet' ? t[k] : Object.assign({}, t, n.sm || {})[k];
  }
  const ownOf = (n, k) => Object.prototype.hasOwnProperty.call(n[layerKey()] || {}, k);
  function setStyle(n, k, v) {
    const lk = layerKey(); if (!n[lk]) n[lk] = {};
    if (v === undefined || v === null || v === '') delete n[lk][k]; else n[lk][k] = v;
  }
  const tokHex = c => (c && c[0] === '@' ? (S.doc.theme[c.slice(1)] || H.TOKENS[c.slice(1)] || '#000000') : c);
  const pickHex = c => { const h = tokHex(c); return /^#[0-9a-f]{6}/i.test(h || '') ? h.slice(0, 7) : '#000000'; };
  const nodeLabel = n => {
    if (n.p && n.p.nm) return n.p.nm;
    if (n.t === 'text') return String(n.p.tx || 'Texte').replace(/\{\{|\}\}/g, '').replace(/\s+/g, ' ').slice(0, 30) || 'Texte';
    if (n.t === 'button') return 'Bouton : ' + String(n.p.lb || '').slice(0, 24);
    if (n.t === 'icon') return 'Icône ' + (n.p.gl || '');
    return TLABEL[n.t] || n.t;
  };
  const countNodes = () => { let c = 0; H.walk(S.doc.nodes, () => { c++; }); return c; };
  const fileBase = f => String(f.name || 'image').replace(/\.[a-z0-9]+$/i, '').slice(0, 60);

  /* ------------------------------------------------------------ images */
  function imgUrl(id) {
    if (H.BUILTIN_IMAGES[id]) return H.BUILTIN_IMAGES[id];
    if (blobs[id]) return blobs[id];
    if (!loading[id] && S && S.images[id]) {
      loading[id] = true;
      fetch('/api/admin/home/image/' + id + '?t=' + Date.now(), { headers: { Authorization: 'Bearer ' + TK } })
        .then(r => (r.ok ? r.blob() : null)).then(b => { loading[id] = false; if (b) { blobs[id] = URL.createObjectURL(b); schedulePaint(); } }).catch(() => { loading[id] = false; });
    }
    return '';
  }
  let paintT = null;
  function schedulePaint() { clearTimeout(paintT); paintT = setTimeout(() => { if (!S) return; paint(); if (S.tab === 'images') renderLeft(); const m = q('#hbe-pick'); if (m) fillPicker(); }, 90); }
  const readFile = f => new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => ko(new Error('Lecture du fichier impossible')); r.readAsDataURL(f); });
  const loadImage = u => new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ko(new Error('Image illisible')); i.src = u; });
  async function prepImage(f) {
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) throw new Error(f.name + ' : format non pris en charge (PNG, JPEG ou WebP)');
    const url = await readFile(f);
    if (f.size <= 1.8 * 1024 * 1024) return url;
    const img = await loadImage(url);        // trop lourde : réduite automatiquement pour respecter la limite de 2 Mo
    let max = 2400, q = 0.88;
    for (let i = 0; i < 8; i++) {
      const k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
      const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
      const out = c.toDataURL('image/jpeg', q);
      if (out.length * 0.75 < 1.85 * 1024 * 1024) return out;
      max = Math.round(max * 0.8); q = Math.max(0.55, q - 0.06);
    }
    throw new Error(f.name + ' : image trop volumineuse');
  }
  async function uploadFiles(list) {
    const files = Array.from(list || []); if (!files.length) return [];
    const ids = []; let n = 0;
    for (const f of files) {
      n++; setStatus('Téléversement ' + n + '/' + files.length + '…');
      try {
        const data_url = await prepImage(f);
        const r = await Pu('/admin/home/media', { data_url, name: fileBase(f) });
        S.images[r.id] = { name: fileBase(f) }; ids.push(r.id);
      } catch (e) { toastMsg(errText(e), 'error'); }
    }
    setStatus(); if (S.tab === 'images') renderLeft(); const m = q('#hbe-pick'); if (m) fillPicker();
    return ids;
  }

  /* ------------------------------------------------------------ historique */
  function pushUndo() { S.undo.push(JSON.stringify(S.doc)); if (S.undo.length > 80) S.undo.shift(); S.redo = []; }
  function mark(key) {
    const now = Date.now();
    if (!S.last || S.last.key !== key || now - S.last.t > 900) pushUndo();
    S.last = { key, t: now }; S.dirty = true; S.unpub = true; updateTop(); scheduleSave();
  }
  function snap() { pushUndo(); S.last = null; S.dirty = true; S.unpub = true; updateTop(); scheduleSave(); }
  function restore(json) {
    S.doc = JSON.parse(json); if (S.sel && !H.find(S.doc, S.sel)) S.sel = null;
    S.dirty = true; S.unpub = true; paint(); renderLeft(); renderRight(); updateTop(); scheduleSave();
  }
  const undo = () => { if (!S.undo.length) return; S.redo.push(JSON.stringify(S.doc)); restore(S.undo.pop()); };
  const redo = () => { if (!S.redo.length) return; S.undo.push(JSON.stringify(S.doc)); restore(S.redo.pop()); };

  /* ------------------------------------------------------------ enregistrement */
  let saveT = null;
  function scheduleSave() { clearTimeout(saveT); if (S && S.auto) saveT = setTimeout(() => { save(true); }, 3500); }
  async function save(silent) {
    if (!S) return false;
    clearTimeout(saveT);
    try {
      H.sanitize(S.doc);
      await Pu('/admin/home', { content: S.doc });
      S.dirty = false; updateTop(); if (!silent) toastMsg('Brouillon enregistré');
      return true;
    } catch (e) { setStatus('⚠ Non enregistré : ' + errText(e)); if (!silent) toastMsg(errText(e), 'error'); return false; }
  }
  async function publish() {
    if (!(await save())) return;
    const warn = publishWarn();
    if (!confirm('Publier cette version sur la page d’accueil publique ?' + warn)) return;
    try { await Po('/admin/home/publish', {}); S.unpub = false; updateTop(); toastMsg('Page d’accueil publiée'); } catch (e) { toastMsg(errText(e), 'error'); }
  }
  async function discard() {
    if (!confirm('Abandonner toutes les modifications non publiées ? Le brouillon reviendra à la page publiée.')) return;
    try { await Po('/admin/home/discard', {}); await reload(); toastMsg('Modifications abandonnées'); } catch (e) { toastMsg(errText(e), 'error'); }
  }
  async function resetTemplate() {
    if (!confirm('Revenir au modèle d’origine (copie du fichier HTML fourni) ? Votre brouillon actuel sera remplacé ; la page publiée ne change pas tant que vous ne publiez pas. Vos images restent dans la bibliothèque.')) return;
    try { await Po('/admin/home/reset', {}); await reload(); toastMsg('Modèle d’origine restauré dans le brouillon'); } catch (e) { toastMsg(errText(e), 'error'); }
  }
  async function reload() {
    const d = await G('/admin/home');
    S.doc = d.draft; S.images = d.images || {}; S.published_at = d.published_at; S.unpub = !!d.dirty; S.dirty = false; S.undo = []; S.redo = []; S.sel = null;
    paint(); renderLeft(); renderRight(); updateTop();
  }
  function exportJson() {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(S.doc, null, 1)], { type: 'application/json' }));
    a.download = 'accueil-station-manager-pro.json'; document.body.appendChild(a); a.click(); a.remove();
  }
  function importJson() {
    const i = document.createElement('input'); i.type = 'file'; i.accept = 'application/json,.json';
    i.onchange = async () => {
      try { const doc = H.sanitize(JSON.parse(await i.files[0].text())); snap(); S.doc = doc; S.sel = null; paint(); renderLeft(); renderRight(); toastMsg('Page importée dans le brouillon'); } catch (e) { toastMsg('Fichier non valide : ' + errText(e), 'error'); }
    };
    i.click();
  }

  /* ------------------------------------------------------------ interface : squelette */
  function build() {
    const el = document.createElement('div'); el.id = 'hbe'; el.className = 'hbe';
    el.innerHTML = `<header class="hbe-top">
        <button type="button" class="hbe-btn" data-top="exit" title="Quitter l’éditeur">← Quitter</button>
        <div class="hbe-title"><b>Accueil publique</b><small id="hbe-state"></small></div>
        <div class="hbe-seg hbe-dev" role="tablist" aria-label="Appareil">${Object.keys(DEV).map(k => `<button type="button" data-dev="${k}" role="tab">${DEV[k].label}</button>`).join('')}</div>
        <div class="hbe-spacer"></div>
        <button type="button" class="hbe-btn hbe-narrow" data-top="left">Éléments</button><button type="button" class="hbe-btn hbe-narrow" data-top="right">Propriétés</button>
        <button type="button" class="hbe-btn hbe-warn" id="hbe-warn" data-top="audit" hidden></button>
        <button type="button" class="hbe-ico" data-top="undo" title="Annuler (Ctrl+Z)">↶</button><button type="button" class="hbe-ico" data-top="redo" title="Rétablir (Ctrl+Y)">↷</button>
        <button type="button" class="hbe-btn" data-top="preview">👁 Aperçu</button>
        <button type="button" class="hbe-btn" data-top="save">Enregistrer</button>
        <button type="button" class="hbe-btn hbe-pub" data-top="publish">Publier</button>
        <div class="hbe-more"><button type="button" class="hbe-ico" data-top="more" title="Plus d’actions">⋯</button>
          <div class="hbe-menu" id="hbe-menu" hidden>
            <label class="hbe-chk"><input type="checkbox" id="hbe-auto" checked> Enregistrement automatique du brouillon</label>
            <button type="button" data-top="discard">Abandonner les modifications non publiées</button>
            <button type="button" data-top="reset">Revenir au modèle d’origine</button>
            <button type="button" data-top="export">Exporter la page (JSON)</button>
            <button type="button" data-top="import">Importer une page (JSON)</button>
          </div></div>
      </header>
      <aside class="hbe-left" id="hbe-left"></aside>
      <main class="hbe-stage" id="hbe-stage"><div class="hbe-framebox" id="hbe-framebox"></div><nav class="hbe-crumbs" id="hbe-crumbs" aria-label="Chemin de l’élément"></nav></main>
      <aside class="hbe-right" id="hbe-right"></aside>`;
    document.body.appendChild(el);
    el.addEventListener('click', onTop);
    el.addEventListener('change', e => { if (e.target.id === 'hbe-auto') { S.auto = e.target.checked; if (S.auto) scheduleSave(); } });
    const left = q('#hbe-left'), right = q('#hbe-right');
    left.addEventListener('click', onLeftClick); left.addEventListener('input', onLeftInput); left.addEventListener('change', onLeftChange);
    left.addEventListener('dragstart', onDragStart); left.addEventListener('dragover', onDragOver); left.addEventListener('dragleave', onDragLeave); left.addEventListener('drop', onDrop); left.addEventListener('dragend', clearDrop);
    right.addEventListener('input', onRightInput); right.addEventListener('change', onRightChange); right.addEventListener('click', onRightClick);
    right.addEventListener('toggle', e => { const g = e.target && e.target.dataset && e.target.dataset.g; if (g) S.open[g] = e.target.open; }, true);
    q('#hbe-crumbs').addEventListener('click', e => { const b = e.target.closest('[data-id]'); if (b) select(b.dataset.id === '__page' ? null : b.dataset.id, true); });
    document.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', onUnload);
    return el;
  }
  function onUnload(e) { if (S && S.dirty) { e.preventDefault(); e.returnValue = ''; } }

  /* ------------------------------------------------------------ cadre (iframe) */
  const FRAME_CSS = 'html,body{margin:0;padding:0;background:#fff}#hb-hov,#hb-sel{position:absolute;pointer-events:none;display:none;z-index:2147483000;box-sizing:border-box}' +
    '#hb-hov{outline:1.5px solid #8b5cf6;outline-offset:-1px;background:rgba(139,92,246,.06)}#hb-sel{outline:2px solid #6d28d9;outline-offset:-1px}' +
    '#hb-bar{position:absolute;display:none;z-index:2147483001;background:#6d28d9;color:#fff;font:600 11px/1 system-ui,sans-serif;border-radius:6px 6px 0 0;white-space:nowrap;align-items:center;gap:2px;padding:4px 6px}' +
    '#hb-bar button{all:unset;cursor:pointer;padding:3px 6px;border-radius:4px;font-size:12px}#hb-bar button:hover{background:rgba(255,255,255,.22)}#hb-bar span{margin-right:6px;max-width:190px;overflow:hidden;text-overflow:ellipsis}' +
    '#hb-add{position:absolute;display:none;z-index:2147483001;transform:translate(-50%,-50%);background:#6d28d9;color:#fff;border-radius:8px;padding:7px 14px;font:700 12px system-ui,sans-serif;cursor:pointer;box-shadow:0 6px 18px #6d28d955}' +
    '[contenteditable=true],[contenteditable=plaintext-only]{outline:2px solid #6d28d9!important;cursor:text;min-width:20px}a{cursor:default}';
  function buildFrame() {
    const box = q('#hbe-framebox'); box.innerHTML = '';
    const f = document.createElement('iframe'); f.className = 'hbe-frame'; f.title = 'Aperçu de la page d’accueil'; f.setAttribute('sandbox', 'allow-same-origin');
    f.srcdoc = '<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + FRAME_CSS + '</style><style id="hb-gen"></style></head><body><div id="hb-root"></div><div id="hb-hov"></div><div id="hb-sel"></div>' +
      '<div id="hb-bar"><span id="hb-lbl"></span><button data-a="parent" title="Sélectionner le parent">↖</button><button data-a="up" title="Monter">↑</button><button data-a="down" title="Descendre">↓</button><button data-a="dup" title="Dupliquer">⧉</button><button data-a="del" title="Supprimer">🗑</button></div>' +
      '<div id="hb-add" data-a="addsec">＋ Section</div></body></html>';
    box.appendChild(f); S.frame = f;
    f.addEventListener('load', () => {
      S.fdoc = f.contentDocument; S.fwin = f.contentWindow; S.rootEl = S.fdoc.getElementById('hb-root'); S.genEl = S.fdoc.getElementById('hb-gen');
      const d = S.fdoc;
      d.addEventListener('click', onFrameClick, true); d.addEventListener('dblclick', onFrameDbl, true);
      d.addEventListener('mouseover', onFrameOver); d.addEventListener('mouseleave', () => { const h = d.getElementById('hb-hov'); if (h) h.style.display = 'none'; });
      d.addEventListener('keydown', onKey); S.fwin.addEventListener('scroll', overlay); S.fwin.addEventListener('resize', overlay);
      paint();
    });
  }
  function setDevice(dev) {
    S.dev = dev; q('#hbe-framebox').style.width = DEV[dev].w;
    qa('[data-dev]').forEach(b => b.classList.toggle('on', b.dataset.dev === dev));
    renderRight(); setTimeout(overlay, 60);
  }
  function paint() {
    if (!S || !S.rootEl) return;
    const r = H.render(S.doc, { edit: !S.prev, imgUrl });
    S.rootEl.innerHTML = r.html; S.genEl.textContent = r.css;
    const t = (S.doc.meta && S.doc.meta.title) || ''; if (t) S.fdoc.title = t;
    syncBurger(); overlay(); crumbs(); renderAud();
  }
  /* Menu burger : tant que la boîte du menu (ou un de ses éléments) est sélectionnée, son panneau reste ouvert pour pouvoir l'éditer. */
  function syncBurger() {
    if (!S || !S.fdoc) return;
    const el = !S.prev && S.sel ? S.fdoc.querySelector('[data-nid="' + S.sel + '"]') : null;
    qa('.hb-host', S.fdoc).forEach(h => h.classList.toggle('hb-open', !!el && (h === el || h.contains(el))));
  }

  /* ------------------------------------------------------------ alerte de lisibilité */
  const DEVICES = ['desktop', 'tablet', 'mobile'];
  const fr = x => String(x).replace('.', ',');
  const tokName = t => (H.TOKEN_LABEL[t] || t);
  const auditAll = () => { const out = []; DEVICES.forEach(d => { try { H.auditContrast(S.doc, d).issues.forEach(i => out.push(i)); } catch (_) { /* document en cours d’édition */ } }); return out; };
  function publishWarn() {
    let all = []; try { all = auditAll(); } catch (_) { /* ignoré */ }
    const bad = all.filter(i => i.level === 'bad'), ids = new Set(bad.map(i => i.id)).size, low = new Set(all.filter(i => i.level === 'low').map(i => i.id)).size;
    if (!bad.length && !low) return '';
    return '\n\n' + (bad.length ? '⚠ ' + ids + ' élément' + (ids > 1 ? 's' : '') + ' avec des textes illisibles (contraste inférieur à 3:1) sur au moins un appareil.' : '') +
      (low ? (bad.length ? '\n' : '') + 'ⓘ ' + low + ' élément' + (low > 1 ? 's' : '') + ' à vérifier (peu lisibles).' : '') + '\nCliquez sur « Annuler », puis sur le bouton d’alerte en haut pour les voir.';
  }
  function showAudit() {
    select(null); const r = q('#hbe-right'); r.classList.add('open'); r.scrollTop = 0;
  }
  function issueHtml(i, full) {
    const n = (H.find(S.doc, i.id) || {}).node, name = n ? nodeLabel(n) : i.id;
    const why = i.fgTok ? ' Cette couleur est celle du thème « ' + E(tokName(i.fgTok)) + ' » (modifiable dans les couleurs du thème).' : '';
    const head = (i.level === 'bad' ? '⚠ Texte illisible' : 'ⓘ Texte peu lisible') + (i.part === 'accent' ? ' (mots accentués)' : '');
    return '<div class="hbe-wbox ' + i.level + '"><b>' + head + (full ? ' · ' + E(name) : '') + '</b>' +
      '<p>Contraste <b>' + fr(i.ratio) + ':1</b> (minimum ' + fr(i.need) + ':1). Texte <i class="hbe-sw" style="background:' + i.fgHex + '"></i>' + i.fgHex + ' sur fond <i class="hbe-sw" style="background:' + i.bgHex + '"></i>' + i.bgHex + '.' +
      (i.est ? ' Estimation : l’image de fond n’est pas mesurée.' : '') + why + '</p>' +
      '<div class="hbe-wact">' + (i.suggest ? '<button type="button" data-c="fixc" data-id="' + i.id + '" data-part="' + i.part + '" title="Applique cette couleur sur ' + E(DEV[S.dev].label.toLowerCase()) + '"><i class="hbe-sw" style="background:' + i.suggest + '"></i> Utiliser ' + i.suggest + '</button>' : '') +
      (full ? '<button type="button" data-c="goto" data-id="' + i.id + '">Aller à l’élément</button>' : '') + '</div></div>';
  }
  function renderAud() {
    if (!S) return;
    let a; try { a = H.auditContrast(S.doc, S.dev); } catch (_) { a = { issues: [] }; }
    S.aud = a; const iss = a.issues, bad = iss.filter(i => i.level === 'bad').length;
    const wb = q('#hbe-warn');
    if (wb) {
      wb.hidden = !iss.length; wb.className = 'hbe-btn hbe-warn ' + (bad ? 'bad' : 'low');
      wb.textContent = bad ? '⚠ ' + bad + (bad > 1 ? ' illisibles' : ' illisible') : 'ⓘ ' + iss.length + ' à vérifier';
      wb.title = 'Textes illisibles ou peu lisibles sur ' + DEV[S.dev].label.toLowerCase() + ' : cliquez pour voir la liste';
    }
    qa('[data-thw]').forEach(b => {
      const k = b.dataset.thw, m = iss.filter(i => i.fgTok === k);
      if (!m.length) { b.hidden = true; return; }
      b.hidden = false; b.className = 'hbe-w ' + (m.some(i => i.level === 'bad') ? 'bad' : 'low'); b.textContent = '⚠ ' + m.length;
      b.title = m.length + ' texte' + (m.length > 1 ? 's' : '') + ' peu lisible' + (m.length > 1 ? 's' : '') + ' avec cette couleur (' + DEV[S.dev].label.toLowerCase() + ')';
    });
    const box = q('#hbe-aud'); if (!box) return;
    const n = cur();
    if (n) {
      const mine = iss.filter(i => i.id === n.id);
      box.hidden = !mine.length; box.innerHTML = mine.map(i => issueHtml(i, false)).join('');
    } else if (!iss.length) { box.hidden = true; box.innerHTML = ''; }
    else {
      const low = iss.length - bad;
      box.hidden = false;
      box.innerHTML = '<div class="hbe-wsum"><b>Lisibilité · ' + E(DEV[S.dev].label) + '</b><span>' + (bad ? '⚠ ' + bad + ' illisible' + (bad > 1 ? 's' : '') : '') + (bad && low ? ' · ' : '') + (low ? 'ⓘ ' + low + ' peu lisible' + (low > 1 ? 's' : '') : '') + '</span></div>' +
        iss.slice(0, 30).map(i => issueHtml(i, true)).join('') + (iss.length > 30 ? '<p class="hbe-hint">… et ' + (iss.length - 30) + ' autres.</p>' : '');
    }
  }
  function overlay() {
    if (!S || !S.fdoc) return;
    const d = S.fdoc, sel = d.getElementById('hb-sel'), bar = d.getElementById('hb-bar'), add = d.getElementById('hb-add');
    const hide = () => { sel.style.display = 'none'; bar.style.display = 'none'; add.style.display = 'none'; };
    if (S.prev || !S.sel) return hide();
    const el = d.querySelector('[data-nid="' + S.sel + '"]');
    if (!el) return hide();
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) { hide(); S.hiddenSel = true; crumbs(); return; }
    S.hiddenSel = false;
    const sx = S.fwin.scrollX, sy = S.fwin.scrollY, n = cur();
    sel.style.cssText = 'display:block;left:' + (r.left + sx) + 'px;top:' + (r.top + sy) + 'px;width:' + r.width + 'px;height:' + r.height + 'px';
    d.getElementById('hb-lbl').textContent = n ? nodeLabel(n) : '';
    bar.style.display = 'flex'; const bh = 26, top = r.top + sy - bh;
    bar.style.left = Math.max(0, r.left + sx) + 'px'; bar.style.top = (top < 0 ? r.top + sy : top) + 'px';
    if (n && n.t === 'section') { add.style.display = 'block'; add.style.left = (sx + d.documentElement.clientWidth / 2) + 'px'; add.style.top = (r.bottom + sy) + 'px'; } else add.style.display = 'none';
  }
  function crumbs() {
    const c = q('#hbe-crumbs'); if (!c) return;
    const path = []; if (S.sel) { let id = S.sel; const parentOf = {}; H.walk(S.doc.nodes, (n, p) => { parentOf[n.id] = p ? p.id : null; }); while (id) { const f = H.find(S.doc, id); if (!f) break; path.unshift(f.node); id = parentOf[id]; } }
    c.innerHTML = '<button type="button" data-id="__page">Page</button>' + path.map(n => ' › <button type="button" data-id="' + n.id + '"' + (n.id === S.sel ? ' class="on"' : '') + '>' + E(nodeLabel(n)) + '</button>').join('') +
      (S.hiddenSel ? ' <em>— masqué sur cet appareil</em>' : '') + (S.dev !== 'desktop' ? ' <span class="hbe-badge">Réglages : ' + DEV[S.dev].label + '</span>' : '');
  }

  /* ------------------------------------------------------------ interactions du cadre */
  function onFrameClick(e) {
    const t = e.target;
    if (S.prev) {
      const a = t.closest && t.closest('[data-anchor],[data-act]'); if (!a) return;
      e.preventDefault(); qa('.hb-chk', S.fdoc).forEach(c => { c.checked = false; });
      if (a.dataset.anchor) { const x = S.fdoc.getElementById('hp-' + a.dataset.anchor); if (x) x.scrollIntoView({ behavior: 'smooth', block: 'start' }); } else toastMsg('Aperçu : ici s’ouvrirait la saisie de la clé / la connexion.', 'success');
      return;
    }
    e.preventDefault(); e.stopPropagation();
    if (S.editing && t.closest && t.closest('[contenteditable]')) return;
    const b = t.closest && t.closest('#hb-bar button,#hb-add');
    if (b) return barAction(b.dataset.a);
    const nd = t.closest && t.closest('[data-nid]');
    if (!nd || nd.dataset.nid === '__page') return select(null);
    select(nd.dataset.nid);
  }
  function onFrameOver(e) {
    if (S.prev) return;
    const h = S.fdoc.getElementById('hb-hov'), nd = e.target.closest && e.target.closest('[data-nid]');
    if (!nd || nd.dataset.nid === '__page' || nd.dataset.nid === S.sel) { h.style.display = 'none'; return; }
    const r = nd.getBoundingClientRect();
    h.style.cssText = 'display:block;left:' + (r.left + S.fwin.scrollX) + 'px;top:' + (r.top + S.fwin.scrollY) + 'px;width:' + r.width + 'px;height:' + r.height + 'px';
  }
  function onFrameDbl(e) {
    if (S.prev) return;
    const nd = e.target.closest && e.target.closest('[data-nid]'); if (!nd) return;
    const f = H.find(S.doc, nd.dataset.nid); if (!f || (f.node.t !== 'text' && f.node.t !== 'button')) return;
    e.preventDefault(); select(f.node.id); startInline(nd, f.node);
  }
  function startInline(el, n) {
    const key = n.t === 'text' ? 'tx' : 'lb', old = n.p[key] || '';
    S.editing = true; el.textContent = old;
    try { el.contentEditable = 'plaintext-only'; } catch (_) { /* repli */ }
    if (el.contentEditable !== 'plaintext-only') el.contentEditable = 'true';
    el.focus(); const r = S.fdoc.createRange(); r.selectNodeContents(el); const s = S.fwin.getSelection(); s.removeAllRanges(); s.addRange(r);
    const done = ok => {
      el.removeEventListener('blur', onBlur); el.removeEventListener('keydown', onKd);
      const v = (el.innerText || '').replace(/\n+$/, '');
      S.editing = false; el.removeAttribute('contenteditable');
      if (ok && v !== old) { snap(); n.p[key] = v.slice(0, key === 'tx' ? 3000 : 80); }
      paint(); renderRight(); renderLeft();
    };
    const onBlur = () => done(true);
    const onKd = ev => { if (ev.key === 'Escape') { ev.preventDefault(); done(false); } else if (ev.key === 'Enter' && (n.t === 'button' || !ev.shiftKey && n.p.tag && /^h[1-4]$/.test(n.p.tag))) { ev.preventDefault(); done(true); } ev.stopPropagation(); };
    el.addEventListener('blur', onBlur); el.addEventListener('keydown', onKd);
  }
  function barAction(a) {
    const n = cur(); if (!n && a !== 'addsec') return;
    if (a === 'parent') { const f = H.find(S.doc, n.id); if (f && f.parent) select(f.parent.id, true); else select(null); }
    else if (a === 'up') moveNode(n.id, -1); else if (a === 'down') moveNode(n.id, 1);
    else if (a === 'dup') dupNode(n.id); else if (a === 'del') delNode(n.id);
    else if (a === 'addsec') { setTab('add'); const l = q('#hbe-left'); l.classList.add('open'); l.scrollTop = 0; flash('Choisissez un modèle de section : il sera inséré après la section sélectionnée.'); }
  }
  const flash = m => { setStatus(m); setTimeout(() => setStatus(), 3500); };

  /* ------------------------------------------------------------ sélection & opérations */
  function select(id, scroll) {
    if (S.editing) return;
    S.sel = id || null;
    if (S.sel) { let p = H.find(S.doc, S.sel); while (p && p.parent) { S.fold[p.parent.id] = false; p = H.find(S.doc, p.parent.id); } }
    syncBurger(); overlay(); crumbs(); renderRight(); if (S.tab === 'layers') renderLeft();
    if (scroll && S.sel && S.fdoc) { const el = S.fdoc.querySelector('[data-nid="' + S.sel + '"]'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: 'smooth' }); setTimeout(overlay, 350); }
    if (S.sel && window.innerWidth < 900) q('#hbe-right').classList.add('open');
  }
  function moveNode(id, dir) {
    const f = H.find(S.doc, id); if (!f) return;
    const j = f.index + dir; if (j < 0 || j >= f.list.length) return;
    snap(); const [x] = f.list.splice(f.index, 1); f.list.splice(j, 0, x); paint(); renderLeft(); overlay();
  }
  function dupNode(id) {
    const f = H.find(S.doc, id); if (!f) return;
    const copy = H.clone(f.node); const n0 = countNodes(); let k = 0; H.walk([copy], () => { k++; });
    if (n0 + k > H.LIMITS.nodes) return toastMsg('Page trop volumineuse (900 éléments maximum).', 'error');
    snap(); H.reId(copy, H.ids(S.doc)); f.list.splice(f.index + 1, 0, copy); select(copy.id); paint(); renderLeft();
  }
  function delNode(id) {
    const f = H.find(S.doc, id); if (!f) return;
    snap(); f.list.splice(f.index, 1); S.sel = f.parent ? f.parent.id : null; paint(); renderLeft(); renderRight(); crumbs();
  }
  function topIndex(id) { let idx = -1; S.doc.nodes.forEach((s, i) => { if (s.id === id) idx = i; else H.walk(s.c, m => { if (m.id === id) idx = i; }); }); return idx; }
  function addSection(key) {
    const sec = H.makeSection(key, H.ids(S.doc)); if (!sec) return;
    let k = 0; H.walk([sec], () => { k++; });
    if (countNodes() + k > H.LIMITS.nodes) return toastMsg('Page trop volumineuse (900 éléments maximum).', 'error');
    if (S.doc.nodes.length >= H.LIMITS.sections) return toastMsg('60 sections maximum.', 'error');
    snap(); const i = S.sel ? topIndex(S.sel) : -1;
    const at = key === 'header' ? 0 : key === 'footer' ? S.doc.nodes.length : (i < 0 ? S.doc.nodes.length : i + 1);
    S.doc.nodes.splice(at, 0, sec); select(sec.id, true); paint(); renderLeft();
  }
  function addElement(key) {
    const el = H.makeElement(key, H.ids(S.doc)); if (!el) return;
    if (!S.doc.nodes.length) addSection('emptySection');
    let list, at;
    const f = S.sel && H.find(S.doc, S.sel);
    if (f && H.CONTAINERS.includes(f.node.t)) { list = f.node.c; at = list.length; }
    else if (f && f.parent) { list = f.parent.c; at = f.index + 1; }
    else { const sec = S.doc.nodes[S.doc.nodes.length > 1 ? S.doc.nodes.length - 2 : 0]; const host = (sec.c || []).find(x => H.CONTAINERS.includes(x.t)) || sec; list = host.c; at = list.length; }
    if (countNodes() + 5 > H.LIMITS.nodes) return toastMsg('Page trop volumineuse (900 éléments maximum).', 'error');
    snap(); list.splice(at, 0, el); select(el.id, true); paint(); renderLeft();
  }

  /* ------------------------------------------------------------ panneau gauche */
  function setTab(t) { S.tab = t; renderLeft(); }
  function renderLeft() {
    const el = q('#hbe-left'); if (!el) return;
    const tabs = [['add', 'Ajouter'], ['layers', 'Calques'], ['images', 'Images']];
    el.innerHTML = '<div class="hbe-tabs">' + tabs.map(([k, l]) => '<button type="button" data-tab="' + k + '"' + (S.tab === k ? ' class="on"' : '') + '>' + l + '</button>').join('') + '</div><div class="hbe-lbody" id="hbe-lbody"></div>';
    const b = q('#hbe-lbody');
    if (S.tab === 'add') b.innerHTML = addHtml(); else if (S.tab === 'layers') b.innerHTML = layersHtml(); else b.innerHTML = imagesHtml();
  }
  function addHtml() {
    const f = (S.q || '').toLowerCase();
    const keep = t => !f || t.toLowerCase().includes(f);
    const secs = H.SECTION_TEMPLATES.filter(t => keep(t.label)), els = H.ELEMENT_TEMPLATES.filter(t => keep(t.label));
    return '<input type="search" class="hbe-search" data-search placeholder="Rechercher un bloc…" value="' + E(S.q || '') + '">' +
      '<h4>Sections <small>(insérées après la section sélectionnée)</small></h4><div class="hbe-cards">' + (secs.map(t => '<button type="button" class="hbe-card" data-addsec="' + t.key + '"><span class="hbe-thumb">' + t.icon + '</span>' + E(t.label) + '</button>').join('') || '<p class="hbe-empty">Aucun résultat</p>') + '</div>' +
      '<h4>Éléments <small>(ajoutés dans le bloc sélectionné)</small></h4><div class="hbe-cards hbe-cards2">' + (els.map(t => '<button type="button" class="hbe-card hbe-mini" data-addel="' + t.key + '"><span class="hbe-thumb">' + t.icon + '</span>' + E(t.label) + '</button>').join('') || '<p class="hbe-empty">Aucun résultat</p>') + '</div>';
  }
  function layersHtml() {
    const rows = [];
    const rec = (list, depth) => list.forEach(n => {
      const kids = n.c && n.c.length, folded = kids ? (S.fold[n.id] === undefined ? depth >= 2 : !!S.fold[n.id]) : false;
      const hid = (n.s && n.s.hid) || (S.dev !== 'desktop' && effOf(n, 'hid'));
      rows.push('<div class="hbe-ly' + (n.id === S.sel ? ' on' : '') + (hid ? ' dim' : '') + '" data-ly="' + n.id + '" draggable="true" style="padding-left:' + (8 + depth * 14) + 'px">' +
        '<button type="button" class="hbe-car" data-fold="' + n.id + '" data-folded="' + (folded ? 1 : 0) + '" ' + (kids ? '' : 'disabled') + '>' + (kids ? (folded ? '▸' : '▾') : '') + '</button><span class="hbe-ti">' + TICON[n.t] + '</span><span class="hbe-ln">' + E(nodeLabel(n)) + '</span>' +
        '<span class="hbe-la"><button type="button" data-lyact="hid" data-id="' + n.id + '" title="Masquer / afficher sur cet appareil">' + (hid ? '🚫' : '👁') + '</button><button type="button" data-lyact="dup" data-id="' + n.id + '" title="Dupliquer">⧉</button><button type="button" data-lyact="del" data-id="' + n.id + '" title="Supprimer">🗑</button></span></div>');
      if (kids && !folded) rec(n.c, depth + 1);
    });
    rec(S.doc.nodes, 0);
    return '<p class="hbe-hint">Glissez-déposez pour réorganiser. Cliquez pour sélectionner.</p>' + (rows.join('') || '<p class="hbe-empty">Page vide.</p>');
  }
  function usedImages() { const u = {}; H.walk(S.doc.nodes, n => { [n.p && n.p.src, n.s && n.s.bgImg, n.st && n.st.bgImg, n.sm && n.sm.bgImg].forEach(x => { if (x) u[x] = (u[x] || 0) + 1; }); }); return u; }
  function imagesHtml() {
    const used = usedImages(), ids = Object.keys(S.images), all = Object.keys(H.BUILTIN_IMAGES).concat(ids);
    const tile = id => '<div class="hbe-img" data-imgid="' + id + '"><div class="hbe-imgthumb">' + (imgUrl(id) ? '<img src="' + E(imgUrl(id)) + '" alt="">' : '<span>…</span>') + '</div><small title="' + E(id) + '">' + E((S.images[id] && S.images[id].name) || (H.BUILTIN_IMAGES[id] ? 'Image du modèle' : id)) + (used[id] ? ' · utilisée ×' + used[id] : '') + '</small>' +
      '<div class="hbe-imgact"><button type="button" data-imguse="' + id + '" title="Utiliser sur l’élément sélectionné">Utiliser</button>' + (H.BUILTIN_IMAGES[id] ? '' : '<button type="button" data-imgdel="' + id + '" title="Supprimer de la bibliothèque">🗑</button>') + '</div></div>';
    return '<label class="hbe-up">＋ Téléverser des images<input type="file" multiple accept="image/png,image/jpeg,image/webp" data-upload hidden></label>' +
      '<p class="hbe-hint">Autant d’images que vous voulez (PNG, JPEG, WebP). Les images de plus de 2 Mo sont réduites automatiquement. « Utiliser » applique l’image à l’élément sélectionné (image, icône ou fond).</p>' +
      '<div class="hbe-imgs">' + all.map(tile).join('') + '</div>';
  }
  function onLeftClick(e) {
    const t = e.target;
    let b;
    if ((b = t.closest('[data-tab]'))) return setTab(b.dataset.tab);
    if ((b = t.closest('[data-addsec]'))) return addSection(b.dataset.addsec);
    if ((b = t.closest('[data-addel]'))) return addElement(b.dataset.addel);
    if ((b = t.closest('[data-fold]'))) { S.fold[b.dataset.fold] = b.dataset.folded !== '1'; renderLeft(); return; }
    if ((b = t.closest('[data-lyact]'))) {
      const id = b.dataset.id, a = b.dataset.lyact;
      if (a === 'del') delNode(id); else if (a === 'dup') dupNode(id);
      else { const f = H.find(S.doc, id); snap(); const n = f.node; const was = !!effOf(n, 'hid'); setStyle(n, 'hid', was ? undefined : true); if (was && S.dev !== 'desktop') setStyle(n, 'hid', false); paint(); renderLeft(); renderRight(); }
      return;
    }
    if ((b = t.closest('[data-ly]'))) return select(b.dataset.ly, true);
    if ((b = t.closest('[data-imguse]'))) return useImage(b.dataset.imguse);
    if ((b = t.closest('[data-imgdel]'))) return delImage(b.dataset.imgdel);
    if (t.closest('.hbe-up')) { const i = q('[data-upload]', q('#hbe-left')); if (i && t.tagName !== 'INPUT') { /* le label ouvre déjà le sélecteur */ } }
  }
  function onLeftInput(e) { if (e.target.matches('[data-search]')) { S.q = e.target.value; const pos = e.target.selectionStart; q('#hbe-lbody').innerHTML = addHtml(); const i = q('[data-search]'); i.focus(); i.setSelectionRange(pos, pos); } }
  async function onLeftChange(e) { if (e.target.matches('[data-upload]')) { const ids = await uploadFiles(e.target.files); e.target.value = ''; if (ids.length) flash(ids.length + ' image(s) ajoutée(s) à la bibliothèque.'); } }
  function useImage(id) {
    const n = cur(); if (!n) return toastMsg('Sélectionnez d’abord un élément (image, icône, section ou boîte).', 'error');
    snap();
    if (n.t === 'image' || n.t === 'icon') n.p.src = id;
    else { setStyle(n, 'bgImg', id); if (!effOf(n, 'bgSz')) setStyle(n, 'bgSz', 'cover'); }
    paint(); renderRight();
  }
  async function delImage(id) {
    const u = usedImages()[id];
    if (!confirm(u ? 'Cette image est utilisée ' + u + ' fois dans la page : elle disparaîtra de ces éléments. Supprimer ?' : 'Supprimer cette image de la bibliothèque ?')) return;
    try {
      await api('DELETE', '/admin/home/image/' + id); delete S.images[id]; if (blobs[id]) { URL.revokeObjectURL(blobs[id]); delete blobs[id]; }
      snap(); H.walk(S.doc.nodes, n => { if (n.p && n.p.src === id) n.p.src = ''; ['s', 'st', 'sm'].forEach(l => { if (n[l] && n[l].bgImg === id) delete n[l].bgImg; }); });
      paint(); renderLeft(); renderRight();
    } catch (er) { toastMsg(errText(er), 'error'); }
  }

  /* glisser-déposer des calques */
  function dropZone(e, row) {
    const r = row.getBoundingClientRect(), y = (e.clientY - r.top) / r.height, f = H.find(S.doc, row.dataset.ly);
    if (y < 0.28) return 'before'; if (y > 0.72) return 'after';
    return f && H.CONTAINERS.includes(f.node.t) ? 'inside' : (y < 0.5 ? 'before' : 'after');
  }
  function onDragStart(e) { const r = e.target.closest && e.target.closest('[data-ly]'); if (!r) return; S.drag = r.dataset.ly; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', S.drag); } catch (_) { /* IE */ } }
  function clearDrop() { qa('.hbe-ly').forEach(x => x.classList.remove('d-before', 'd-after', 'd-inside')); }
  function onDragLeave(e) { const r = e.target.closest && e.target.closest('[data-ly]'); if (r) r.classList.remove('d-before', 'd-after', 'd-inside'); }
  function onDragOver(e) {
    const r = e.target.closest && e.target.closest('[data-ly]'); if (!r || !S.drag) return;
    e.preventDefault(); clearDrop(); r.classList.add('d-' + dropZone(e, r));
  }
  function onDrop(e) {
    const r = e.target.closest && e.target.closest('[data-ly]'); if (!r || !S.drag) return;
    e.preventDefault(); const zone = dropZone(e, r), src = S.drag, dst = r.dataset.ly; S.drag = null; clearDrop();
    if (src === dst) return;
    const a = H.find(S.doc, src), b = H.find(S.doc, dst); if (!a || !b) return;
    let inner = false; H.walk(a.node.c, m => { if (m.id === dst) inner = true; });
    if (inner) return toastMsg('Impossible de déplacer un bloc dans lui-même.', 'error');
    let tList, tIdx;
    if (zone === 'inside') { tList = b.node.c; tIdx = tList.length; } else { tList = b.list; tIdx = b.index + (zone === 'after' ? 1 : 0); }
    if (tList === S.doc.nodes && a.node.t !== 'section') return toastMsg('Seules des sections peuvent être placées au niveau de la page.', 'error');
    snap(); a.list.splice(a.index, 1);
    if (a.list === tList && a.index < tIdx) tIdx--;
    tList.splice(tIdx, 0, a.node); paint(); renderLeft(); overlay();
  }

  /* ------------------------------------------------------------ panneau droit : fabrique de champs */
  const AUD = '<div class="hbe-aud" id="hbe-aud" hidden></div>';
  const resetBtn = (n, k) => (ownOf(n, k) ? '<button type="button" class="hbe-rs" data-reset="' + k + '" title="Rétablir la valeur ' + (S.dev === 'desktop' ? 'par défaut' : 'de l’ordinateur') + '">↺</button>' : '');
  const row = (label, inner, n, k) => '<div class="hbe-r' + (n && k && ownOf(n, k) && S.dev !== 'desktop' ? ' ovr' : '') + '"><span class="hbe-l">' + label + '</span><div class="hbe-c">' + inner + (n && k ? resetBtn(n, k) : '') + '</div></div>';
  const fNum = (n, k, label, ph, step, min, max) => { const sp = H.STYLE[k] || {}, v = effOf(n, k); return row(label, '<input type="number" data-c="num" data-k="' + k + '" value="' + (v == null ? '' : v) + '" placeholder="' + E(ph == null ? 'auto' : ph) + '" step="' + (step || sp.step || 1) + '"' + (min != null ? ' min="' + min + '"' : sp.min != null ? ' min="' + sp.min + '"' : '') + (max != null ? ' max="' + max + '"' : sp.max != null ? ' max="' + sp.max + '"' : '') + '>', n, k); };
  const fSize = (n, k, label, ph) => row(label, '<input type="text" data-c="size" data-k="' + k + '" value="' + E(effOf(n, k) || '') + '" placeholder="' + E(ph || 'auto') + '" maxlength="14" title="Ex. : 100%, 600px, 40vh, auto">', n, k);
  const fSeg = (n, k, label, opts) => { const v = effOf(n, k); return row(label, '<div class="hbe-seg">' + opts.map(([val, txt, tip]) => '<button type="button" data-c="seg" data-k="' + k + '" data-v="' + val + '"' + (String(v) === String(val) ? ' class="on"' : '') + (tip ? ' title="' + E(tip) + '"' : '') + '>' + txt + '</button>').join('') + '</div>', n, k); };
  const fSel = (n, k, label, opts) => { const v = effOf(n, k); return row(label, '<select data-c="sel" data-k="' + k + '"><option value="">— défaut —</option>' + opts.map(([val, txt]) => '<option value="' + val + '"' + (String(v) === String(val) ? ' selected' : '') + '>' + E(txt) + '</option>').join('') + '</select>', n, k); };
  const fBool = (n, k, label) => { const v = !!effOf(n, k); return row(label, '<div class="hbe-seg"><button type="button" data-c="bool" data-k="' + k + '" data-v="1"' + (v ? ' class="on"' : '') + '>Oui</button><button type="button" data-c="bool" data-k="' + k + '" data-v="0"' + (!v ? ' class="on"' : '') + '>Non</button></div>', n, k); };
  function colorInner(k, v, extra) {
    const toks = Object.keys(H.TOKENS).map(t => '<button type="button" class="hbe-tok' + (v === '@' + t ? ' on' : '') + '" data-c="tok" data-k="' + k + '"' + (extra || '') + ' data-v="@' + t + '" style="background:' + tokHex('@' + t) + '" title="' + E(H.TOKEN_LABEL[t]) + '"></button>').join('');
    return '<span class="hbe-col"><input type="color" data-c="colorpick" data-k="' + k + '"' + (extra || '') + ' value="' + pickHex(v) + '"><input type="text" data-c="colortext" data-k="' + k + '"' + (extra || '') + ' value="' + E(v || '') + '" placeholder="aucune" maxlength="9" spellcheck="false"></span><span class="hbe-toks">' + toks + '</span>';
  }
  const fCol = (n, k, label) => row(label, colorInner(k, effOf(n, k)), n, k);
  const fProp = (n, k, label, ph, max, multi) => row(label, multi ? '<textarea data-p="' + k + '" rows="4" maxlength="' + max + '" placeholder="' + E(ph || '') + '">' + E(n.p[k] || '') + '</textarea>' : '<input type="text" data-p="' + k + '" value="' + E(n.p[k] || '') + '" maxlength="' + max + '" placeholder="' + E(ph || '') + '">');
  const fPropSel = (n, k, label, opts) => row(label, '<select data-p="' + k + '">' + opts.map(([v, t]) => '<option value="' + v + '"' + (String(n.p[k] || '') === String(v) ? ' selected' : '') + '>' + E(t) + '</option>').join('') + '</select>');
  const grp = (id, title, body) => '<details class="hbe-g" data-g="' + id + '"' + (S.open[id] ? ' open' : '') + '><summary>' + title + '</summary><div class="hbe-gb">' + body + '</div></details>';

  function stopsEditor(n, k, angKey) {
    const v = effOf(n, k);
    const list = v || [{ c: '@primary', p: 0 }, { c: '@accent', p: 100 }];
    const rows = list.map((s, i) => '<div class="hbe-stop">' + colorInner(k, s.c, ' data-si="' + i + '"') + '<input type="number" data-c="stoppos" data-k="' + k + '" data-si="' + i + '" value="' + s.p + '" min="0" max="100" title="Position (%)"><button type="button" class="hbe-rs" data-c="stopdel" data-k="' + k + '" data-si="' + i + '" title="Retirer cette couleur"' + (list.length <= 2 ? ' disabled' : '') + '>✕</button></div>').join('');
    return '<div class="hbe-stops">' + rows + '<button type="button" class="hbe-add" data-c="stopadd" data-k="' + k + '"' + (list.length >= 6 ? ' disabled' : '') + '>＋ Ajouter une couleur</button></div>' + fNum(n, angKey, 'Angle (°)', '180', 1, 0, 360);
  }
  function imgField(n, label, get, key) {
    const id = get(), url = id ? imgUrl(id) : '';
    return row(label, '<div class="hbe-imgf"><div class="hbe-imgthumb sm">' + (url ? '<img src="' + E(url) + '" alt="">' : '<span>—</span>') + '</div><button type="button" data-c="pickimg" data-key="' + key + '">Choisir…</button>' + (id ? '<button type="button" data-c="clearimg" data-key="' + key + '" title="Retirer">🗑</button>' : '') + '</div>');
  }
  function hrefField(n) {
    const v = n.p.href || '', type = !v ? 'none' : v === 'action:login' ? 'login' : v[0] === '#' ? 'anchor' : /^https?:/i.test(v) ? 'web' : /^mailto:/i.test(v) ? 'mail' : /^tel:/i.test(v) ? 'tel' : 'none';
    const anchors = []; H.walk(S.doc.nodes, m => { if (m.p && m.p.an) anchors.push([m.p.an, nodeLabel(m)]); });
    let val = '';
    if (type === 'anchor') val = '<select data-c="hrefval">' + anchors.map(([a, l]) => '<option value="#' + E(a) + '"' + (v === '#' + a ? ' selected' : '') + '>' + E(l) + ' (#' + E(a) + ')</option>').join('') + '</select>';
    else if (type === 'web') val = '<input type="text" data-c="hrefval" value="' + E(v) + '" placeholder="https://…" maxlength="300">';
    else if (type === 'mail') val = '<input type="text" data-c="hrefval" value="' + E(v.replace(/^mailto:/i, '')) + '" data-pre="mailto:" placeholder="nom@exemple.com" maxlength="200">';
    else if (type === 'tel') val = '<input type="text" data-c="hrefval" value="' + E(v.replace(/^tel:/i, '')) + '" data-pre="tel:" placeholder="+223 …" maxlength="30">';
    return row('Type de lien', '<select data-c="hreftype">' + [['none', 'Aucun lien'], ['login', 'Connexion (saisie de clé / mot de passe)'], ['anchor', 'Aller à une section de la page'], ['web', 'Site web'], ['mail', 'E-mail'], ['tel', 'Téléphone']].map(([a, b]) => '<option value="' + a + '"' + (type === a ? ' selected' : '') + '>' + b + '</option>').join('') + '</select>') + (val ? row('Cible', val) : '') +
      (type === 'anchor' && !anchors.length ? '<p class="hbe-hint">Aucune ancre : renseignez « Ancre » dans une section pour pouvoir la cibler.</p>' : '');
  }
  function mockupFields(n) {
    const m = n.p.m || (n.p.m = {}), inp = (k, l, max) => row(l, '<input type="text" data-m="' + k + '" value="' + E(m[k] || '') + '" maxlength="' + max + '">');
    return inp('brand', 'Titre de la fenêtre', 60) + inp('right', 'Texte à droite', 60) + inp('sideTitle', 'Titre du menu', 40) +
      row('Entrées du menu (une par ligne)', '<textarea data-m="side" rows="6">' + E((m.side || []).join('\n')) + '</textarea>') + row('Entrée active (n°)', '<input type="number" data-m="active" min="1" max="14" value="' + ((m.active || 0) + 1) + '">') +
      inp('hello', 'Salutation', 80) + inp('sub', 'Sous-titre', 120) +
      (m.metrics || []).map((x, i) => '<div class="hbe-sub"><b>Indicateur ' + (i + 1) + '</b><input type="text" data-mm="' + i + '.l" value="' + E(x.l) + '" placeholder="Libellé"><input type="text" data-mm="' + i + '.v" value="' + E(x.v) + '" placeholder="Valeur"><input type="text" data-mm="' + i + '.e" value="' + E(x.e) + '" placeholder="Détail"></div>').join('') +
      inp('c1', 'Titre du graphique', 60) + row('Barres (valeurs 2 à 100, séparées par des virgules)', '<input type="text" data-m="bars" value="' + E((m.bars || []).join(', ')) + '">') + inp('c2', 'Titre du cercle', 60) + inp('ring', 'Texte du cercle', 8);
  }

  function renderRight() {
    const el = q('#hbe-right'); if (!el) return;
    const n = cur();
    if (!n) { el.innerHTML = AUD + pageHtml(); renderAud(); return; }
    const t = n.t, isC = H.CONTAINERS.includes(t), dev = S.dev;
    let h = '<div class="hbe-rh"><span class="hbe-ti big">' + TICON[t] + '</span><div><b>' + E(nodeLabel(n)) + '</b><small>' + TLABEL[t] + (dev !== 'desktop' ? ' · réglages ' + DEV[dev].label.toLowerCase() + ' (' + DEV[dev].note + ')' : '') + '</small></div></div>';
    // Contenu
    let c = '';
    if (t === 'text') c += fProp(n, 'tx', 'Texte', 'Votre texte…', 3000, true) + '<p class="hbe-hint">Entourez des mots de {{doubles accolades}} pour les colorer (couleur « Accent » ci-dessous). {annee} = année en cours.</p>' + fPropSel(n, 'tag', 'Balise', [['h1', 'Titre 1'], ['h2', 'Titre 2'], ['h3', 'Titre 3'], ['h4', 'Titre 4'], ['p', 'Paragraphe'], ['div', 'Bloc de texte'], ['span', 'Texte en ligne'], ['small', 'Petit texte'], ['strong', 'Gras'], ['em', 'Italique']]);
    if (t === 'button') c += fProp(n, 'lb', 'Libellé', 'Mon bouton', 80) + fPropSel(n, 'vr', 'Style de base', [['primary', 'Principal (dégradé bleu)'], ['outline', 'Contour'], ['white', 'Blanc'], ['plain', 'Sans fond']]);
    if (t === 'image') c += imgField(n, 'Image', () => n.p.src, 'src') + fProp(n, 'alt', 'Texte alternatif', 'Description de l’image', 160) + fPropSel(n, 'fit', 'Cadrage', [['cover', 'Remplir (rogner)'], ['contain', 'Contenir (entière)'], ['fill', 'Étirer']]);
    if (t === 'icon') c += fProp(n, 'gl', 'Symbole / emoji / lettres', '⭐', 12) + imgField(n, 'Ou image (logo)', () => n.p.src, 'src');
    if (t === 'mockup') c += mockupFields(n);
    if (t === 'section') c += fPropSel(n, 'tag', 'Balise', [['section', 'Section'], ['header', 'En-tête'], ['footer', 'Pied de page'], ['main', 'Contenu principal'], ['div', 'Bloc']]);
    c += fProp(n, 'nm', 'Nom du calque', nodeLabel(n), 40) + fProp(n, 'an', 'Ancre (cible d’un lien interne)', 'ex. contact', 40);
    h += grp('content', 'Contenu', c);
    if (t === 'text' || t === 'button' || t === 'box' || t === 'image') h += grp('link', 'Lien', hrefField(n));
    // Disposition
    if (isC) {
      const d = effOf(n, 'd') || 'block';
      let l = fSeg(n, 'd', 'Type', [['block', 'Bloc'], ['row', 'Ligne ↔'], ['column', 'Colonne ↕'], ['grid', 'Grille']]);
      if (d === 'grid') l += row('Colonnes', '<input type="number" data-c="cols" min="1" max="12" value="' + (effOf(n, 'cols') || '') + '" placeholder="auto">', n, 'cols') + row('Largeurs (avancé)', '<input type="text" data-c="tpl" data-k="tpl" value="' + E(effOf(n, 'tpl') || '') + '" placeholder="ex. 1fr 2fr" maxlength="80">', n, 'tpl');
      if (d !== 'block') l += fSeg(n, 'ai', 'Alignement', [['start', 'Début'], ['center', 'Centre'], ['end', 'Fin'], ['stretch', 'Étirer']]) + fSeg(n, 'jc', 'Répartition', [['start', 'Début'], ['center', 'Centre'], ['end', 'Fin'], ['between', 'Écart'], ['around', 'Autour']]);
      if (d === 'row') l += fBool(n, 'wrap', 'Retour à la ligne');
      if (t === 'box') l += fPropSel(n, 'burger', 'Menu burger (☰)', [['', 'Aucun'], ['tablet', 'Tablette et mobile (≤ 1000 px)'], ['mobile', 'Mobile seul (≤ 600 px)']]) +
        (n.p.burger ? '<p class="hbe-hint">Sur les petits écrans, le contenu de cette boîte s’ouvre dans un panneau déroulant sous la section positionnée la plus proche (en général l’en-tête : Position « Fixe »), via le bouton ☰. Aucun script n’est ajouté à la page.</p>' : '');
      if (d !== 'block') l += fNum(n, 'gap', 'Espacement (px)', '0');
      h += grp('layout', 'Disposition', l);
    }
    h += grp('size', 'Taille', fSize(n, 'w', 'Largeur', 'auto') + fSize(n, 'mw', 'Largeur max.', 'aucune') + fSize(n, 'h', 'Hauteur', 'auto') + fSize(n, 'mh', 'Hauteur min.', 'aucune') + fBool(n, 'ctr', 'Centrer le bloc'));
    h += grp('pos', 'Position', fSel(n, 'pos', 'Mode', [['static', 'Normal'], ['relative', 'Relatif'], ['absolute', 'Absolu'], ['sticky', 'Collant'], ['fixed', 'Fixe (reste en haut au défilement)']]) + fSize(n, 'top', 'Haut') + fSize(n, 'right', 'Droite') + fSize(n, 'bottom', 'Bas') + fSize(n, 'left', 'Gauche') + fNum(n, 'z', 'Profondeur (z)', '0') + fNum(n, 'ord', 'Ordre d’affichage', '0') + fSel(n, 'ovf', 'Débordement', [['visible', 'Visible'], ['hidden', 'Masqué'], ['auto', 'Défilement']]));
    h += grp('space', 'Espacement', '<div class="hbe-sub"><b>Intérieur (padding)</b><div class="hbe-4">' + ['pt:Haut', 'pr:Droite', 'pb:Bas', 'pl:Gauche'].map(x => { const [k, l] = x.split(':'); const v = effOf(n, k); return '<label>' + l + '<input type="number" data-c="num" data-k="' + k + '" value="' + (v == null ? '' : v) + '" min="0" max="400" placeholder="0"></label>'; }).join('') + '</div></div>' +
      '<div class="hbe-sub"><b>Extérieur (marge)</b><div class="hbe-4">' + ['mt:Haut', 'mr:Droite', 'mb:Bas', 'ml:Gauche'].map(x => { const [k, l] = x.split(':'); const v = effOf(n, k); return '<label>' + l + '<input type="number" data-c="num" data-k="' + k + '" value="' + (v == null ? '' : v) + '" min="-200" max="400" placeholder="0"></label>'; }).join('') + '</div></div>');
    if (t !== 'image') {
      h += grp('typo', 'Typographie', fNum(n, 'fs', 'Taille du texte (px)', '16', 1, 8, 200) + fSel(n, 'fw', 'Graisse', [['300', 'Fine'], ['400', 'Normale'], ['500', 'Moyenne'], ['600', 'Semi-grasse'], ['700', 'Grasse'], ['800', 'Très grasse'], ['900', 'Extra-grasse']]) + fCol(n, 'color', 'Couleur du texte') +
        fSeg(n, 'ta', 'Alignement', [['left', '⇤', 'Gauche'], ['center', '↔', 'Centré'], ['right', '⇥', 'Droite'], ['justify', '☰', 'Justifié']]) + fNum(n, 'lh', 'Interligne', '1.5', 0.05) + fNum(n, 'ls', 'Espacement des lettres (px)', '0', 0.1) +
        fSel(n, 'tt', 'Casse', [['none', 'Normale'], ['uppercase', 'MAJUSCULES'], ['capitalize', 'Initiales'], ['lowercase', 'minuscules']]) + fSel(n, 'ff', 'Police', Object.keys(H.FONTS).map(k => [k, H.FONT_LABEL[k]])) +
        fSel(n, 'fst', 'Style', [['normal', 'Normal'], ['italic', 'Italique']]) + fSel(n, 'td', 'Décoration', [['none', 'Aucune'], ['underline', 'Souligné']]) + fCol(n, 'ac', 'Couleur des mots {{accentués}}') + fCol(n, 'hc', 'Couleur au survol') + fBool(n, 'nw', 'Sur une seule ligne'));
    }
    const bgT = effOf(n, 'bgT') || (effOf(n, 'bg') ? 'color' : 'none');
    let f = fSeg(n, 'bgT', 'Type de fond', [['none', 'Aucun'], ['color', 'Couleur'], ['gradient', 'Dégradé']]);
    if (bgT === 'color') f += fCol(n, 'bg', 'Couleur de fond');
    if (bgT === 'gradient') f += '<div class="hbe-sub"><b>Dégradé</b>' + stopsEditor(n, 'gr', 'ang') + '</div>';
    if (t !== 'image' && t !== 'icon') {
      f += '<div class="hbe-sub"><b>Image de fond</b>' + imgField(n, 'Image', () => effOf(n, 'bgImg'), 'bgImg') + (effOf(n, 'bgImg') ? fSel(n, 'bgSz', 'Taille', [['cover', 'Remplir'], ['contain', 'Contenir'], ['auto', 'Taille réelle']]) + row('Position', '<input type="text" data-c="pos" data-k="bgPs" value="' + E(effOf(n, 'bgPs') || '') + '" placeholder="center 24%" maxlength="20">', n, 'bgPs') + fNum(n, 'bgIo', 'Opacité de l’image', '1', 0.05, 0, 1) : '') + '</div>';
      f += '<div class="hbe-sub"><b>Calque de couleur par-dessus le fond</b>' + (effOf(n, 'ovg') ? stopsEditor(n, 'ovg', 'ova') + '<button type="button" class="hbe-add" data-c="ovrm">Retirer le calque</button>' : '<button type="button" class="hbe-add" data-c="ovadd">＋ Ajouter un calque dégradé</button>') + '</div>';
    }
    h += grp('fill', 'Remplissage', f);
    h += grp('border', 'Bordure', fNum(n, 'rad', 'Arrondi (px)', '0') + fNum(n, 'bw', 'Épaisseur (px)', '0') + '<div class="hbe-sub"><b>Par côté (px)</b><div class="hbe-4">' + ['bt:Haut', 'br:Droite', 'bb:Bas', 'bl:Gauche'].map(x => { const [k, l] = x.split(':'); const v = effOf(n, k); return '<label>' + l + '<input type="number" data-c="num" data-k="' + k + '" value="' + (v == null ? '' : v) + '" min="0" max="30" placeholder="—"></label>'; }).join('') + '</div></div>' + fCol(n, 'bc', 'Couleur') + fSel(n, 'bst', 'Style', [['solid', 'Continu'], ['dashed', 'Tirets'], ['dotted', 'Points']]));
    h += grp('fx', 'Effets', fNum(n, 'op', 'Opacité', '1', 0.05, 0, 1) + '<div class="hbe-sub"><b>Ombre</b>' + fNum(n, 'shx', 'Décalage X', '0') + fNum(n, 'shy', 'Décalage Y', '0') + fNum(n, 'shb', 'Flou', '0') + fNum(n, 'shs', 'Étendue', '0') + fCol(n, 'shc', 'Couleur') + '</div>' +
      '<div class="hbe-sub"><b>Transformation</b>' + fNum(n, 'rx', 'Inclinaison X (°)', '0') + fNum(n, 'ry', 'Inclinaison Y (°)', '0') + fNum(n, 'rz', 'Rotation (°)', '0') + fNum(n, 'scl', 'Échelle', '1', 0.05) + '</div>' + fSel(n, 'hv', 'Effet au survol', [['none', 'Aucun'], ['lift', 'Soulever'], ['grow', 'Agrandir']]));
    h += grp('vis', 'Visibilité', fBool(n, 'hid', 'Masquer sur ' + (dev === 'desktop' ? 'tous les appareils' : DEV[dev].label.toLowerCase())) + '<div class="hbe-actions"><button type="button" data-c="act" data-a="up">↑ Monter</button><button type="button" data-c="act" data-a="down">↓ Descendre</button><button type="button" data-c="act" data-a="dup">⧉ Dupliquer</button><button type="button" class="danger" data-c="act" data-a="del">🗑 Supprimer</button></div>');
    el.innerHTML = AUD + h; renderAud();
  }
  function pageHtml() {
    const th = S.doc.theme, meta = S.doc.meta;
    return '<div class="hbe-rh"><span class="hbe-ti big">▤</span><div><b>Page d’accueil</b><small>Réglages généraux — cliquez un élément pour le modifier</small></div></div>' +
      grp('pg_meta', 'Titre et description (onglet du navigateur)', row('Titre', '<input type="text" data-pg="title" value="' + E(meta.title) + '" maxlength="120">') + row('Description', '<textarea data-pg="description" rows="3" maxlength="300">' + E(meta.description) + '</textarea>')) +
      grp('pg_theme', 'Couleurs du thème', '<p class="hbe-hint">Les éléments qui utilisent une pastille de thème (au-dessus des sélecteurs de couleur) suivent ces couleurs : changez-en une, tout le site change.</p>' + Object.keys(H.TOKENS).map(k => row(H.TOKEN_LABEL[k] + ' <span class="hbe-w" data-thw="' + k + '" hidden></span>', '<span class="hbe-col"><input type="color" data-th="' + k + '" value="' + pickHex(th[k]) + '"><input type="text" data-thtext="' + k + '" value="' + E(th[k]) + '" maxlength="7" spellcheck="false"></span>')).join('')) +
      grp('pg_font', 'Police générale', row('Police', '<select data-pg="font">' + Object.keys(H.FONTS).map(k => '<option value="' + k + '"' + (th.font === k ? ' selected' : '') + '>' + E(H.FONT_LABEL[k]) + '</option>').join('') + '</select>')) +
      '<div class="hbe-actions" style="padding:12px"><button type="button" data-c="pgact" data-a="reset">Revenir au modèle d’origine</button></div>';
  }

  /* ------------------------------------------------------------ panneau droit : événements */
  function applyStyle(k, v, rerender) { const n = cur(); if (!n) return; mark('s:' + n.id + ':' + S.dev + ':' + k); setStyle(n, k, v); paint(); if (rerender) renderRight(); }
  function applyProp(k, v, rerender) { const n = cur(); if (!n) return; mark('p:' + n.id + ':' + k); if (v === '' && (k === 'an' || k === 'nm' || k === 'burger')) delete n.p[k]; else n.p[k] = v; paint(); if (rerender) renderRight(); if (k === 'nm' || k === 'tx' || k === 'lb') { crumbs(); if (S.tab === 'layers') renderLeft(); } }
  function getStops(n, k) { const v = effOf(n, k); return v ? v.map(s => Object.assign({}, s)) : [{ c: '@primary', p: 0 }, { c: '@accent', p: 100 }]; }
  function setStops(k, stops, angKey) { const n = cur(); mark('st:' + n.id + k); setStyle(n, k, stops); if (angKey && effOf(n, angKey) == null) setStyle(n, angKey, k === 'gr' ? 135 : 90); paint(); }
  function onRightInput(e) {
    const t = e.target, c = t.dataset.c, n = cur();
    if (t.dataset.p !== undefined && n) return applyProp(t.dataset.p, t.value, false);
    if (t.dataset.pg !== undefined) { mark('pg:' + t.dataset.pg); if (t.dataset.pg === 'font') S.doc.theme.font = t.value; else S.doc.meta[t.dataset.pg] = t.value; paint(); return; }
    if (t.dataset.th) { mark('th:' + t.dataset.th); S.doc.theme[t.dataset.th] = t.value.toLowerCase(); const tx = q('[data-thtext="' + t.dataset.th + '"]'); if (tx) tx.value = t.value.toLowerCase(); paint(); return; }
    if (t.dataset.thtext) { if (/^#[0-9a-f]{6}$/i.test(t.value)) { mark('th:' + t.dataset.thtext); S.doc.theme[t.dataset.thtext] = t.value.toLowerCase(); const pk = q('[data-th="' + t.dataset.thtext + '"]'); if (pk) pk.value = t.value; paint(); } return; }
    if (!n) return;
    if (t.dataset.m !== undefined) {
      const m = n.p.m, k = t.dataset.m; mark('m:' + n.id + k);
      if (k === 'side') m.side = t.value.split('\n').map(x => x.slice(0, 30)).filter(Boolean).slice(0, 14);
      else if (k === 'bars') m.bars = t.value.split(/[,;\s]+/).map(Number).filter(x => isFinite(x) && x > 0).map(x => Math.min(100, Math.max(2, Math.round(x)))).slice(0, 14);
      else if (k === 'active') m.active = Math.max(0, (parseInt(t.value, 10) || 1) - 1); else m[k] = t.value;
      return paint();
    }
    if (t.dataset.mm !== undefined) { const [i, f] = t.dataset.mm.split('.'); mark('mm:' + n.id + t.dataset.mm); n.p.m.metrics[+i][f] = t.value.slice(0, 40); return paint(); }
    if (c === 'num') { const v = t.value === '' ? undefined : Number(t.value); if (v !== undefined && !isFinite(v)) return; return applyStyle(t.dataset.k, v, false); }
    if (c === 'size') { const v = t.value.trim(); const ok = v === '' || /^(auto|fit-content|-?\d{1,4}(\.\d{1,2})?(px|%|vw|vh|rem|em)?)$/.test(v); t.classList.toggle('bad', !ok); if (ok) applyStyle(t.dataset.k, v || undefined, false); return; }
    if (c === 'tpl') { const v = t.value.trim(); const ok = v === '' || (/^[0-9a-z.%,() \-]{1,80}$/i.test(v) && !/url|expression|var\(/i.test(v)); t.classList.toggle('bad', !ok); if (ok) applyStyle('tpl', v || undefined, false); return; }
    if (c === 'pos') { const v = t.value.trim(); const ok = v === '' || /^((left|center|right|top|bottom|\d{1,3}%)( |$)){1,2}$/.test(v); t.classList.toggle('bad', !ok); if (ok) applyStyle('bgPs', v || undefined, false); return; }
    if (c === 'colortext') { const v = t.value.trim().toLowerCase(), ok = v === '' || H.COLOR_RE.test(v); t.classList.toggle('bad', !ok); if (ok) colorSet(t, v || undefined, false); return; }
    if (c === 'colorpick') return colorSet(t, t.value.toLowerCase(), false, true);
    if (c === 'stoppos') { const st = getStops(n, t.dataset.k); st[+t.dataset.si].p = Math.max(0, Math.min(100, Math.round(+t.value || 0))); return setStops(t.dataset.k, st); }
    if (c === 'cols') { const v = Math.max(1, Math.min(12, Math.round(+t.value || 0))); if (!t.value) return; mark('cols:' + n.id + S.dev); setStyle(n, 'cols', v); setStyle(n, 'tpl', 'repeat(' + v + ',minmax(0,1fr))'); const tp = q('[data-c="tpl"]'); if (tp) tp.value = 'repeat(' + v + ',minmax(0,1fr))'; return paint(); }
  }
  function colorSet(t, v, rerender, fromPick) {
    const k = t.dataset.k, si = t.dataset.si, n = cur();
    if (si !== undefined) { const st = getStops(n, k); st[+si].c = v || st[+si].c; setStops(k, st); if (fromPick || rerender) { const tx = t.closest('.hbe-col').querySelector('[data-c="colortext"]'); if (tx) tx.value = v; } return; }
    applyStyle(k, v, rerender);
    if (fromPick) { const tx = t.closest('.hbe-col').querySelector('[data-c="colortext"]'); if (tx) tx.value = v; }
  }
  function onRightChange(e) {
    const t = e.target, c = t.dataset.c, n = cur();
    if (t.dataset.p !== undefined && t.tagName === 'SELECT') return applyProp(t.dataset.p, t.value, true);
    if (t.dataset.pg === 'font') { mark('pg:font'); S.doc.theme.font = t.value; return paint(); }
    if (!n) return;
    if (c === 'sel') { if (t.dataset.k === 'pos' && t.value === 'absolute') { /* position absolue : prévenir si aucun repère */ } return applyStyle(t.dataset.k, t.value || undefined, true); }
    if (c === 'hreftype') {
      const ty = t.value; mark('href:' + n.id);
      let v = ''; if (ty === 'login') v = 'action:login'; else if (ty === 'web') v = 'https://'; else if (ty === 'mail') v = 'mailto:'; else if (ty === 'tel') v = 'tel:';
      else if (ty === 'anchor') { let first = ''; H.walk(S.doc.nodes, m => { if (!first && m.p && m.p.an) first = m.p.an; }); v = first ? '#' + first : ''; }
      if (v) n.p.href = v; else delete n.p.href; paint(); return renderRight();
    }
    if (c === 'hrefval') { mark('href:' + n.id); const pre = t.dataset.pre || ''; const v = pre + t.value.trim(); if (/^(https?:\/\/[^\s"'<>\\]{1,280}|mailto:[^\s"'<>\\]{3,220}|tel:[+0-9 ().-]{3,30}|#[a-z0-9_-]{1,40})$/i.test(v)) { n.p.href = v; t.classList.remove('bad'); paint(); } else t.classList.add('bad'); return; }
    if (c === 'colortext' || c === 'colorpick') { return renderRight(); }
    if (t.type === 'file') return;
  }
  function onRightClick(e) {
    const b = e.target.closest('button'); if (!b) return;
    const c = b.dataset.c, n = cur();
    if (b.dataset.reset && n) { mark('rs:' + n.id + b.dataset.reset); setStyle(n, b.dataset.reset, undefined); if (b.dataset.reset === 'cols') setStyle(n, 'tpl', undefined); paint(); return renderRight(); }
    if (c === 'act') return barAction(b.dataset.a);
    if (c === 'pgact') return resetTemplate();
    if (c === 'goto') return select(b.dataset.id, true);
    if (c === 'fixc') {                                   // « Utiliser #xxxxxx » : applique une couleur lisible sur l'appareil affiché
      const f = H.find(S.doc, b.dataset.id), it = ((S.aud && S.aud.issues) || []).find(i => i.id === b.dataset.id && i.part === b.dataset.part);
      if (!f || !it || !it.suggest) return;
      snap(); setStyle(f.node, it.part === 'accent' ? 'ac' : 'color', it.suggest); paint(); renderRight(); if (S.tab === 'layers') renderLeft(); return;
    }
    if (!n) return;
    if (c === 'seg' || c === 'bool' || c === 'tok') {
      const k = b.dataset.k; let v = b.dataset.v;
      if (c === 'bool') v = v === '1'; 
      if (c === 'tok') { if (b.dataset.si !== undefined) { const st = getStops(n, k); st[+b.dataset.si].c = v; setStops(k, st); return renderRight(); } return applyStyle(k, v, true); }
      mark('s:' + n.id + ':' + S.dev + ':' + k);
      if (k === 'bgT' && v === 'gradient' && !effOf(n, 'gr')) { setStyle(n, 'gr', [{ c: '@primary', p: 0 }, { c: '@accent', p: 100 }]); if (effOf(n, 'ang') == null) setStyle(n, 'ang', 135); }
      if (k === 'bgT' && v === 'color' && !effOf(n, 'bg')) setStyle(n, 'bg', '@primary');
      if (k === 'd' && v === 'grid' && !effOf(n, 'cols') && !effOf(n, 'tpl')) { setStyle(n, 'cols', 2); setStyle(n, 'tpl', 'repeat(2,minmax(0,1fr))'); }
      setStyle(n, k, v); paint(); return renderRight();
    }
    if (c === 'stopadd') { const st = getStops(n, b.dataset.k); st.splice(st.length - 1, 0, { c: '@primary', p: Math.round((st[st.length - 2].p + st[st.length - 1].p) / 2) }); setStops(b.dataset.k, st); return renderRight(); }
    if (c === 'stopdel') { const st = getStops(n, b.dataset.k); if (st.length <= 2) return; st.splice(+b.dataset.si, 1); setStops(b.dataset.k, st); return renderRight(); }
    if (c === 'ovadd') { mark('ov:' + n.id); setStyle(n, 'ovg', [{ c: '#00000099', p: 0 }, { c: '#00000000', p: 100 }]); if (effOf(n, 'ova') == null) setStyle(n, 'ova', 90); paint(); return renderRight(); }
    if (c === 'ovrm') { mark('ov:' + n.id); setStyle(n, 'ovg', undefined); setStyle(n, 'ova', undefined); paint(); return renderRight(); }
    if (c === 'pickimg') return openPicker(id => { const key = b.dataset.key; mark('img:' + n.id); if (key === 'bgImg') { setStyle(n, 'bgImg', id); if (!effOf(n, 'bgSz')) setStyle(n, 'bgSz', 'cover'); } else n.p.src = id; paint(); renderRight(); });
    if (c === 'clearimg') { snap(); if (b.dataset.key === 'bgImg') setStyle(n, 'bgImg', undefined); else n.p.src = ''; paint(); return renderRight(); }
  }

  /* sélecteur d'image (fenêtre) */
  function openPicker(cb) {
    closePicker();
    const m = document.createElement('div'); m.id = 'hbe-pick'; m.className = 'hbe-modal';
    m.innerHTML = '<div class="hbe-dlg" role="dialog" aria-modal="true" aria-label="Choisir une image"><div class="hbe-dh"><b>Choisir une image</b><button type="button" data-pk="close">✕</button></div><label class="hbe-up">＋ Téléverser des images<input type="file" multiple accept="image/png,image/jpeg,image/webp" data-pk="upload" hidden></label><div class="hbe-imgs" id="hbe-pkgrid"></div></div>';
    document.body.appendChild(m); S.pickCb = cb; fillPicker();
    m.addEventListener('click', ev => { const b = ev.target.closest('[data-pk],[data-pkid]'); if (ev.target === m || (b && b.dataset.pk === 'close')) return closePicker(); if (b && b.dataset.pkid) { const f = S.pickCb; closePicker(); f && f(b.dataset.pkid); } });
    m.addEventListener('change', async ev => { if (ev.target.dataset.pk === 'upload') { await uploadFiles(ev.target.files); ev.target.value = ''; fillPicker(); } });
  }
  function fillPicker() {
    const g = q('#hbe-pkgrid'); if (!g) return;
    g.innerHTML = Object.keys(H.BUILTIN_IMAGES).concat(Object.keys(S.images)).map(id => '<button type="button" class="hbe-img pk" data-pkid="' + id + '"><div class="hbe-imgthumb">' + (imgUrl(id) ? '<img src="' + E(imgUrl(id)) + '" alt="">' : '<span>…</span>') + '</div><small>' + E((S.images[id] && S.images[id].name) || (H.BUILTIN_IMAGES[id] ? 'Image du modèle' : id)) + '</small></button>').join('') || '<p class="hbe-empty">Aucune image.</p>';
  }
  function closePicker() { const m = q('#hbe-pick'); if (m) m.remove(); S.pickCb = null; }

  /* ------------------------------------------------------------ barre du haut & clavier */
  function setStatus(t) { const s = q('#hbe-state'); if (s) s.textContent = t || statusText(); }
  const statusText = () => (S.dirty ? 'Modifications non enregistrées' : S.unpub ? 'Brouillon enregistré · non publié' : 'Publié · à jour');
  function updateTop() {
    setStatus(); const u = q('[data-top="undo"]'), r = q('[data-top="redo"]'); if (u) u.disabled = !S.undo.length; if (r) r.disabled = !S.redo.length;
  }
  function togglePreview() {
    S.prev = !S.prev; q('#hbe').classList.toggle('prev', S.prev); q('[data-top="preview"]').textContent = S.prev ? '✎ Retour à l’édition' : '👁 Aperçu'; paint();
  }
  async function exit() {
    if (S.dirty && !(await save(true)) && !confirm('Le brouillon n’a pas pu être enregistré. Quitter quand même ?')) return;
    document.removeEventListener('keydown', onKey); window.removeEventListener('beforeunload', onUnload);
    clearTimeout(saveT); const e = q('#hbe'); if (e) e.remove(); closePicker(); S = null;
    try { if (typeof goBack === 'function') goBack(); else if (typeof go === 'function') go('dash'); } catch (_) { /* vue indisponible */ }
  }
  function onTop(e) {
    const t = e.target, b = t.closest('[data-top]'), d = t.closest('[data-dev]');
    const menu = q('#hbe-menu'); if (menu && !t.closest('.hbe-more')) menu.hidden = true;
    if (d) return setDevice(d.dataset.dev);
    if (!b) return;
    const a = b.dataset.top; if (menu && a !== 'more') menu.hidden = true;
    ({ exit, undo, redo, audit: showAudit, preview: togglePreview, save: () => save(), publish, discard, reset: resetTemplate, export: exportJson, import: importJson,
      more: () => { menu.hidden = !menu.hidden; }, left: () => q('#hbe-left').classList.toggle('open'), right: () => q('#hbe-right').classList.toggle('open') }[a] || (() => {}))();
  }
  function onKey(e) {
    if (!S || q('#hbe-pick')) return;
    const tag = (e.target && e.target.tagName) || '', typing = /^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (e.target && e.target.isContentEditable);
    const mod = e.ctrlKey || e.metaKey, k = (e.key || '').toLowerCase();
    if (mod && k === 's') { e.preventDefault(); return save(); }
    if (typing) return;
    if (mod && k === 'z') { e.preventDefault(); return e.shiftKey ? redo() : undo(); }
    if (mod && k === 'y') { e.preventDefault(); return redo(); }
    if (mod && k === 'd' && S.sel) { e.preventDefault(); return dupNode(S.sel); }
    if ((k === 'delete' || k === 'backspace') && S.sel && !S.editing) { e.preventDefault(); return delNode(S.sel); }
    if (k === 'escape') { if (S.prev) return togglePreview(); select(null); }
  }

  /* ------------------------------------------------------------ ouverture */
  async function openEditor() {
    if (S) return;
    let d; try { d = await G('/admin/home'); } catch (e) { return toastMsg(errText(e), 'error'); }
    S = { doc: d.draft, images: d.images || {}, published_at: d.published_at, sel: null, dev: 'desktop', undo: [], redo: [], dirty: false, unpub: !!d.dirty, tab: 'add', fold: {}, open: { content: true, typo: true, fill: true, layout: true }, prev: false, auto: true, q: '' };
    build(); buildFrame(); renderLeft(); renderRight(); setDevice('desktop'); updateTop();
  }
  window.hbOpen = openEditor;
  window.hbIsOpen = () => !!S;
  window.hbClose = () => { const e = q('#hbe'); if (e) e.remove(); S = null; };
})();
