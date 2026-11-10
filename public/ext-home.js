/* ext-home.js — page d'accueil publique, saisie de la clé d'accès, et écrans Super Admin
   « 🔑 Clé d'accès » et « Personnalisation de l'accueil ».
   Principe : le visiteur non connecté voit la page d'accueil ; « Se connecter » ouvre la saisie de clé (si le Super Admin l'a activée),
   puis l'écran de connexion habituel. La clé ne remplace jamais le mot de passe : le serveur revérifie à la connexion. */
(function () {
  'use strict';
  const E = s => (typeof esc === 'function' ? esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const C = () => window.dv2Color || null;
  const SLOTS = ['logo', 'hero', 'background', 'g1', 'g2', 'g3', 'g4'];
  const SLOT_LABEL = { logo: 'Logo', hero: 'Image principale', background: 'Image de fond', g1: 'Photo 1', g2: 'Photo 2', g3: 'Photo 3', g4: 'Photo 4' };
  const origLogin = typeof window.showLogin === 'function' ? window.showLogin : null;

  /* ---------------- Rendu de la page d'accueil (moteur partagé : home-core.js) ---------------- */
  const homeHtml = (doc, imgUrl) => { const r = window.HomeCore.render(doc, { imgUrl }); return '<style>' + r.css + '</style>' + r.html; };
  /* Menu burger (☰) : le CSS ouvre / ferme le panneau (case à cocher cachée) ; ici on le referme après un clic sur un lien, en dehors du menu ou avec Échap. */
  const closeBurgers = () => document.querySelectorAll('#login .hb-chk:checked').forEach(c => { c.checked = false; });
  document.addEventListener('click', ev => {
    const t = ev.target; if (!t || !t.closest || !document.querySelector('#login .hb-chk:checked')) return;
    if (t.closest('#login .hb-panel [data-act],#login .hb-panel [data-anchor],#login .hb-panel a[href]') || !t.closest('#login .hb-host')) closeBurgers();
  }, true);
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape') closeBurgers(); });
  document.addEventListener('click', ev => {
    const a = ev.target.closest && ev.target.closest('#login [data-act],#login [data-anchor]');
    if (!a) return;
    ev.preventDefault();
    if (a.dataset.act === 'login') return window.homeLogin();
    const t = document.getElementById('hp-' + a.dataset.anchor); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  /* ---------------- Visiteur : accueil -> clé -> connexion ---------------- */
  let HOME = null;
  async function fetchHome() {
    const r = await fetch('/api/public/home', { cache: 'no-store', credentials: 'same-origin' });
    if (!r.ok) throw new Error('home ' + r.status);
    return r.json();
  }
  async function showHome() {
    try {
      HOME = await fetchHome();
    } catch (e) { return origLogin && origLogin(); }   // serveur ancien / hors ligne : écran de connexion habituel
    const app = document.getElementById('app'); if (app) { app.style.display = 'none'; app.classList.remove('ready'); }
    const box = document.getElementById('login'); if (!box) return origLogin && origLogin();
    box.innerHTML = homeHtml(HOME.content, id => (window.HomeCore.BUILTIN_IMAGES[id] || `/api/public/home/image/${id}?v=${encodeURIComponent(HOME.v)}`));
    document.title = (HOME.content.meta && HOME.content.meta.title) || document.title;
  }
  function showLoginForm() {
    origLogin && origLogin();
    const wrap = document.querySelector('#login .login-card');
    if (wrap && !wrap.querySelector('.hp-back')) wrap.insertAdjacentHTML('afterbegin', '<a href="#" class="hp-back" onclick="showLogin();return false">← Retour à l’accueil</a>');
  }
  window.homeLogin = function () {
    if (HOME && HOME.access && HOME.access.required && !HOME.access.ok) return openKeyDialog();
    showLoginForm();
  };
  function openKeyDialog() {
    const host = document.getElementById('login');
    host.insertAdjacentHTML('beforeend', `<div class="hp-overlay" id="hp-key" role="dialog" aria-modal="true" aria-labelledby="hp-key-t">
      <div class="hp-dialog"><h2 id="hp-key-t">Clé d’accès</h2>
        <p>Saisissez la clé à 4 chiffres communiquée par l’administrateur pour accéder à la connexion.</p>
        <label for="hp-key-in">Clé d’accès</label>
        <input id="hp-key-in" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="one-time-code" placeholder="••••" onkeydown="if(event.key==='Enter')homeVerify()">
        <p id="hp-key-msg" class="hp-msg" role="alert" aria-live="assertive"></p>
        <div class="hp-dlg-actions"><button type="button" class="b2" onclick="homeKeyClose()">Retour à l’accueil</button><button type="button" id="hp-key-ok" onclick="homeVerify()">Vérifier la clé</button></div>
        <p style="margin:12px 0 0;text-align:center"><button type="button" class="b2" onclick="homeRecoveryOpen()">Clé expirée ou perdue ? Code de secours Superadmin</button></p>
      </div></div>`);
    const i = document.getElementById('hp-key-in'); i && i.focus();
  }
  window.homeRecoveryOpen = function () {
    const d = document.querySelector('#hp-key .hp-dialog'); if (!d) return;
    d.innerHTML = `<h2 id="hp-key-t">Code de secours Superadmin</h2>
      <p>Saisissez le code de secours à 16 caractères généré dans « Clé d’accès ». Il ne fonctionne qu’une seule fois et n’ouvre que l’écran de connexion : le mot de passe reste obligatoire.</p>
      <label for="hp-rec-in">Code de secours</label>
      <input id="hp-rec-in" maxlength="24" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX" onkeydown="if(event.key==='Enter')homeRecover()">
      <p id="hp-key-msg" class="hp-msg" role="alert" aria-live="assertive"></p>
      <div class="hp-dlg-actions"><button type="button" class="b2" onclick="homeKeyClose()">Retour à l’accueil</button><button type="button" id="hp-key-ok" onclick="homeRecover()">Utiliser le code</button></div>
      <p style="margin:10px 0 0;font-size:12.5px;opacity:.8">Code perdu ? Sur le PC serveur : <code>npm run access:rescue -- new-key</code> (ou <code>open</code>).</p>`;
    const i = document.getElementById('hp-rec-in'); i && i.focus();
  };
  window.homeRecover = async function () {
    const inp = document.getElementById('hp-rec-in'), msg = document.getElementById('hp-key-msg'), ok = document.getElementById('hp-key-ok');
    if (!inp) return;
    const code = inp.value.trim();
    if (!code) { msg.textContent = 'Saisissez le code de secours.'; return; }
    ok.disabled = true; const label = ok.textContent; ok.textContent = 'Vérification…'; msg.textContent = '';
    try {
      const r = await fetch('/api/public/access/recovery', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { msg.textContent = j.error || 'Vérification impossible.'; inp.value = ''; inp.focus(); return; }
      HOME.access.ok = true; window.homeKeyClose(); showLoginForm();
      try { toast('Code de secours accepté. Après connexion, générez un nouveau code de secours et une nouvelle clé (menu « Clé d’accès »).', 'success'); } catch (_) { /* toast absent sur l'écran de connexion */ }
    } catch (e) { msg.textContent = 'Serveur injoignable. Vérifiez la connexion réseau.'; }
    finally { ok.disabled = false; ok.textContent = label; }
  };
  window.homeKeyClose = function () { const o = document.getElementById('hp-key'); if (o) o.remove(); };
  window.homeVerify = async function () {
    const inp = document.getElementById('hp-key-in'), msg = document.getElementById('hp-key-msg'), ok = document.getElementById('hp-key-ok');
    if (!inp) return;
    const key = inp.value.trim();
    if (!/^\d{4}$/.test(key)) { msg.textContent = 'La clé comporte exactement 4 chiffres.'; return; }
    ok.disabled = true; const label = ok.textContent; ok.textContent = 'Vérification…'; msg.textContent = '';
    try {
      const r = await fetch('/api/public/access/verify', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { msg.textContent = j.error || 'Vérification impossible.'; inp.value = ''; inp.focus(); return; }
      HOME.access.ok = true; window.homeKeyClose(); showLoginForm();
    } catch (e) { msg.textContent = 'Serveur injoignable. Vérifiez la connexion réseau.'; }
    finally { ok.disabled = false; ok.textContent = label; }
  };
  if (origLogin) {
    window.showLogin = function (e) {
      // appelé aussi comme gestionnaire d'erreur (boot().catch(showLogin)) et à la déconnexion : on repart toujours de l'accueil
      return showHome();
    };
  }

  /* ---------------- Super Admin : « 🔑 Clé d'accès » ---------------- */
  const dtf = t => (t ? new Date(t).toLocaleString('fr-FR') : '—');
  const ST = { provisoire: ['Provisoire', 'tag'], disponible: ['Disponible', 'tag ok'], expiree: ['Expirée', 'tag x'], revoquee: ['Révoquée', 'tag x'] };
  async function vAccessKeys() {
    const f = window.__akf || (window.__akf = { status: '', from: '', to: '' });
    const q = new URLSearchParams(); if (f.status) q.set('status', f.status); if (f.from) q.set('from', f.from); if (f.to) q.set('to', f.to);
    const [st, rows, ev, rec] = await Promise.all([G('/admin/access-keys/settings'), G('/admin/access-keys?' + q), G('/admin/access-keys/events').catch(() => []), G('/admin/access-keys/recovery').catch(() => ({ configured: false }))]);
    const gen = window.__akGen;
    return `<div class="dv2">
<section class="dv2-card"><div class="dv2-card-head"><h3>🔑 Politique d'accès à la connexion</h3></div>
  <label class="ck"><input type="checkbox" id="ak_req" ${st.required ? 'checked' : ''} ${st.forced_off ? 'disabled' : ''} style="width:auto"> Exiger une clé d'accès avant l'écran de connexion</label>
  ${st.forced_off ? '<p class="warn">La variable ACCESS_KEY_DISABLE=1 du serveur désactive la clé d’accès (mode secours).</p>' : ''}
  ${st.required && !st.live_keys ? '<p class="warn">⚠ Aucune clé active : seuls les appareils déjà enrôlés et le code de secours peuvent atteindre la connexion. Générez puis activez une clé.</p>' : ''}
  ${st.required && !st.recovery_configured ? '<p class="warn">⚠ Aucun code de secours Superadmin n’est défini : générez-le ci-dessous pour ne jamais être bloqué.</p>' : ''}
  <label style="margin-top:10px">Durée de validité du laissez-passer après saisie de la clé (minutes)<input type="number" id="ak_pass" min="5" max="1440" value="${st.pass_minutes}" style="max-width:160px"></label>
  <div style="margin-top:12px"><button type="button" onclick="akSaveSettings()">Enregistrer la politique</button></div>
  <p class="dv2-note">Désactivé par défaut. La clé autorise uniquement l'accès à l'écran de connexion : le mot de passe reste obligatoire. Une clé à 4 chiffres n'offre que 10 000 combinaisons : le serveur limite les essais (délai croissant) et journalise les échecs. Une clé ne s'utilise qu'une seule fois par appareil : l'appareil devient « de confiance » et ne la redemande plus, même après l'expiration de la clé (l'expiration ne concerne que les nouveaux appareils). Révoquer une clé retire la confiance des appareils enrôlés avec elle. L'appareil est reconnu par un identifiant aléatoire stocké dans le navigateur : effacer les données du navigateur, changer de navigateur ou réinitialiser l'appareil le fait considérer comme un nouvel appareil.</p></section>

<section class="dv2-card"><div class="dv2-card-head"><h3>🛟 Code de secours Superadmin</h3><button type="button" onclick="akRecoveryGenerate()">${rec.configured ? 'Générer un nouveau code' : 'Générer le code de secours'}</button></div>
  <p>${rec.configured ? `Code actif ${E(rec.hint || '')} — créé le ${dtf(rec.created_at)}${rec.created_by_name ? ' par ' + E(rec.created_by_name) : ''}.` : (rec.used_at ? `Le dernier code a été utilisé le ${dtf(rec.used_at)} : générez-en un nouveau.` : 'Aucun code de secours défini.')}</p>
  ${rec.configured ? '<button type="button" class="b2" onclick="akRecoveryRevoke()">Supprimer ce code</button>' : ''}
  <p class="dv2-note">Si la clé d'accès est expirée ou perdue, ce code à usage unique ouvre l'écran de connexion (lien « Clé expirée ou perdue ? ») : le mot de passe reste obligatoire. Notez-le hors de l'application (papier, coffre) : il n'est affiché qu'une fois. Sur le PC serveur, sans code : <code>npm run access:rescue -- status | open | new-key | new-recovery</code>.</p></section>

<section class="dv2-card"><div class="dv2-card-head"><h3>Générer une clé</h3><button type="button" onclick="akGenerate()">Générer une clé</button></div>
  ${gen ? `<div class="ak-gen"><div class="ak-digits" aria-label="Clé générée">${E(gen.key)}</div><div><span class="tag">Provisoire</span>
      <p class="dv2-note">Cette clé n'est utilisable qu'après « Enregistrer et activer ». Elle reste ensuite écrite dans la section « Clés actives et archive » ci-dessous, avec le lien, et copiable à tout moment.</p><button type="button" class="b2" onclick="akCopy('${E(gen.key)}','Clé copiée.')">Copier la clé</button>
      <label>Validité <select id="ak_exp"><option value="720">30 jours</option><option value="2160">90 jours</option><option value="4320">180 jours</option><option value="8760" selected>1 an</option><option value="17520">2 ans</option><option value="">Sans limite</option></select></label>
      <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap"><button type="button" onclick="akConfirm(${gen.id})">Enregistrer et activer</button><button type="button" class="b2" onclick="akRevoke(${gen.id})">Annuler cette clé</button></div></div></div>` : '<p class="dv2-empty" style="text-align:left">Aucune clé en cours de création.</p>'}
</section>

<section class="dv2-card"><div class="dv2-card-head"><h3>Clés actives et archive (clé + lien)</h3></div>
  <p><b>Lien de connexion :</b> <code id="ak_link" style="overflow-wrap:anywhere">${E(location.origin)}/</code> <button type="button" class="b2" onclick="akCopy(document.getElementById('ak_link').textContent,'Lien copié.')">Copier le lien</button></p>
  ${/^(localhost|127\.|0\.0\.0\.0)/.test(location.hostname) ? '<p class="warn">Ce lien utilise une adresse locale (127.0.0.1 / localhost) : il ne fonctionnera pas sur les autres appareils. Ouvrez l’application depuis l’adresse réellement utilisée par vos clients pour obtenir le bon lien.</p>' : ''}
  ${rows.filter(r => r.key).length ? rows.filter(r => r.key).map(r => { const s = ST[r.effective_status] || [r.effective_status, 'tag']; return `<div class="ak-gen" style="align-items:center"><div class="ak-digits" aria-label="Clé">${E(r.key)}</div><div><span class="${s[1]}">${s[0]}</span> · Générée le ${dtf(r.created_at)} · <b>Expire le ${r.expires_at ? dtf(r.expires_at) : 'jamais (sans limite)'}</b>
      <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap"><button type="button" onclick="akCopy('${E(r.key)}','Clé copiée.')">Copier la clé</button><button type="button" class="b2" onclick="akCopy('Lien : '+document.getElementById('ak_link').textContent+' — Clé d’accès : ${E(r.key)}','Lien et clé copiés.')">Copier lien + clé</button></div></div></div>`; }).join('') : '<p class="dv2-empty" style="text-align:left">Aucune clé active. Générez puis activez une clé.</p>'}
  <p class="dv2-note">Les clés révoquées ou expirées restent dans l’historique ci-dessous (bouton 👁 pour les relire, journalisé).</p></section>

<section class="dv2-card"><div class="dv2-card-head"><h3>Historique des clés</h3></div>
  <div class="ak-filters"><label>Statut<select id="akf_s"><option value="">Tous</option>${Object.entries(ST).map(([k, v]) => `<option value="${k}" ${f.status === k ? 'selected' : ''}>${v[0]}</option>`).join('')}</select></label>
    <label>Du<input type="date" id="akf_f" value="${E(f.from)}"></label><label>Au<input type="date" id="akf_t" value="${E(f.to)}"></label>
    <button type="button" class="b2" onclick="akFilter()">Filtrer</button></div>
  <div class="dv2-tw"><table class="dv2-table"><thead><tr><th>Clé</th><th>Générée le</th><th>Par</th><th>Enregistrée le</th><th>Expire</th><th>Statut</th><th>Appareils</th><th>Dernière utilisation</th><th>Actions</th></tr></thead><tbody>
  ${rows.length ? rows.map(r => { const s = ST[r.effective_status] || [r.effective_status, 'tag']; const live = r.status === 'provisoire' || r.status === 'disponible';
      return `<tr><td><span id="akk${r.id}">${E(r.key || r.key_hint)}</span> <button type="button" class="b2" style="padding:3px 8px" onclick="akReveal(${r.id})" aria-label="Afficher la clé">👁</button></td><td>${dtf(r.created_at)}</td><td>${E(r.created_by_name || '—')}</td><td>${dtf(r.confirmed_at)}</td><td>${r.expires_at ? dtf(r.expires_at) : '—'}</td><td><span class="${s[1]}">${s[0]}</span></td><td>${r.devices}</td><td>${dtf(r.last_used_at)}</td>
      <td style="white-space:nowrap">${r.status === 'provisoire' ? `<button type="button" style="padding:4px 10px" onclick="akConfirm(${r.id})">Activer</button> ` : ''}${live ? `<button type="button" class="b2" style="padding:4px 10px" onclick="akRevoke(${r.id})">Révoquer</button>` : ''}</td></tr>`; }).join('') : '<tr><td colspan="9" class="dv2-empty">Aucune clé pour ces critères.</td></tr>'}
  </tbody></table></div></section>

<section class="dv2-card"><div class="dv2-card-head"><h3>Événements de sécurité récents</h3></div>
  <div class="dv2-tw"><table class="dv2-table"><thead><tr><th>Date</th><th>Événement</th><th>Détail</th><th>IP</th><th>Par</th></tr></thead><tbody>
  ${ev.length ? ev.slice(0, 50).map(x => `<tr><td>${dtf(x.at)}</td><td>${E(x.kind)}</td><td>${E(x.detail || '')}</td><td>${E(x.ip || '')}</td><td>${E(x.user_name || '')}</td></tr>`).join('') : '<tr><td colspan="5" class="dv2-empty">Aucun événement.</td></tr>'}
  </tbody></table></div></section></div>`;
  }
  const refresh = () => go('accesskeys');
  window.akSaveSettings = async () => { try { await Pu('/admin/access-keys/settings', { required: $('#ak_req').checked, pass_minutes: +$('#ak_pass').value }); toast('Politique enregistrée', 'success'); refresh(); } catch (e) { toast(errMsg(e), 'error'); } };
  window.akGenerate = async () => { try { window.__akGen = await Po('/admin/access-keys/generate', {}); refresh(); } catch (e) { toast(errMsg(e), 'error'); } };
  window.akConfirm = async id => { try { const h = $('#ak_exp'); await Po('/admin/access-keys/' + id + '/confirm', { expires_in_hours: h && h.value ? +h.value : null }); if (window.__akGen && window.__akGen.id === id) window.__akGen = null; toast('Clé activée', 'success'); refresh(); } catch (e) { toast(errMsg(e), 'error'); } };
  window.akRevoke = async id => { if (!confirm('Révoquer cette clé ? Elle ne pourra plus être utilisée et les appareils enrôlés avec cette clé devront saisir une nouvelle clé (l’historique est conservé).')) return; try { await Po('/admin/access-keys/' + id + '/revoke', {}); if (window.__akGen && window.__akGen.id === id) window.__akGen = null; toast('Clé révoquée', 'success'); refresh(); } catch (e) { toast(errMsg(e), 'error'); } };
  window.akCopy = async (t, m) => { try { await navigator.clipboard.writeText(String(t)); toast(m || 'Copié.', 'success'); } catch (_) { prompt('Copiez le texte :', String(t)); } };
  window.akReveal = async id => { try { const r = await Po('/admin/access-keys/' + id + '/reveal', {}); const el = document.getElementById('akk' + id); if (el) { const old = el.textContent; el.textContent = r.key; setTimeout(() => { el.textContent = old; }, 60000); akCopy(r.key, 'Clé affichée et copiée.'); } } catch (e) { toast(errMsg(e), 'error'); } };
  window.akRecoveryGenerate = () => modal(`<h3>Code de secours Superadmin</h3><p>Confirmez avec votre mot de passe. Le nouveau code remplace l’ancien et ne sera affiché qu’une seule fois.</p>
    <label>Mot de passe<input type="password" id="ak_rec_pw" autocomplete="current-password" onkeydown="if(event.key==='Enter')akRecoveryDo()"></label>
    <div class="r"><button type="button" class="b2" onclick="closeM()">Annuler</button><button type="button" onclick="akRecoveryDo()">Générer</button></div>`);
  window.akRecoveryDo = async () => {
    try {
      const r = await Po('/admin/access-keys/recovery/generate', { password: $('#ak_rec_pw').value });
      modal(`<h3>Votre code de secours</h3><div class="ak-digits" style="letter-spacing:.1em;font-size:1.5rem;word-break:break-all">${E(r.code)}</div>
        <p class="warn">Notez-le maintenant, hors de l’application. Il ne sera plus jamais affiché et ne fonctionne qu’une seule fois.</p>
        <div class="r"><button type="button" onclick="closeM();go('accesskeys')">J’ai noté le code</button></div>`);
    } catch (e) { toast(errMsg(e), 'error'); }
  };
  window.akRecoveryRevoke = async () => { if (!confirm('Supprimer le code de secours ? Vous n’aurez plus de recours depuis l’écran de connexion tant que vous n’en aurez pas généré un autre.')) return; try { await Po('/admin/access-keys/recovery/revoke', {}); toast('Code de secours supprimé', 'success'); refresh(); } catch (e) { toast(errMsg(e), 'error'); } };
  window.akFilter = () => { window.__akf = { status: $('#akf_s').value, from: $('#akf_f').value, to: $('#akf_t').value }; refresh(); };

  /* ---------------- Super Admin : « Personnalisation de l'accueil » (éditeur visuel : home-editor.js) ---------------- */
  async function vHomeAdmin() {
    setTimeout(() => { if (typeof window.hbOpen === 'function' && !(window.hbIsOpen && window.hbIsOpen())) window.hbOpen(); }, 0);
    return `<div class="dv2"><section class="dv2-card"><div class="dv2-card-head"><h3>Personnalisation de l'accueil</h3>
      <button type="button" onclick="hbOpen()">Ouvrir l'éditeur visuel</button></div>
      <p class="dv2-note">L'éditeur s'ouvre en plein écran : choisissez un élément directement sur la page pour modifier son texte, ses couleurs, ses tailles, ses images, sa position et son comportement sur ordinateur, tablette et mobile. Le brouillon est enregistré automatiquement ; rien n'est visible des visiteurs tant que vous ne cliquez pas sur « Publier ».</p></section></div>`;
  }

  /* ---------------- Enregistrement des vues ---------------- */
  function register() {
    if (typeof V === 'undefined' || typeof VM === 'undefined') return;
    Object.assign(V, { accesskeys: ["Clé d'accès", 'user.manage'], homeadmin: ["Personnalisation de l'accueil", 'user.manage'] });
    Object.assign(VM, { accesskeys: vAccessKeys, homeadmin: vHomeAdmin });
    if (typeof NAV_ICONS !== 'undefined') { NAV_ICONS.accesskeys = '🔑'; NAV_ICONS.homeadmin = '🏠'; }
    if (typeof SUPERADMIN_VIEWS !== 'undefined') { SUPERADMIN_VIEWS.add('accesskeys'); SUPERADMIN_VIEWS.add('homeadmin'); }
  }
  register();
  window.addEventListener('load', register);
})();
