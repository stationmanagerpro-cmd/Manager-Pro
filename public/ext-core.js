'use strict';
// Extensions du client : apparence et pied de page, images, moyens de paiement, ventes carburant (index / litres / montant),
// fiche employé (quarts, performances, écarts, dettes, avances, paie, situation financière) et Gestion RH.
let AP = { theme: { mode: 'light', primary: '#0a6b5c', secondary: '#647184' }, footer: {}, station: {}, payment_methods: [], expense_categories: [], fuel_amount_entry_allowed: true };
// Moyens de règlement liés à un compte ACTIF : espèces (caisse) ou banque / mobile money rattaché à un compte actif.
// Libellé = « Moyen — Compte », valeur = code du moyen (le serveur en déduit le compte crédité).
const pmAccOpts = (excl = ['credit']) => (AP.payment_methods || [])
  .filter(m => !excl.includes(m.kind) && (m.kind === 'especes' || (m.account_id && m.account_active)))
  .map(m => [m.code, m.kind === 'especes' ? m.label + ' — Caisse' : m.label + ' — ' + (m.account_name || 'Compte #' + m.account_id)]);
async function refreshPmAccounts() { try { const a = await G('/appearance'); if (a && Array.isArray(a.payment_methods)) AP.payment_methods = a.payment_methods; } catch (_) { /* on garde la liste en mémoire */ } }
const pmOpts = (excl = []) => (AP.payment_methods.length ? AP.payment_methods : [{ code: 'especes', label: 'Espèces', kind: 'especes' }]).filter(m => !excl.includes(m.kind)).map(m => [m.code, m.label]);
const monthNow = () => new Date().toISOString().slice(0, 7), dayNow = () => new Date().toISOString().slice(0, 10), monthFirst = () => monthNow() + '-01';
const fmtN = v => typeof v == 'number' ? new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 }).format(v) : esc(v ?? '');
const kvh = rows => `<div class="kv">${rows.map(([k, v]) => `<span>${k}</span><b>${v ?? ''}</b>`).join('')}</div>`;
const card = (l, v, n = '') => `<div class="card"><small>${l}</small><b>${v}</b>${n ? `<small>${n}</small>` : ''}</div>`;

/* ---------- Apparence, pied de page ---------- */
const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const lum = h => { const [r, g, b] = hexRgb(h).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * r + .7152 * g + .0722 * b; };
const mix = (h, bg, t) => '#' + hexRgb(h).map((v, i) => Math.round(v * t + hexRgb(bg)[i] * (1 - t)).toString(16).padStart(2, '0')).join('');
function paint(t) {
  const d = document.documentElement, dark = t.mode == 'dark';
  d.dataset.theme = t.mode; d.style.setProperty('--p', t.primary); d.style.setProperty('--pl', mix(t.primary, dark ? '#16212b' : '#ffffff', .16)); d.style.setProperty('--m', t.secondary);
  let st = $('#thm'); if (!st) { st = document.createElement('style'); st.id = 'thm'; document.head.appendChild(st); }
  const fg = lum(t.primary) > .4 ? '#111' : '#fff';   // texte des boutons toujours lisible, quelle que soit la couleur choisie
  st.textContent = `:where(button:not(.b2):not(.bd)){color:${fg}}.tabs a.on{color:${fg}}`;   // :where + sans !important : les boutons à fond clair/transparent (onglets, segments de période…) gardent leur couleur propre (correctif 2026-11-01)
}
function renderFooter() {
  const f = AP.footer || {}, s = AP.station || {}, parts = [f.text, f.show_copyright !== false ? (f.copyright || `© ${new Date().getFullYear()} ${s.name || ''}`) : ''].filter(Boolean);
  $('#ft').innerHTML = (parts.length ? `<div>${parts.map(esc).join(' · ')}</div>` : '') + (f.forced_signature ? `<div class="forced-sig">${esc(f.forced_signature)}</div>` : '') + (f.show_ad && f.ad_text ? `<div class="ad">${esc(f.ad_text)}</div>` : '');
}
async function applyAppearance() { AP = await G('/appearance'); paint(AP.theme); renderFooter(); CUR = (AP.station.currency || 'FCFA').trim(); if (typeof refreshTenantBrand === 'function') await refreshTenantBrand(); }
async function loadPersonalMotion() {
  if (!ME) { document.documentElement.dataset.motion = 'subtle'; return; }
  var mode = 'subtle';
  try {
    var key = 'smp-motion-user-' + ME.id;
    var cached = localStorage.getItem(key);
    if (['off','subtle','full'].includes(cached)) mode = cached;
    document.documentElement.dataset.motion = mode;
    var pref = await G('/me/preferences/motion');
    if (['off','subtle','full'].includes(pref.mode)) mode = pref.mode;
    document.documentElement.dataset.motion = mode;
    try { localStorage.setItem(key, mode); } catch (_) {}
  } catch (_) { document.documentElement.dataset.motion = mode; }
}

async function loadPersonalTheme() {
  if (!ME) return;
  try {
    const localKey = 'smp-theme-user-' + ME.id;
    const cached = localStorage.getItem(localKey);
    if (cached) { try { paint(JSON.parse(cached)); } catch (_) {} }
    const r = await G('/me/preferences/theme');
    window.__personalThemeAllowed = r.allowed !== false;
    if (r.theme) {
      paint(r.theme);
      try { localStorage.setItem(localKey, JSON.stringify(r.theme)); } catch (_) {}
    }
    if (typeof updateThemeToggleBtn === 'function') updateThemeToggleBtn();
  } catch (_) {
    window.__personalThemeAllowed = true;
    if (typeof updateThemeToggleBtn === 'function') updateThemeToggleBtn();
  }
}
function updateThemeToggleBtn() {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  const dark = document.documentElement.dataset.theme === 'dark';
  btn.textContent = dark ? '☀️' : '🌙';
  btn.title = dark ? 'Passer en mode jour (clair)' : 'Passer en mode nuit (sombre)';
  btn.setAttribute('aria-label', btn.title);
}
window.updateThemeToggleBtn = updateThemeToggleBtn;
window.loadPersonalMotion = loadPersonalMotion;

/** Bascule rapide jour / nuit (bouton en haut de page). */
window.toggleDayNight = async function () {
  try {
    const d = document.documentElement;
    const next = d.dataset.theme === 'dark' ? 'light' : 'dark';
    const base = (typeof AP !== 'undefined' && AP.theme) || { primary: '#0a6b5c', secondary: '#647184' };
    let primary = base.primary || '#0a6b5c', secondary = base.secondary || '#647184';
    try {
      const r = await G('/me/preferences/theme');
      if (r.theme) { primary = r.theme.primary || primary; secondary = r.theme.secondary || secondary; }
    } catch (_) {}
    const value = { mode: next, primary, secondary };
    paint(value);
    updateThemeToggleBtn();
    try { if (ME) localStorage.setItem('smp-theme-user-' + ME.id, JSON.stringify(value)); } catch (_) {}
    if (ME) {
      try {
        await api('PUT', '/me/preferences/theme', { theme: value });
        toast(next === 'dark' ? 'Mode nuit activé' : 'Mode jour activé', 'success');
      } catch (_) {
        toast(next === 'dark' ? 'Mode nuit (local)' : 'Mode jour (local)');
      }
    }
  } catch (e) {
    if (typeof toast === 'function') toast(typeof errMsg === 'function' ? errMsg(e) : e.message, 'error');
  }
};

window.personalThemeEditor = async function () {
  try {
    let current = { mode: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light', primary: '#0a6b5c', secondary: '#647184' };
    try {
      const r = await G('/me/preferences/theme');
      if (r.theme) current = { ...current, ...r.theme };
      window.__personalThemeAllowed = r.allowed !== false;
    } catch (_) { window.__personalThemeAllowed = true; }
    form('Mon thème personnel', [
      ['mode', 'Mode', 's', [['light', 'Clair (jour)'], ['dark', 'Sombre (nuit)']]],
      ['primary', 'Couleur principale', 'color'],
      ['secondary', 'Couleur secondaire', 'color']
    ], current, async d => {
      const value = { mode: d.mode, primary: d.primary, secondary: d.secondary };
      await window.savePersonalTheme(value);
      closeM();
    });
  } catch (e) {
    if (typeof toast === 'function') toast(typeof errMsg === 'function' ? errMsg(e) : e.message, 'error');
  }
};

window.savePersonalTheme = async function (themeValue) {
  try {
    paint(themeValue);
    updateThemeToggleBtn();
    try { if (ME) localStorage.setItem('smp-theme-user-' + ME.id, JSON.stringify(themeValue)); } catch (_) {}
    await api('PUT', '/me/preferences/theme', { theme: themeValue });
    toast('Thème personnel enregistré', 'success');
  } catch (e) {
    /* Le thème est déjà appliqué et gardé sur cet appareil ; seule la synchronisation serveur a échoué. */
    toast('Thème appliqué sur cet appareil. Synchronisation serveur impossible pour le moment (' + (typeof errMsg === 'function' ? errMsg(e) : e.message) + ').', 'error');
  }
};
function chgPwd() { form('Changer mon mot de passe', [['current', 'Mot de passe actuel', 'password'], ['next', 'Nouveau mot de passe (8 caractères min.)', 'password'], ['again', 'Confirmer le nouveau mot de passe', 'password']], {}, async d => { if (d.next !== d.again) throw new Error('Les deux mots de passe ne correspondent pas'); await Po('/auth/password', { current: d.current, next: d.next }); closeM(); toast('Mot de passe modifié'); }); }

/* ---------- Images : photo ou logo, avatar par défaut, aperçu avant validation ---------- */
const initials = n => String(n || '?').split(/\s+/).slice(0, 2).map(x => x[0] || '').join('').toUpperCase();
const IMGC = {};
function av(ent, id, photo, name, big) {
  const cls = 'av' + (big ? ' big' : ''), imageAllowed = can('image.manage') || (ent === 'stations' && (can('settings.edit') || can('appearance.manage'))) || (ent === 'products' && (can('price.edit') || can('stock.adjust'))), edit = imageAllowed ? ` onclick="event.stopPropagation();pickImage('${ent}',${id})" style="cursor:pointer" title="${ent === 'stations' ? 'Changer le logo de la station' : 'Changer la photo'}"` : '';
  return photo ? `<img class="${cls}" data-ent="${ent}" data-id="${id}" data-name="${esc(name || '')}" alt=""${edit}>` : `<span class="${cls}"${edit}>${esc(initials(name))}</span>`;
}
async function hydrateImages() {
  for (const im of document.querySelectorAll('img[data-ent]')) {
    const k = im.dataset.ent + '/' + im.dataset.id;
    try { if (!IMGC[k]) { const r = await fetch('/api/images/' + k, { headers: { Authorization: 'Bearer ' + TK, 'X-Station-Id': SID } }); if (!r.ok) throw 0; IMGC[k] = URL.createObjectURL(await r.blob()); } im.src = IMGC[k]; }
    catch (e) { const sp = document.createElement('span'); sp.className = im.className; sp.textContent = initials(im.dataset.name || ''); im.replaceWith(sp); }
  }
}
async function uploadImage(ent, id, dataUrl) { await api('PUT', `/images/${ent}/${id}`, { data_url: dataUrl }); delete IMGC[ent + '/' + id]; }
window.pickImage = function pickImage(ent, id) {
  modal(`<h3>Photo / logo</h3><p style="color:var(--m)">PNG, JPEG ou WebP, 2 Mo maximum.</p><input type="file" id="imf" accept="image/png,image/jpeg,image/webp"><div style="margin:12px 0"><img id="imp" class="av big" style="display:none;width:120px;height:120px;border-radius:12px"></div><div class="r"><button class="bd" id="imd">Supprimer la photo</button><button class="b2" onclick="closeM()">Annuler</button><button id="imo" disabled>Enregistrer</button></div>`);
  let data = null;
  $('#imf').onchange = e => { const f = e.target.files[0]; if (!f) return; if (!/^image\/(png|jpeg|webp)$/.test(f.type)) return toast('Format refusé : PNG, JPEG ou WebP uniquement'); if (f.size > 2 * 1024 * 1024) return toast('Fichier trop volumineux (2 Mo maximum)'); const rd = new FileReader(); rd.onload = () => { data = rd.result; $('#imp').src = data; $('#imp').style.display = ''; $('#imo').disabled = false; }; rd.readAsDataURL(f); };
  $('#imo').onclick = async () => { try { await uploadImage(ent, id, data); closeM(); toast('Image enregistrée'); go(cur, arg); if (ent == 'stations') { window.__tenantLogoKey = null; if (window.applyAppearance) await applyAppearance(); } } catch (e) { toast(errMsg(e)); } };
  $('#imd').onclick = () => ask('Supprimer cette image ?', async () => { await api('DELETE', `/images/${ent}/${id}`); delete IMGC[ent + '/' + id]; if (ent === 'stations') { window.__tenantLogoKey = null; if (window.__tenantLogoUrl) { URL.revokeObjectURL(window.__tenantLogoUrl); window.__tenantLogoUrl = null; } } toast('Image supprimée'); go(cur, arg); if (ent === 'stations' && window.applyAppearance) await applyAppearance(); });
}

/* ---------- Quart : ouverture avec affectation des employés aux pompes ---------- */
async function openQ() {
  const [pm, rg, em] = await Promise.all([G('/pumps'), G('/cash/registers'), G('/employees').catch(() => [])]), cs = pm.filter(p => p.status == 'active').flatMap(p => p.counters.map(c => ({ ...c, pn: p.name }))), act = em.filter(e => e.status == 'actif');
  const pumpOpts = [['', 'Aucune pompe'], ...pm.filter(p => p.status == 'active').map(p => [p.id, p.name])];
  const shiftRoles = [['', 'Sélectionner le rôle'], ['chef_quart', 'Chef de quart'], ['pompiste', 'Pompiste'], ['caissier', 'Caissier / caissière'], ['superviseur', 'Superviseur'], ['autre', 'Autre participant']];
  const ROLE_LABEL = { chef_quart: 'Chef de quart', pompiste: 'Pompiste', caissier: 'Caissier / caissière', superviseur: 'Superviseur', autre: 'Autre participant' };
  // Rôle proposé d'après la fonction de l'employé (modifiable).
  const guessRole = e => { const t = String(e.position || ''); return /pompist/i.test(t) ? 'pompiste' : /caissi/i.test(t) ? 'caissier' : /superviseur|chef de piste/i.test(t) ? 'superviseur' : ''; };
  const opt = (v, l, sel) => `<option value="${esc(v)}"${String(v) === String(sel) ? ' selected' : ''}>${esc(l)}</option>`;
  const rowHtml = () => `<div class="pt-row" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr)) auto;gap:8px;align-items:end;margin-bottom:8px">
      <label style="margin:0">Employé<select class="pt-emp" onchange="ptEmpChanged(this)"><option value="">— Choisir un employé —</option>${act.map(e => opt(e.id, e.first_name + ' ' + e.last_name)).join('')}</select></label>
      <label style="margin:0">Rôle<select class="pt-role">${shiftRoles.map(([v, l]) => opt(v, l)).join('')}</select></label>
      <label style="margin:0">Pompe 1<select class="pt-pump" onchange="ptRefresh()">${pumpOpts.map(([v, l]) => opt(v, l)).join('')}</select></label><span style="display:flex;gap:4px"><button type="button" class="b2 pt-addp" title="Ajouter une 2e pompe à cet employé" onclick="ptAddPump(this)">+ Pompe</button><button type="button" class="b2 pt-del" title="Retirer ce participant" aria-label="Retirer ce participant" onclick="ptRemove(this)">✕</button></span>
      <label class="pt-pump2-wrap" style="margin:0;display:none;grid-column:1 / -1">Pompe 2<span style="display:flex;gap:6px;align-items:center"><select class="pt-pump2" style="flex:1 1 auto;min-width:0" onchange="ptRefresh()"><option value="">— Aucune —</option>${pumpOpts.slice(1).map(([v, l]) => opt(v, l)).join('')}</select><button type="button" class="b2" title="Retirer la 2e pompe" aria-label="Retirer la 2e pompe" onclick="ptDelPump(this)">✕</button></span></label></div>`;
  const rows = () => [...document.querySelectorAll('#pt-list .pt-row')];
  // Un employé ne peut apparaître que sur une seule ligne : les choix déjà pris sont grisés ailleurs.
  window.ptRefresh = () => {
    const taken = new Set(rows().map(r => r.querySelector('.pt-emp').value).filter(Boolean));
    rows().forEach(r => { const mine = r.querySelector('.pt-emp').value; r.querySelectorAll('.pt-emp option').forEach(o => { o.disabled = !!o.value && o.value !== mine && taken.has(o.value); }); });
    const add = document.getElementById('pt-add'); if (add) add.disabled = taken.size >= act.length;
    // Une pompe ne peut être choisie qu'une fois dans tout le quart : les choix déjà pris sont grisés ailleurs.
    const ps = [...document.querySelectorAll('#pt-list .pt-pump, #pt-list .pt-pump2')], tp = new Set(ps.map(x => x.value).filter(Boolean));
    ps.forEach(sl => sl.querySelectorAll('option').forEach(o => { o.disabled = !!o.value && o.value !== sl.value && tp.has(o.value); }));
    rows().forEach(r => { const w = r.querySelector('.pt-pump2-wrap'), b = r.querySelector('.pt-addp'); if (b && w) b.disabled = w.style.display !== 'none'; });
  };
  window.ptEmpChanged = sel => {
    const e = act.find(x => String(x.id) === sel.value), role = sel.closest('.pt-row').querySelector('.pt-role');
    if (e && !role.value) role.value = guessRole(e);
    ptRefresh();
  };
  window.ptAdd = () => { const l = document.getElementById('pt-list'); l.insertAdjacentHTML('beforeend', rowHtml()); ptRefresh(); const last = l.lastElementChild; if (last) last.querySelector('.pt-emp').focus(); };
  // « + Pompe » : affiche la 2e pompe de l'employé (maximum 2 par employé et par quart, règle du serveur).
  window.ptAddPump = btn => {
    const r = btn.closest('.pt-row'), w = r.querySelector('.pt-pump2-wrap'), sl = r.querySelector('.pt-pump2');
    if (!w || !sl) return;
    const used = new Set([...document.querySelectorAll('#pt-list .pt-pump, #pt-list .pt-pump2')].map(x => x.value).filter(Boolean));
    const free = pumpOpts.slice(1).find(([v]) => !used.has(String(v)));
    if (!free) { toast('Aucune autre pompe disponible : toutes sont déjà affectées.'); return; }
    w.style.display = ''; sl.value = String(free[0]);
    ptRefresh(); sl.focus();
  };
  window.ptDelPump = btn => { const r = btn.closest('.pt-row'), w = r.querySelector('.pt-pump2-wrap'); if (w) { w.querySelector('select').value = ''; w.style.display = 'none'; } ptRefresh(); };
  window.ptRemove = btn => { const r = btn.closest('.pt-row'); if (rows().length <= 1) { r.querySelectorAll('select').forEach(x => { x.value = ''; }); const w = r.querySelector('.pt-pump2-wrap'); if (w) w.style.display = 'none'; } else r.remove(); ptRefresh(); };
  const participants = `<div style="margin-top:14px"><b>Participants du quart</b>
      <p style="color:var(--m);font-size:12px;margin:2px 0 8px">Ajoutez uniquement les employés présents. Une ligne vide est ignorée.</p>
      <div id="pt-list" style="max-height:36vh;overflow:auto;padding-right:2px">${rowHtml()}</div>
      <button type="button" class="b2" id="pt-add" onclick="ptAdd()">+ Ajouter un participant</button></div>`;
  const _now = new Date(), _pad = n => String(n).padStart(2, '0');
  const _today = _now.getFullYear() + '-' + _pad(_now.getMonth() + 1) + '-' + _pad(_now.getDate());
  const _hhmm = _pad(_now.getHours()) + ':' + _pad(_now.getMinutes());
  form('Ouverture de quart', [['kind', 'Quart', 's', ['Matin', 'Après-midi', 'Nuit', 'Personnalisé']], ['odate', 'Date d’ouverture', 'date'], ['otime', 'Heure d’ouverture', 'time'], ['reg', 'Caisse', 's', rg.map(x => [x.id, x.name + ' (' + fl(x.balance) + ')'])], ['ci', 'Caisse initiale (' + CUR + ')', 'number'],
    ...cs.map((c, i) => ['i' + i, `${c.pn}, compteur ${c.counter_number} (${c.product}) : index initial`, 'number'])],
    { odate: _today, otime: _hhmm, ci: rg[0]?.balance, ...Object.fromEntries(cs.map((c, i) => ['i' + i, c.current_index])) },
    async d => {
      // Date / heure d’ouverture : permet d’enregistrer un quart en retard ; le serveur le replace chronologiquement.
      if (!d.odate) throw new Error('Indiquez la date d’ouverture du quart.');
      const openedMs = new Date(d.odate + 'T' + ((d.otime || '00:00').length === 5 ? (d.otime || '00:00') + ':00' : d.otime)).getTime();
      if (Number.isNaN(openedMs)) throw new Error('Date/heure d’ouverture invalide.');
      if (openedMs > Date.now() + 60000) throw new Error('La date/heure d’ouverture ne peut pas être dans le futur.');
      const chosen = rows().map(r => {
        const p1 = r.querySelector('.pt-pump')?.value || '';
        const p2 = r.querySelector('.pt-pump2')?.value || '';
        const pumps = [p1, p2].filter(Boolean);
        if (pumps.length === 2 && pumps[0] === pumps[1]) throw new Error('Les deux pompes d’un même employé doivent être différentes.');
        return { id: r.querySelector('.pt-emp').value, role: r.querySelector('.pt-role').value, pumps };
      }).filter(x => x.id);
      if (new Set(chosen.map(x => x.id)).size !== chosen.length) throw new Error('Un employé ne peut être ajouté qu’une seule fois.');
      const employee_roles = chosen.map(x => ({ employee_id: +x.id, role: ROLE_LABEL[x.role] || 'Participant' }));
      if (employee_roles.filter(x => x.role === 'Chef de quart').length > 1) throw new Error('Un seul chef de quart peut être désigné.');
      const pump_assignments = [];
      const usedPumps = new Set();
      for (const x of chosen) {
        for (const pid of x.pumps) {
          if (usedPumps.has(String(pid))) throw new Error('Une pompe ne peut être affectée qu’à un seul employé du quart.');
          usedPumps.add(String(pid));
          pump_assignments.push({ employee_id: +x.id, pump_id: +pid });
        }
      }
      const doOpen = async () => {
        try {
          await Po('/shifts/open', { kind: d.kind, cash_register_id: +d.reg, opening_cash: +d.ci, employee_ids: chosen.map(x => +x.id), employee_roles, pump_assignments, counters: cs.map((c, i) => ({ counter_id: c.id, index_start: +d['i' + i] })), shift_date: d.odate, opened_at: new Date(openedMs).toISOString() });
          closeM(); go('quart');
        } catch (e) { toast(errMsg(e)); }
      };
      if (d.odate < _today) ask('Ce quart sera enregistré à la date du ' + d.odate + ' (date antérieure) et replacé automatiquement dans l’ordre chronologique des quarts. Continuer ?', doOpen);
      else await doOpen();
    }, participants);
  // Index initial : repris du dernier index connu, non modifiable (seul l'index final / nouveau est saisi)
  cs.forEach((c, i) => { const el = document.getElementById('f_i' + i); if (el && c.current_index != null) { el.readOnly = true; el.style.background = 'var(--bg,#f1f1f1)'; el.style.cursor = 'not-allowed'; el.title = 'Index initial : repris automatiquement, non modifiable'; } });
  // Modale élargie + champ date borné à aujourd’hui + aide de placement chronologique
  const box = document.querySelector('#m > div'); if (box) box.classList.add('oq-wide');
  const fd = document.getElementById('f_odate'); if (fd) { fd.max = _today; fd.required = true; }
  const grid = document.querySelector('#m > div .g');
  if (grid) grid.insertAdjacentHTML('afterend', '<p id="oq-place" class="muted" style="font-size:12px;margin:8px 0 0">Pour un quart oublié ou saisi en retard, choisissez sa date et son heure réelles : il sera replacé automatiquement entre les quarts voisins.</p>');
  // Placement chronologique : à chaque changement de date/heure, on interroge le serveur
  // (quart précédent / suivant) et on préremplit les index initiaux avec la clôture du quart précédent.
  const defaults = Object.fromEntries(cs.map((c, i) => [i, c.current_index]));
  let placeSeq = 0;
  const refreshPlacement = async () => {
    const dv = document.getElementById('f_odate')?.value, tv = document.getElementById('f_otime')?.value || '00:00', hint = document.getElementById('oq-place');
    if (!dv || !hint) return;
    const ms = new Date(dv + 'T' + (tv.length === 5 ? tv + ':00' : tv)).getTime();
    if (Number.isNaN(ms)) return;
    const seq = ++placeSeq;
    try {
      const pl = await G('/shifts/placement?at=' + encodeURIComponent(new Date(ms).toISOString()));
      if (seq !== placeSeq || !document.getElementById('oq-place')) return;
      const fmt = x => x ? dt(x) : '—';
      const p = pl.previous, n = pl.next;
      if (!p && !n) { hint.textContent = 'Aucun autre quart enregistré : ce sera le premier.'; hint.style.color = ''; }
      else if (!n) { hint.textContent = 'Ce quart sera le plus récent, après le quart N° ' + p.number + (p.closed_at ? ' (clôturé le ' + fmt(p.closed_at) + ')' : '') + '.'; hint.style.color = ''; }
      else { hint.textContent = 'Ce quart sera inséré ' + (p ? 'après le quart N° ' + p.number + ' (clôturé le ' + fmt(p.closed_at) + ') et ' : '') + 'avant le quart N° ' + n.number + ' (ouvert le ' + fmt(n.opened_at) + '). Les index de compteurs du quart précédent sont repris ; la clôture devra se situer avant le ' + fmt(n.opened_at) + '.'; hint.style.color = 'var(--w, #b7791f)'; }
      if (pl.overlap) { hint.textContent = '⚠ ' + pl.overlap; hint.style.color = 'var(--r, #c0392b)'; }
      // Index initiaux : quart précédent si on s’insère dans l’historique, sinon index courants.
      cs.forEach((c, i) => {
        const inp = document.getElementById('f_i' + i); if (!inp) return;
        const prevIdx = pl.previous?.indexes?.[c.id];
        inp.value = (pl.inserted && prevIdx != null) ? prevIdx : defaults[i];
      });
    } catch (_) { /* l’indication est facultative : le serveur revalide à l’enregistrement */ }
  };
  ['f_odate', 'f_otime'].forEach(id => { const el = document.getElementById(id); if (el) el.addEventListener('change', refreshPlacement); });
  ptRefresh();
}
/** Raccourci « + Vente » / touche N : choix Produit ou Carburant. */
async function addS() {
  if (!can('sale.create')) return toast('Permission vente refusée', 'error');
  modal(`<h3>Nouvelle vente</h3>
    <p style="color:var(--m);font-size:13px">Choisissez le type de vente à enregistrer.</p>
    <div class="cards" style="grid-template-columns:1fr 1fr;gap:12px;margin:16px 0">
      <button type="button" class="card" style="cursor:pointer;text-align:center;padding:20px 12px" id="vs-prod">
        <div style="font-size:28px;margin-bottom:6px">🛒</div>
        <b>Produit</b>
        <div style="font-size:12px;color:var(--m);margin-top:4px">Boutique, lubrifiants, accessoires…</div>
      </button>
      <button type="button" class="card" style="cursor:pointer;text-align:center;padding:20px 12px" id="vs-fuel">
        <div style="font-size:28px;margin-bottom:6px">⛽</div>
        <b>Carburant</b>
        <div style="font-size:12px;color:var(--m);margin-top:4px">Index, litres ou montant</div>
      </button>
    </div>
    <div class="r"><button class="b2" onclick="closeM()">Annuler</button></div>`);
  document.getElementById('vs-prod').onclick = () => { closeM(); addProductSale(); };
  document.getElementById('vs-fuel').onclick = () => { closeM(); addFuel(); };
}
/** Vente produit hors carburant. */
async function addProductSale() {
  const [pr, cl, em, loy] = await Promise.all([G('/products'), G('/customers').catch(() => []), G('/employees').catch(() => []), G('/loyalty/settings').catch(() => null)]);
  const ps = pr.filter(p => p.category != 'CARBURANT' && p.active !== false && p.active !== 0);
  if (!ps.length) return toast('Aucun produit hors carburant disponible', 'error');
  form('Vente de produit', [
    ['p', 'Produit', 's', ps.map(p => [p.id, `${p.name} (${p.sell_price}) stock ${fl(p.stock)}`])],
    ['q', 'Quantité', 'number'],
    ['pay', 'Paiement', 's', pmOpts()],
    ['c', 'Client (si crédit)', 's', [['', 'Aucun'], ...cl.map(c => [c.id, c.name])]],
    ['e', 'Employé', 's', em.map(e => [e.id, e.first_name + ' ' + e.last_name])]
  ].concat(loy && loy.enabled && !loy.fuel_only ? [['yp', 'Fidélité · téléphone (facultatif)', 'text'], ['yl', 'Fidélité · plaque (facultatif)', 'text']] : []), { q: 1 }, async d => {
    const p = ps.find(x => x.id == d.p); if (!p) throw new Error('Aucun produit disponible');
    await Po('/sales', {
      items: [{ product_id: p.id, quantity: d.q }],
      payments: [{ method: d.pay, amount: fl(d.q * p.sell_price) }],
      customer_id: d.c ? +d.c : undefined,
      employee_id: d.e ? +d.e : undefined,
      loyalty: (d.yp || d.yl) ? { phone: d.yp || null, plate: d.yl || null } : undefined
    });
    closeM(); toast('Vente produit enregistrée', 'success'); go(cur === 'quart' ? 'quart' : 'ventes');
  });
}
window.addProductSale = addProductSale;
window.addS = addS;

/* ---------- Vente de carburant : deux modes de saisie, contrôles en temps réel ---------- */
let FM = 'index', FX = {};
async function addFuel() {
  const cu = await G('/shifts/current'); if (!cu) return toast('Ouvrez un quart pour saisir des ventes');
  const [cl, em, loy] = await Promise.all([G('/customers').catch(() => []), G('/employees').catch(() => []), G('/loyalty/settings').catch(() => null)]); FM = 'index';
  const loyHtml = loy && loy.enabled ? `<label>Fidélité · téléphone (facultatif)<input id="fyp" inputmode="tel" placeholder="Ex. 70 11 22 33"></label><label>Fidélité · plaque (facultatif)<input id="fyl" placeholder="Ex. AB-123-CD"></label>` : '';
  modal(`<h3>Vente de carburant</h3><div class="tabs" id="fm"><a data-m="index" class="on">Par index de compteur</a><a data-m="litres">En litres</a>${AP.fuel_amount_entry_allowed ? '<a data-m="montant">En montant</a>' : ''}</div>
  <div class="g"><label>Compteur<select id="fc">${cu.counters.map(c => `<option value="${c.counter_id}">${esc(c.pump)} · C${c.counter_number} · ${esc(c.product)}</option>`).join('')}</select></label>
  <label class="fi">Ancien index<input id="fo" type="number" step="any" readonly style="background:var(--bg,#f1f1f1);cursor:not-allowed" title="Index initial : repris automatiquement du dernier index connu, non modifiable"></label><label class="fi">Nouvel index<input id="fn" type="number" step="any"></label>
  <label class="fl" style="display:none">Quantité (litres)<input id="fq" type="number" step="any"></label><label class="fa" style="display:none">Montant (${CUR})<input id="fa" type="number" step="any"></label>
  <label>Paiement<select id="fp">${pmOpts().map(([c, l]) => `<option value="${c}">${esc(l)}</option>`).join('')}</select></label><label>Client (si crédit)<select id="fu"><option value="">Aucun</option>${cl.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label>
  <label>Employé<select id="fe">${em.map(e => `<option value="${e.id}">${esc(e.first_name + ' ' + e.last_name)}</option>`).join('')}</select></label>${loyHtml}</div>
  <div class="card" id="fsum" style="margin-top:10px"></div><div class="r"><button class="b2" onclick="closeM()">Annuler</button><button id="fok">Enregistrer</button></div>`);
  document.querySelectorAll('#fm a').forEach(a => a.onclick = () => { FM = a.dataset.m; document.querySelectorAll('#fm a').forEach(x => x.classList.toggle('on', x == a)); document.querySelectorAll('.fi').forEach(x => x.style.display = FM == 'index' ? '' : 'none'); document.querySelectorAll('.fl').forEach(x => x.style.display = FM == 'litres' ? '' : 'none'); document.querySelectorAll('.fa').forEach(x => x.style.display = FM == 'montant' ? '' : 'none'); calcF(); });
  ['fo', 'fn', 'fq', 'fa'].forEach(i => $('#' + i).oninput = calcF); $('#fc').onchange = loadF; $('#fok').onclick = () => sendF(false);
  await loadF();
}
async function loadF() { try { FX = await G('/sales/fuel/expected?counter_id=' + $('#fc').value); $('#fo').value = FX.expected_old_index; } catch (e) { FX = {}; toast(errMsg(e)); } calcF(); }
function calcF() {
  const n = id => parseFloat($('#' + id).value), p = FX.price || 0; let l = 0, a = 0, msg = [];
  if (FM == 'index') { l = n('fn') - n('fo'); if (!(l > 0)) msg.push("Le nouvel index doit être supérieur à l'ancien"); if (Math.abs(n('fo') - FX.expected_old_index) > .0005) msg.push(`L'ancien index diffère du dernier index connu (${FX.expected_old_index})`); l = fl(l * 1000) / 1000; a = fl(l * p); }
  else if (FM == 'litres') { l = n('fq'); a = fl(l * p); if (!(l > 0)) msg.push('Saisissez une quantité'); }
  else { a = n('fa'); l = Math.round(a / p * 1000) / 1000; if (!(a > 0)) msg.push('Saisissez un montant'); else if (Math.abs(fl(l * p) - a) > .25) msg.push(`Arrondi : ${l} L × ${p} = ${fl(l * p)} au lieu de ${a}`); }
  $('#fsum').innerHTML = `<b>${isNaN(l) ? '-' : fl(l)} L</b> à ${f(p)}/L = <b>${isNaN(a) ? '-' : f(a)}</b> · ${esc(FX.product || '')}` + msg.map(m => `<div class="warn">${esc(m)}</div>`).join('');
}
// Les données saisies sont conservées dans `saved` : la boîte de confirmation remplace le formulaire à l'écran
async function sendF(confirm, saved) {
  let b = saved;
  if (!b) {
    const n = id => parseFloat($('#' + id).value); b = { mode: FM, counter_id: +$('#fc').value, employee_id: +$('#fe').value || undefined, customer_id: $('#fu').value ? +$('#fu').value : undefined };
    if (FM == 'index') { b.index_old = n('fo'); b.index_new = n('fn'); } else if (FM == 'litres') b.liters = n('fq'); else b.amount = n('fa');
    const amount = FM == 'montant' ? n('fa') : FM == 'litres' ? fl(n('fq') * FX.price) : fl((n('fn') - n('fo')) * FX.price); b.payments = [{ method: $('#fp').value, amount }];
    const yp = $('#fyp'), yl = $('#fyl'); if (yp && yl && (yp.value.trim() || yl.value.trim())) b.loyalty = { phone: yp.value.trim() || null, plate: yl.value.trim() || null };
  }
  b = { ...b, confirm };
  try { const r = await Po('/sales/fuel', b); closeM(); toast(`Vente enregistrée : ${r.liters} L, ${f(r.amount)}` + (r.loyalty && r.loyalty.points_earned ? ` · +${r.loyalty.points_earned} point(s) fidélité` : '')); go(cur === 'quart' ? 'quart' : 'ventes'); }
  catch (e) { if (e.message == 'Confirmation requise') ask('<b>Incohérences détectées :</b><br>' + (e.details || []).map(esc).join('<br>') + '<br><br>Enregistrer quand même ?', () => sendF(true, b)); else toast(errMsg(e)); }
}

/* ---------- Employés : liste et fiche individuelle ---------- */
let ETAB = 'id', EGROUP = 'identite', EPER = { from: monthFirst(), to: dayNow() }, EMON = monthNow(), EMP = null;

/* Groupes d'onglets imbriqués pour réduire le nombre d'onglets visibles */
const EGROUPS = {
  identite: { label: 'Identité', tabs: [['id', 'Identité'], ['comp', 'Comportement'], ['acces', 'Accès & rôle']] },
  activite: { label: 'Activité', tabs: [['actions', 'Historique des actions'], ['quarts', 'Quarts'], ['perf', 'Performances'], ['ecarts', 'Écarts'], ['creances', 'Dettes clients']] },
  finances: { label: 'Finances RH', tabs: [['dettes', 'Dettes & avances'], ['paie', 'Paie & bulletins'], ['fin', 'Situation financière']] }
};
// Onglets horizontaux de la fiche employé (même présentation que la fiche produit)
const EFLAT = [['id', '📊', "Vue d'ensemble"], ['comp', '🧭', 'Comportement'], ['acces', '🔐', 'Accès & rôle'], ['actions', '📜', 'Historique des actions'], ['quarts', '🕐', 'Quarts'], ['perf', '📈', 'Performances'], ['ecarts', '⚖', 'Écarts'], ['creances', '🤝', 'Dettes clients'], ['dettes', '🧾', 'Dettes & avances'], ['paie', '💵', 'Paie & bulletins'], ['fin', '🏦', 'Situation financière']];
function groupOf(tab) {
  for (const [g, def] of Object.entries(EGROUPS)) if (def.tabs.some(([k]) => k === tab)) return g;
  return 'identite';
}
const setTab = t => { ETAB = t; EGROUP = groupOf(t); go('empf', arg); };
const setGroup = g => {
  EGROUP = g;
  const first = EGROUPS[g].tabs[0][0];
  // Si l'onglet actuel n'appartient pas au nouveau groupe, basculer sur le premier sous-onglet
  if (!EGROUPS[g].tabs.some(([k]) => k === ETAB)) ETAB = first;
  go('empf', arg);
};
const setPer = () => { EPER = { from: $('#pf').value, to: $('#pt').value }; go('empf', arg); };
const perBar = () => `<div class="bar"><label style="flex-direction:row;align-items:center;gap:6px">Du <input type="date" id="pf" value="${EPER.from}"></label><label style="flex-direction:row;align-items:center;gap:6px">au <input type="date" id="pt" value="${EPER.to}"></label><button class="b2" onclick="setPer()">Appliquer</button></div>`;
const monBar = () => `<div class="bar"><label style="flex-direction:row;align-items:center;gap:6px">Mois <input type="month" id="mm" value="${EMON}" onchange="EMON=this.value;go('empf',arg)"></label></div>`;
async function vEmpList() {
  const ls = await G('/employees' + archQuery('employees')), hr = can('hr.manage') || can('hr.payroll'), inactiveView = ARCH.employees;
  const accessLabel = e => {
    if (!e.user_id) return '<span class="tag x">Sans compte</span>';
    if (e.user_active === false) return `<span class="tag x">Accès suspendu</span><br><small style="color:var(--m)">${esc(e.user_login || '')}</small>`;
    return `<span class="tag ok">Compte actif</span><br><small style="color:var(--m)">${esc(e.user_login || '')}</small>`;
  };
  return `<div class="bar"><input class="q" placeholder="Rechercher" oninput="flt(this)">${can('settings.edit') && !inactiveView ? `<button onclick="addEmp()">Ajouter un employé</button>` : ''}${can('user.manage') && !inactiveView ? `<button class="b2" onclick="typeof addU==='function'&&addU()">Octroyer un accès compte</button>` : ''}${archToggleBtn('employees')}${can('settings.edit') || can('hr.view') || can('hr.manage') ? `<button class="b2" onclick="empPdf()">📄 Export PDF</button>` : ''}</div>`
    + archBanner('employees', ls.length)
    + `<p style="font-size:12px;color:var(--m);margin:0 0 8px">1) Créez l'employé · 2) Octroyez un accès compte si besoin. Un employé sans compte peut travailler (quarts, ventes). Seul le statut <b>inactif</b> suspend tout.</p>`
    + T(['', 'Matricule', 'Nom', 'Fonction', 'Statut RH', 'Accès compte', ...(hr ? ['Salaire de base'] : []), ''],
      ls.map(e => [
        av('employees', e.id, e.photo_path, e.first_name + ' ' + e.last_name),
        esc(e.matricule),
        `<a href="#" style="font-weight:600;color:var(--p)" onclick="event.preventDefault();event.stopPropagation();ETAB='id';EGROUP='identite';go('empf',${e.id})">${esc(e.first_name + ' ' + e.last_name)}</a>`,
        esc(e.position),
        `<span class="tag ${e.status == 'actif' ? '' : 'x'}">${e.status}</span>`,
        accessLabel(e),
        ...(hr ? [f(e.base_salary)] : []),
        archRowBtn('employees', e.id, inactiveView, e.first_name + ' ' + e.last_name)
      ]),
      i => `ETAB='id';EGROUP='identite';go('empf',${ls[i].id})`);
}
/** Export PDF de la liste des employés affichée (liste active ou inactive, filtre « Rechercher » respecté). */
window.empPdf = async function () {
  try {
    const hr = can('hr.manage') || can('hr.payroll'), inactiveView = ARCH.employees;
    const q = ((document.querySelector('#pg input.q') || {}).value || '').trim().toLowerCase();
    const all = await G('/employees' + archQuery('employees'));
    const ls = q ? all.filter(e => [e.matricule, e.first_name, e.last_name, e.position, e.status].join(' ').toLowerCase().includes(q)) : all;
    if (!ls.length) return toast('Aucun employé à exporter.', 'info');
    const acc = e => !e.user_id ? 'Sans compte' : (e.user_active === false ? 'Accès suspendu' : 'Compte actif') + (e.user_login ? ' (' + e.user_login + ')' : '');
    const head = ['Matricule', 'Nom', 'Fonction', 'Statut RH', 'Accès compte'].concat(hr ? ['Salaire de base'] : []);
    const rows = ls.map(e => [String(e.matricule ?? ''), (e.first_name || '') + ' ' + (e.last_name || ''), e.position || '', e.status || '', acc(e)].concat(hr ? [Math.round(Number(e.base_salary) || 0)] : []));
    const notes = [ls.length + ' employé(s)' + (q ? ' - filtre « ' + q + ' »' : '') + '.'];
    toast('Génération du PDF…', 'info');
    await brandedPdf({ title: inactiveView ? 'Employés inactifs' : 'Liste des employés', subtitle: new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }),
      sections: [{ type: 'table', head, rows, notes }], landscape: head.length > 5 ? true : undefined, filename: 'employes', signatures: [{ label: 'Responsable RH' }, { label: 'Direction' }] });
  } catch (e) { if (!e || !e.stale) toast((e && e.message) || 'Export PDF impossible', 'error'); }
};
async function vEmpf() {
  const id = arg;
  if (!id) return `<p class="warn">Aucun employé sélectionné.</p><button class="b2" onclick="go('emp')">Retour à la liste</button>`;
  let d = null, e = null, hrOk = true;
  try {
    d = await G('/hr/employees/' + id);
    e = EMP = d.employee;
    // Enrichir avec login / user_active depuis le catalogue
    try {
      const ls = await G('/employees?status=all').catch(() => []);
      const cat = (ls || []).find(x => x.id == id);
      if (cat) { e.user_login = cat.user_login; e.user_active = cat.user_active; e.user_id = e.user_id || cat.user_id; }
    } catch (_) {}
  } catch (err) {
    // Module RH indisponible / non licencié : profil de base depuis le catalogue
    hrOk = false;
    const ls = await G('/employees?status=all').catch(() => []);
    e = EMP = (ls || []).find(x => x.id == id) || null;
    if (!e) {
      return `<p class="warn">Employé introuvable ou accès refusé.</p>
        <button class="b2" onclick="go('emp')">Retour à la liste</button>`;
    }
    d = { employee: e, history: [], debts: { initial: 0, repaid: 0, balance: 0 }, advances_outstanding: 0, _basic: true };
  }
  // Profil de base (sans module RH) : identité + ventes + notes
  if (!hrOk || d._basic) {
    let sales = [];
    try {
      const all = await G('/sales').catch(() => []);
      sales = (all || []).filter(s => s.employee_id == id || s.employee_id == e.id).slice(0, 40);
    } catch (_) {}
    const creditSales = sales.filter(s => /credit|crédit/i.test(String(s.payment_method || s.method || s.kind || '')));
    return `<div class="card split">
        <div>${av('employees', e.id, e.photo_path, e.first_name + ' ' + e.last_name, true)}</div>
        <div class="grow">
          <h2 style="margin:0">${esc(e.first_name + ' ' + e.last_name)}</h2>
          <div style="color:var(--m)">${esc(e.position)} · Matricule ${esc(e.matricule)}</div>
          <span class="tag ${e.status == 'actif' ? '' : 'x'}">${e.status || '—'}</span>
        </div>
        <div><button class="b2" onclick="go('emp')">Liste</button></div>
      </div>
      <div class="cards">
        ${card('Téléphone', esc(e.phone || '—'))}
        ${card('Email', esc(e.email || '—'))}
        ${card('Adresse', esc(e.address || '—'))}
        ${card("Date d'embauche", esc(e.hired_on || '—'))}
      </div>
      <div class="card" style="text-align:left">
        <h3 style="margin-top:0">Identité</h3>
        ${kvh([
          ['Nom complet', esc((e.first_name || '') + ' ' + (e.last_name || ''))],
          ['Matricule', esc(e.matricule)],
          ['Fonction', esc(e.position)],
          ['Statut', e.status],
          ['Téléphone', esc(e.phone)],
          ['Email', esc(e.email)],
          ['Adresse / quartier', esc(e.address)],
          ['Contrat', esc(e.contract_type || '—')],
          ["Date d'embauche", esc(e.hired_on || '—')],
        ])}
        ${e.notes ? `<p style="margin-top:12px"><b>Notes</b><br>${esc(e.notes)}</p>` : '<p style="color:var(--m);font-size:13px">Espace notes : disponible via la fiche RH si le module est activé.</p>'}
      </div>
      <h3>Historique des ventes (récentes)</h3>
      ${sales.length
        ? T(['N°', 'Facture', 'Date', 'Type', 'Total', 'Statut'], sales.map(s => [s.id, esc(s.invoice_no), dt(s.sold_at || s.created_at), esc(s.kind), f(s.total), esc(s.status)]))
        : '<p style="color:var(--m)">Aucune vente associée ou module ventes non accessible.</p>'}
      <h3>Ventes à crédit (dettes clients liées)</h3>
      ${creditSales.length
        ? T(['N°', 'Date', 'Total', 'Statut'], creditSales.map(s => [s.id, dt(s.sold_at || s.created_at), f(s.total), esc(s.status)]))
        : '<p style="color:var(--m)">Aucune vente à crédit identifiée sur cet employé.</p>'}
      ${can('user.manage') && e.user_id && e.user_active !== false && e.status === 'actif' ? `<div class="bar"><button class="bd" onclick="empResetPassword(${e.id})">Réinitialiser le mot de passe</button></div>` : ''}
      <p class="warn" style="margin-top:12px">Profil simplifié : le module RH n'est pas disponible pour ce compte (contrat / licence). Activez le module RH pour dettes RH, paie, écarts, diplômes et alertes avancées.</p>
      <div class="r"><button class="b2" onclick="go('emp')">Retour</button></div>`;
  }
  // S'assurer que le groupe correspond à l'onglet courant
  EGROUP = groupOf(ETAB);
  let body = '';
  try { body = await ETABS[ETAB](e, d); } catch (err) {
    body = `<p class="warn">Onglet indisponible : ${esc(err.message || String(err))}</p>`;
  }
  const flatTabs = EFLAT.map(([k, ico, l]) => `<button type="button" role="tab" aria-selected="${k === ETAB}" class="b2 ${k === ETAB ? 'on' : ''}" onclick="setTab('${k}')"><span class="pp-ti" aria-hidden="true">${ico}</span><span>${l}</span></button>`).join('');
  const accessTag = !e.user_id ? '<span class="tag x">Sans compte</span>' : (e.user_active === false ? '<span class="tag x">Accès suspendu</span>' : '<span class="tag ok">Compte actif</span>');
  return `<div class="card split"><div>${av('employees', e.id, e.photo_path, e.first_name + ' ' + e.last_name, true)}</div><div class="grow"><h2 style="margin:0">${esc(e.first_name + ' ' + e.last_name)}</h2><div style="color:var(--m)">${esc(e.position)} · Matricule ${esc(e.matricule)}${e.user_login ? ' · Login ' + esc(e.user_login) : ''}</div><span class="tag ${e.status == 'actif' ? '' : 'x'}">${e.status}</span> ${accessTag}</div><div style="display:flex;flex-wrap:wrap;gap:6px">${can('settings.edit') || can('hr.view') ? `<button class="b2" onclick="go('emp')">Liste</button>` : ''} ${can('hr.manage') ? `<button onclick="editEmp()">Modifier la fiche</button>` : ''} ${typeof empAccessButtons === 'function' ? empAccessButtons(e) : ''} ${can('user.manage') && e.user_id && e.user_active !== false && e.status === 'actif' ? `<button class="bd" onclick="empResetPassword(${e.id})">Réinitialiser le mot de passe</button>` : ''}</div></div>
  <div class="pp-tabs emp-tabs" role="tablist" aria-label="Sections de la fiche employé">${flatTabs}</div>
  <div class="emp-body">${body}</div>`;
}
function editEmp() {
  const e = EMP, F = [['matricule', 'Matricule'], ['last_name', 'Nom'], ['first_name', 'Prénom'], ['phone', 'Téléphone'], ['position', 'Fonction', 's', ['administrateur', 'gérant', 'caissier', 'pompiste', 'superviseur', 'magasinier', 'comptable']], ['status', 'Statut RH (inactif = tout suspendu)', 's', ['actif', 'inactif']], ['address', 'Adresse'], ['email', 'Email'], ['base_salary', 'Salaire de base mensuel', 'number'], ['contract_type', 'Type de contrat'], ['hired_on', "Date d'embauche", 'date'], ['contract_start', 'Début du contrat', 'date'], ['contract_end', 'Fin du contrat', 'date']];
  form('Modifier la fiche', F, e, async d => { const ch = {}; for (const [k] of F) { const v = d[k] === '' ? null : d[k]; if (String(v ?? '') !== String(e[k] ?? '')) ch[k] = v; } if (!Object.keys(ch).length) return closeM(); await api('PATCH', '/hr/employees/' + e.id, ch); closeM(); toast('Fiche mise à jour (modification historisée)'); go('empf', e.id); });
}
// Rôle individuel : un employé peut avoir des droits propres, séparés des autres employés du même poste
window.accEdit = async id => {
  try {
    const a = await G(`/hr/employees/${id}/access`), have = new Set((a.permissions || []).map(p => p.code));
    modal(`<h3 style="margin-top:0">Rôle individuel — ${esc(a.employee.name)}</h3><p class="muted" style="font-size:12px">Ces droits ne concernent que cet employé. Les autres employés du même poste ne sont pas modifiés. Vous ne pouvez accorder que les droits que vous possédez vous-même.</p>`
      + `<div style="max-height:46vh;overflow:auto">${(a.catalogue || []).map(p => `<label style="flex-direction:row;align-items:center;gap:8px;padding:3px 0"><input type="checkbox" class="acc-p" value="${esc(p.code)}" ${have.has(p.code) ? 'checked' : ''}> ${esc(p.label)} <small style="color:var(--m)">${esc(p.code)}</small></label>`).join('')}</div>`
      + `<div class="r" style="margin-top:12px"><button class="b2" onclick="closeM()">Annuler</button><button onclick="accSave(${Number(id)})">Enregistrer</button></div>`);
  } catch (e) { toast(errMsg(e), 'error'); }
};
window.accSave = async id => {
  const permissions = [...document.querySelectorAll('.acc-p:checked')].map(x => x.value);
  try { await api('PUT', `/hr/employees/${id}/personal-role`, { permissions }); closeM(); toast('Rôle individuel enregistré', 'success'); go('empf', arg); } catch (e) { toast(errMsg(e), 'error'); }
};
window.accRevert = async id => {
  try {
    const roles = await G('/admin/roles/assignable');
    form('Revenir à un rôle commun', [['role', 'Rôle', 's', roles.map(r => [r.code, r.label])]], {}, async d => { await Po(`/hr/employees/${id}/personal-role/revert`, { role: d.role }); closeM(); toast('Rôle commun rétabli', 'success'); go('empf', arg); });
  } catch (e) { toast(errMsg(e), 'error'); }
};
// Historique des actions au nom de l'employé : transparence, rejet possible (l'action n'est jamais supprimée)
const ACT_LABEL = { vente: 'Vente', dette_client: 'Dette client', ecart: 'Écart', anomalie: 'Anomalie', decision_ecart: 'Décision', dette_employe: 'Dette employé', role: 'Accès', autre: 'Autre' };
window.actReject = id => form('Rejeter cette action', [['reason', 'Pourquoi la rejetez-vous ?']], {}, async d => {
  try { await Po(`/hr/actions/${id}/reject`, { reason: d.reason }); closeM(); toast('Rejet enregistré : l’action reste dans l’historique avec votre motif', 'success'); go('empf', arg); } catch (e) { toast(errMsg(e), 'error'); }
});
window.actReview = id => form('Répondre au rejet', [['note', 'Votre réponse à l’employé']], {}, async d => {
  try { await Po(`/hr/actions/${id}/review`, { note: d.note }); closeM(); toast('Réponse enregistrée', 'success'); go('empf', arg); } catch (e) { toast(errMsg(e), 'error'); }
});
const ETABS = {
  async actions(e) {
    const h = await G(`/hr/employees/${e.id}/actions`);
    if (!h.actions.length) return `<div class="card"><h3 style="margin-top:0">Historique des actions</h3><p style="color:var(--m)">Aucune action enregistrée à ce nom pour le moment.</p></div>`;
    return `<div class="card"><h3 style="margin-top:0">Historique des actions à ce nom</h3><p class="muted" style="font-size:12px">${h.can_reject ? 'Vous pouvez rejeter une action faite par quelqu’un d’autre en votre nom. Le rejet ne supprime rien : il est mentionné ici et le gérant est prévenu.' : 'Chaque action faite au nom de cet employé est listée ici. L’employé peut la rejeter ; un rejet ne supprime rien.'}</p></div>`
      + T(['Date', 'Type', 'Action', 'Montant', 'Par', 'État', ''], h.actions.map(a => [dt(a.created_at), esc(ACT_LABEL[a.kind] || a.kind), esc(a.description), a.amount == null ? '' : f(a.amount), a.self_made ? 'Vous-même' : esc(a.performed_by_name || ''),
        a.status === 'rejete' ? `<span class="tag" style="background:var(--r);color:#fff">Rejetée</span><div style="font-size:12px">Motif : ${esc(a.rejected_reason || '')}${a.review_note ? `<br><b>Réponse du gérant :</b> ${esc(a.review_note)}` : ''}</div>` : '<span class="tag">Active</span>',
        (h.can_reject && a.status !== 'rejete' && !a.self_made ? `<button class="b2" onclick="actReject(${a.id})">Rejeter</button>` : '') + (h.can_review && a.status === 'rejete' && !a.review_note ? `<button class="b2" onclick="actReview(${a.id})">Répondre</button>` : '')]));
  },
  async creances(e) {
    const d = await G(`/hr/employees/${e.id}/customer-debts`);
    if (!d.items.length) return `<div class="card"><h3 style="margin-top:0">Dettes clients</h3><p style="color:var(--m)">Aucune dette client enregistrée à ce nom.</p></div>`;
    const open = d.items.filter(x => x.status === 'ouverte' || x.status === 'partielle').reduce((a, x) => a + x.remaining, 0);
    return `<div class="card"><h3 style="margin-top:0">Dettes clients enregistrées à ce nom</h3>${kvh([['Reste à encaisser (ventes à crédit ouvertes)', f(open)]])}<p class="muted" style="font-size:12px">${esc(d.note)}</p></div>`
      + T(['Vente', 'Date', 'Client', 'Montant', 'Réglé (lié à la vente)', 'Reste', 'Statut'], d.items.map(x => [x.sale_id, dt(x.sold_at), esc(x.customer), f(x.amount), f(x.paid_linked), f(x.remaining), esc(x.status)]));
  },
  async acces(e) {
    const a = await G(`/hr/employees/${e.id}/access`);
    if (!a.linked) return `<div class="card"><h3 style="margin-top:0">Accès & rôle</h3><p>Aucun compte utilisateur n'est lié à cet employé : il ne peut pas se connecter. Créez ou liez son compte dans Paramètres > Utilisateurs.</p></div>`;
    const chips = (a.permissions || []).map(p => `<span class="tag" title="${esc(p.code)}">${esc(p.label)}</span>`).join(' ') || '-';
    return `<div class="card"><h3 style="margin-top:0">Accès & rôle</h3>${kvh([['Compte', esc(a.account.login)], ['Fonction (poste)', esc(a.employee.position)], ['Rôle', esc(a.role.label) + (a.role.personal ? ' <span class="tag">rôle individuel</span>' : '')], ['Dépenses de l’entreprise', a.expense_allowed ? 'Autorisées' : 'Non autorisées (réservées à l’administrateur local et au gérant)']])}</div>`
      + (a.can_edit ? `<div class="bar"><button onclick="accEdit(${e.id})">${a.role.personal ? 'Ajuster le rôle individuel' : 'Donner un rôle individuel'}</button>${a.role.personal ? `<button class="b2" onclick="accRevert(${e.id})">Revenir à un rôle commun</button>` : ''}</div>` : '')
      + `<h3>Droits actuels</h3><div class="card">${chips}</div>`;
  },
  async id(e, d) {
    return `<div class="card"><h3 style="margin-top:0">Informations administratives</h3>${kvh([['Téléphone', esc(e.phone)], ['Email', esc(e.email)], ['Adresse', esc(e.address)], ["Date d'embauche", esc(e.hired_on)], ['Contrat', esc([e.contract_type, e.contract_start, e.contract_end ? '→ ' + e.contract_end : ''].filter(Boolean).join(' '))], ...(e.base_salary !== undefined ? [['Salaire de base mensuel', f(e.base_salary)]] : [])])}</div>
      <h3>Historique des modifications administratives</h3>` + T(['Date', 'Champ', 'Ancienne valeur', 'Nouvelle valeur', 'Par'], d.history.map(h => [dt(h.changed_at), esc(h.field), esc(h.old_value ?? ''), esc(h.new_value ?? ''), esc(h.login)]));
  },
  async quarts(e) {
    const ls = await G(`/hr/employees/${e.id}/shifts?from=${EPER.from}&to=${EPER.to}`); window.ESH = ls;
    return perBar() + T(['Quart', 'Type', 'Ouverture', 'Fermeture', 'Responsable', 'Pompe', "Chiffre d'affaires", 'Opérations', 'État'], ls.map(s => [s.number, esc(s.kind), dt(s.opened_at), dt(s.closed_at), esc(s.manager), esc(s.pump || ''), f(s.revenue), s.operations, `<span class="tag ${s.state == 'clôturé' ? '' : 'x'}">${s.state}</span>`]), i => `empOps(${ls[i].id},${ls[i].number},'${ls[i].status}')`) + `<p style="color:var(--m)">Cliquez sur un quart pour voir le détail des opérations enregistrées.</p>`;
  },
  async perf(e) {
    const p = await G(`/hr/employees/${e.id}/performance?from=${EPER.from}&to=${EPER.to}`);
    const chartId = `empPerfChart${e.id}_${Date.now()}`;
    const products = Array.isArray(p.by_product) ? p.by_product : [];
    const chart = `<div class="card" style="margin:12px 0"><h3 style="margin-top:0">Diagramme des ventes par produit</h3>${products.length ? `<div style="height:260px;position:relative"><canvas id="${chartId}" role="img" aria-label="Chiffre d'affaires attribué par produit"></canvas></div>` : '<p style="color:var(--m)">Aucune donnée produit pour cette période.</p>'}</div>`;
    if (products.length) setTimeout(() => {
      if (typeof Chart === 'undefined') return;
      const canvas = document.getElementById(chartId);
      if (!canvas) return;
      new Chart(canvas, {
        type: 'bar',
        data: { labels: products.map(x => String(x.product || 'Sans nom')), datasets: [{ label: 'Chiffre d’affaires', data: products.map(x => Number(x.amount || 0)) }] },
        options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => new Intl.NumberFormat('fr-FR').format(Number(ctx.raw || 0)) + ' FCFA' } } }, scales: { x: { beginAtZero: true, ticks: { callback: v => new Intl.NumberFormat('fr-FR', { notation: 'compact' }).format(v) } } } }
      });
    }, 80);
    return perBar() + `<div class="cards">${card("Chiffre d'affaires attribué", f(p.revenue))}${card('Quarts travaillés', p.shifts)}${card('Moyenne par quart', f(p.avg_per_shift))}${card('Litres de carburant', fmtN(p.liters) + ' L')}${card('Opérations', p.operations)}${card('Période précédente', f(p.previous.revenue), p.variation_pct == null ? 'Comparaison impossible' : (p.variation_pct > 0 ? '+' : '') + p.variation_pct + ' %')}</div>` + chart +
    `<div class="cards" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr))">${hb('Par produit', products.map(x => [x.product, x.amount, fmtN(x.quantity) + ' · ' + f(x.amount)]))}${hb('Carburant par pompe', p.by_pump.map(x => [x.pump, x.amount, fmtN(x.quantity) + ' L · ' + f(x.amount)]))}</div><div class="warn">${esc(p.note)}</div>`;
  },
  async ecarts(e) {
    const [ls, anoms] = await Promise.all([G(`/hr/employees/${e.id}/gaps`), G(`/hr/employees/${e.id}/anomalies`).catch(() => [])]); window.EGP = ls;
    const anomHtml = anoms.length ? `<h3>Anomalies à son nom</h3>` + T(['Quart', 'Type', 'Description', 'Montant', 'Écart lié'], anoms.map(a => [a.shift_number, esc(a.kind), esc(a.description), a.amount == null ? '' : fmtN(a.amount), a.gap_id ? '#' + a.gap_id : ''])) : '';
    return T(['Quart', 'Type', 'Écart', 'Statut', 'Justification', 'Décision du gérant', 'Dette', ''], ls.map(g => [g.shift_number, g.kind + (g.product ? ' · ' + esc(g.product) : ''), fmtN(g.amount), `<span class="tag ${g.status == 'cloture' || g.status == 'regularise' ? '' : 'x'}">${g.status}</span>`, esc(g.employee_justification || ''), esc(g.manager_decision || ''), g.debt_id ? '#' + g.debt_id : '',
      `<button class="b2" onclick="gapHist(${g.id})">Historique</button>` + (g.status != 'cloture' ? ` <button class="b2" onclick="gapJust(${g.id})">Justifier</button>` : '') + ((can('hr.gaps') || can('hr.payroll')) && g.status != 'cloture' ? ` <button class="b2" onclick="gapDecide(${g.id},'${g.status}')">Décider</button>` : '') + ((can('hr.gaps') || can('hr.payroll')) && g.status == 'accepte' && !g.debt_id ? ` <button onclick="gapDebt(${g.id},${g.kind === 'stock' ? 'null' : Math.abs(g.amount)})">Créer la dette</button>` : '')])) + `<div class="warn">Un écart n'entraîne jamais de retenue automatique : la dette et la retenue sur salaire résultent de décisions enregistrées.</div>` + anomHtml;
  },
  async dettes(e) {
    const [ds, av2] = await Promise.all([G(`/hr/employees/${e.id}/debts`), G(`/hr/employees/${e.id}/advances`)]); window.EDB = ds;
    const ini = ds.filter(d => d.status != 'annule').reduce((a, d) => a + d.amount, 0), paid = ds.filter(d => d.status != 'annule').reduce((a, d) => a + d.paid, 0);
    return `<div class="cards">${card('Dettes initiales', f(ini))}${card('Remboursé', f(paid))}${card('Solde des dettes', f(ini - paid))}${card('Avances à déduire', f(av2.reduce((a, x) => a + (x.status == 'en_cours' ? x.remaining : 0), 0)))}</div>
    <div class="bar">${can('hr.debts') ? `<button onclick="newDebt()">Nouvelle dette</button>` : ''}${can('hr.payroll') ? `<button class="b2" onclick="newAdv()">Nouvelle avance sur salaire</button>` : ''}</div><h3>Dettes</h3>` +
    T(['Date', 'Motif', 'Initial', 'Remboursé', 'Solde', 'Statut', 'Règlements', ''], ds.map(d => [esc(d.debt_date), esc(d.reason) + (d.has_attachment ? ` <a onclick="dlFile('/hr/debts/${d.id}/attachment','piece-${d.id}')" style="cursor:pointer">📎</a>` : ''), f(d.amount), f(d.paid), f(d.balance), `<span class="tag ${d.status == 'solde' ? '' : 'x'}">${d.status}</span>`,
      d.payments.map(p => `<a style="cursor:pointer" onclick="dlFile('/hr/debt-payments/${p.id}/receipt.pdf',${jsArg(p.receipt_no)})">${esc(p.receipt_no)}</a> ${f(p.amount)} (${esc(p.method)})`).join('<br>') || '-',
      can('hr.debts') ? (d.status == 'en_cours' ? `<button onclick="payDebt(${d.id},${d.balance})">Rembourser</button> ` : '') + (['en_cours', 'conteste'].includes(d.status) ? `<button class="b2" onclick="editDebt(${d.id})">Modifier</button> ` : '') + (d.paid == 0 && d.status != 'annule' ? `<button class="bd" onclick="cancelDebt(${d.id})">Annuler</button>` : '') : ''])) +
    '<h3>Avances sur salaire</h3>' + T(['Date', 'Mois', 'Montant', 'Déduit', 'Reste', 'Mode', 'Référence', 'Statut'], av2.map(a => [esc(a.advance_date), esc(a.pay_month.slice(0, 7)), f(a.amount), f(a.deducted), f(a.remaining), esc(a.method), esc(a.reference || a.reason || ''), `<span class="tag ${a.status == 'solde' ? '' : 'x'}">${a.status}</span>`]));
  },
  async paie(e) {
    const [adj, sl] = await Promise.all([G(`/hr/adjustments?employee_id=${e.id}&month=${EMON}`).catch(() => []), G(`/hr/payroll?employee_id=${e.id}`)]), P = can('hr.payroll');
    return monBar() + (P ? `<div class="bar"><button onclick="newAdj()">Ajouter prime / indemnité / retenue</button><button onclick="prepPay()">Préparer la paie du mois</button><button class="b2" onclick="dryRunOne()">Simulation (dry-run)</button></div>` : '') + '<h3>Éléments de paie du mois</h3>' +
      T(['Type', 'Libellé', 'Montant', ''], adj.map(a => [a.kind, esc(a.label), f(a.amount), P ? `<button class="bd" onclick="delAdj(${a.id})">Supprimer</button>` : ''])) + '<h3>Bulletins de paie</h3>' +
      T(['N°', 'Mois', 'Brut', 'Retenues', 'Net à payer', 'État', ''], sl.map(s => [esc(s.number), esc(s.month.slice(0, 7)), f(s.gross), f(s.total_deductions), f(s.net_pay), `<span class="tag ${s.status == 'paye' ? '' : 'x'}">${s.status}</span>`,
        `<button class="b2" onclick="dlFile('/hr/payroll/${s.id}/pdf',${jsArg(s.number)})">PDF</button> <button class="b2" onclick="slipDetail(${s.id})">Détail</button>` + (P && s.status == 'brouillon' ? ` <button onclick="valSlip(${s.id})">Valider</button> <button class="bd" onclick="delSlip(${s.id})">Supprimer</button>` : '') + (P && s.status == 'valide' ? ` <button onclick="paySlip(${s.id},${s.net_pay})">Payer</button>` : '') + (P && ['valide', 'paye'].includes(s.status) && !s.rectifies_id ? ` <button class="b2" onclick="rectSlip(${s.id})">Rectifier</button>` : '')]));
  },
  async fin(e) {
    const m = await G(`/hr/employees/${e.id}/finance?month=${EMON}`), r = m.remuneration, pl = r.payslip;
    return monBar() + `<div class="bar"><button onclick="dlFile('/hr/employees/${e.id}/finance.pdf?month=${EMON}',${jsArg(`situation-${e.matricule}-${EMON}`)})">Exporter en PDF</button><button class="b2" onclick="window.print()">Imprimer</button></div>
    <div class="card"><h3 style="margin-top:0">Activité de vente <small style="color:var(--m)">(ne pas confondre avec la rémunération)</small></h3>${kvh([["Chiffre d'affaires réalisé", f(m.operational.revenue)], ['Litres de carburant', fmtN(m.operational.liters) + ' L'], ['Opérations', m.operational.operations]])}</div>
    <div class="card"><h3 style="margin-top:0">Rémunération du mois</h3>${pl ? kvh([['Bulletin', esc(pl.number) + ' (' + pl.status + ')'], ['Salaire de base', f(pl.base_salary)], ['Primes', f(pl.bonuses)], ['Indemnités', f(pl.allowances)], ['Rémunération brute', f(pl.gross)], ['Avances déduites', f(pl.advances_deducted)], ['Remboursement de dettes retenu', f(pl.debts_deducted)], ['Autres retenues', f(pl.other_deductions)]]) : `<p>${esc(r.status_note || '')}</p>`}${kvh([['Net à payer (validé)', f(r.net_due)], ['Salaire déjà payé', f(r.paid)], ['Reste à payer', f(r.remaining)], ['Trop-perçu', f(r.overpaid)]])}</div>
    <div class="card"><h3 style="margin-top:0">Avances et dettes</h3>${kvh([['Avances reçues ce mois', f(m.advances.received_this_month)], ['Avances restant à déduire', f(m.advances.outstanding)], ['Dettes initiales (cumul)', f(m.debts.initial_to_date)], ['Remboursements du mois', f(m.debts.repaid_this_month)], ['Remboursements cumulés', f(m.debts.repaid_to_date)], ['dont retenues sur salaire', f(m.debts.deducted_from_salary_to_date)], ['Solde des dettes', f(m.debts.balance)]])}</div>`;
  },
};
async function empOps(shiftId, num, status) {
  const ops = await G(`/hr/employees/${EMP.id}/operations?shift_id=${shiftId}`);
  modal(`<h3>Quart ${num} : opérations de ${esc(EMP.first_name)}</h3>` + T(['N°', 'Heure', 'Type', 'Produit', 'Quantité', 'Montant', 'Pompe', 'Index', 'Statut'], ops.map(o => [o.id, dt(o.sold_at), o.kind == 'carburant' ? 'Carburant (' + esc(o.input_mode) + ')' : 'Produit', esc(o.product), fmtN(o.quantity), f(o.total), esc(o.pump || ''), o.index_new != null ? `${o.index_old} → ${o.index_new}` : '', o.status])) + `<div class="r">${status == 'ferme' ? `<button onclick="closeM();go('rapq',${shiftId})">Rapport du quart</button>` : ''}<button class="b2" onclick="closeM()">Fermer</button></div>`);
}
async function dlFile(path, name) {
  const r = await fetch('/api' + path, { headers: { Authorization: 'Bearer ' + TK, 'X-Station-Id': SID } });
  if (!r.ok) { const j = await r.json().catch(() => ({})); return toast(j.error || 'Téléchargement impossible'); }
  const blob = await r.blob(), ext = ({ 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'text/csv': 'csv' })[blob.type.split(';')[0]] || (blob.type.includes('spreadsheet') ? 'xlsx' : 'bin');
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = /\.\w+$/.test(name) ? name : name + '.' + ext; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
/* écarts */
const NEXT = { en_attente: ['accepte', 'conteste', 'cloture'], conteste: ['accepte', 'cloture'], accepte: ['regularise', 'cloture'], regularise: ['cloture'] };
const gapJust = id => form('Justification', [['text', 'Explication']], {}, async d => { await Po(`/hr/gaps/${id}/justify`, d); closeM(); go('empf', arg); });
const gapDecide = (id, st) => form('Décision du gérant', [['status', 'Nouvel état', 's', NEXT[st] || []], ['decision', 'Décision / justification']], {}, async d => { await Po(`/hr/gaps/${id}/decide`, d); closeM(); go(cur, arg); });
const gapDebt = (id, amt) => form("Créer une dette à partir de l'écart", [['amount', 'Montant de la dette', 'number'], ['reason', 'Motif']], { amount: amt }, async d => { await Po(`/hr/gaps/${id}/to-debt`, d); closeM(); setTab('dettes'); });
async function gapHist(id) { const g = (window.EGP || []).find(x => x.id == id); modal('<h3>Historique de l\'écart</h3>' + T(['Date', 'Action', 'De', 'Vers', 'Note', 'Par'], (g.events || []).map(x => [dt(x.created_at), esc(x.action), esc(x.from_status || ''), esc(x.to_status || ''), esc(x.note || ''), esc(x.login)])) + '<div class="r"><button class="b2" onclick="closeM()">Fermer</button></div>'); }
/* dettes et avances */
function newDebt() {
  modal(`<h3>Nouvelle dette</h3><div class="g"><label>Montant<input id="dm" type="number"></label><label>Date<input id="dd" type="date" value="${dayNow()}"></label><label>Motif<input id="dr"></label><label>Argent sorti de la caisse ?<select id="dc"><option value="non">Non (ex. manquant)</option><option value="oui">Oui (prêt)</option></select></label><label>Mode si prêt<select id="dp">${pmOpts(['credit']).map(([c, l]) => `<option value="${c}">${esc(l)}</option>`).join('')}</select></label><label>Pièce justificative (PNG, JPEG ou PDF, 2 Mo)<input id="da" type="file" accept="image/png,image/jpeg,application/pdf"></label></div><div class="r"><button class="b2" onclick="closeM()">Annuler</button><button id="dok">Enregistrer</button></div>`);
  $('#dok').onclick = async () => { try { let att; const fl_ = $('#da').files[0]; if (fl_) { if (fl_.size > 2 * 1024 * 1024) throw new Error('Pièce trop volumineuse'); att = await new Promise(r => { const rd = new FileReader(); rd.onload = () => r(rd.result); rd.readAsDataURL(fl_); }); }
    await Po('/hr/debts', { employee_id: EMP.id, amount: parseFloat($('#dm').value) || 0, reason: $('#dr').value, debt_date: $('#dd').value, cash_out: $('#dc').value == 'oui', method: $('#dc').value == 'oui' ? $('#dp').value : undefined, attachment: att }); closeM(); go('empf', EMP.id); } catch (e) { toast(errMsg(e)); } };
}
const payDebt = (id, bal) => form('Remboursement (solde ' + fl(bal) + ')', [['amount', 'Montant', 'number'], ['method', 'Mode de paiement', 's', pmOpts(['credit'])], ['note', 'Motif / note']], { amount: bal }, async d => { const r = await Po(`/hr/debts/${id}/pay`, d); closeM(); toast('Reçu ' + r.receipt_no + ' · solde ' + f(r.balance)); go('empf', EMP.id); });
const editDebt = id => { const d = EDB.find(x => x.id == id); form('Modifier la dette', [['amount', 'Montant', 'number'], ['reason', 'Motif'], ['status', 'État', 's', ['en_cours', 'conteste']], ['edit_reason', 'Motif de la modification (obligatoire)']], d, async x => { const ch = { edit_reason: x.edit_reason }; if (x.amount != d.amount) ch.amount = x.amount; if (x.reason != d.reason) ch.reason = x.reason; if (x.status != d.status) ch.status = x.status; await api('PATCH', '/hr/debts/' + id, ch); closeM(); go('empf', EMP.id); }); };
const cancelDebt = id => form('Annuler la dette', [['reason', 'Motif']], {}, async d => { await Po(`/hr/debts/${id}/cancel`, d); closeM(); go('empf', EMP.id); });
const newAdv = () => form('Avance sur salaire', [['amount', 'Montant', 'number'], ['method', 'Mode de paiement', 's', pmOpts(['credit'])], ['pay_month', 'Mois de rattachement', 'month'], ['reason', 'Motif'], ['reference', 'Référence']], { pay_month: monthNow() }, async d => { await Po('/hr/advances', { employee_id: EMP.id, amount: d.amount, method: d.method, pay_month: d.pay_month, reason: d.reason || undefined, reference: d.reference || undefined }); closeM(); go('empf', EMP.id); });
/* paie */
const newAdj = () => form('Élément de paie', [['kind', 'Type', 's', [['prime', 'Prime'], ['indemnite', 'Indemnité'], ['autre_gain', 'Autre gain'], ['retenue', 'Retenue']]], ['label', 'Libellé'], ['amount', 'Montant', 'number']], {}, async d => { await Po('/hr/adjustments', { ...d, employee_id: EMP.id, month: EMON }); closeM(); go('empf', EMP.id); });
const delAdj = id => ask('Supprimer cet élément de paie ?', async () => { await api('DELETE', '/hr/adjustments/' + id); go('empf', EMP.id); });
function prepPay() {
  form('Préparer la paie ' + EMON, [['debt_mode', 'Dettes de l’employé', 's', [['none', 'Ne pas déduire les dettes ce mois-ci'], ['all', 'Déduire toutes les dettes admissibles'], ['partial', 'Déduire un montant partiel']]], ['debt_amount', 'Montant partiel (si partiel)', 'number']], { debt_mode: 'none' }, async d => {
    const b = { employee_id: EMP.id, month: EMON, debt_mode: d.debt_mode, debt_amount: d.debt_mode == 'partial' ? d.debt_amount : undefined }, p = await Po('/hr/payroll/preview', b);
    modal(`<h3>Aperçu avant validation : ${esc(p.employee || '')} · ${p.month}</h3>` + kvh([
      ['Salaire de base', f(p.base_salary)], ['Primes', f((p.bonuses || 0) - (p.commission_total || 0))], ...(p.commission_total > 0 ? [['Commission sur vente', f(p.commission_total)]] : []), ['Indemnités et autres gains', f(p.allowances)],
      ['<b>Rémunération brute</b>', '<b>' + f(p.gross) + '</b>'],
      ['Autres retenues', f(p.other_deductions)], ['Avances déduites', f(p.advances_deducted)],
      ['Dettes admissibles', f(p.debts_eligible)], ['Retenue de dettes', f(p.debts_deducted)],
      ['AMO salarié', f(p.amo_employee || 0)], ['INPS salarié', f(p.inps_employee || 0)], ['ITS', f(p.its_amount || 0)],
      ['Net avant retenues facultatives', f(p.net_before_debt)],
      ['<b>NET FINAL À PAYER</b>', '<b>' + f(p.net_pay) + '</b>'],
      ['AMO employeur (hors net)', f(p.amo_employer || 0)], ['INPS employeur (hors net)', f(p.inps_employer || 0)],
      ['Charges patronales autres (hors net)', f(p.employer_charges_total || 0)],
      ['<b>Coût employeur</b>', '<b>' + f(p.employer_cost || p.gross) + '</b>'],
      ['Solde des dettes après paie', f(p.debt_remaining)]
    ]) + `<h4>Vérification des montants à zéro</h4><div class="warn">${Number(p.allowances || 0) === 0 ? 'Indemnités et autres gains : 0 FCFA. Aucun élément de type Indemnité / Autre gain n’est enregistré pour ce mois, ou leur total est nul. Ajoutez-les depuis « Élément de paie » si nécessaire.' : 'Indemnités et autres gains : montant calculé à partir des éléments de paie saisis.'}</div>` + ['payroll_amo_enabled','payroll_inps_enabled','payroll_its_enabled','payroll_employer_charges_enabled'].map((flag, i) => { const names = ['AMO salarié / employeur','INPS salarié / employeur','ITS','Autres charges patronales']; const amounts = [Number(p.amo_employee||0)+Number(p.amo_employer||0), Number(p.inps_employee||0)+Number(p.inps_employer||0), Number(p.its_amount||0), Number(p.employer_charges_total||0)]; const active = !!(p.feature_flags && p.feature_flags[flag]); const details = [p.amo_detail,p.inps_detail,p.its_detail,p.employer_charges_detail][i] || {}; const reason = details.reason || (active ? 'Module activé ; vérifier les règles et leur assiette si le montant reste nul.' : 'Module désactivé dans les règles de paie.'); return amounts[i] === 0 ? `<div class="warn">${esc(names[i])} : 0 FCFA — ${esc(reason)} ${active ? '' : 'N’activez le module qu’après validation des taux/barèmes applicables et des règles confirmées + actives.'}</div>` : ''; }).join('') + (p.warnings || []).map(w => `<div class="warn">${esc(w)}</div>`).join('') + `<div class="warn">${esc(p.rules_unverified || '')}</div><div class="r"><button class="b2" onclick="closeM()">Retour</button><button id="pk">Créer le bulletin (brouillon)</button></div>`);
    $('#pk').onclick = async () => { try { await Po('/hr/payroll', b); closeM(); toast('Bulletin créé en brouillon : à valider'); go('empf', EMP.id); } catch (e) { toast(errMsg(e)); } }; return 'keep';
  });
}
const valSlip = id => ask('Valider ce bulletin ? Il sera figé et les retenues (avances, dettes) seront appliquées.', async () => { await Po(`/hr/payroll/${id}/validate`); go('empf', EMP.id); });
const delSlip = id => ask('Supprimer ce brouillon ?', async () => { await api('DELETE', '/hr/payroll/' + id); go('empf', EMP.id); });
const paySlip = (id, net) => form('Paiement du net : ' + fl(net), [['method', 'Mode de paiement', 's', pmOpts(['credit'])]], {}, async d => { await Po(`/hr/payroll/${id}/pay`, d); closeM(); go('empf', EMP.id); });
const rectSlip = id => form('Rectification du bulletin', [['reason', 'Motif'], ['label', 'Libellé de la correction'], ['amount', 'Montant (+ gain, − retenue)', 'number']], {}, async d => { const r = await Po(`/hr/payroll/${id}/rectify`, { reason: d.reason, lines: [{ label: d.label, amount: d.amount }] }); closeM(); toast('Rectification ' + r.number + ' créée en brouillon'); go('empf', EMP.id); });
window.slipDetail = safe(async id => {
  const d = await G('/hr/payroll/' + id + '/detail');
  const sf = d.social_fiscal || {};
  modal(`<h3>Détail du calcul — ${esc(d.number || '')}</h3>
    ${kvh([['Employé', esc((d.employee && d.employee.name) || '')], ['Mois', esc(d.month || '')], ['État', esc(d.status)], ['Moteur', esc(d.engine_version || '-')], ['Mode', esc(d.calculation_mode || '-')]])}
    <h4>Gains / Net</h4>${kvh([['Brut', f(d.gross)], ['Retenues', f(d.total_deductions)], ['<b>Net à payer</b>', '<b>' + f(d.net_pay) + '</b>'], ['Coût employeur', f(d.employer_cost)]])}
    <h4>Social / Fiscal</h4>${kvh([['Base ITS', f((d.bases && d.bases.its) || 0)], ['ITS', f(sf.its_amount || 0)], ['Base INPS', f((d.bases && d.bases.inps) || 0)], ['INPS salarié', f(sf.inps_employee || 0)], ['INPS employeur', f(sf.inps_employer || 0)], ['Base AMO', f((d.bases && d.bases.amo) || 0)], ['AMO salarié', f(sf.amo_employee || 0)], ['AMO employeur', f(sf.amo_employer || 0)], ['Charges patronales autres', f(sf.employer_charges_total || 0)]])}
    ${(d.warnings || []).map(w => `<div class="warn">${esc(w)}</div>`).join('')}
    <div class="r"><button class="b2" onclick="dlFile('/hr/payroll/${id}/pdf',${jsArg(d.number || 'bulletin')})">PDF</button><button class="b2" onclick="emailSlip(${id})">✉ E-mail</button><button class="b2" onclick="closeM()">Fermer</button></div>`);
});
window.dryRunOne = safe(async () => {
  if (!EMP) return toast('Aucun employé');
  const d = await Po('/hr/payroll/dry-run', { employee_id: EMP.id, month: EMON, debt_mode: 'none' });
  const p = d.result || {};
  modal(`<h3>Simulation (dry-run) — ${esc((d.employee && d.employee.name) || '')}</h3>
    <div class="warn">Aucune écriture financière · ROLLBACK forcé · can_pay = false</div>
    ${kvh([['Brut', f(p.gross)], ['Net', f(p.net_pay)], ['Coût employeur', f(p.employer_cost)], ['ITS', f(p.its_amount)], ['INPS sal.', f(p.inps_employee)], ['AMO sal.', f(p.amo_employee)]])}
    ${(p.warnings || []).map(w => `<div class="warn">${esc(w)}</div>`).join('')}
    <div class="r"><button class="b2" onclick="closeM()">Fermer</button></div>`);
});

/* ---------- Gestion RH : vue d'ensemble ---------- */
let RMON = monthNow();
async function vRh() {
  const [gaps, debts, advs, sl] = await Promise.all([G('/hr/gaps').catch(() => []), G('/hr/debts?status=en_cours').catch(() => []), G('/hr/advances').catch(() => []), G('/hr/payroll?month=' + RMON).catch(() => [])]), todo = gaps.filter(g => g.status != 'cloture' && g.status != 'regularise');
  return `<div class="cards">${card('Écarts à traiter', todo.length)}${card('Dettes en cours', f(debts.reduce((a, d) => a + d.balance, 0)), debts.length + ' dette(s)')}${card('Avances à déduire', f(advs.filter(a => a.status == 'en_cours').reduce((a, x) => a + x.remaining, 0)))}${card('Bulletins du mois', sl.length, 'à payer : ' + f(sl.filter(s => s.status == 'valide').reduce((a, s) => a + s.net_pay, 0)))}</div>
  <h3>Écarts de caisse et de stock</h3>` + T(['Quart', 'Type', 'Écart', 'Employé', 'Statut', ''], todo.map(g => [g.shift_number, g.kind + (g.product ? ' · ' + esc(g.product) : ''), fmtN(g.amount), g.employee ? `<a style="cursor:pointer" onclick="ETAB='ecarts';go('empf',${g.employee_id})">${esc(g.employee)}</a>` : '<i>non attribué</i>', `<span class="tag x">${g.status}</span>`, can('hr.gaps') && !g.employee_id ? `<button onclick="assignGap(${g.id})">Attribuer</button>` : ''])) +
  '<h3>Dettes en cours</h3>' + T(['Employé', 'Date', 'Motif', 'Initial', 'Solde'], debts.map(d => [`<a style="cursor:pointer" onclick="ETAB='dettes';go('empf',${d.employee_id})">${esc(d.employee)}</a>`, esc(d.debt_date), esc(d.reason), f(d.amount), f(d.balance)])) +
  `<h3>Bulletins</h3><div class="bar"><label style="flex-direction:row;align-items:center;gap:6px">Mois <input type="month" value="${RMON}" onchange="RMON=this.value;go('rh')"></label>
  <button class="b2" onclick="go('rhr')">Rapports RH</button>
  <button class="b2" onclick="go('act')">Activation progressive</button>
  <button class="b2" onclick="go('audrh')">Audit RH</button></div>` + T(['N°', 'Employé', 'Brut', 'Retenues', 'Net', 'État'], sl.map(s => [esc(s.number), `<a style="cursor:pointer" onclick="ETAB='paie';go('empf',${s.employee_id})">${esc(s.employee)}</a>`, f(s.gross), f(s.total_deductions), f(s.net_pay), `<span class="tag ${s.status == 'paye' ? '' : 'x'}">${s.status}</span>`]));
}
async function assignGap(id) { const em = await G('/employees'); form("Attribuer l'écart", [['employee_id', 'Employé', 's', em.map(e => [e.id, e.first_name + ' ' + e.last_name])]], {}, async d => { try { await Po(`/hr/gaps/${id}/assign`, { employee_id: +d.employee_id }); } catch (e) { if (/force/.test(e.message)) { await Po(`/hr/gaps/${id}/assign`, { employee_id: +d.employee_id, force: true }); } else throw e; } closeM(); go('rh'); }); }
async function vMoi() {
  const m = await G('/hr/me').catch(() => null);
  if (!m || !m.id) {
    return `<div class="card"><p>Aucune fiche employé n’est liée à votre compte.</p>
      <p style="font-size:13px;color:var(--m)">Demandez au gérant de créer votre fiche puis de vous octroyer un accès.</p>
      <button class="b2" onclick="go('msg')">Messagerie</button></div>`;
  }
  let slips = [];
  try { slips = await G('/hr/payroll?employee_id=' + m.id).catch(() => []); } catch (_) {}
  const slipRows = (slips || []).slice(0, 24);
  const slipHtml = slipRows.length
    ? T(['N°', 'Mois', 'Statut', 'Brut', 'Net', ''], slipRows.map(s => [
        esc(s.number || s.id), esc(s.month || s.month_s || ''), esc(s.status),
        f(s.gross), f(s.net_pay),
        (s.status && s.status !== 'brouillon')
          ? `<button class="b2" onclick="dlFile('/hr/payroll/${s.id}/pdf','bulletin-${s.id}.pdf')">PDF</button>` : '—'
      ]))
    : '<p style="color:var(--m);font-size:13px">Aucun bulletin disponible pour le moment.</p>';
  return `<h2 style="margin-top:0">Mon espace</h2>
    <div class="card"><b>${esc((m.first_name || '') + ' ' + (m.last_name || ''))}</b>
      <div style="color:var(--m)">${esc(m.position || '')} · Matricule ${esc(m.matricule || '')}</div>
      <div class="bar" style="margin-top:10px">
        <button class="b2" onclick="ETAB='id';EGROUP='identite';go('empf',${m.id})">Ma fiche complète</button>
        <button class="b2" onclick="ETAB='actions';EGROUP='activite';go('empf',${m.id})">Historique de mes actions</button>
        <button class="b2" onclick="go('msg')">Messagerie</button>
      </div>
    </div>
    <h3>Mes bulletins de paie</h3>${slipHtml}`;
}

/* ---------- Rapports RH (Phase 10) ---------- */
let RHR_FROM = new Date().toISOString().slice(0, 7) + '-01';
let RHR_TO = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().slice(0, 10);
async function vRhr() {
  return `<h2 style="margin-top:0">Rapports RH</h2>
  <div class="card"><div class="g">
    <label>Du <input type="date" id="rhr_from" value="${RHR_FROM}"></label>
    <label>Au <input type="date" id="rhr_to" value="${RHR_TO}"></label>
  </div>
  <p style="color:var(--m);font-size:13px">Les montants proviennent des bulletins enregistrés. Cotisations à 0 si les feature flags sont OFF.</p>
  <div class="bar">
    <button onclick="rhrPrev('payroll')">Aperçu masse salariale</button>
    <button class="b2" onclick="rhrExp('payroll','pdf')">PDF</button>
    <button class="b2" onclick="rhrExp('payroll','xlsx')">Excel</button>
  </div>
  <div class="bar" style="margin-top:8px">
    <button onclick="rhrPrev('employer-cost')">Aperçu coût personnel</button>
    <button class="b2" onclick="rhrExp('employer-cost','pdf')">PDF</button>
    <button class="b2" onclick="rhrExp('employer-cost','xlsx')">Excel</button>
  </div>
  <div class="bar" style="margin-top:8px">
    <button onclick="rhrPrev('social-fiscal')">Aperçu social / fiscal</button>
    <button class="b2" onclick="rhrExp('social-fiscal','pdf')">PDF</button>
    <button class="b2" onclick="rhrExp('social-fiscal','xlsx')">Excel</button>
  </div>
  <div class="bar" style="margin-top:8px">
    <button class="b2" onclick="rhrExp('employees','pdf')">Liste salariés PDF</button>
    <button class="b2" onclick="rhrExp('employees','xlsx')">Liste salariés Excel</button>
  </div>
  <div class="bar" style="margin-top:8px">
    <button onclick="rhrPrev('forecast')">Prévision masse salariale</button>
    <button onclick="rhrPrev('stats')">Statistiques RH</button>
  </div>
  </div>
  <div id="rhrout"></div>
  <div class="bar"><button class="b2" onclick="go('rh')">Retour Gestion RH</button></div>`;
}
function rhrQ() {
  RHR_FROM = ($('#rhr_from') && $('#rhr_from').value) || RHR_FROM;
  RHR_TO = ($('#rhr_to') && $('#rhr_to').value) || RHR_TO;
  return `from=${encodeURIComponent(RHR_FROM)}&to=${encodeURIComponent(RHR_TO)}`;
}
window.rhrExp = safe(async (kind, fmt) => {
  await dlFile(`/hr/reports/${kind}?${rhrQ()}&format=${fmt}`, `${kind}-${RHR_TO}`);
});
window.rhrPrev = safe(async kind => {
  const out = $('#rhrout');
  if (!out) return;
  if (kind === 'forecast') {
    const month = (RHR_FROM || new Date().toISOString().slice(0, 10)).slice(0, 7);
    const d = await G('/hr/reports/forecast?month=' + month);
    const t = d.totals || {};
    out.innerHTML = `<div class="card"><h3 style="margin-top:0">Prévision masse salariale ${esc(d.month || '')}</h3>
      <div class="warn">Simulation pure — aucun impact financier (ROLLBACK)</div>
      ${kvh([['Effectif', d.headcount], ['Avec salaire', d.with_salary], ['Brut prévu', f(t.gross)], ['Net prévu', f(t.net_pay)], ['Coût employeur', f(t.employer_cost)], ['ITS', f(t.its)], ['INPS emp.', f(t.inps_employer)], ['AMO emp.', f(t.amo_employer)]])}
      ${T(['Employé', 'Brut', 'Net', 'Coût'], (d.lines || []).filter(l => !l.skipped).map(l => [esc(l.name), f(l.gross), f(l.net_pay), f(l.employer_cost)]))}</div>`;
    return;
  }
  if (kind === 'stats') {
    const d = await G('/hr/reports/stats');
    const h = d.headcount || {};
    out.innerHTML = `<div class="card"><h3 style="margin-top:0">Statistiques RH</h3>
      ${kvh([['Actifs', h.actifs], ['Suspendus', h.suspendus], ['Inactifs', h.inactifs], ['Total', h.total]])}
      <h4>Paie année en cours</h4>
      ${kvh([['Bulletins', (d.payroll_year||{}).bulletins], ['Payés', (d.payroll_year||{}).payes], ['Validés', (d.payroll_year||{}).valides], ['Net payé YTD', f((d.payroll_year||{}).net_paid_ytd)]])}
      <h4>Dettes / Avances</h4>
      ${kvh([['Dettes en cours', (d.debts||{}).en_cours], ['Solde dettes', f((d.debts||{}).solde)], ['Avances en cours', (d.advances||{}).en_cours], ['Avances restantes', f((d.advances||{}).outstanding)]])}</div>`;
    return;
  }
  const d = await G(`/hr/reports/${kind}?${rhrQ()}&format=json`);
  if (kind === 'payroll') {
    const t = d.totals || {};
    out.innerHTML = `<div class="card"><h3 style="margin-top:0">Masse salariale ${esc((d.period && d.period.from) || '')} → ${esc((d.period && d.period.to) || '')}</h3>
      ${kvh([['Bulletins', t.count], ['Brut', f(t.gross)], ['Net', f(t.net_pay)], ['ITS', f(t.its)], ['INPS sal./emp.', f(t.inps_employee) + ' / ' + f(t.inps_employer)], ['AMO sal./emp.', f(t.amo_employee) + ' / ' + f(t.amo_employer)], ['Charges patronales', f(t.employer_charges)], ['Coût employeur', f(t.employer_cost)]])}
      <p style="color:var(--m);font-size:12px">${esc(d.note || '')}</p>
      ${T(['N°', 'Mois', 'Employé', 'Brut', 'Net', 'État'], (d.lines || []).slice(0, 50).map(l => [esc(l.number), esc(l.month), esc(l.employee), f(l.gross), f(l.net_pay), esc(l.status)]))}</div>`;
  } else if (kind === 'employer-cost') {
    const t = d.totals || {};
    out.innerHTML = `<div class="card"><h3 style="margin-top:0">Coût du personnel</h3>
      ${kvh([['Salariés', t.employees], ['Brut', f(t.gross)], ['Charges employeur', f(t.employer_social)], ['Coût total', f(t.employer_cost)], ['Net versé', f(t.net_pay)]])}
      <p style="font-size:12px;color:var(--m)">${esc(d.formula || '')}</p>
      ${T(['Employé', 'Matricule', 'Mois', 'Brut', 'Coût', 'Net'], (d.lines || []).map(l => [esc(l.employee), esc(l.matricule), l.months, f(l.gross), f(l.employer_cost), f(l.net_pay)]))}</div>`;
  } else if (kind === 'social-fiscal') {
    out.innerHTML = `<div class="card"><h3 style="margin-top:0">État social / fiscal</h3>
      ${kvh([['ITS total', f((d.its && d.its.total) || 0)], ['INPS salarié', f((d.inps && d.inps.employee) || 0)], ['INPS employeur', f((d.inps && d.inps.employer) || 0)], ['AMO salarié', f((d.amo && d.amo.employee) || 0)], ['AMO employeur', f((d.amo && d.amo.employer) || 0)]])}
      <p style="color:var(--m);font-size:12px">${esc(d.note || '')}</p></div>`;
  }
});

/* ---------- Activation progressive paie Mali (AMO / INPS / ITS) ---------- */
async function vAct() {
  const d = await G('/hr/payroll-modules').catch(e => ({ error: e.message || String(e), modules: [] }));
  if (d.error && !(d.modules || []).length) {
    return `<p class="warn">Impossible de charger les modules paie : ${esc(d.error)}</p>
      <p style="font-size:13px;color:var(--m)">Vérifiez le droit hr.manage et que le SuperAdmin a autorisé les modules AMO/INPS/ITS sur le contrat.</p>
      <div class="bar"><button class="b2" onclick="go('rh')">Retour RH</button></div>`;
  }
  const cards = (d.modules || []).map(m => {
    const status = !m.authorized
      ? '<span class="tag x">Non autorisé SuperAdmin</span>'
      : (m.flag_on ? '<span class="tag ok">Actif</span>' : '<span class="tag x">Inactif</span>');
    let actions = '';
    if (!m.authorized) {
      actions = `<p style="font-size:12px;color:var(--m)">Demandez au SuperAdmin d'autoriser « ${esc(m.label)} » sur votre contrat client.</p>`;
    } else if (!m.flag_on) {
      actions = `<button onclick="openPayrollActivate('${m.code}')">Activer…</button>`;
    } else {
      actions = `<button class="b2" onclick="openPayrollActivate('${m.code}', true)">Reconfigurer les taux</button>
        <button class="bd" onclick="payrollDeactivate('${m.code}')">Désactiver</button>`;
    }
    const cfg = m.config || {};
    const cfgSummary = m.flag_on && cfg.effective_from
      ? `<p style="font-size:12px;color:var(--m)">Effet : ${esc(cfg.effective_from)} · Périmètre : ${esc(cfg.apply_to || 'all')}</p>`
      : '';
    return `<div class="card" style="margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap">
        <b>${esc(m.label)}</b>${status}
      </div>
      <p style="font-size:13px;color:var(--m);margin:6px 0">${esc(m.description || '')}</p>
      ${cfgSummary}
      <div class="r" style="gap:6px;flex-wrap:wrap;margin-top:8px">${actions}</div>
    </div>`;
  }).join('');
  const sources = (d.sources || []).map(s => `<li>${esc(s)}</li>`).join('');
  return `<h2 style="margin-top:0">Modules de paie (AMO, INPS, ITS)</h2>
    <div class="warn" style="margin-bottom:12px">
      <b>Processus en 2 étapes</b><br>
      1. Le <b>SuperAdmin</b> autorise le module sur le contrat client.<br>
      2. Le <b>client</b> active manuellement et saisit les taux / paramètres de calcul (modifiables à tout moment).
    </div>
    <p style="font-size:13px;color:var(--m)">${esc(d.note || '')}</p>
    ${cards || '<p>Aucun module disponible.</p>'}
    <div class="bar" style="flex-wrap:wrap;gap:8px">
      <button onclick="payrollActivateAll()">Activer tous les modules autorisés</button>
      <button class="b2" onclick="go('rh')">Retour RH</button>
      <button class="b2" onclick="go('rhr')">Rapports paie</button>
    </div>
    <div class="card" style="margin-top:14px"><b>Sources de référence (indicatives)</b>
      <ul style="font-size:12px;color:var(--m)">${sources || '<li>CLEISS / INPS / DGI Mali</li>'}</ul>
      <p style="font-size:11px;color:var(--m)">Les taux légaux peuvent évoluer. Le client reste responsable de la conformité de ses paramètres.</p>
    </div>`;
}

/** Formulaire d'activation / reconfiguration avec champs de calcul. */
window.openPayrollActivate = async function (code, reconfig) {
  try {
    const d = await G('/hr/payroll-modules');
    const m = (d.modules || []).find(x => x.code === code);
    if (!m) return toast('Module introuvable', 'error');
    if (!m.authorized) return toast('Non autorisé par le SuperAdmin', 'error');
    const fields = m.fields || [];
    const vals = { ...(m.defaults || {}), ...(m.config || {}) };
    if (!vals.effective_from) vals.effective_from = new Date().toISOString().slice(0, 10);
    if (vals.deduct_inps_before_its === true) vals.deduct_inps_before_its = 'true';
    if (vals.deduct_inps_before_its === false) vals.deduct_inps_before_its = 'false';

    const formFields = fields.map(f => {
      if (f.type === 'select') return [f.key, f.label, 's', f.options || []];
      if (f.type === 'date') return [f.key, f.label, 'date'];
      if (f.type === 'number') return [f.key, f.label, 'number'];
      return [f.key, f.label];
    });
    formFields.push(['reason', 'Motif (obligatoire, min. 5 car.)']);

    form(
      (reconfig ? 'Reconfigurer — ' : 'Activer — ') + m.label,
      formFields,
      { ...vals, reason: '' },
      async data => {
        const reason = String(data.reason || '').trim();
        if (reason.length < 5) throw Object.assign(new Error('Motif trop court'), { status: 400 });
        const config = {};
        for (const f of fields) {
          if (data[f.key] !== undefined && data[f.key] !== '') {
            if (f.type === 'number') config[f.key] = parseFloat(data[f.key]);
            else config[f.key] = data[f.key];
          }
        }
        if (reconfig) {
          await api('PUT', '/hr/payroll-modules/' + encodeURIComponent(code) + '/config', { config, reason });
          toast('Paramètres mis à jour', 'success');
        } else {
          if (!confirm('Confirmer l\'activation de « ' + m.label + ' » ? Les NOUVEAUX bulletins appliqueront ces taux.')) return;
          await Po('/hr/payroll-modules/' + encodeURIComponent(code) + '/activate', { config, reason, confirm: true });
          toast(m.label + ' activé', 'success');
        }
        closeM();
        go('act');
      }
    );
  } catch (e) {
    toast(typeof errMsg === 'function' ? errMsg(e) : e.message, 'error');
  }
};

window.payrollDeactivate = async function (code) {
  try {
    const reason = prompt('Motif de désactivation (min. 5 caractères) :');
    if (!reason || reason.length < 5) return toast('Motif trop court');
    await Po('/hr/payroll-modules/' + encodeURIComponent(code) + '/deactivate', { reason });
    toast('Module désactivé', 'success');
    go('act');
  } catch (e) {
    toast(typeof errMsg === 'function' ? errMsg(e) : e.message, 'error');
  }
};

window.payrollActivateAll = async function () {
  try {
    if (!confirm('Activer tous les modules autorisés par le SuperAdmin avec les taux par défaut (CLEISS / DGI) ? Vous pourrez les ajuster ensuite.')) return;
    const reason = prompt('Motif (min. 5 caractères) :', 'Activation groupée modules paie');
    if (!reason || reason.length < 5) return toast('Motif trop court');
    const out = await Po('/hr/payroll-modules/activate-all', {
      reason, confirm: true,
      effective_from: new Date().toISOString().slice(0, 10)
    });
    const n = (out.results || []).filter(r => r.status === 'activated').length;
    toast(n + ' module(s) activé(s)', 'success');
    go('act');
  } catch (e) {
    toast(typeof errMsg === 'function' ? errMsg(e) : e.message, 'error');
  }
};

// Compat anciens handlers
window.actEnable = (code) => openPayrollActivate(code, false);
window.actDisable = (code) => payrollDeactivate(code);

/* ---------- Audit RH / Paie (Phase 14) ---------- */
let AUD_FROM = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
let AUD_TO = new Date().toISOString().slice(0, 10);
async function vAudRh() {
  const q = `from=${AUD_FROM}&to=${AUD_TO}&limit=80`;
  const [list, integ] = await Promise.all([
    G('/hr/audit?' + q).catch(() => ({ lines: [], total: 0 })),
    G('/hr/audit/integrity?from=' + AUD_FROM + '&to=' + AUD_TO).catch(() => null)
  ]);
  const checks = (integ && integ.integrity_checks || []).map(c =>
    `<li>${c.ok ? '✔' : '⚠'} ${esc(c.label)}${c.count != null ? ' : ' + c.count : ''}</li>`).join('');
  const sev = (integ && integ.by_severity) || {};
  return `<h2 style="margin-top:0">Audit RH & Paie</h2>
  <div class="card"><div class="g">
    <label>Du <input type="date" id="aud_from" value="${AUD_FROM}"></label>
    <label>Au <input type="date" id="aud_to" value="${AUD_TO}"></label>
  </div>
  <div class="bar">
    <button onclick="audRhReload()">Actualiser</button>
    <button class="b2" onclick="audRhExp('pdf')">PDF</button>
    <button class="b2" onclick="audRhExp('xlsx')">Excel</button>
  </div></div>
  <div class="cards">${card('Événements', list.total || 0)}${card('Critiques', sev.critique || 0)}${card('Sensibles', sev.sensible || 0)}${card('Info', sev.info || 0)}</div>
  ${integ ? `<div class="card"><b>Contrôles d'intégrité</b><ul style="font-size:13px">${checks}</ul>
    <p style="font-size:12px;color:var(--m)">${esc(integ.note || '')}</p></div>` : ''}
  <h3>Journal</h3>
  ${T(['Date', 'User', 'Module', 'Action', 'Table', 'Sévérité'], (list.lines || []).map(a => [
    dt(a.created_at), esc(a.user_login || ''), esc(a.module), esc(a.action), esc(a.table_name || ''),
    `<span class="tag ${a.severity === 'critique' ? 'x' : ''}">${esc(a.severity)}</span>`
  ]))}
  <div class="bar"><button class="b2" onclick="go('rh')">Retour RH</button><button class="b2" onclick="go('act')">Activation</button></div>`;
}
window.audRhReload = safe(async () => {
  AUD_FROM = ($('#aud_from') && $('#aud_from').value) || AUD_FROM;
  AUD_TO = ($('#aud_to') && $('#aud_to').value) || AUD_TO;
  go('audrh');
});
window.audRhExp = safe(async fmt => {
  AUD_FROM = ($('#aud_from') && $('#aud_from').value) || AUD_FROM;
  AUD_TO = ($('#aud_to') && $('#aud_to').value) || AUD_TO;
  await dlFile(`/hr/audit/export?from=${AUD_FROM}&to=${AUD_TO}&format=${fmt}`, `audit-rh-${AUD_TO}`);
});

Object.assign(V, { emp: ['Employés', 'settings.edit|shift.open|hr.view|hr.manage'], rh: ['Gestion RH', 'hr.view|hr.payroll|hr.debts|hr.gaps'], rhr: ['Rapports RH', 'hr.view|hr.payroll|hr.manage'], act: ['Activation paie', 'hr.manage'], audrh: ['Audit RH', 'hr.view|hr.manage|hr.payroll'], moi: ['Mon profil', '*'] });

/** Actions accès compte / statut employé */
window.empToggleStatus = async function (id, nextStatus) {
  try {
    const reason = prompt(nextStatus === 'inactif'
      ? 'Motif de mise en inactif (suspend tout, y compris le compte) :'
      : 'Motif de réactivation :', '');
    if (reason == null) return;
    if (nextStatus === 'inactif' && reason.trim().length < 3) return toast('Motif trop court', 'error');
    await api('PATCH', '/employees/' + id + '/status', { status: nextStatus, reason: reason || undefined });
    toast(nextStatus === 'inactif' ? 'Employé inactif — accès compte coupé' : 'Employé réactivé (réactivez l’accès compte séparément si besoin)', 'success');
    go('empf', id);
  } catch (e) { toast(typeof errMsg === 'function' ? errMsg(e) : e.message, 'error'); }
};
window.empRevokeAccess = async function (id) {
  try {
    const reason = prompt('Motif de suspension de l’accès compte (l’employé reste actif pour les quarts) :');
    if (!reason || reason.trim().length < 3) return toast('Motif trop court', 'error');
    await Po('/employees/' + id + '/revoke-access', { reason });
    toast('Accès compte suspendu — l’employé reste actif', 'success');
    go('empf', id);
  } catch (e) { toast(typeof errMsg === 'function' ? errMsg(e) : e.message, 'error'); }
};
window.empGrantAccess = async function (id) {
  try {
    await Po('/employees/' + id + '/grant-access', { reason: 'Rétablissement accès' });
    toast('Accès compte rétabli', 'success');
    go('empf', id);
  } catch (e) {
    const msg = typeof errMsg === 'function' ? errMsg(e) : e.message;
    if (/Aucun compte lié|aucun compte/i.test(msg) && typeof addU === 'function') {
      toast('Pas de compte — ouvrez « Octroyer un accès compte »', 'info');
      addU();
    } else toast(msg, 'error');
  }
};
window.empResetPassword = async function (id) {
  try {
    const reason = prompt('Motif de réinitialisation du mot de passe (minimum 3 caractères) :');
    if (reason == null) return;
    if (reason.trim().length < 3) return toast('Motif trop court', 'error');
    if (!confirm('Créer un nouveau mot de passe temporaire et déconnecter toutes les sessions de cet employé ?')) return;
    const result = await Po('/employees/' + id + '/reset-password', { reason: reason.trim() });
    modal(`<h3>Mot de passe temporaire créé</h3><p>Transmettez ce mot de passe à l’employé par un canal sécurisé. Il ne sera plus affiché après fermeture de cette fenêtre.</p><div class="card"><label>Nouveau mot de passe temporaire</label><input id="emp-temp-password" readonly value="${esc(result.temporary_password)}" onclick="this.select()"></div><div class="bar"><button onclick="document.getElementById('emp-temp-password').select();document.execCommand('copy');toast('Mot de passe copié', 'success')">Copier</button><button class="b2" onclick="closeM();go('empf',${id})">Fermer</button></div><p style="font-size:12px;color:var(--m)">Les anciennes sessions ont été révoquées. Le compte n’a pas été réactivé s’il était désactivé.</p>`);
  } catch (e) { toast(typeof errMsg === 'function' ? errMsg(e) : e.message, 'error'); }
};

function empAccessButtons(e) {
  if (!can('user.manage') && !can('settings.edit')) return '';
  let html = '';
  if (e.status === 'actif') {
    if (!e.user_id) {
      html += can('user.manage') ? `<button class="b2" onclick="typeof addU==='function'&&addU(${e.id})">Octroyer un accès</button>` : '';
    } else if (e.user_active === false) {
      html += can('user.manage') ? `<button onclick="empGrantAccess(${e.id})">Rétablir l'accès</button>` : '';
    } else {
      html += can('user.manage') ? `<button class="bd" onclick="empRevokeAccess(${e.id})">Suspendre l'accès</button>` : '';
    }
    html += can('settings.edit') ? `<button class="bd" onclick="empToggleStatus(${e.id},'inactif')">Rendre inactif</button>` : '';
  } else {
    html += can('settings.edit') ? `<button onclick="empToggleStatus(${e.id},'actif')">Réactiver l'employé</button>` : '';
  }
  return html;
}

Object.assign(VM, { emp: vEmpList, empf: vEmpf, rh: vRh, rhr: vRhr, act: vAct, audrh: vAudRh, moi: vMoi });

window.emailSlip = safe(async id => {
  try {
    const r = await Po('/hr/payroll/' + id + '/email', {});
    toast('Envoyé à ' + r.recipient, 'success');
  } catch (e) {
    const msg = (e && e.message) || String(e);
    if (/déjà envoyé|409|force/i.test(msg)) {
      if (confirm('Déjà envoyé. Renvoyer ?')) {
        const r = await Po('/hr/payroll/' + id + '/email', { force: true });
        toast('Renvoyé à ' + r.recipient, 'success');
      }
    } else toast(msg || 'Envoi impossible');
  }
});
