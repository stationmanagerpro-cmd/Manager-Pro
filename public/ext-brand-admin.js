/* ext-brand-admin.js — Identité app + panneau connexion + publicité (SuperAdmin). */
(function () {
  window.renderIdentityTab = async function () {
    if (!can('appearance.manage|settings.edit|user.manage')) return '<p class="warn">Accès réservé aux administrateurs.</p>';
    let b = {};
    try { b = await G('/admin/branding'); } catch (e) { return `<p class="warn">Identité indisponible : ${esc(errMsg(e))}</p>`; }
    const editable = !!b.editable;
    const img = (kind, label, has, hint) => `<div class="card" style="text-align:left;margin-bottom:10px">
      <b>${esc(label)}</b>
      <div style="margin:8px 0">${has
        ? `<img src="/api/branding/${kind}?v=${Date.now()}" alt="${esc(label)}" style="max-height:80px;max-width:100%;background:#fff;border:1px solid var(--bd);border-radius:8px;padding:4px">`
        : `<span style="color:var(--m);font-size:13px">Aucune image</span>`}</div>
      <p style="font-size:12px;color:var(--m);margin:0 0 8px">${esc(hint)}</p>
      ${editable ? `<div class="bar">
        <button class="b2" onclick="brPickImage('${kind}')">Changer</button>
        ${has ? `<button class="b2 bd" onclick="brDelImage('${kind}')">Supprimer</button>` : ''}
      </div>` : ''}
    </div>`;
    return `<h2 style="margin-top:0">Identité de l'application</h2>
      <p style="color:var(--m);font-size:13px">Nom, slogan, logo et panneau de connexion visibles sur l'écran de login. Panneau publicitaire affiché sur les tableaux de bord clients.</p>
      ${!editable ? '<p class="warn">Consultation seule — seules les modifications de l\'Administrateur Principal sont autorisées.</p>' : ''}
      <div class="card" style="text-align:left">
        <div class="g">
          <label>Nom de l'application<input id="br_name" value="${esc(b.name || '')}" ${editable ? '' : 'disabled'} maxlength="60"></label>
          <label>Slogan / tagline<input id="br_tag" value="${esc(b.tagline || '')}" ${editable ? '' : 'disabled'} maxlength="120"></label>
          <label>Couleur panneau connexion<input id="br_login_color" type="color" value="${esc(b.login_bg_color || '#0a6b5c')}" ${editable ? '' : 'disabled'}></label>
        </div>
        <h3>Panneau publicitaire (dashboards)</h3>
        <div class="g">
          <label>Titre<input id="br_ad_title" value="${esc(b.ad_title || 'PANNEAU PUBLICITAIRE')}" ${editable ? '' : 'disabled'} maxlength="80"></label>
          <label>Texte / message<textarea id="br_ad_text" rows="3" ${editable ? '' : 'disabled'} maxlength="500">${esc(b.ad_text || '')}</textarea></label>
        </div>
        <label style="flex-direction:row;align-items:center;gap:8px;margin:8px 0">
          <input type="checkbox" id="br_ad_on" ${b.ad_enabled !== false ? 'checked' : ''} ${editable ? '' : 'disabled'} style="width:auto">
          Afficher le panneau publicitaire sur les tableaux de bord
        </label>
        ${editable ? `<div class="r" style="margin-top:12px">
          <button class="b2" onclick="brReset()">Réinitialiser</button>
          <button onclick="brSave()">Enregistrer</button>
        </div>` : ''}
      </div>
      <div style="margin-top:16px">
        ${img('logo', 'Logo (menu et documents)', b.has_logo, 'PNG ou JPEG, 2 Mo max.')}
        ${img('favicon', 'Favicon (icône de l’onglet)', b.has_favicon, 'PNG ou JPEG carré recommandé.')}
        ${img('banner', 'Photo du bandeau (en haut de toutes les pages du Superadmin)', b.has_banner, 'Optionnel. Format large conseillé (ex. 1600 × 300). Le nom et le slogan s’affichent par-dessus : choisissez une photo plutôt sombre ou uniforme.')}
        ${img('login-bg', 'Image de fond du panneau de connexion', b.has_login_bg_image, 'Optionnel. Complète la couleur du panneau gauche de login.')}
      </div>`;
  };

  window.brSave = async function () {
    try {
      await api('PUT', '/admin/branding', {
        name: document.getElementById('br_name').value,
        tagline: document.getElementById('br_tag').value,
        login_bg_color: document.getElementById('br_login_color').value,
        ad_title: document.getElementById('br_ad_title').value,
        ad_text: document.getElementById('br_ad_text').value,
        ad_enabled: document.getElementById('br_ad_on').checked
      });
      await loadBrand();
      toast('Identité et panneau publicitaire enregistrés', 'success');
      go(cur, arg);
    } catch (e) { toast(errMsg(e), 'error'); }
  };
  window.brReset = function () {
    ask('Revenir aux valeurs par défaut (nom, slogan, couleur, publicité) ?', async () => {
      await Po('/admin/branding/reset');
      await loadBrand();
      toast('Valeurs par défaut rétablies', 'success');
      go(cur, arg);
    });
  };
  window.brPickImage = function (kind) {
    const labels = { logo: 'Logo', favicon: 'Favicon', 'login-bg': 'Image de fond connexion', banner: 'Photo du bandeau' };
    modal(`<h3>${labels[kind] || kind}</h3><p style="color:var(--m)">PNG ou JPEG, 2 Mo maximum.</p>
      <input type="file" id="brf" accept="image/png,image/jpeg">
      <div style="margin:12px 0"><img id="brp" style="display:none;max-height:96px;max-width:100%;border:1px solid var(--bd);border-radius:8px;background:#fff" alt=""></div>
      <div class="r"><button class="b2" onclick="closeM()">Annuler</button><button id="bro" disabled>Enregistrer</button></div>`);
    let data = null;
    document.getElementById('brf').onchange = e => {
      const f = e.target.files[0]; if (!f) return;
      if (!/^image\/(png|jpeg)$/.test(f.type)) return toast('Format refusé : PNG ou JPEG uniquement', 'error');
      if (f.size > 2 * 1024 * 1024) return toast('Fichier trop volumineux (2 Mo maximum)', 'error');
      const rd = new FileReader();
      rd.onload = () => { data = rd.result; const p = document.getElementById('brp'); p.src = data; p.style.display = 'block'; document.getElementById('bro').disabled = false; };
      rd.readAsDataURL(f);
    };
    document.getElementById('bro').onclick = async () => {
      try {
        await api('PUT', '/admin/branding/' + kind, { data_url: data });
        closeM(); await loadBrand(); toast('Image enregistrée', 'success'); go(cur, arg);
      } catch (e) { toast(errMsg(e), 'error'); }
    };
  };
  window.brDelImage = function (kind) {
    ask('Supprimer cette image ?', async () => {
      await api('DELETE', '/admin/branding/' + kind);
      await loadBrand(); toast('Image supprimée', 'success'); go(cur, arg);
    });
  };

  if (typeof SEC_FN !== 'undefined') SEC_FN.ident = () => window.renderIdentityTab();
})();
