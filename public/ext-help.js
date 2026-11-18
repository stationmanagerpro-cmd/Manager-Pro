/* Besoin d'aide : bouton permanent dans la bannière (index.html) et vue en cartes par module.
 * Contenu lu sur le serveur (/api/help-guides). Seul le Super Admin peut modifier procédure et lien vidéo. */
(function () {
  if (typeof V === 'undefined' || typeof VM === 'undefined') return;

  // Mêmes clés que HELP_KEYS côté serveur (src/help_guides.js).
  const HELP_MODULES = ['dash', 'quart', 'ventes', 'prod', 'pompes', 'cli', 'four', 'caisse', 'emp', 'alert', 'audit', 'param'];

  // Clé propre : « aide » désigne déjà le manuel (ext-aide-demo.js), qui écraserait cette vue.
  V.besoin_aide = ["Besoin d'aide", '*'];

  const isHttps = u => /^https:\/\/\S+$/.test(String(u || ''));

  function card(k, guide, isSuper) {
    const proc = guide && guide.procedure ? guide.procedure : '';
    const video = guide && guide.video_url ? guide.video_url : '';
    return `
      <article class="help-card" data-module="${esc(k)}">
        <h3>${esc(V[k][0])}</h3>
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
    const byKey = Object.fromEntries((data.guides || []).map(g => [g.module_key, g]));
    // Le droit d'édition vient de la session (ME.is_global), pas seulement de la réponse : une lecture ratée ne le retire plus.
    const isSuper = !!(ME && ME.is_global) || !!data.is_superadmin;
    const cards = HELP_MODULES
      .filter(k => V[k] && (isSuper || canView(k)))
      .map(k => card(k, byKey[k], isSuper))
      .join('');
    const notice = loadError
      ? `<p class="muted" role="status">Contenu non chargé. <button type="button" class="b2" onclick="go('besoin_aide')">Réessayer</button></p>`
      : '';
    return `<section class="help-page">
      <p class="muted">Procédures et vidéos par module.</p>${notice}
      <div class="help-grid">${cards || '<p class="muted">Aucun module d’aide accessible avec vos droits.</p>'}</div>
    </section>`;
  };

  // Édition réservée au Super Admin (le serveur refuse de toute façon les autres comptes).
  window.helpEdit = async function (k) {
    let data = { guides: [] };
    try { data = await G('/help-guides'); } catch (e) { return toast('Impossible de charger le contenu d’aide', 'error'); }
    const g = (data.guides || []).find(x => x.module_key === k) || {};
    modal(`<h3>Aide : ${esc(V[k][0])}</h3>
      <label>Procédure<textarea id="help-proc" rows="8" maxlength="20000" style="width:100%">${esc(g.procedure || '')}</textarea></label>
      <label>Lien vidéo (https)<input id="help-video" type="url" maxlength="500" value="${esc(g.video_url || '')}" placeholder="https://…" style="width:100%"></label>
      <div class="bar" style="margin-top:10px;justify-content:flex-end">
        <button class="b2" onclick="closeM()">Annuler</button>
        <button onclick="helpSave('${esc(k)}')">Enregistrer</button>
      </div>`);
  };

  window.helpSave = async function (k) {
    const procedure = document.getElementById('help-proc').value;
    const video_url = document.getElementById('help-video').value.trim();
    if (video_url && !isHttps(video_url)) return toast('Le lien vidéo doit commencer par https://', 'error');
    try {
      await Pu('/help-guides/' + encodeURIComponent(k), { procedure, video_url });
      closeM();
      toast('Aide enregistrée', 'success');
      if (typeof go === 'function') go('besoin_aide');
    } catch (e) { toast(errMsg(e)); }
  };
})();
