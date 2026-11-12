/* ext-about.js — onglet « A propos de Manager PRO » (tout en bas du menu).
   Page de présentation (vision, mission, objectifs, valeurs…) visible par tous les comptes connectés ;
   le Super Admin peut la modifier lui-même (bouton « Modifier la page »). Données : GET /me/about, PUT /admin/about, POST /admin/about/reset.
   Le contenu est du texte brut, échappé à l'affichage (aucun HTML libre). Le serveur refuse toute modification venant d'un autre compte. */
(function () {
  'use strict';
  if (typeof V === 'undefined' || typeof VM === 'undefined') return;

  const E = s => esc(String(s == null ? '' : s));
  const L = { title: 80, tagline: 160, intro: 1200, body: 4000, icon: 8, contact: 160, phone: 40, sections: 12 };
  const st = { meta: null, edit: null };
  const newId = () => 's' + Math.random().toString(36).slice(2, 10).padEnd(8, '0');

  // Une ligne commençant par « - » devient une puce ; les autres lignes forment des paragraphes.
  function rich(text) {
    const out = []; let list = null;
    for (const raw of String(text || '').split('\n')) {
      const line = raw.trim(), m = /^[-•*]\s+(.*)$/.exec(line);
      if (m) { if (!list) { list = []; out.push(list); } list.push(m[1]); }
      else { list = null; if (line) out.push(line); }
    }
    return out.map(x => Array.isArray(x) ? '<ul>' + x.map(i => '<li>' + E(i) + '</li>').join('') + '</ul>' : '<p>' + E(x) + '</p>').join('');
  }

  /* ---------------- Lecture ---------------- */
  function viewHtml(meta) {
    const d = meta.content, h = d.header, c = d.contact || {};
    const secs = d.sections.filter(s => s.visible);
    const hasContact = c.email || c.phone || c.website || c.address;
    const contact = hasContact ? `<section class="ab-card ab-contact"><h3><span class="ab-ic" aria-hidden="true">📞</span>Nous contacter</h3><ul class="ab-clist">
        ${c.email ? `<li><span>E-mail</span><a href="mailto:${E(c.email)}">${E(c.email)}</a></li>` : ''}
        ${c.phone ? `<li><span>Téléphone</span><a href="tel:${E(c.phone.replace(/[^0-9+]/g, ''))}">${E(c.phone)}</a></li>` : ''}
        ${c.website ? `<li><span>Site web</span><a href="${E(c.website)}" target="_blank" rel="noopener noreferrer">${E(c.website)}</a></li>` : ''}
        ${c.address ? `<li><span>Adresse</span><b>${E(c.address)}</b></li>` : ''}
      </ul></section>` : '';
    return `<div class="ab" id="ab-root">
      <section class="ab-hero">
        <div class="ab-hero-text"><h2>${E(h.title)}</h2>${h.tagline ? `<p class="ab-tag">${E(h.tagline)}</p>` : ''}${h.intro ? `<p class="ab-intro">${E(h.intro)}</p>` : ''}</div>
        ${meta.editable ? '<button type="button" class="ab-edit-btn" onclick="abEdit()">✏️ Modifier la page</button>' : ''}
      </section>
      ${secs.length ? `<div class="ab-grid">${secs.map(s => `<section class="ab-card"><h3>${s.icon ? `<span class="ab-ic" aria-hidden="true">${E(s.icon)}</span>` : ''}${E(s.title)}</h3><div class="ab-body">${rich(s.body)}</div></section>`).join('')}</div>`
        : '<p class="ab-empty">Aucune rubrique à afficher pour le moment.</p>'}
      ${contact}
      <p class="ab-foot">Manager PRO${meta.app_version ? ' · version ' + E(meta.app_version) : ''}${meta.editable && !meta.customized ? ' · modèle d’origine (vous pouvez le personnaliser)' : ''}</p>
    </div>`;
  }

  /* ---------------- Édition (Super Admin) ---------------- */
  function secRow(s, i, n) {
    return `<div class="ab-sec" data-id="${E(s.id)}">
      <div class="ab-sec-head">
        <input class="ab-i" value="${E(s.icon)}" maxlength="${L.icon}" aria-label="Icône (emoji)" title="Icône (un emoji)">
        <input class="ab-t" value="${E(s.title)}" maxlength="${L.title}" placeholder="Titre de la rubrique" aria-label="Titre de la rubrique">
        <label class="ab-vis"><input type="checkbox" class="ab-v" ${s.visible !== false ? 'checked' : ''}> Visible</label>
        <span class="ab-acts">
          <button type="button" class="b2" ${i === 0 ? 'disabled' : ''} onclick="abMove(${i},-1)" aria-label="Monter la rubrique">↑</button>
          <button type="button" class="b2" ${i === n - 1 ? 'disabled' : ''} onclick="abMove(${i},1)" aria-label="Descendre la rubrique">↓</button>
          <button type="button" class="b2 bd" onclick="abDel(${i})" aria-label="Supprimer la rubrique">✕</button>
        </span>
      </div>
      <textarea class="ab-b" rows="4" maxlength="${L.body}" placeholder="Texte de la rubrique…" aria-label="Texte de la rubrique">${E(s.body)}</textarea>
    </div>`;
  }
  function editHtml(d) {
    const h = d.header, c = d.contact || {};
    return `<div class="ab ab-editing" id="ab-root">
      <section class="ab-card"><h3>✏️ Modifier la page « ${E(V.apropos[0])} »</h3>
        <p class="ab-hint">Visible par tous les comptes (Super Admin et clients). Texte simple : une ligne commençant par « - » devient une puce.</p>
        <div class="ab-form">
          <label>Titre de la page<input id="ab_title" value="${E(h.title)}" maxlength="${L.title}"></label>
          <label>Slogan<input id="ab_tag" value="${E(h.tagline)}" maxlength="${L.tagline}"></label>
          <label class="ab-wide">Introduction<textarea id="ab_intro" rows="3" maxlength="${L.intro}">${E(h.intro)}</textarea></label>
        </div>
      </section>
      <section class="ab-card"><h3>Rubriques <small>(vision, mission, objectifs, valeurs…)</small></h3>
        <div id="ab-secs">${d.sections.map((s, i) => secRow(s, i, d.sections.length)).join('') || '<p class="ab-empty">Aucune rubrique.</p>'}</div>
        <div class="ab-bar"><button type="button" class="b2" ${d.sections.length >= L.sections ? 'disabled' : ''} onclick="abAdd()">＋ Ajouter une rubrique</button><small>${d.sections.length}/${L.sections}</small></div>
      </section>
      <section class="ab-card"><h3>Coordonnées <small>(facultatif)</small></h3>
        <div class="ab-form">
          <label>E-mail<input id="ab_email" type="email" value="${E(c.email)}" maxlength="${L.contact}"></label>
          <label>Téléphone<input id="ab_phone" value="${E(c.phone)}" maxlength="${L.phone}"></label>
          <label>Site web (https://…)<input id="ab_web" value="${E(c.website)}" maxlength="${L.contact}"></label>
          <label>Adresse<input id="ab_addr" value="${E(c.address)}" maxlength="${L.contact}"></label>
        </div>
      </section>
      <div class="ab-bar ab-save">
        <button type="button" class="b2 bd" onclick="abReset()">Rétablir le modèle d’origine</button>
        <span class="ab-spacer"></span>
        <button type="button" class="b2" onclick="abCancel()">Annuler</button>
        <button type="button" onclick="abSave()">Enregistrer</button>
      </div>
    </div>`;
  }
  // Lit le formulaire tel qu'il est à l'écran (les ajouts, suppressions et déplacements ne perdent pas la saisie en cours).
  function collect() {
    const g = id => { const el = document.getElementById(id); return el ? el.value : ''; };
    return {
      v: 1,
      header: { title: g('ab_title'), tagline: g('ab_tag'), intro: g('ab_intro') },
      sections: [...document.querySelectorAll('#ab-root .ab-sec')].map(r => ({
        id: r.dataset.id, icon: r.querySelector('.ab-i').value, title: r.querySelector('.ab-t').value,
        visible: r.querySelector('.ab-v').checked, body: r.querySelector('.ab-b').value
      })),
      contact: { email: g('ab_email'), phone: g('ab_phone'), website: g('ab_web'), address: g('ab_addr') }
    };
  }
  const paint = () => { const root = document.getElementById('ab-root'); if (root) { root.outerHTML = editHtml(st.edit); } };

  window.abEdit = () => { if (!st.meta || !st.meta.editable) return; st.edit = JSON.parse(JSON.stringify(st.meta.content)); paint(); window.scrollTo({ top: 0 }); };
  window.abCancel = () => { st.edit = null; go('apropos'); };
  window.abAdd = () => { st.edit = collect(); if (st.edit.sections.length >= L.sections) return; st.edit.sections.push({ id: newId(), icon: '📌', title: 'Nouvelle rubrique', visible: true, body: '' }); paint(); };
  window.abDel = i => { st.edit = collect(); st.edit.sections.splice(i, 1); paint(); };
  window.abMove = (i, dir) => {
    st.edit = collect(); const a = st.edit.sections, j = i + dir;
    if (j < 0 || j >= a.length) return;
    [a[i], a[j]] = [a[j], a[i]]; paint();
  };
  window.abSave = async () => {
    const content = collect();
    if (!content.header.title.trim()) return toast('Le titre de la page est obligatoire', 'error');
    if (content.sections.some(s => !s.title.trim())) return toast('Chaque rubrique doit avoir un titre', 'error');
    try {
      await api('PUT', '/admin/about', { content });
      st.edit = null; toast('Page « A propos » enregistrée', 'success'); go('apropos');
    } catch (e) { toast(errMsg(e), 'error'); }
  };
  window.abReset = () => ask('Rétablir le texte d’origine ? Vos modifications de cette page seront perdues.', async () => {
    try { await Po('/admin/about/reset', {}); st.edit = null; toast('Modèle d’origine rétabli', 'success'); go('apropos'); }
    catch (e) { toast(errMsg(e), 'error'); }
  });

  /* ---------------- Vue ---------------- */
  async function vAbout() {
    try { st.meta = await G('/me/about'); }
    catch (e) { return `<div class="ab"><p class="warn">Page indisponible : ${E(errMsg(e))}</p></div>`; }
    if (!st.meta.editable) st.edit = null;
    return viewHtml(st.meta);
  }

  /* ---------------- Enregistrement de la vue (visible par le Super Admin ET par les comptes clients) ---------------- */
  function register() {
    if (typeof V === 'undefined' || typeof VM === 'undefined') return;
    V.apropos = ['A propos de Manager PRO', '*'];
    VM.apropos = vAbout;
    try { NAV_ICONS.apropos = 'ℹ️'; } catch (_) { /* icônes indisponibles */ }
    try { SUPERADMIN_VIEWS.add('apropos'); SHARED_VIEWS.add('apropos'); } catch (_) { /* ensembles indisponibles */ }
  }
  register();
  window.addEventListener('load', register);
})();
