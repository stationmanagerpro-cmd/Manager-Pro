/* ext-about.js — onglet « A propos de Manager PRO » (tout en bas du menu).
   Vitrine institutionnelle : présentation, solutions logicielles (Objectif / Solutions / Avantages), approche, « pourquoi choisir »,
   et — TOUT EN BAS — téléchargement des applications mobiles (Android / App Store).
   Visible par tous les comptes connectés ; le Super Admin la modifie lui-même (bouton « Modifier la page »).
   Données : GET /me/about, PUT /admin/about, POST /admin/about/reset. Le contenu est du texte brut, échappé à l'affichage.
   Liens de téléchargement : aucun lien par défaut ; vide = « Bientôt disponible » ; seuls les liens https:// du Super Admin sont affichés. */
(function () {
  'use strict';
  if (typeof V === 'undefined' || typeof VM === 'undefined') return;

  const E = s => esc(String(s == null ? '' : s));
  const L = { title: 80, tagline: 160, intro: 1200, body: 4000, icon: 8, contact: 160, phone: 40, sections: 12, solutions: 20, name: 60, subtitle: 120, objective: 600, item: 180, commitments: 6, short: 200, url: 500 };
  const STATUS = { disponible: ['Disponible', 'ok'], bientot: ['Bientôt disponible', 'soon'], developpement: ['En développement', 'dev'] };
  const WHY_ICONS = ['🎯', '🗂️', '📊', '🛡️', '📱', '🧱', '🤝', '⚙️', '🚀', '💡', '🔒', '🌍'];
  const st = { meta: null, edit: null };
  const newId = () => 's' + Math.random().toString(36).slice(2, 10).padEnd(8, '0');
  const paras = t => String(t || '').split('\n').map(x => x.trim()).filter(Boolean).map(x => '<p>' + E(x) + '</p>').join('');
  const ul = (arr, cls) => (arr && arr.length ? `<ul class="ab-ul ${cls || ''}">${arr.map(i => '<li>' + E(i) + '</li>').join('')}</ul>` : '');

  // Une ligne commençant par « - » devient une puce ; les autres lignes forment des paragraphes.
  function rich(text) {
    const out = []; let list = null;
    for (const raw of String(text || '').split('\n')) {
      const line = raw.trim(), m = /^[-•*]\s+(.*)$/.exec(line);
      if (m) { if (!list) { list = []; out.push(list); } list.push(m[1]); }
      else { list = null; if (line) out.push(line); }
    }
    return out.map(x => Array.isArray(x) ? '<ul class="ab-ul">' + x.map(i => '<li>' + E(i) + '</li>').join('') + '</ul>' : '<p>' + E(x) + '</p>').join('');
  }

  /* ---------------- Lecture ---------------- */
  function solutionCard(s) {
    const stt = STATUS[s.status];
    return `<article class="ab-sol" data-sol="${E(s.id)}">
      <header class="ab-sol-head">
        <span class="ab-sol-ic" aria-hidden="true">${E(s.icon || '🧩')}</span>
        <div class="ab-sol-t"><h3>${E(s.name)}</h3>${s.subtitle ? `<p>${E(s.subtitle)}</p>` : ''}</div>
        ${stt ? `<span class="ab-badge ab-${stt[1]}">${stt[0]}</span>` : ''}
      </header>
      ${s.objective ? `<div class="ab-blk ab-obj"><h4>Objectif</h4><p>${E(s.objective)}</p></div>` : ''}
      ${s.features.length ? `<div class="ab-blk"><h4>Solutions</h4>${ul(s.features)}</div>` : ''}
      ${s.benefits.length ? `<div class="ab-blk"><h4>Avantages</h4>${ul(s.benefits, 'ab-ok')}</div>` : ''}
    </article>`;
  }
  function phone(kind) {
    return `<div class="ab-phone ab-phone-${kind}" aria-hidden="true"><div class="ab-phone-screen">
      <img src="/icons/icon-192.png" alt="" width="36" height="36" loading="lazy" decoding="async"><b>MANAGER PRO</b><i></i><i></i><i class="s"></i></div></div>`;
  }
  function dlCard(kind, d) {
    const android = kind === 'android', url = android ? d.android_url : d.ios_url;
    const name = android ? 'Android' : 'iPhone et iPad';
    const heading = url ? (android ? 'Disponible sur Android' : 'Disponible sur iPhone et iPad') : (android ? 'Application Android' : 'Application iPhone et iPad');
    const btn = url
      ? `<a class="ab-dl-btn" href="${E(url)}" ${url.charAt(0) === '/' ? 'download' : 'target="_blank" rel="noopener noreferrer"'}>${android ? 'TÉLÉCHARGER SUR ANDROID' : 'TÉLÉCHARGER SUR L’APP STORE'}</a>`
      : '<span class="ab-dl-btn is-soon" role="status">BIENTÔT DISPONIBLE</span>';
    return `<article class="ab-dl-card" data-os="${kind}">
      ${phone(kind)}
      <div class="ab-dl-info"><span class="ab-os">${E(name)}</span><h3>${E(heading)}</h3>${btn}</div>
    </article>`;
  }
  function viewHtml(meta) {
    const d = meta.content, h = d.header, c = d.contact || {}, sg = d.signature || {};
    const secs = d.sections.filter(s => s.visible);
    const sols = d.solutions.filter(s => s.visible);
    const up = d.upcoming && d.upcoming.visible && (d.upcoming.title || d.upcoming.text) ? d.upcoming : null;
    const hasContact = c.email || c.phone || c.website || c.address;
    const dl = d.downloads || {};
    return `<div class="ab" id="ab-root">
      <section class="ab-hero">
        <div class="ab-hero-text"><h2>${E(h.title)}</h2>${h.tagline ? `<p class="ab-tag">${E(h.tagline)}</p>` : ''}${h.intro ? `<p class="ab-intro">${E(h.intro)}</p>` : ''}</div>
        ${meta.editable ? '<button type="button" class="ab-edit-btn" onclick="abEdit()">✏️ Modifier la page</button>' : ''}
      </section>
      ${secs.length ? `<div class="ab-grid">${secs.map(s => `<section class="ab-card"><h3>${s.icon ? `<span class="ab-ic" aria-hidden="true">${E(s.icon)}</span>` : ''}${E(s.title)}</h3><div class="ab-body">${rich(s.body)}</div></section>`).join('')}</div>` : ''}
      ${sols.length || up ? `<section class="ab-block" id="ab-solutions"><h2 class="ab-h">${E(d.solutions_title || 'NOS SOLUTIONS LOGICIELLES')}</h2>
        ${sols.length ? `<div class="ab-sol-grid">${sols.map(solutionCard).join('')}</div>` : ''}
        ${up ? `<article class="ab-upcoming"><span class="ab-up-ic" aria-hidden="true">✨</span><div><h3>${E(up.title)}</h3><div class="ab-body">${paras(up.text)}</div></div></article>` : ''}
      </section>` : ''}
      ${d.approach && (d.approach.title || d.approach.text || d.approach.commitments.length) ? `<section class="ab-approach"><h2 class="ab-h">${E(d.approach.title)}</h2>
        <div class="ab-approach-text">${paras(d.approach.text)}</div>
        ${d.approach.commitments.length ? `<ol class="ab-commit">${d.approach.commitments.map((k, i) => `<li><span class="ab-num" aria-hidden="true">${i + 1}</span><div><b>${E(k.title)}</b>${k.text ? `<p>${E(k.text)}</p>` : ''}</div></li>`).join('')}</ol>` : ''}
      </section>` : ''}
      ${d.why && d.why.items.length ? `<section class="ab-block ab-why"><h2 class="ab-h">${E(d.why.title)}</h2>
        <ul class="ab-why-grid">${d.why.items.map((t, i) => `<li><span class="ab-why-ic" aria-hidden="true">${WHY_ICONS[i % WHY_ICONS.length]}</span><span>${E(t)}</span></li>`).join('')}</ul></section>` : ''}
      ${hasContact ? `<section class="ab-card ab-contact"><h3><span class="ab-ic" aria-hidden="true">📞</span>Nous contacter</h3><ul class="ab-clist">
        ${c.email ? `<li><span>E-mail</span><a href="mailto:${E(c.email)}">${E(c.email)}</a></li>` : ''}
        ${c.phone ? `<li><span>Téléphone</span><a href="tel:${E(c.phone.replace(/[^0-9+]/g, ''))}">${E(c.phone)}</a></li>` : ''}
        ${c.website ? `<li><span>Site web</span><a href="${E(c.website)}" target="_blank" rel="noopener noreferrer">${E(c.website)}</a></li>` : ''}
        ${c.address ? `<li><span>Adresse</span><b>${E(c.address)}</b></li>` : ''}
      </ul></section>` : ''}
      <section class="ab-dl" id="ab-download" aria-labelledby="ab-dl-t">
        <h2 id="ab-dl-t">${E(dl.title || 'MANAGER PRO VOUS ACCOMPAGNE PARTOUT')}</h2>
        ${dl.subtitle ? `<p class="ab-dl-sub">${E(dl.subtitle)}</p>` : ''}
        <div class="ab-dl-grid">${dlCard('android', dl)}${dlCard('ios', dl)}</div>
        <footer class="ab-sign">
          ${sg.name ? `<b>${E(sg.name)}</b>` : ''}${sg.tagline ? `<span>${E(sg.tagline)}</span>` : ''}${sg.slogan ? `<em>${E(sg.slogan)}</em>` : ''}
          <small>Manager PRO${meta.app_version ? ' · version ' + E(meta.app_version) : ''}${meta.editable && !meta.customized ? ' · modèle d’origine (vous pouvez le personnaliser)' : ''}</small>
        </footer>
      </section>
    </div>`;
  }

  /* ---------------- Édition (Super Admin) ---------------- */
  const ARR = { sec: d => d.sections, sol: d => d.solutions, com: d => d.approach.commitments };
  const MAX = { sec: L.sections, sol: L.solutions, com: L.commitments };
  const acts = (kind, i, n) => `<span class="ab-acts">
      <button type="button" class="b2" ${i === 0 ? 'disabled' : ''} onclick="abMove('${kind}',${i},-1)" aria-label="Monter">↑</button>
      <button type="button" class="b2" ${i === n - 1 ? 'disabled' : ''} onclick="abMove('${kind}',${i},1)" aria-label="Descendre">↓</button>
      <button type="button" class="b2 bd" onclick="abDel('${kind}',${i})" aria-label="Supprimer">✕</button></span>`;
  function secRow(s, i, n) {
    return `<div class="ab-sec" data-id="${E(s.id)}">
      <div class="ab-sec-head">
        <input class="ab-i" value="${E(s.icon)}" maxlength="${L.icon}" aria-label="Icône (emoji)" title="Icône (un emoji)">
        <input class="ab-t" value="${E(s.title)}" maxlength="${L.title}" placeholder="Titre de la rubrique" aria-label="Titre de la rubrique">
        <label class="ab-vis"><input type="checkbox" class="ab-v" ${s.visible !== false ? 'checked' : ''}> Visible</label>${acts('sec', i, n)}
      </div>
      <textarea class="ab-b" rows="3" maxlength="${L.body}" placeholder="Texte de la rubrique…" aria-label="Texte de la rubrique">${E(s.body)}</textarea>
    </div>`;
  }
  function solRow(s, i, n) {
    const opts = [['', 'Statut non précisé'], ['disponible', 'Disponible'], ['bientot', 'Bientôt disponible'], ['developpement', 'En développement']];
    return `<details class="ab-sec ab-sole" data-id="${E(s.id)}" ${s.__open ? 'open' : ''}>
      <summary><span class="e-sum">${E(s.icon)} ${E(s.name || 'Nouvelle solution')}</span></summary>
      <div class="ab-sec-head">
        <input class="e-ic ab-i" value="${E(s.icon)}" maxlength="${L.icon}" aria-label="Icône (emoji)" title="Icône (un emoji)">
        <input class="e-name ab-t" value="${E(s.name)}" maxlength="${L.name}" placeholder="Nom de la solution" aria-label="Nom de la solution">
        <label class="ab-vis"><input type="checkbox" class="e-vis" ${s.visible !== false ? 'checked' : ''}> Visible</label>${acts('sol', i, n)}
      </div>
      <div class="ab-form">
        <label>Sous-titre<input class="e-sub" value="${E(s.subtitle)}" maxlength="${L.subtitle}"></label>
        <label>Statut affiché<select class="e-status">${opts.map(([v, t]) => `<option value="${v}" ${s.status === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label class="ab-wide">Objectif (le problème métier auquel le logiciel répond)<textarea class="e-obj" rows="3" maxlength="${L.objective}">${E(s.objective)}</textarea></label>
        <label>Solutions (une fonctionnalité par ligne)<textarea class="e-feat" rows="7">${E((s.features || []).join('\n'))}</textarea></label>
        <label>Avantages (un avantage par ligne)<textarea class="e-ben" rows="7">${E((s.benefits || []).join('\n'))}</textarea></label>
      </div>
    </details>`;
  }
  function comRow(k, i, n) {
    return `<div class="ab-sec ab-com-ed"><div class="ab-sec-head">
      <input class="c-t ab-t" value="${E(k.title)}" maxlength="${L.name}" placeholder="Titre de l’engagement" aria-label="Titre de l’engagement">${acts('com', i, n)}</div>
      <input class="c-x" value="${E(k.text)}" maxlength="${L.short}" placeholder="Texte court" aria-label="Texte de l’engagement"></div>`;
  }
  const field = (id, label, val, max, extra = '') => `<label ${extra}>${label}<input id="${id}" value="${E(val)}" maxlength="${max}"></label>`;
  const area = (id, label, val, max, rows = 3, extra = 'class="ab-wide"') => `<label ${extra}>${label}<textarea id="${id}" rows="${rows}" maxlength="${max}">${E(val)}</textarea></label>`;
  function editHtml(d) {
    const h = d.header, c = d.contact || {}, up = d.upcoming, ap = d.approach, w = d.why, dl = d.downloads, sg = d.signature;
    return `<div class="ab ab-editing" id="ab-root">
      <section class="ab-card"><h3>✏️ Modifier la page « ${E(V.apropos[0])} »</h3>
        <p class="ab-hint">Visible par tous les comptes (Super Admin et clients). Texte simple, sans mise en forme : une ligne commençant par « - » devient une puce dans les rubriques. Rien n'est publié avant « Enregistrer ».</p>
        <div class="ab-form">${field('ab_title', 'Titre de la page', h.title, L.title)}${field('ab_tag', 'Slogan', h.tagline, L.tagline)}${area('ab_intro', 'Introduction', h.intro, L.intro)}</div>
      </section>
      <section class="ab-card"><h3>Rubriques de présentation <small>(qui sommes-nous, vision…)</small></h3>
        <div>${d.sections.map((s, i) => secRow(s, i, d.sections.length)).join('') || '<p class="ab-empty">Aucune rubrique.</p>'}</div>
        <div class="ab-bar"><button type="button" class="b2" ${d.sections.length >= L.sections ? 'disabled' : ''} onclick="abAdd('sec')">＋ Ajouter une rubrique</button><small>${d.sections.length}/${L.sections}</small></div>
      </section>
      <section class="ab-card"><h3>Solutions logicielles <small>(Objectif · Solutions · Avantages)</small></h3>
        <div class="ab-form">${field('ab_soltitle', 'Titre de la section', d.solutions_title, L.title, 'class="ab-wide"')}</div>
        <p class="ab-hint">N’affichez « Disponible » que pour un logiciel réellement commercialisé ; « Bientôt disponible » ou « En développement » sinon.</p>
        <div>${d.solutions.map((s, i) => solRow(s, i, d.solutions.length)).join('') || '<p class="ab-empty">Aucune solution.</p>'}</div>
        <div class="ab-bar"><button type="button" class="b2" ${d.solutions.length >= L.solutions ? 'disabled' : ''} onclick="abAdd('sol')">＋ Ajouter une solution</button><small>${d.solutions.length}/${L.solutions}</small></div>
        <h3 style="margin-top:18px">Carte « solutions à venir »</h3>
        <div class="ab-form"><label class="ab-wide ab-vis"><input type="checkbox" id="ab_upvis" ${up.visible ? 'checked' : ''}> Afficher cette carte</label>
          ${field('ab_uptitle', 'Titre', up.title, L.title, 'class="ab-wide"')}${area('ab_uptext', 'Texte (un paragraphe par ligne)', up.text, L.body, 4)}</div>
      </section>
      <section class="ab-card"><h3>Notre approche</h3>
        <div class="ab-form">${field('ab_aptitle', 'Titre', ap.title, L.title, 'class="ab-wide"')}${area('ab_aptext', 'Texte (un paragraphe par ligne)', ap.text, L.body, 6)}</div>
        <h4 class="ab-sub">Engagements</h4>
        <div>${ap.commitments.map((k, i) => comRow(k, i, ap.commitments.length)).join('') || '<p class="ab-empty">Aucun engagement.</p>'}</div>
        <div class="ab-bar"><button type="button" class="b2" ${ap.commitments.length >= L.commitments ? 'disabled' : ''} onclick="abAdd('com')">＋ Ajouter un engagement</button><small>${ap.commitments.length}/${L.commitments}</small></div>
      </section>
      <section class="ab-card"><h3>Pourquoi choisir Manager PRO ?</h3>
        <div class="ab-form">${field('ab_whytitle', 'Titre', w.title, L.title, 'class="ab-wide"')}${area('ab_whyitems', 'Arguments (un par ligne)', w.items.join('\n'), L.item * 12, 8)}</div>
      </section>
      <section class="ab-card"><h3>Coordonnées <small>(facultatif)</small></h3>
        <div class="ab-form">${field('ab_email', 'E-mail', c.email, L.contact)}${field('ab_phone', 'Téléphone', c.phone, L.phone)}${field('ab_web', 'Site web (https://…)', c.website, L.contact)}${field('ab_addr', 'Adresse', c.address, L.contact)}</div>
      </section>
      <section class="ab-card"><h3>Téléchargement des applications mobiles <small>(affiché tout en bas de la page)</small></h3>
        <p class="ab-hint">Collez ici le lien officiel de téléchargement. Laissez vide tant que l’application n’est pas publiée : la page affichera « Bientôt disponible » (jamais de faux lien). Seules les adresses https:// sont acceptées.</p>
        <div class="ab-form">${field('ab_dltitle', 'Titre', dl.title, L.title, 'class="ab-wide"')}${area('ab_dlsub', 'Sous-titre', dl.subtitle, L.body, 3)}
          ${field('ab_android', 'Lien de téléchargement Android (Google Play ou lien direct)', dl.android_url, L.url, 'class="ab-wide"')}${field('ab_ios', 'Lien App Store (iPhone / iPad)', dl.ios_url, L.url, 'class="ab-wide"')}</div>
      </section>
      <section class="ab-card"><h3>Signature <small>(bas de page)</small></h3>
        <div class="ab-form">${field('ab_sgname', 'Nom', sg.name, L.name)}${field('ab_sgtag', 'Phrase de signature', sg.tagline, L.tagline)}${field('ab_sgslogan', 'Slogan', sg.slogan, L.tagline, 'class="ab-wide"')}</div>
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
    const root = document.getElementById('ab-root'), g = id => { const el = document.getElementById(id); return el ? el.value : ''; };
    const q = (r, s) => r.querySelector(s), lines = el => el.value.split('\n').map(x => x.trim()).filter(Boolean);
    return {
      v: 2,
      header: { title: g('ab_title'), tagline: g('ab_tag'), intro: g('ab_intro') },
      sections: [...root.querySelectorAll('.ab-sec[data-id]:not(.ab-sole)')].map(r => ({ id: r.dataset.id, icon: q(r, '.ab-i').value, title: q(r, '.ab-t').value, visible: q(r, '.ab-v').checked, body: q(r, '.ab-b').value })),
      solutions_title: g('ab_soltitle'),
      solutions: [...root.querySelectorAll('.ab-sole')].map(r => ({
        id: r.dataset.id, icon: q(r, '.e-ic').value, name: q(r, '.e-name').value, subtitle: q(r, '.e-sub').value, status: q(r, '.e-status').value,
        visible: q(r, '.e-vis').checked, objective: q(r, '.e-obj').value, features: lines(q(r, '.e-feat')), benefits: lines(q(r, '.e-ben')), __open: r.open
      })),
      upcoming: { visible: !!(document.getElementById('ab_upvis') || {}).checked, title: g('ab_uptitle'), text: g('ab_uptext') },
      approach: { title: g('ab_aptitle'), text: g('ab_aptext'), commitments: [...root.querySelectorAll('.ab-com-ed')].map(r => ({ title: q(r, '.c-t').value, text: q(r, '.c-x').value })) },
      why: { title: g('ab_whytitle'), items: g('ab_whyitems').split('\n').map(x => x.trim()).filter(Boolean) },
      downloads: { title: g('ab_dltitle'), subtitle: g('ab_dlsub'), android_url: g('ab_android').trim(), ios_url: g('ab_ios').trim() },
      contact: { email: g('ab_email'), phone: g('ab_phone'), website: g('ab_web'), address: g('ab_addr') },
      signature: { name: g('ab_sgname'), tagline: g('ab_sgtag'), slogan: g('ab_sgslogan') }
    };
  }
  const paint = () => { const root = document.getElementById('ab-root'); if (root) root.outerHTML = editHtml(st.edit); };
  const blank = { sec: () => ({ id: newId(), icon: '📌', title: 'Nouvelle rubrique', visible: true, body: '' }),
    sol: () => ({ id: newId(), icon: '🧩', name: 'NOUVELLE SOLUTION MANAGER PRO', subtitle: '', status: '', visible: true, objective: '', features: [], benefits: [], __open: true }),
    com: () => ({ title: 'Nouvel engagement', text: '' }) };

  window.abEdit = () => { if (!st.meta || !st.meta.editable) return; st.edit = JSON.parse(JSON.stringify(st.meta.content)); paint(); window.scrollTo({ top: 0 }); };
  window.abCancel = () => { st.edit = null; go('apropos'); };
  window.abAdd = kind => { st.edit = collect(); const a = ARR[kind](st.edit); if (a.length >= MAX[kind]) return; a.push(blank[kind]()); paint(); };
  window.abDel = (kind, i) => { st.edit = collect(); ARR[kind](st.edit).splice(i, 1); paint(); };
  window.abMove = (kind, i, dir) => {
    st.edit = collect(); const a = ARR[kind](st.edit), j = i + dir;
    if (j < 0 || j >= a.length) return;
    [a[i], a[j]] = [a[j], a[i]]; paint();
  };
  window.abSave = async () => {
    const content = collect();
    content.solutions.forEach(s => { delete s.__open; });
    if (!content.header.title.trim()) return toast('Le titre de la page est obligatoire', 'error');
    if (content.sections.some(s => !s.title.trim())) return toast('Chaque rubrique doit avoir un titre', 'error');
    if (content.solutions.some(s => !s.name.trim())) return toast('Chaque solution doit avoir un nom', 'error');
    if (content.approach.commitments.some(k => !k.title.trim())) return toast('Chaque engagement doit avoir un titre', 'error');
    for (const [v, l] of [[content.downloads.android_url, 'Android'], [content.downloads.ios_url, 'App Store']]) {
      if (v && !/^https:\/\/[^\s]+$/i.test(v) && !/^\/telechargements\/[A-Za-z0-9._-]+$/.test(v)) return toast('Lien ' + l + ' : l’adresse doit commencer par https://', 'error');
    }
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
