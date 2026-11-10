/* Couleurs personnalisables du menu de gauche et de l'en-tête (fond bleu par défaut).
 * Ordre de priorité : couleur PERSONNELLE de l'utilisateur > couleur de la STATION (choisie par l'administrateur) > défaut.
 * - Administrateur de la station : Paramètres → Apparence → « Couleurs du menu et de l'en-tête » (toute la station).
 * - Tout utilisateur (Super Admin compris) : menu du profil (en haut à droite) → « 🎨 Couleurs du menu » (pour lui seul).
 * Le texte reste blanc : les couleurs trop claires sont refusées (même règle que le serveur). */
(function () {
  const HEX = /^#[0-9a-fA-F]{6}$/, MAX_LUM = 0.18;
  const DEFAULTS = { sidebar: '#0c1f45', header: '#0c1f45' };
  const PRESETS = ['#0c1f45', '#0a6b5c', '#3f1d5c', '#7a1f2b', '#1f2937', '#7c2d12'];
  const NAV = { station: null, personal: null };

  const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const relLum = h => { const [r, g, b] = rgb(h).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * r + .7152 * g + .0722 * b; };
  const shade = (h, k) => '#' + rgb(h).map(v => Math.round(v * k).toString(16).padStart(2, '0')).join('');   // k < 1 : plus foncé
  const lighten = (h, t) => '#' + rgb(h).map(v => Math.round(v + (255 - v) * t).toString(16).padStart(2, '0')).join('');
  const ok = v => typeof v === 'string' && HEX.test(v) && relLum(v) <= MAX_LUM;
  const clean = c => ({ sidebar: c && ok(c.sidebar) ? c.sidebar : null, header: c && ok(c.header) ? c.header : null });
  const notify = (m, t) => { try { toast(m, t); } catch (_) { /* toast indisponible */ } };

  /** Applique la couleur effective : personnelle, sinon station, sinon défaut de l'application. */
  function applyNavColors() {
    const d = document.documentElement;
    const pick = k => (NAV.personal && ok(NAV.personal[k]) && NAV.personal[k]) || (NAV.station && ok(NAV.station[k]) && NAV.station[k]) || null;
    const sb = pick('sidebar'), hd = pick('header');
    if (sb) {
      d.style.setProperty('--nav-bg', `linear-gradient(180deg, ${sb} 0%, ${shade(sb, .78)} 100%)`);
      d.style.setProperty('--sb-flyout', lighten(sb, .1));
    } else { d.style.removeProperty('--nav-bg'); d.style.removeProperty('--sb-flyout'); }
    if (hd) d.style.setProperty('--hd-bg', `linear-gradient(135deg, ${hd} 0%, ${shade(hd, .82)} 100%)`);
    else d.style.removeProperty('--hd-bg');
  }
  window.applyNavColors = applyNavColors;

  // ---- La couleur de la station suit l'apparence chargée par l'application ----
  if (typeof window.applyAppearance === 'function') {
    const prev = window.applyAppearance;
    window.applyAppearance = async function () {
      const r = await prev.apply(this, arguments);
      try { NAV.station = clean(typeof AP !== 'undefined' && AP ? AP.nav_colors : null); applyNavColors(); } catch (_) { /* non bloquant */ }
      return r;
    };
  }

  // ---- La couleur personnelle est chargée avec le thème personnel (après connexion) ----
  async function loadPersonalNav() {
    if (typeof ME === 'undefined' || !ME) return;
    if (ME.is_global) NAV.station = null;                       // le Super Admin n'a pas de station
    const key = 'smp-nav-user-' + ME.id;
    NAV.personal = null;
    try { const c = localStorage.getItem(key); if (c) NAV.personal = clean(JSON.parse(c)); } catch (_) { /* cache illisible */ }
    applyNavColors();
    try {
      const r = await G('/me/preferences/nav-colors');
      NAV.personal = clean(r.nav_colors);
      try { localStorage.setItem(key, JSON.stringify(NAV.personal)); } catch (_) { /* stockage indisponible */ }
    } catch (_) { /* on garde la valeur en cache */ }
    applyNavColors();
  }
  window.loadPersonalNavColors = loadPersonalNav;
  if (typeof window.loadPersonalTheme === 'function') {
    const prev = window.loadPersonalTheme;
    window.loadPersonalTheme = async function () {
      try { return await prev.apply(this, arguments); } finally { try { await loadPersonalNav(); } catch (_) { /* non bloquant */ } }
    };
  }

  // ---- Éditeur (commun à la station et au profil personnel) ----
  const scopeOf = p => (p === 'np' ? 'personal' : 'station');
  function row(prefix, key, label, hint, cur) {
    const v = cur && ok(cur[key]) ? cur[key] : null;
    return `<div class="card" style="margin-bottom:10px;text-align:left">
      <b>${esc(label)}</b>
      <p style="font-size:12px;color:var(--m);margin:4px 0 8px">${esc(hint)}</p>
      <label style="flex-direction:row;align-items:center;gap:8px;margin:0 0 8px"><input type="checkbox" id="${prefix}_${key}_on" ${v ? 'checked' : ''} style="width:auto" onchange="navPrev('${prefix}')"> Personnaliser cette couleur</label>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <input type="color" id="${prefix}_${key}" value="${v || DEFAULTS[key]}" oninput="navPick('${prefix}','${key}')" style="width:48px;height:34px;padding:2px">
        ${PRESETS.map(c => `<span class="sw" title="${c}" style="background:${c}" onclick="navSwatch('${prefix}','${key}','${c}')"></span>`).join('')}
      </div>
    </div>`;
  }
  const rowsHtml = (prefix, cur) =>
    row(prefix, 'sidebar', 'Menu de gauche (onglets)', 'Fond de la barre de navigation à gauche.', cur) +
    row(prefix, 'header', 'En-tête (haut de page)', 'Fond de la bande qui porte le nom du compte client et la barre d\'outils.', cur) +
    `<p id="${prefix}_warn" class="warn err" style="display:none"></p>`;

  function read(prefix) {
    const out = { sidebar: null, header: null }; let bad = null;
    for (const k of ['sidebar', 'header']) {
      const on = document.getElementById(prefix + '_' + k + '_on'), el = document.getElementById(prefix + '_' + k);
      if (!on || !el || !on.checked) continue;
      if (relLum(el.value) > MAX_LUM) bad = k; else out[k] = el.value;
    }
    return { value: out, bad };
  }
  window.navPrev = function (prefix) {
    const { value, bad } = read(prefix), w = document.getElementById(prefix + '_warn');
    if (w) { w.style.display = bad ? '' : 'none'; w.textContent = bad ? 'Couleur trop claire pour du texte blanc : elle ne sera pas appliquée. Choisissez une teinte plus foncée.' : ''; }
    NAV[scopeOf(prefix)] = value;      // aperçu immédiat (annulable)
    applyNavColors();
  };
  window.navPick = function (prefix, key) { const on = document.getElementById(prefix + '_' + key + '_on'); if (on) on.checked = true; navPrev(prefix); };
  window.navSwatch = function (prefix, key, c) { const el = document.getElementById(prefix + '_' + key); if (el) el.value = c; navPick(prefix, key); };

  // ---- Personnel : menu du profil ----
  window.personalNavColorsEditor = async function () {
    try {
      let cur = NAV.personal;
      try { cur = clean((await G('/me/preferences/nav-colors')).nav_colors); } catch (_) { /* on part de la valeur en mémoire */ }
      NAV.personal = cur; applyNavColors();
      modal(`<h3 style="margin-top:0">Couleurs du menu et de l'en-tête</h3>
        <p style="color:var(--m);font-size:13px;margin-top:0">Ces couleurs ne changent que votre affichage. Elles remplacent, pour vous seul, celles choisies par l'administrateur de la station.</p>
        ${rowsHtml('np', cur)}
        <div class="r" style="margin-top:12px">
          <button class="b2" onclick="navPersonalCancel()">Annuler</button>
          <button class="b2" onclick="navPersonalReset()">Couleurs par défaut</button>
          <button onclick="navPersonalSave()">Enregistrer</button>
        </div>`);
    } catch (e) { notify((e && e.message) || 'Impossible d\'ouvrir les couleurs.', 'error'); }
  };
  window.navPersonalCancel = async function () { closeM(); await loadPersonalNav(); };
  window.navPersonalSave = async function () {
    const { value, bad } = read('np');
    if (bad) return notify('Couleur trop claire : le texte blanc deviendrait illisible.', 'error');
    try {
      await api('PUT', '/me/preferences/nav-colors', { nav_colors: value });
      NAV.personal = clean(value);
      try { localStorage.setItem('smp-nav-user-' + ME.id, JSON.stringify(NAV.personal)); } catch (_) { /* stockage indisponible */ }
      applyNavColors(); closeM(); notify('Couleurs enregistrées.', 'success');
    } catch (e) { notify((e && e.message) || 'Enregistrement impossible.', 'error'); }
  };
  window.navPersonalReset = async function () {
    try {
      await api('DELETE', '/me/preferences/nav-colors');
      NAV.personal = null;
      try { localStorage.removeItem('smp-nav-user-' + ME.id); } catch (_) { /* stockage indisponible */ }
      applyNavColors(); closeM(); notify('Couleurs par défaut rétablies.', 'success');
    } catch (e) { notify((e && e.message) || 'Réinitialisation impossible.', 'error'); }
  };

  // ---- Station : Paramètres → Apparence (administrateur) ----
  function stationCard() {
    if (typeof can === 'function' && !can('appearance.manage')) return '';
    const cur = clean(typeof AP !== 'undefined' && AP ? AP.nav_colors : null);
    return `<h3 style="margin:22px 0 6px">Couleurs du menu et de l'en-tête</h3>
      <div class="card" style="text-align:left">
        <p style="color:var(--m);font-size:13px;margin-top:0">Appliquées à tous les utilisateurs de cette station, sauf à ceux qui ont choisi leurs propres couleurs (profil → « 🎨 Couleurs du menu »). Le texte reste blanc : choisissez des teintes foncées.</p>
        ${rowsHtml('ns', cur)}
        <div class="r"><button class="b2" onclick="navStationReset()">Couleurs par défaut</button><button class="b2" onclick="navStationCancel()">Annuler l'aperçu</button><button onclick="navStationSave()">Enregistrer pour la station</button></div>
      </div>`;
  }
  window.navStationCancel = async function () { NAV.station = clean(AP && AP.nav_colors); applyNavColors(); go('param'); };
  window.navStationSave = async function () {
    const { value, bad } = read('ns');
    if (bad) return notify('Couleur trop claire : le texte blanc deviendrait illisible.', 'error');
    try {
      await api('PUT', '/settings/nav_colors', { value });
      notify('Couleurs enregistrées pour toute la station.', 'success');
      await applyAppearance(); go('param');
    } catch (e) { notify((e && e.message) || 'Enregistrement impossible.', 'error'); }
  };
  window.navStationReset = function () {
    ask('Revenir aux couleurs par défaut du menu et de l\'en-tête ?', async () => {
      await Po('/settings/reset/nav_colors');
      await applyAppearance(); notify('Couleurs par défaut rétablies.', 'success'); go('param');
    });
  };
  if (typeof SEC_FN !== 'undefined' && typeof SEC_FN.app === 'function') {
    const prev = SEC_FN.app;
    SEC_FN.app = async function () { return (await prev.apply(this, arguments)) + stationCard(); };
  }
})();
