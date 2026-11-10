/* RH V2 — interface modules */
(function () {
  if (typeof V === 'undefined' || typeof VM === 'undefined') return;

  async function vRhDash() {
    const d = await G('/hr/v2/dashboard').catch(() => null);
    if (!d) return '<p>Tableau de bord RH indisponible (migration 012 ?).</p>';
    const h = d.headcount || {}, a = d.attendance_today || {}, p = d.payroll || {};
    return `<h2 style="margin-top:0">Tableau de bord RH</h2>
      <div class="cards">
        ${card('Actifs', h.actifs || 0)}${card('Inactifs', h.inactifs || 0)}
        ${card('Présents', a.presents || 0)}${card('Absents', a.absents || 0)}
        ${card('Congés en attente', d.leave_pending || 0)}
        ${card('Bulletins brouillon', p.brouillons || 0)}
      </div>
      <h3>Alertes ouvertes</h3>
      ${T(['Niveau', 'Type', 'Message', 'Échéance'], (d.alerts || []).map(x => [
        esc(x.level), esc(x.kind), esc(x.message), esc(x.due_date || '')
      ]))}
      <div class="bar" style="flex-wrap:wrap">
        <button class="b2" onclick="go('rh')">Gestion RH</button>
        <button class="b2" onclick="go('rhctl')">Contrôle paie</button>
        <button class="b2" onclick="go('rhalerts')">Alertes</button>
        <button class="b2" onclick="go('rhleaves')">Congés</button>
        <button class="b2" onclick="go('rhatt')">Présences</button>
        <button class="b2" onclick="go('rhot')">Heures sup.</button>
        <button class="b2" onclick="go('rhcontracts')">Contrats</button>
        <button class="b2" onclick="go('rhdocs')">Documents</button>
        <button class="b2" onclick="go('rhsched')">Planning</button>
      </div>`;
  }

  async function vRhCtl() {
    const month = (typeof EMON !== 'undefined' && EMON) || new Date().toISOString().slice(0, 7);
    const d = await G('/hr/v2/payroll-control?month=' + month).catch(e => ({ error: e.message }));
    if (d.error) return `<p class="warn">${esc(d.error)}</p>`;
    const anoms = (d.anomalies || []).map(a =>
      `<li><span class="tag ${a.level === 'critical' ? 'x' : ''}">${esc(a.level)}</span> ${esc(a.message)}</li>`).join('');
    return `<h2 style="margin-top:0">Contrôle de paie — ${esc(d.month || '')}</h2>
      <div class="cards">${card('Salariés', d.employees)}${card('Bulletins', d.payslips)}${card('Sans bulletin', (d.without_payslip || []).length)}</div>
      <div class="card"><h3 style="margin-top:0">${esc(d.status_label || d.status)}</h3>
        <ul style="font-size:13px">${anoms || '<li>Aucune anomalie</li>'}</ul>
        <p style="font-size:12px;color:var(--m)">${esc(d.note || '')}</p>
      </div>
      <div class="bar"><button class="b2" onclick="go('rhdash')">Retour</button></div>`;
  }

  async function vRhAlerts() {
    const rows = await G('/hr/v2/alerts?status=open').catch(() => []);
    return `<h2 style="margin-top:0">Centre d'alertes RH</h2>
      <div class="bar"><button onclick="rhAlertRefresh()">Actualiser alertes</button></div>
      ${T(['Niveau', 'Type', 'Salarié', 'Message', 'Échéance', ''], (rows || []).map(a => [
        esc(a.level), esc(a.kind), esc(a.employee || ''), esc(a.message), esc(a.due_date || ''),
        `<button class="b2" onclick="rhAlertDone(${a.id})">OK</button>`
      ]))}
      <div class="bar"><button class="b2" onclick="go('rhdash')">Tableau de bord</button></div>`;
  }

  async function vRhLeaves() {
    const rows = await G('/hr/v2/leaves').catch(() => []);
    return `<h2 style="margin-top:0">Congés</h2>
      ${T(['Employé', 'Début', 'Fin', 'Jours', 'État', ''], (rows || []).map(l => [
        esc(l.employee), esc(l.start_date), esc(l.end_date), l.days, esc(l.status),
        l.status === 'demande' ? `<button onclick="rhLeaveDecide(${l.id},'approuve')">Approuver</button>
          <button class="bd" onclick="rhLeaveDecide(${l.id},'refuse')">Refuser</button>` : ''
      ]))}
      <div class="bar"><button class="b2" onclick="go('rhdash')">Retour</button></div>`;
  }

  async function vRhAtt() {
    const today = new Date().toISOString().slice(0, 10);
    const rows = await G(`/hr/v2/attendance?from=${today}&to=${today}`).catch(() => []);
    return `<h2 style="margin-top:0">Présences du jour</h2>
      ${T(['Employé', 'Statut', 'Retard (min)', 'Notes'], (rows || []).map(a => [
        esc(a.employee), esc(a.status), a.late_minutes || 0, esc(a.notes || '')
      ]))}
      <div class="bar"><button class="b2" onclick="go('rhdash')">Retour</button></div>`;
  }

  async function vRhOt() {
    const d = await G('/hr/v2/overtime').catch(() => ({ lines: [] }));
    const rows = d.lines || [];
    return `<h2 style="margin-top:0">Heures supplémentaires</h2>
      <div class="warn">${esc(d.note || 'Workflow : proposé → validé → approuvé. Simulation uniquement.')}</div>
      ${T(['Employé', 'Date', 'Heures', 'Coeff.', 'État', ''], rows.map(o => [
        esc(o.employee), esc(o.work_date), o.hours, o.rate_multiplier, esc(o.status),
        o.status === 'propose' ? `<button onclick="rhOtVal(${o.id})">Valider</button> <button class="bd" onclick="rhOtRef(${o.id})">Refuser</button>` :
        o.status === 'valide_responsable' ? `<button onclick="rhOtApp(${o.id})">Approuver RH</button> <button class="bd" onclick="rhOtRef(${o.id})">Refuser</button>` : ''
      ]))}
      <div class="bar"><button class="b2" onclick="go('rhdash')">Retour</button></div>`;
  }

  async function vRhContracts() {
    const rows = await G('/hr/v2/contracts').catch(() => []);
    return `<h2 style="margin-top:0">Contrats</h2>
      ${T(['Employé', 'Type', 'Début', 'Fin', 'Essai', 'Statut'], (rows || []).map(c => [
        esc(c.employee), esc(c.contract_type), esc(c.start_date), esc(c.end_date || ''), esc(c.trial_end || ''), esc(c.status)
      ]))}
      <div class="bar"><button class="b2" onclick="go('rhdash')">Retour</button></div>`;
  }

  async function vRhDocs() {
    const rows = await G('/hr/v2/documents').catch(() => []);
    return `<h2 style="margin-top:0">Documents RH</h2>
      ${T(['Employé', 'Catégorie', 'Titre', 'Expiration'], (rows || []).map(d => [
        esc(d.employee), esc(d.category), esc(d.title), esc(d.expires_on || '')
      ]))}
      <div class="bar"><button class="b2" onclick="go('rhdash')">Retour</button></div>`;
  }

  async function vRhSched() {
    const from = new Date().toISOString().slice(0, 10);
    const to = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
    const rows = await G(`/hr/v2/schedules?from=${from}&to=${to}`).catch(() => []);
    return `<h2 style="margin-top:0">Planning (7 jours)</h2>
      ${T(['Date', 'Employé', 'Équipe', 'Début', 'Fin', 'État'], (rows || []).map(s => [
        esc(s.work_date), esc(s.employee), esc(s.team_name || ''), esc(s.start_time || ''), esc(s.end_time || ''), esc(s.status)
      ]))}
      <div class="bar"><button class="b2" onclick="go('rhdash')">Retour</button></div>`;
  }

  window.rhAlertRefresh = safe(async () => { await Po('/hr/v2/alerts/refresh', {}); toast('Alertes actualisées', 'success'); go('rhalerts'); });
  window.rhAlertDone = safe(async id => { await Po('/hr/v2/alerts/' + id + '/resolve', { status: 'done' }); go('rhalerts'); });
  window.rhLeaveDecide = safe(async (id, decision) => { await Po('/hr/v2/leaves/' + id + '/decide', { decision }); toast('OK', 'success'); go('rhleaves'); });
  window.rhOtVal = safe(async id => { await Po('/hr/v2/overtime/' + id + '/validate', {}); toast('Validé', 'success'); go('rhot'); });
  window.rhOtApp = safe(async id => {
    if (!confirm('Approuver pour SIMULATION uniquement ?')) return;
    await Po('/hr/v2/overtime/' + id + '/approve', {});
    toast('Approuvé (simulation)', 'success'); go('rhot');
  });
  window.rhOtRef = safe(async id => {
    const note = prompt('Motif du refus :');
    if (!note || note.length < 3) return toast('Motif requis');
    await Po('/hr/v2/overtime/' + id + '/refuse', { note }); go('rhot');
  });


  async function vRhPeriods() {
    const rows = await G('/hr/v2/periods').catch(() => []);
    return `<h2 style="margin-top:0">Périodes de paie</h2>
      <div class="warn">La clôture empêche de nouveaux bulletins. Les bulletins existants restent inchangés.</div>
      <div class="bar"><button onclick="rhClosePeriod()">Clôturer un mois</button></div>
      ${T(['Mois', 'Statut', 'Clôturé le', 'Notes'], (rows || []).map(p => [
        esc(p.month), esc(p.status), esc(p.closed_at || ''), esc(p.notes || '')
      ]))}
      <div class="bar"><button class="b2" onclick="go('rhdash')">Retour</button></div>`;
  }
  async function vRhSettings() {
    const d = await G('/hr/v2/modules').catch(() => ({ modules: {} }));
    const m = d.modules || {};
    const LABELS = {
      dossier: 'Dossier employé', contracts: 'Contrats', documents: 'Documents',
      schedule: 'Planning', attendance: 'Présences', leave: 'Congés',
      skills: 'Compétences', training: 'Formation', evaluation: 'Évaluations',
      disciplinary: 'Disciplinaire', alerts: 'Alertes', portal: 'Portail',
      payroll_email: 'E-mail bulletins', payroll_control: 'Contrôle de paie'
    };
    const keys = Object.keys(m);
    if (!keys.length) {
      return `<h2 style="margin-top:0">Modules RH</h2><p class="warn">Aucun module chargé. Vérifiez la migration 012 et les droits hr.manage.</p>
        <div class="bar"><button class="b2" onclick="go('rhdash')">Retour</button></div>`;
    }
    const rows = keys.map(k => {
      const on = !!m[k];
      const label = LABELS[k] || k;
      return `<tr>
        <td><b>${esc(label)}</b><br><small style="color:var(--m)">${esc(k)}</small></td>
        <td><span class="tag ${on ? '' : 'x'}">${on ? 'Actif' : 'Inactif'}</span></td>
        <td><button type="button" class="${on ? 'bd' : ''}" onclick="rhToggleMod('${k}', ${on ? 'false' : 'true'})">${on ? 'Désactiver' : 'Activer'}</button></td>
      </tr>`;
    }).join('');
    return `<h2 style="margin-top:0">Modules RH</h2>
      <p style="font-size:13px;color:var(--m)">Activation locale par station — aucun abonnement requis. Les boutons Activer / Désactiver sont opérationnels avec le droit hr.manage.</p>
      <table class="t"><thead><tr><th>Module</th><th>État</th><th>Action</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="bar"><button class="b2" onclick="go('rhdash')">Retour</button></div>`;
  }
  window.rhClosePeriod = safe(async () => {
    const month = prompt('Mois à clôturer (AAAA-MM) :', new Date().toISOString().slice(0, 7));
    if (!month || !/^\d{4}-\d{2}$/.test(month)) return toast('Mois invalide');
    if (!confirm('Clôturer ' + month + ' ? Aucun nouveau bulletin ne pourra être créé pour ce mois.')) return;
    await Po('/hr/v2/periods/close', { month });
    toast('Période clôturée', 'success');
    go('rhperiods');
  });
  window.rhToggleMod = async function (key, on) {
    try {
      const enable = on === true || on === 'true' || on === 1 || on === '1';
      const d = await G('/hr/v2/modules').catch(() => ({ modules: {} }));
      const modules = { ...(d.modules || {}), [key]: enable };
      await api('PUT', '/hr/v2/modules', { modules });
      toast(key + (enable ? ' activé' : ' désactivé'), 'success');
      go('rhsettings');
    } catch (e) {
      toast(typeof errMsg === 'function' ? errMsg(e) : (e.message || String(e)), 'error');
    }
  };

  Object.assign(V, {
    rhdash: ['Tableau RH', 'hr.view|hr.manage|hr.employee.view'],
    rhctl: ['Contrôle paie', 'hr.payroll|hr.payroll.control|hr.manage'],
    rhalerts: ['Alertes RH', 'hr.view|hr.manage'],
    rhleaves: ['Congés', 'hr.leave.view|hr.view|hr.manage'],
    rhatt: ['Présences', 'hr.attendance.view|hr.view|hr.manage'],
    rhot: ['Heures sup.', 'hr.overtime.view|hr.view|hr.manage'],
    rhcontracts: ['Contrats', 'hr.employee.view|hr.view|hr.manage'],
    rhdocs: ['Documents RH', 'hr.documents.view|hr.view|hr.manage'],
    rhsched: ['Planning', 'hr.schedule.view|hr.view|hr.manage'],
    rhperiods: ['Périodes paie', 'hr.payroll|hr.manage'],
    rhsettings: ['Modules RH', 'hr.settings|hr.manage']
  });
  Object.assign(VM, {
    rhdash: vRhDash, rhctl: vRhCtl, rhalerts: vRhAlerts, rhleaves: vRhLeaves,
    rhatt: vRhAtt, rhot: vRhOt, rhcontracts: vRhContracts, rhdocs: vRhDocs, rhsched: vRhSched, rhperiods: vRhPeriods, rhsettings: vRhSettings
  });
})();
