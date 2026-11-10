/* ext-teamroles.js — « Rôles de mon équipe » (comptes clients).
   Le client y attribue des rôles à ses employés et crée ses propres rôles à partir des permissions qu'il possède.
   Règles appliquées côté SERVEUR (cet écran ne fait que les présenter) :
   - jamais plus de droits que ceux du client lui-même ; - isolation par client ; - rôles ADMIN / Super administrateur non attribuables ;
   - un rôle personnalisé encore attribué ne peut pas être supprimé. */
(function () {
  'use strict';
  const E = s => (typeof esc === 'function' ? esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  let CACHE = null;

  async function load() {
    const [roles, perms, users, assignable] = await Promise.all([G('/admin/roles'), G('/admin/permissions'), G('/users'), G('/admin/roles/assignable')]);
    CACHE = { roles, perms, users, assignable };
    return CACHE;
  }
  const groupOf = code => String(code).split('.')[0];

  async function vTeamRoles() {
    if (ME && ME.is_global) return '<p class="warn">Cet écran est réservé aux comptes clients. Les rôles communs se gèrent dans « Rôles ».</p>';
    const { roles, users, assignable } = await load();
    const assignSet = new Set(assignable.map(r => r.code));
    const opts = cur => assignable.map(r => `<option value="${E(r.code)}" ${r.code === cur ? 'selected' : ''}>${E(r.label)}${r.client_id ? ' (personnalisé)' : ''}</option>`).join('');
    const team = users.map(u => {
      const locked = (ME && Number(u.id) === Number(ME.id)) || (u.role === 'ADMIN' && !(ME && ME.role === 'ADMIN'));
      const sel = locked ? `<span class="dv2-note" style="margin:0">${(ME && Number(u.id) === Number(ME.id)) ? 'Votre compte' : 'Administrateur du compte'}</span>`
        : `<select aria-label="Rôle de ${E(u.full_name || u.login)}" onchange="trSetRole(${Number(u.id)}, this)" data-cur="${E(u.role)}">${assignSet.has(u.role) ? '' : `<option value="${E(u.role)}" selected>${E(u.role_label || u.role)}</option>`}${opts(u.role)}</select>`;
      return `<tr><td><b>${E(u.full_name || u.login)}</b><br><small>${E(u.login)}</small></td><td>${E(u.role_label || u.role)}</td><td><span class="tag ${u.active ? 'ok' : 'x'}">${u.active ? 'Actif' : 'Inactif'}</span></td><td>${sel}</td></tr>`;
    }).join('');
    const list = roles.filter(r => r.role !== 'ADMIN').map(r => `<tr><td><b>${E(r.label)}</b><br><small>${E(r.role)}</small></td><td><span class="tag ${r.custom ? 'ok' : ''}">${r.custom ? 'Personnalisé' : 'Commun'}</span></td><td>${r.permissions.length}</td><td>${r.users_count}</td>
      <td style="white-space:nowrap"><button type="button" class="b2" onclick="trView('${E(r.role)}')">Voir</button>${r.custom ? ` <button type="button" class="b2" onclick="trEdit('${E(r.role)}')">Modifier</button> <button type="button" class="b2" onclick="trDelete('${E(r.role)}')">Supprimer</button>` : ''}</td></tr>`).join('');
    return `<div class="dv2">
<section class="dv2-card"><div class="dv2-card-head"><h3>Mon équipe et leurs rôles</h3></div>
  <div class="dv2-tw"><table class="dv2-table"><thead><tr><th>Employé</th><th>Rôle actuel</th><th>Statut</th><th>Changer le rôle</th></tr></thead><tbody>${team || '<tr><td colspan="4" class="dv2-empty">Aucun employé.</td></tr>'}</tbody></table></div>
  <p class="dv2-note">Vous ne pouvez attribuer que des rôles dont toutes les permissions font partie des vôtres. Le changement est appliqué immédiatement et enregistré dans le journal d'audit.</p></section>
<section class="dv2-card"><div class="dv2-card-head"><h3>Rôles disponibles</h3><button type="button" onclick="trEdit()">+ Nouveau rôle personnalisé</button></div>
  <div class="dv2-tw"><table class="dv2-table"><thead><tr><th>Rôle</th><th>Type</th><th>Permissions</th><th>Utilisateurs</th><th>Actions</th></tr></thead><tbody>${list}</tbody></table></div>
  <p class="dv2-note">Les rôles communs sont définis par la plateforme. Vos rôles personnalisés n'existent que dans votre organisation et ne peuvent contenir que des permissions que vous possédez.</p></section></div>`;
  }

  window.trSetRole = async function (id, sel) {
    const cur = sel.dataset.cur, role = sel.value;
    if (role === cur) return;
    if (!confirm('Changer le rôle de cet employé ? Ses accès changeront immédiatement.')) { sel.value = cur; return; }
    try { await api('PATCH', '/users/' + id + '/role', { role }); toast('Rôle mis à jour', 'success'); go('teamroles'); }
    catch (e) { toast(errMsg(e), 'error'); sel.value = cur; }
  };
  window.trView = function (code) {
    const r = CACHE.roles.find(x => x.role === code); if (!r) return;
    const byGroup = {}; r.permissions.forEach(p => { (byGroup[groupOf(p)] = byGroup[groupOf(p)] || []).push(p); });
    modal(`<h3 style="margin-top:0">${E(r.label)}</h3>${r.permissions.length ? Object.entries(byGroup).map(([g, a]) => `<p><b>${E(g)}</b> : ${a.map(x => E((CACHE.perms.find(p => p.code === x) || {}).label || x)).join(', ')}</p>`).join('') : '<p>Aucune permission.</p>'}<div style="text-align:right"><button type="button" class="b2" onclick="closeM()">Fermer</button></div>`);
  };
  window.trEdit = function (code) {
    const r = code ? CACHE.roles.find(x => x.role === code) : null;
    const have = new Set(r ? r.permissions : []);
    const groups = {}; CACHE.perms.forEach(p => { (groups[groupOf(p.code)] = groups[groupOf(p.code)] || []).push(p); });
    modal(`<h3 style="margin-top:0">${r ? 'Modifier le rôle' : 'Nouveau rôle personnalisé'}</h3>
      <label>Nom du rôle<input id="tr_label" maxlength="80" value="${E(r ? r.label : '')}" placeholder="Ex. Caissier de nuit"></label>
      <p class="dv2-note">Seules vos propres permissions sont proposées.</p>
      <div style="max-height:46vh;overflow:auto;border:1px solid var(--bd);border-radius:12px;padding:10px">
      ${Object.entries(groups).map(([g, a]) => `<fieldset style="border:0;margin:0 0 10px;padding:0"><legend style="font-weight:700;color:var(--t)">${E(g)}</legend>${a.map(p => `<label class="ck"><input type="checkbox" class="tr-p" value="${E(p.code)}" ${have.has(p.code) ? 'checked' : ''}> ${E(p.label || p.code)}</label>`).join('')}</fieldset>`).join('')}</div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px"><button type="button" class="b2" onclick="closeM()">Annuler</button><button type="button" onclick="trSave(${r ? `'${E(r.role)}'` : 'null'})">Enregistrer</button></div>`);
  };
  window.trSave = async function (code) {
    const label = (document.getElementById('tr_label').value || '').trim(), permissions = [...document.querySelectorAll('.tr-p:checked')].map(x => x.value);
    if (label.length < 2) return toast('Indiquez un nom de rôle (2 caractères minimum).', 'error');
    try {
      if (code) { await Pu('/admin/roles/' + encodeURIComponent(code) + '/permissions', { permissions }); const cur = CACHE.roles.find(x => x.role === code); if (cur && cur.label !== label) await api('PATCH', '/admin/roles/' + encodeURIComponent(code), { label }); }
      else await Po('/admin/roles', { label, permissions });
      closeM(); toast('Rôle enregistré', 'success'); go('teamroles');
    } catch (e) { toast(errMsg(e), 'error'); }
  };
  window.trDelete = async function (code) {
    if (!confirm('Supprimer ce rôle personnalisé ? (impossible s’il est encore attribué)')) return;
    try { await api('DELETE', '/admin/roles/' + encodeURIComponent(code)); toast('Rôle supprimé', 'success'); go('teamroles'); } catch (e) { toast(errMsg(e), 'error'); }
  };

  function register() {
    if (typeof V === 'undefined' || typeof VM === 'undefined') return;
    Object.assign(V, { teamroles: ['Rôles de mon équipe', 'user.manage'] });
    Object.assign(VM, { teamroles: vTeamRoles });
    if (typeof NAV_ICONS !== 'undefined') NAV_ICONS.teamroles = '🧑‍🤝‍🧑';
  }
  register();
  window.addEventListener('load', register);
})();
