/* Gestion des rôles et permissions */
(function () {
  if (typeof V === 'undefined' || typeof VM === 'undefined') return;

  async function vRoles() {
    const canManage = can('user.manage');
    if (!canManage) return '';
    const [roles, perms] = await Promise.all([
      G('/admin/roles').catch(() => []),
      G('/admin/permissions').catch(() => [])
    ]);
    const isPrincipal = typeof ME !== 'undefined' && ME && ME.is_global;
    return `<h2 style="margin-top:0">Rôles & permissions</h2>
      <div class="bar" style="flex-wrap:wrap;gap:8px">
        ${isPrincipal ? '<button onclick="roleNew()">Nouveau rôle</button>' : ''}
        <button class="b2" onclick="typeof showRolePresets==='function'&&showRolePresets()">Modèles métier (Pompiste, Caissier…)</button>
        <button class="b2" onclick="go('param')">Utilisateurs</button>
      </div>
      ${isPrincipal ? '' : '<p style="font-size:12px;color:var(--m)">Consultation : seuls les administrateurs principaux modifient le détail des permissions. Les modèles métier guident le choix de rôle à l’octroi d’accès.</p>'}
      ${T(['Code', 'Libellé', 'Utilisateurs', 'Permissions', ''], (roles || []).map(r => [
        esc(r.role), esc(r.label), r.users_count || 0,
        (r.permissions || []).length + ' perm.',
        isPrincipal
          ? `<button class="b2" onclick='roleEditPerms(${JSON.stringify(r.role)},${JSON.stringify(r.permissions || [])})'>Permissions</button>`
          : ''
      ]))}
      <h3>Catalogue des permissions</h3>
      ${T(['Code', 'Libellé'], (perms || []).map(p => [esc(p.code), esc(p.label)]))}
      <div class="bar"><button class="b2" onclick="go('param')">Retour paramètres</button></div>`;
  }

  window.roleNew = safe(async () => {
    form('Nouveau rôle', [
      ['code', 'Code (MAJUSCULES_SANS_ESPACE)'],
      ['label', 'Libellé']
    ], {}, async d => {
      await Po('/admin/roles', { code: String(d.code).toUpperCase(), label: d.label, permissions: [] });
      closeM(); toast('Rôle créé', 'success'); go('roles');
    });
  });

  // Édition des permissions d'un rôle : cases à cocher regroupées par domaine (remplace la saisie de codes en texte libre)
  window.roleEditPerms = safe(async (code, current) => {
    const all = await G('/admin/permissions').catch(() => []);
    const cur = new Set(current || []), groups = {};
    all.forEach(p => { const g = p.code.split('.')[0]; (groups[g] = groups[g] || []).push(p); });
    modal(`<h3>Permissions — ${esc(code)}</h3>
      <div style="max-height:60vh;overflow:auto;border:1px solid var(--bd);border-radius:8px;padding:8px 12px">
      ${Object.keys(groups).sort().map(g => `<fieldset style="border:0;padding:0;margin:0 0 10px"><legend style="font-weight:700;text-transform:capitalize;margin-bottom:4px">${esc(g)}</legend>
        ${groups[g].map(p => `<label style="flex-direction:row;align-items:center;gap:8px;color:var(--t);margin:2px 0"><input type="checkbox" class="rp" value="${esc(p.code)}" ${cur.has(p.code) ? 'checked' : ''} style="width:auto"> <span>${esc(p.label)} <small style="color:var(--m)">(${esc(p.code)})</small></span></label>`).join('')}</fieldset>`).join('')}
      </div>
      <div class="r"><button class="b2" onclick="closeM()">Annuler</button><button id="rpok">Enregistrer</button></div>`);
    document.getElementById('rpok').onclick = async () => {
      try {
        const permissions = [...document.querySelectorAll('.rp:checked')].map(x => x.value);
        await api('PUT', '/admin/roles/' + encodeURIComponent(code) + '/permissions', { permissions });
        closeM(); toast('Permissions mises à jour', 'success'); go(cur0(), undefined);
      } catch (e) { toast(errMsg(e), 'error'); }
    };
  });
  const cur0 = () => (typeof cur !== 'undefined' ? cur : 'roles');

  // Améliorer création utilisateur avec rôles assignables
  /** Position employé → rôle par défaut (modules essentiels du poste). */
  const POS_ROLE = {
    pompiste: 'POMPISTE', caissier: 'CAISSIER', gérant: 'GERANT', gerant: 'GERANT',
    administrateur: 'GERANT', superviseur: 'SUPERVISEUR', magasinier: 'MAGASINIER',
    comptable: 'COMPTABLE', rh: 'GERANT'
  };

  /** Création compte : employé d'abord + rôle (modules) selon le poste. */
  window.addU = async function (preselectedEmployeeId) {
    try {
      // Les erreurs ne sont plus avalées : un échec réseau/serveur n'est plus confondu avec « aucun employé ».
      const [assignable, unlinked] = await Promise.all([
        G('/admin/roles/assignable'),
        G('/employees/unlinked?scope=client')
      ]);
      if (!(unlinked || []).length) {
        toast('Aucun employé sans compte sur cette station. Créez d’abord une fiche employé (statut actif), puis octroyez-lui un accès.', 'error');
        return;
      }
      const empOpts = unlinked.map(e => [e.id, (e.matricule || '') + ' — ' + e.first_name + ' ' + e.last_name + ' (' + (e.position || '—') + ')' + (e.station_name ? ' @ ' + e.station_name : '')]);
      let first = unlinked[0];
      if (preselectedEmployeeId != null) {
        const found = unlinked.find(e => Number(e.id) === Number(preselectedEmployeeId));
        if (found) first = found;
        else {
          toast('Cet employé a déjà un compte, est inactif, ou n’est pas sur la station active. Sélectionnez un employé disponible.', 'error');
        }
      }
      // Liste unique de rôles (table `roles`), filtrée côté serveur selon le droit d'attribution :
      // un compte client ne reçoit jamais ADMIN (rôle plateforme).
      const isPlatform = !!(typeof ME !== 'undefined' && ME && ME.is_global);
      const roles = (assignable || [])
        .filter(r => r && r.code && (isPlatform || r.code !== 'ADMIN' || (ME && ME.role === 'ADMIN')))
        .map(r => [r.code, r.label || r.code]);
      if (!roles.length) {
        toast('Aucun rôle attribuable n’est disponible. Contactez l’administrateur de la plateforme.', 'error');
        return;
      }
      // Rôle par défaut selon la fonction de l'employé (POS_ROLE), s'il existe dans la liste.
      const posKey = String((first && first.position) || '').trim().toLowerCase();
      const posRole = POS_ROLE[posKey];
      const defRole = (posRole && roles.some(r => r[0] === posRole)) ? posRole : roles[0][0];
      if (typeof showRolePresets === 'function') { /* aide rôles disponible */ }
      form('Octroyer un accès compte', [
        ['employee_id', 'Employé (fiche déjà créée)', 's', empOpts],
        ['login', 'Identifiant de connexion'],
        ['password', 'Mot de passe (8 caractères min.)', 'password'],
        ['role', 'Rôle applicatif (voir modèles)', 's', roles]
      ], { employee_id: first.id, role: defRole }, async d => {
        const employee_id = Number(d.employee_id);
        if (!employee_id || Number.isNaN(employee_id)) {
          toast('Sélectionnez un employé existant dans la liste.', 'error');
          return;
        }
        const login = String(d.login || '').trim();
        const password = String(d.password || '');
        if (login.length < 3) { toast('Identifiant trop court (3 caractères min.).', 'error'); return; }
        if (password.length < 8) { toast('Mot de passe trop court (8 caractères min.).', 'error'); return; }
        // Priorité : station de la fiche employé si fournie par /unlinked?scope=client, sinon station active.
        const empRow = (unlinked || []).find(e => Number(e.id) === employee_id);
        const empSid = empRow && empRow.station_id ? Number(empRow.station_id) : null;
        const sid = empSid || ((typeof SID !== 'undefined' && SID) ? Number(SID) : null);
        const station_ids = sid ? [sid] : (ME.stations || []).map(s => s.id).slice(0, 1);
        if (!station_ids.length) {
          toast('Aucune station active : impossible de rattacher le compte.', 'error');
          return;
        }
        await Po('/users', {
          login,
          password,
          role: d.role,
          employee_id,
          station_ids
        });
        closeM();
        toast('Compte créé et lié à l’employé', 'success');
        if (typeof go === 'function') go(typeof location !== 'undefined' && String(location.hash || '').includes('empf') ? 'emp' : 'param');
      });
    } catch (e) {
      toast(typeof errMsg === 'function' ? errMsg(e) : (e.message || String(e)), 'error');
    }
  };

  // Bandeau d'incohérences : employé dont la fonction (fiche) ne correspond pas au rôle de son compte.
  window.roleConsistencyBanner = async function () {
    if (typeof can === 'function' && !can('user.manage')) return '';
    if (typeof ME !== 'undefined' && ME && ME.is_global) return '';
    const list = await G('/users/role-consistency');
    if (!Array.isArray(list) || !list.length) return '';
    const rows = list.map(m => `<li><b>${esc((m.first_name + ' ' + m.last_name).trim() || m.login)}</b> : fonction « ${esc(m.position)} » mais rôle du compte « ${esc(m.role_label || m.role)} »</li>`).join('');
    return `<div class="card" style="border-left:4px solid var(--w,#f59e0b);margin-bottom:12px"><b>${list.length} incohérence(s) entre la fonction de l'employé et son rôle</b>
      <ul style="margin:8px 0 10px 18px">${rows}</ul>
      <div class="bar"><button class="b2" onclick="fixRoleConsistency('employee')">Aligner les rôles sur les fonctions</button>
      <button class="b2" onclick="fixRoleConsistency('user')">Aligner les fonctions sur les rôles</button></div></div>`;
  };
  window.fixRoleConsistency = async function (mode) {
    try {
      const r = await api('POST', '/users/role-consistency/fix', { mode });
      toast(r.fixed + ' correction(s) appliquée(s)', 'success');
      if (typeof goAdminTab === 'function' && cur === 'admin') goAdminTab('users'); else go('param');
    } catch (e) { toast(typeof errMsg === 'function' ? errMsg(e) : (e.message || String(e)), 'error'); }
  };

  // « Modifier » d'un utilisateur : nom, fonction et statut (actif / inactif).
  window.editUserProfile = async function (id, login, fullName, jobTitle, active) {
    try {
      if (!id) throw new Error('Utilisateur invalide');
      const isSelf = typeof ME !== 'undefined' && ME && Number(ME.id) === Number(id);
      const fields = [['full_name', 'Nom complet'], ['job_title', 'Fonction']];
      if (!isSelf) fields.push(['active', 'Statut du compte', 's', [['true', 'Actif'], ['false', 'Inactif']]]);
      form('Modifier — ' + esc(login || ('#' + id)), fields,
        { full_name: fullName || '', job_title: jobTitle || '', active: active ? 'true' : 'false' }, async d => {
          await api('PATCH', '/users/' + id + '/profile', { full_name: (d.full_name || '').trim() || null, job_title: (d.job_title || '').trim() || null });
          if (!isSelf && String(d.active) !== String(!!active)) await api('PATCH', '/users/' + id + '/active', { active: d.active === 'true' });
          closeM();
          toast('Utilisateur modifié', 'success');
          if (typeof goAdminTab === 'function' && cur === 'admin') goAdminTab('users');
          else go('param');
        });
    } catch (e) {
      const msg = (typeof errMsg === 'function' ? errMsg(e) : (e && e.message)) || String(e);
      if (typeof toast === 'function') toast(msg, 'error');
    }
  };

  window.changeUserRole = async function (id, login, current) {
    try {
      if (!id) throw new Error('Utilisateur invalide');
      const fallback = [
        ['GERANT', 'Gérant'],
        ['CAISSIER', 'Caissier'],
        ['POMPISTE', 'Pompiste'],
        ['MAGASINIER', 'Magasinier'],
        ['COMPTABLE', 'Comptable'],
        ['SUPERVISEUR', 'Superviseur']
      ];
      let assignable = [];
      try { assignable = await G('/admin/roles/assignable'); } catch (_) { assignable = []; }
      let roleOpts = (assignable || [])
        .filter(r => r && r.code && (r.code !== 'ADMIN' || (ME && ME.role === 'ADMIN')))
        .map(r => [r.code, r.code === 'ADMIN' ? 'Administrateur local' : (r.label || r.code)]);
      if (!roleOpts.length) roleOpts = fallback;
      // S'assurer que le rôle courant figure dans la liste
      if (current && !roleOpts.some(o => o[0] === current || o === current)) {
        roleOpts = [[current, current], ...roleOpts];
      }
      form('Rôle — ' + esc(login || ('#' + id)), [
        ['role', 'Nouveau rôle', 's', roleOpts]
      ], { role: current || roleOpts[0][0] }, async d => {
        if (!d.role) throw new Error('Sélectionnez un rôle');
        await api('PATCH', '/users/' + id + '/role', { role: d.role });
        closeM();
        toast('Rôle modifié : ' + d.role, 'success');
        // Recharger la vue utilisateurs (param ou centre admin)
        if (typeof goAdminTab === 'function' && cur === 'admin') goAdminTab('users');
        else go('param');
      });
    } catch (e) {
      const msg = (typeof errMsg === 'function' ? errMsg(e) : (e && e.message)) || String(e);
      if (typeof toast === 'function') toast(msg, 'error');
      else console.error(msg);
    }
  };

  Object.assign(V, { roles: ['Rôles', 'user.manage'] });
  Object.assign(VM, { roles: vRoles });
})();
