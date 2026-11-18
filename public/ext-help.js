/* Besoin d'aide : bouton permanent dans la bannière (index.html) et vue en cartes par module.
 * Contenu lu sur le serveur (/api/help-guides). Seul le Super Admin peut modifier les noms, procédures et liens vidéo,
 * et ajouter des modules. */
(function () {
  if (typeof V === 'undefined' || typeof VM === 'undefined') return;

  // Mêmes clés que HELP_KEYS côté serveur (src/help_guides.js).
  const HELP_MODULES = ['dash', 'quart', 'ventes', 'prod', 'pompes', 'cli', 'four', 'caisse', 'emp', 'alert', 'audit', 'param'];
  const LABEL_MAX = 80;

  // Clé propre : « aide » désigne déjà le manuel (ext-aide-demo.js), qui écraserait cette vue.
  V.besoin_aide = ["Besoin d'aide", '*'];

  const isHttps = u => /^https:\/\/\S+$/.test(String(u || ''));
  // Nom affiché : nom personnalisé du Super Admin, sinon nom par défaut du module intégré.
  const labelOf = (k, guide) => (guide && guide.label) || (V[k] ? V[k][0] : k);

  function card(k, guide, isSuper) {
    const proc = guide && guide.procedure ? guide.procedure : '';
    const video = guide && guide.video_url ? guide.video_url : '';
    return `
      <article class="help-card" data-module="${esc(k)}">
        <h3>${esc(labelOf(k, guide))}</h3>
        ${proc
          ? `<p class="help-proc" style="white-space:pre-line">${esc(proc)}</p>`
          : `<p class="help-proc muted">Procédure : à rédiger.</p>`}
        ${video && isHttps(video)
          ? `<a class="b2 help-video" href="${esc(video)}" target="_blank" rel="noopener">▶ Voir la vidéo</a>`
          : `<button type="button" class="b2 help-video" disabled title="Aucun lien vidéo renseigné">Voir la vidéo</button>`}
        ${isSuper ? `<button type="button" class="b2" onclick="helpEdit('${esc(k)}')">Modifier</button>` : ''}
      </article>`;
  }

  VM.besoin_aide = async function () {
    let data = { guides: [] }, loadError = null;
    try { data = await G('/help-guides'); } catch (e) { loadError = e; }
    const guides = data.guides || [];
    const byKey = Object.fromEntries(guides.map(g => [g.module_key, g]));
    // Liste des modules intégrés : source serveur (ANO-008) ; repli sur la liste locale si absente.
    // Le droit d'édition vient de la session (ME.is_global), pas seulement de la réponse : une lecture ratée ne le retire plus.
    const isSuper = !!(ME && ME.is_global) || !!data.is_superadmin;
    const builtin = (Array.isArray(data.help_keys) && data.help_keys.length ? data.help_keys : HELP_MODULES)
      .filter(k => V[k] && (isSuper || canView(k)))
      .map(k => card(k, byKey[k], isSuper));
    // Modules ajoutés par le Super Admin : visibles de tous les comptes connectés.
    const custom = guides.filter(g => g.custom).map(g => card(g.module_key, g, isSuper));
    const cards = builtin.concat(custom).join('');
    const notice = loadError
      ? `<p class="muted" role="status">Contenu non chargé. <button type="button" class="b2" onclick="go('besoin_aide')">Réessayer</button></p>`
      : '';
    const addBtn = isSuper
      ? `<p><button type="button" class="b2" onclick="helpNew()">+ Ajouter un module</button></p>`
      : '';
    return `<section class="help-page">
      <p class="muted">Procédures et vidéos par module.</p>${notice}${addBtn}
      <div class="help-grid">${cards || '<p class="muted">Aucun module d’aide accessible avec vos droits.</p>'}</div>
    </section>`;
  };

  function openForm({ key, title, label, procedure, video, placeholder, required }) {
    modal(`<h3>${esc(title)}</h3>
      <label>Nom du module<input id="help-label" maxlength="${LABEL_MAX}" value="${esc(label)}" placeholder="${esc(placeholder || '')}" ${required ? 'required' : ''} style="width:100%"></label>
      <label>Procédure<textarea id="help-proc" rows="8" maxlength="20000" style="width:100%">${esc(procedure)}</textarea></label>
      <label>Lien vidéo (https)<input id="help-video" type="url" maxlength="500" value="${esc(video)}" placeholder="https://…" style="width:100%"></label>
      <div class="bar" style="margin-top:10px;justify-content:flex-end">
        <button class="b2" onclick="closeM()">Annuler</button>
        <button onclick="helpSave('${esc(key)}')">Enregistrer</button>
      </div>`);
  }

  // Édition réservée au Super Admin (le serveur refuse de toute façon les autres comptes).
  window.helpEdit = async function (k) {
    let data = { guides: [] };
    try { data = await G('/help-guides'); } catch (e) { return toast('Impossible de charger le contenu d’aide', 'error'); }
    const g = (data.guides || []).find(x => x.module_key === k) || {};
    const isCustom = !!g.custom;
    openForm({
      key: k,
      title: 'Aide : ' + labelOf(k, g),
      label: g.label || '',
      placeholder: isCustom ? '' : 'Vide = nom par défaut (' + (V[k] ? V[k][0] : k) + ')',
      required: isCustom,
      procedure: g.procedure || '',
      video: g.video_url || '',
    });
  };

  // Nouveau module personnalisé (Super Admin).
  window.helpNew = function () {
    openForm({ key: '', title: 'Nouveau module d’aide', label: '', placeholder: 'Ex. Sécurité', required: true, procedure: '', video: '' });
  };

  // key vide = création (POST), sinon mise à jour (PUT).
  window.helpSave = async function (key) {
    const label = document.getElementById('help-label').value.trim();
    const procedure = document.getElementById('help-proc').value;
    const video_url = document.getElementById('help-video').value.trim();
    if (video_url && !isHttps(video_url)) return toast('Le lien vidéo doit commencer par https://', 'error');
    if (!key && !label) return toast('Nom du module obligatoire', 'error');
    try {
      if (key) await Pu('/help-guides/' + encodeURIComponent(key), { label, procedure, video_url });
      else await Po('/help-guides', { label, procedure, video_url });
      closeM();
      toast('Aide enregistrée', 'success');
      if (typeof go === 'function') go('besoin_aide');
    } catch (e) { toast(errMsg(e)); }
  };

  /* Raccourci permanent « Besoin d'aide » en haut à droite : dans la bannière (#hero) quand elle est affichée,
   * sinon dans la barre d'en-tête, à côté du profil. Réinséré à chaque rendu (la bannière est recréée de façon asynchrone). */
  function placeHelpShortcut() {
    const header = document.getElementById('app-header');
    let btn = document.querySelector('.help-top-btn');
    let logged = false;
    try { logged = !!ME; } catch (_) { logged = false; }
    if (!logged || !header) { if (btn) btn.remove(); return; }
    const hero = document.getElementById('hero');
    const rightBar = document.querySelector('#tenant-brandbar .brandbar-right');
    let target = header, before = null;
    if (hero) target = hero;
    else if (rightBar) { target = rightBar; before = rightBar.querySelector('.user-chip'); }
    if (btn && btn.parentElement === target && btn.nextElementSibling === before) return;
    if (btn) btn.remove();
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'help-top-btn';
    btn.textContent = "Besoin d'aide";
    btn.title = "Besoin d'aide";
    btn.setAttribute('aria-label', "Besoin d'aide");
    btn.onclick = () => { if (typeof go === 'function') go('besoin_aide'); };
    if (before) target.insertBefore(btn, before); else target.appendChild(btn);
  }
  let helpPlaceQueued = false;
  function queueHelpShortcut() {
    if (helpPlaceQueued) return;
    helpPlaceQueued = true;
    requestAnimationFrame(() => { helpPlaceQueued = false; placeHelpShortcut(); });
  }
  const helpRoot = document.querySelector('main') || document.body;
  new MutationObserver(queueHelpShortcut).observe(helpRoot, { childList: true, subtree: true });
  queueHelpShortcut();
})();
