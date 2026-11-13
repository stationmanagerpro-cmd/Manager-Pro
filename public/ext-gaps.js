/* ext-gaps.js — écrans qui manquaient pour des routes/tables déjà présentes (audit 2026-11-12) :
   RH (équipes, compétences, formations, évaluations, sanctions/récompenses, portail salarié, congés, présences, heures sup., périodes, e-mail bulletins, règles de paie),
   transferts de stock, historique des compteurs, licence & modules, préférences du tableau de bord, estimation fiscale. API : src/gaps.js, hr_v2.js, hr.js, fiscal.js. */
(function () {
  'use strict';
  if (typeof V === 'undefined' || typeof VM === 'undefined' || typeof G === 'undefined') return;
  var can_ = function (p) { try { return can(p); } catch (_) { return false; } };
  var fd = function (s) { return s ? String(s).slice(0, 10).split('-').reverse().join('/') : '—'; };
  var err = function (e) { toast((typeof errMsg === 'function' ? errMsg(e) : (e && e.message)) || String(e), 'error'); };
  var ok = function (m) { toast(m, 'success'); };
  var val = function (id) { var e = document.getElementById(id); return e ? e.value.trim() : ''; };
  var today = function () { return new Date().toISOString().slice(0, 10); };
  var back = function (k, l) { return '<div class="bar"><button class="b2" type="button" onclick="go(\'' + k + '\')">' + (l || 'Retour') + '</button></div>'; };
  var opts = function (rows, v, l, sel) { return rows.map(function (x) { return '<option value="' + esc(x[v]) + '"' + (String(x[v]) === String(sel) ? ' selected' : '') + '>' + esc(typeof l === 'function' ? l(x) : x[l]) + '</option>'; }).join(''); };
  var empName = function (e) { return (e.first_name || '') + ' ' + (e.last_name || ''); };
  var run = function (fn) { return async function () { try { await fn.apply(null, arguments); } catch (e) { err(e); } }; };

  /* Modules RH : chaque écran RH n'est opérationnel que si son module est activé (Modules RH). */
  var modsCache = null, modsAt = 0;
  async function hrMods() {
    if (modsCache && Date.now() - modsAt < 15000) return modsCache;
    try { modsCache = (await G('/hr/v2/modules')).modules || {}; } catch (_) { modsCache = {}; }
    modsAt = Date.now(); return modsCache;
  }
  window.smpHrModsReset = function () { modsCache = null; };
  async function needMod(code, title) {
    var m = await hrMods();
    if (m[code]) return null;
    return '<h2 style="margin-top:0">' + esc(title) + '</h2><p class="warn">Le module « ' + esc(code) + ' » est désactivé. ' +
      (can_('hr.settings') || can_('hr.manage') ? 'Activez-le dans « Modules RH » pour utiliser cet écran.' : 'Demandez à votre responsable RH de l’activer.') + '</p>' +
      '<div class="bar">' + (can_('hr.settings') || can_('hr.manage') ? '<button type="button" onclick="go(\'rhsettings\')">Ouvrir Modules RH</button>' : '') + '<button class="b2" type="button" onclick="go(\'rhdash\')">Retour</button></div>';
  }
  var emps = async function () { return (await G('/employees').catch(function () { return []; })).filter(function (e) { return e.active !== false; }); };

  /* ───────── Équipes ───────── */
  VM.rhteams = async function () {
    var off = await needMod('schedule', 'Équipes'); if (off) return off;
    var rows = await G('/hr/v2/teams');
    return '<h2 style="margin-top:0">Équipes de travail</h2><p class="muted">Les équipes (ex. Jour, Nuit) sont utilisées dans le planning.</p>' +
      T(['Code', 'Nom', 'Début', 'Fin'], rows.map(function (t) { return [esc(t.code), esc(t.name), esc((t.start_time || '').slice(0, 5)), esc((t.end_time || '').slice(0, 5))]; })) +
      (can_('hr.schedule.manage') || can_('hr.manage') ? '<div class="bar" style="flex-wrap:wrap;gap:8px"><input id="tm-c" placeholder="Code" style="width:90px"><input id="tm-n" placeholder="Nom"><input id="tm-s" type="time"><input id="tm-e" type="time"><button type="button" onclick="gapTeamAdd()">Ajouter</button></div>' : '') + back('rhsched', 'Planning');
  };
  window.gapTeamAdd = run(async function () { await Po('/hr/v2/teams', { code: val('tm-c'), name: val('tm-n'), start_time: val('tm-s') || null, end_time: val('tm-e') || null }); ok('Équipe ajoutée'); go('rhteams'); });

  /* ───────── Compétences ───────── */
  var LV = { debutant: 'Débutant', intermediaire: 'Intermédiaire', confirme: 'Confirmé', expert: 'Expert' };
  VM.rhskills = async function () {
    var off = await needMod('skills', 'Compétences'); if (off) return off;
    var r = await Promise.all([G('/hr/v2/skills'), G('/hr/v2/employee-skills'), emps()]), sk = r[0], es = r[1], em = r[2], mg = can_('hr.skills.manage') || can_('hr.manage');
    return '<h2 style="margin-top:0">Compétences du personnel</h2>' +
      T(['Employé', 'Compétence', 'Niveau', 'Évalué le'], es.map(function (x) { return [esc(x.employee), esc(x.skill_label), esc(LV[x.level] || x.level), fd(x.evaluated_on)]; })) +
      (mg ? '<div class="card" style="margin-top:10px"><b>Évaluer une compétence</b><div class="bar" style="flex-wrap:wrap;gap:8px"><select id="sk-e">' + opts(em, 'id', empName) + '</select><select id="sk-s">' + opts(sk, 'id', 'label') + '</select><select id="sk-l">' +
        Object.keys(LV).map(function (k) { return '<option value="' + k + '">' + LV[k] + '</option>'; }).join('') + '</select><button type="button" onclick="gapSkillSet()">Enregistrer</button></div>' +
        '<div class="bar" style="flex-wrap:wrap;gap:8px"><input id="sk-new" placeholder="Nouvelle compétence au catalogue"><button class="b2" type="button" onclick="gapSkillNew()">Ajouter au catalogue</button></div></div>' : '') + back('rhdash', 'Tableau RH');
  };
  window.gapSkillSet = run(async function () { await Po('/hr/v2/employee-skills', { employee_id: +val('sk-e'), skill_id: +val('sk-s'), level: val('sk-l') }); ok('Compétence enregistrée'); go('rhskills'); });
  window.gapSkillNew = run(async function () { await Po('/hr/v2/skills', { label: val('sk-new') }); ok('Ajoutée au catalogue'); go('rhskills'); });

  /* ───────── Formations ───────── */
  VM.rhtrain = async function () {
    var off = await needMod('training', 'Formations'); if (off) return off;
    var rows = await G('/hr/v2/trainings'), mg = can_('hr.training.manage') || can_('hr.manage');
    return '<h2 style="margin-top:0">Formations</h2><p class="muted">Le coût est informatif : aucune écriture financière n’est créée.</p>' +
      T(['Formation', 'Organisme', 'Du', 'Au', 'Heures', 'Coût (info)', ''], rows.map(function (t) {
        return [esc(t.title), esc(t.organism || t.trainer || '—'), fd(t.start_date), fd(t.end_date), t.duration_hours == null ? '—' : t.duration_hours, t.cost_info == null ? '—' : f(t.cost_info),
          '<button class="b2" type="button" onclick="gapTrainOpen(' + t.id + ')">Participants</button>'];
      })) + (mg ? '<div class="bar"><button type="button" onclick="gapTrainNew()">＋ Nouvelle formation</button></div>' : '') + back('rhdash', 'Tableau RH');
  };
  window.gapTrainNew = run(async function () {
    var em = await emps();
    modal('<h3>Nouvelle formation</h3><label>Intitulé<input id="tr-t"></label><label>Organisme<input id="tr-o"></label><label>Formateur<input id="tr-f"></label>' +
      '<div class="g"><label>Début<input id="tr-s" type="date"></label><label>Fin<input id="tr-e" type="date"></label><label>Heures<input id="tr-h" type="number" min="0" step="any"></label><label>Coût (information)<input id="tr-c" type="number" min="0" step="any"></label></div>' +
      '<label>Participants (Ctrl/Cmd pour plusieurs)<select id="tr-p" multiple size="6">' + opts(em, 'id', empName) + '</select></label>' +
      '<div class="r"><button class="b2" type="button" onclick="closeM()">Annuler</button><button type="button" onclick="gapTrainSave()">Enregistrer</button></div>');
  });
  window.gapTrainSave = run(async function () {
    var n = function (id) { return val(id) === '' ? null : Number(val(id)); };
    await Po('/hr/v2/trainings', { title: val('tr-t'), organism: val('tr-o') || null, trainer: val('tr-f') || null, start_date: val('tr-s') || null, end_date: val('tr-e') || null, duration_hours: n('tr-h'), cost_info: n('tr-c'),
      participant_ids: [].slice.call(document.getElementById('tr-p').selectedOptions).map(function (o) { return +o.value; }) });
    closeM(); ok('Formation enregistrée'); go('rhtrain');
  });
  window.gapTrainOpen = run(async function (id) {
    var rows = await G('/hr/v2/trainings/' + id + '/participants'), mg = can_('hr.training.manage') || can_('hr.manage');
    modal('<h3>Participants</h3>' + T(['Employé', 'Résultat', 'Valable jusqu’au', ''], rows.map(function (p) {
      return [esc(p.employee), esc(p.result || '—'), fd(p.expires_on), mg ? '<select onchange="gapTrainRes(' + id + ',' + p.id + ',this.value)"><option value="">Résultat…</option><option value="present">Présent</option><option value="reussi">Réussi</option><option value="echec">Échec</option><option value="absent">Absent</option></select>' : ''];
    })) + '<div class="r"><button class="b2" type="button" onclick="closeM()">Fermer</button></div>');
  });
  window.gapTrainRes = run(async function (id, pid, v) { if (!v) return; await Po('/hr/v2/trainings/' + id + '/participants/' + pid + '/result', { result: v }); ok('Résultat enregistré'); gapTrainOpen(id); });

  /* ───────── Évaluations ───────── */
  VM.rheval = async function () {
    var off = await needMod('evaluation', 'Évaluations'); if (off) return off;
    var r = await Promise.all([G('/hr/v2/evaluations'), G('/hr/v2/evaluation-templates')]), rows = r[0], tpl = r[1], mg = can_('hr.evaluation.manage') || can_('hr.manage');
    return '<h2 style="margin-top:0">Évaluations</h2><p class="muted">Aucune incidence automatique sur le salaire ou la paie.</p>' +
      T(['Employé', 'Période', 'Note globale (/20)', 'Date', 'Statut', 'Commentaire'], rows.map(function (e) { return [esc(e.employee), esc(e.period_label || '—'), e.overall_score == null ? '—' : e.overall_score, fd(e.evaluated_on), esc(e.status || ''), esc(e.comment || '')]; })) +
      (mg ? '<div class="bar"><button type="button" onclick="gapEvalNew()">＋ Nouvelle évaluation</button></div>' : '') + '<p class="muted">Modèles : ' + (tpl.map(function (t) { return esc(t.label); }).join(', ') || '—') + '</p>' + back('rhdash', 'Tableau RH');
  };
  window.gapEvalNew = run(async function () {
    var r = await Promise.all([emps(), G('/hr/v2/evaluation-templates')]), em = r[0], tpl = r[1];
    window.__evTpl = tpl;
    modal('<h3>Nouvelle évaluation</h3><label>Employé<select id="ev-e">' + opts(em, 'id', empName) + '</select></label><label>Modèle<select id="ev-t" onchange="gapEvalCrit()">' + opts(tpl, 'id', 'label') + '</select></label>' +
      '<label>Période<input id="ev-p" placeholder="Ex. 2026 ou T3 2026"></label><div id="ev-c"></div><label>Commentaire<textarea id="ev-m" rows="3"></textarea></label>' +
      '<div class="r"><button class="b2" type="button" onclick="closeM()">Annuler</button><button type="button" onclick="gapEvalSave()">Enregistrer</button></div>');
    gapEvalCrit();
  });
  window.gapEvalCrit = function () {
    var t = (window.__evTpl || []).find(function (x) { return String(x.id) === val('ev-t'); }), c = (t && t.criteria) || [];
    document.getElementById('ev-c').innerHTML = c.map(function (k) { return '<label>' + esc(k.label) + ' (sur ' + k.max + ')<input type="number" min="0" max="' + k.max + '" step="any" data-evc="' + esc(k.code) + '" data-max="' + k.max + '"></label>'; }).join('');
  };
  window.gapEvalSave = run(async function () {
    var scores = {}, sum = 0, mx = 0;
    [].slice.call(document.querySelectorAll('[data-evc]')).forEach(function (i) { if (i.value !== '') { scores[i.getAttribute('data-evc')] = Number(i.value); sum += Number(i.value); mx += Number(i.getAttribute('data-max')); } });
    await Po('/hr/v2/evaluations', { employee_id: +val('ev-e'), template_id: +val('ev-t') || null, period_label: val('ev-p') || null, scores: scores, overall_score: mx ? Math.round(sum / mx * 1000) / 50 : null, comment: val('ev-m') || null });
    closeM(); ok('Évaluation enregistrée'); go('rheval');
  });

  /* ───────── Sanctions et récompenses ───────── */
  VM.rhdisc = async function () {
    var off = await needMod('disciplinary', 'Sanctions & récompenses'); if (off) return off;
    var rows = await G('/hr/v2/disciplinary'), mg = can_('hr.employee.edit') || can_('hr.manage');
    return '<h2 style="margin-top:0">Sanctions et récompenses</h2><p class="muted">Aucun impact automatique sur la paie.</p>' +
      T(['Date', 'Employé', 'Type', 'Libellé', 'Description'], rows.map(function (d) { return [fd(d.occurred_on), esc(d.employee), d.kind === 'sanction' ? '<span class="tag x">Sanction</span>' : '<span class="tag">Récompense</span>', esc(d.type_label), esc(d.description || '')]; })) +
      (mg ? '<div class="bar"><button type="button" onclick="gapDiscNew()">＋ Enregistrer</button></div>' : '') + back('rhdash', 'Tableau RH');
  };
  window.gapDiscNew = run(async function () {
    var em = await emps();
    modal('<h3>Sanction / récompense</h3><label>Employé<select id="di-e">' + opts(em, 'id', empName) + '</select></label><label>Nature<select id="di-k"><option value="sanction">Sanction</option><option value="recompense">Récompense</option></select></label>' +
      '<label>Libellé (ex. avertissement, prime d’assiduité)<input id="di-l"></label><label>Date<input id="di-d" type="date" value="' + today() + '"></label><label>Description<textarea id="di-t" rows="3"></textarea></label>' +
      '<div class="r"><button class="b2" type="button" onclick="closeM()">Annuler</button><button type="button" onclick="gapDiscSave()">Enregistrer</button></div>');
  });
  window.gapDiscSave = run(async function () { await Po('/hr/v2/disciplinary', { employee_id: +val('di-e'), kind: val('di-k'), type_label: val('di-l'), occurred_on: val('di-d') || undefined, description: val('di-t') || null }); closeM(); ok('Enregistré'); go('rhdisc'); });

  /* ───────── Portail salarié ───────── */
  VM.rhme = async function () {
    var off = await needMod('portal', 'Mon espace RH'); if (off) return off;
    var d = await G('/hr/v2/me/summary');
    if (!d.linked) return '<h2 style="margin-top:0">Mon espace RH</h2><p class="warn">Votre compte n’est pas rattaché à une fiche employé. Demandez à votre responsable RH de faire le lien.</p>';
    return '<h2 style="margin-top:0">Mon espace RH — ' + esc(empName(d.employee)) + '</h2><p class="muted">' + esc(d.note || '') + '</p>' +
      '<h3>Mes bulletins</h3>' + T(['N°', 'Mois', 'Statut', 'Net à payer'], d.payslips.map(function (p) { return [esc(p.number), fd(p.month), esc(p.status), f(p.net_pay)]; })) +
      '<h3>Mes congés</h3>' + T(['Du', 'Au', 'Jours', 'État'], d.leaves.map(function (l) { return [fd(l.start_date), fd(l.end_date), l.days, esc(l.status)]; })) +
      '<h3>Mes présences (14 derniers jours)</h3>' + T(['Date', 'Statut'], d.attendance.map(function (a) { return [fd(a.work_date), esc(a.status)]; })) +
      '<h3>Mes documents</h3>' + T(['Catégorie', 'Titre', 'Expire le'], d.documents.map(function (x) { return [esc(x.category), esc(x.title), fd(x.expires_on)]; })) +
      (can_('hr.leave.request') || can_('hr.manage') ? '<div class="bar"><button type="button" onclick="gapLeaveNew(' + d.employee.id + ')">Demander un congé</button></div>' : '');
  };

  /* ───────── Congés : demande + types ───────── */
  var origLeaves = VM.rhleaves;
  VM.rhleaves = async function () {
    var html = origLeaves ? await origLeaves() : '', m = await hrMods(); if (!m.leave) return html;
    var types = await G('/hr/v2/leave-types').catch(function () { return []; });
    return html + '<div class="card"><b>Types de congé</b>' + T(['Code', 'Libellé', 'Payé', 'Jours / an'], types.map(function (t) { return [esc(t.code), esc(t.label), t.paid ? 'Oui' : 'Non', t.annual_days == null ? '—' : t.annual_days]; })) +
      (can_('hr.leave.request') || can_('hr.leave.manage') || can_('hr.manage') ? '<div class="bar"><button type="button" onclick="gapLeaveNew()">＋ Nouvelle demande de congé</button></div>' : '') + '</div>';
  };
  window.gapLeaveNew = run(async function (empId) {
    var r = await Promise.all([emps(), G('/hr/v2/leave-types')]), em = r[0], ty = r[1];
    modal('<h3>Demande de congé</h3><label>Employé<select id="lv-e">' + opts(em, 'id', empName, empId) + '</select></label><label>Type<select id="lv-t">' + opts(ty, 'id', 'label') + '</select></label>' +
      '<div class="g"><label>Du<input id="lv-s" type="date" value="' + today() + '"></label><label>Au<input id="lv-f" type="date" value="' + today() + '"></label><label>Jours ouvrés<input id="lv-d" type="number" min="0.5" step="0.5" value="1"></label></div><label>Motif<input id="lv-r"></label>' +
      '<div class="r"><button class="b2" type="button" onclick="closeM()">Annuler</button><button type="button" onclick="gapLeaveSave()">Envoyer</button></div>');
  });
  window.gapLeaveSave = run(async function () { await Po('/hr/v2/leaves', { employee_id: +val('lv-e'), leave_type_id: +val('lv-t') || null, start_date: val('lv-s'), end_date: val('lv-f'), days: Number(val('lv-d')), reason: val('lv-r') || null }); closeM(); ok('Demande enregistrée'); go('rhleaves'); });

  /* ───────── Présences : correction ───────── */
  var origAtt = VM.rhatt;
  VM.rhatt = async function () {
    var html = origAtt ? await origAtt() : '', m = await hrMods(); if (!m.attendance || !(can_('hr.attendance.correct') || can_('hr.manage'))) return html;
    var to = today(), from = new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10), rows = await G('/hr/v2/attendance?from=' + from + '&to=' + to).catch(function () { return []; });
    return html + '<div class="card"><b>Corriger une présence (7 derniers jours)</b><p class="muted">Toute correction est motivée et journalisée.</p>' +
      T(['Date', 'Employé', 'Statut', 'Entrée', 'Sortie', ''], rows.map(function (a) { return [fd(a.work_date), esc(a.employee || ''), esc(a.status), esc((a.time_in || '').slice(0, 5)), esc((a.time_out || '').slice(0, 5)), '<button class="b2" type="button" onclick="gapAttFix(' + a.id + ',\'' + esc(a.status) + '\')">Corriger</button>']; })) + '</div>';
  };
  window.gapAttFix = run(async function (id, st) {
    var S = ['present', 'absent', 'retard', 'conge', 'maladie', 'mission', 'repos', 'autre'];
    modal('<h3>Corriger la présence</h3><label>Statut<select id="at-s">' + S.map(function (x) { return '<option' + (x === st ? ' selected' : '') + '>' + x + '</option>'; }).join('') + '</select></label><div class="g"><label>Entrée<input id="at-i" type="time"></label><label>Sortie<input id="at-o" type="time"></label></div><label>Motif (obligatoire)<input id="at-r"></label>' +
      '<div class="r"><button class="b2" type="button" onclick="closeM()">Annuler</button><button type="button" onclick="gapAttSave(' + id + ')">Enregistrer</button></div>');
  });
  window.gapAttSave = run(async function (id) { await Po('/hr/v2/attendance/' + id + '/correct', { status: val('at-s'), time_in: val('at-i') || null, time_out: val('at-o') || null, reason: val('at-r') }); closeM(); ok('Présence corrigée'); go('rhatt'); });

  /* ───────── Heures supplémentaires : heures approuvées du mois ───────── */
  var origOt = VM.rhot;
  VM.rhot = async function () {
    var html = origOt ? await origOt() : '', d = await G('/hr/v2/overtime/approved-hours').catch(function () { return null; });
    if (!d) return html;
    var names = {}; (await emps()).forEach(function (e) { names[e.id] = empName(e); });
    return html + '<div class="card"><b>Heures approuvées par la RH — ' + esc(d.month) + '</b><p class="muted">' + esc(d.note || '') + '</p>' + T(['Employé', 'Heures', 'Montant estimé'], (d.lines || []).map(function (l) { return [esc(names[l.employee_id] || ('n° ' + l.employee_id)), l.hours, f(l.amount_estimate)]; })) + '</div>';
  };

  /* ───────── Périodes de paie : état, réouverture ; envoi des bulletins par e-mail ───────── */
  var origPer = VM.rhperiods;
  VM.rhperiods = async function () {
    var html = origPer ? await origPer() : '', month = today().slice(0, 7), r = await Promise.all([G('/hr/v2/periods/check?month=' + month).catch(function () { return null; }), G('/hr/payroll?month=' + month).catch(function () { return []; })]), chk = r[0], slips = r[1], m = await hrMods();
    var out = html + '<div class="card"><b>Période ' + month + '</b> : ' + (chk ? (chk.open ? '<span class="tag">Ouverte</span>' : '<span class="tag x">Clôturée</span>') : '—') +
      (chk && !chk.open && (can_('hr.payroll.reopen') || can_('hr.manage')) ? ' <button class="bd" type="button" onclick="gapPerReopen(\'' + month + '\')">Rouvrir (exceptionnel)</button>' : '') + '</div>';
    if (m.payroll_email && (can_('hr.payroll.email') || can_('hr.payroll') || can_('hr.manage')))
      out += '<div class="card"><b>Envoi des bulletins par e-mail — ' + month + '</b><p class="muted">Seuls les bulletins validés ou payés, avec adresse e-mail sur la fiche.</p>' +
        T(['Employé', 'N°', 'Statut', 'Net', ''], slips.map(function (s) { return [esc(s.employee), esc(s.number), esc(s.status), f(s.net_pay), ['valide', 'paye'].indexOf(s.status) >= 0 ? '<button class="b2" type="button" onclick="gapSlipMail(' + s.id + ')">Envoyer</button> <button class="b2" type="button" onclick="gapSlipLog(' + s.id + ')">Journal</button>' : '']; })) + '</div>';
    return out;
  };
  window.gapPerReopen = run(async function (month) { var why = prompt('Motif de réouverture (obligatoire, 5 caractères minimum) :'); if (!why) return; await Po('/hr/v2/periods/reopen', { month: month, reason: why }); ok('Période rouverte (journalisé)'); go('rhperiods'); });
  window.gapSlipMail = run(async function (id) { var r = await Po('/hr/payroll/' + id + '/email', {}); ok(r && r.message ? r.message : 'E-mail envoyé'); go('rhperiods'); });
  window.gapSlipLog = run(async function (id) {
    var rows = await G('/hr/payroll/' + id + '/email-log');
    modal('<h3>Journal d’envoi</h3>' + T(['Date', 'Destinataire', 'Résultat', 'Par'], rows.map(function (l) { return [dt(l.sent_at), esc(l.recipient || ''), esc((l.status || '') + (l.error_message ? ' — ' + l.error_message : '')), esc(l.login || '')]; })) + '<div class="r"><button class="b2" type="button" onclick="closeM()">Fermer</button></div>');
  });

  /* ───────── Modules RH : modèle d'e-mail + test SMTP ───────── */
  var origSet = VM.rhsettings;
  VM.rhsettings = async function () {
    var html = origSet ? await origSet() : '', m = await hrMods(), out = html;
    if (m.payroll_email) {
      var t = await G('/hr/v2/email-template').catch(function () { return null; });
      if (t) out += '<div class="card"><b>Modèle de l’e-mail des bulletins</b><p class="muted">Variables : {{prenom}}, {{periode}}, {{entreprise}}</p><label>Objet<input id="et-s" value="' + esc(t.subject) + '"></label><label>Message<textarea id="et-b" rows="6">' + esc(t.body) + '</textarea></label>' +
        '<div class="bar"><button type="button" onclick="gapTplSave()">Enregistrer le modèle</button></div></div>';
    }
    if (can_('settings.edit') || can_('hr.settings')) {
      var dg = await G('/admin/smtp/diagnostics').catch(function () { return []; });
      out += '<div class="card"><b>Test d’envoi e-mail</b><p class="muted">Vérifie que le serveur d’e-mails est bien configuré (nécessaire pour envoyer les bulletins).</p><div class="bar"><input id="sm-to" type="email" placeholder="Adresse de test"><button type="button" onclick="gapSmtp()">Envoyer un test</button></div>' +
        T(['Date', 'Résultat', 'Détail', 'Par'], dg.map(function (x) { return [dt(x.created_at), x.success ? '<span class="tag">OK</span>' : '<span class="tag x">Échec</span>', esc(x.diagnostic), esc(x.login || '')]; })) + '</div>';
    }
    return out;
  };
  window.gapTplSave = run(async function () { await api('PUT', '/hr/v2/email-template', { subject: val('et-s'), body: val('et-b') }); ok('Modèle enregistré'); });
  window.gapSmtp = run(async function () { var r = await Po('/admin/smtp/test', { to: val('sm-to') }); toast(r.diagnostic, r.success ? 'success' : 'error'); go('rhsettings'); });

  /* ───────── Règles de paie : ITS, INPS, AMO, charges patronales ───────── */
  var FAM = [['its-brackets', 'ITS — barèmes', 'its'], ['inps-branches', 'INPS — branches', 'inps'], ['amo-branches', 'AMO — branches', 'amo'], ['employer-charges', 'Charges patronales', 'chg']];
  VM.rhrules = async function () {
    var r = await Promise.all([G('/hr/activation-status'), G('/hr/rules').catch(function () { return {}; })].concat(FAM.map(function (x) { return G('/hr/' + x[0]).catch(function () { return []; }); }))), st = r[0], rules = r[1], mg = can_('hr.manage');
    var out = '<h2 style="margin-top:0">Règles de paie (ITS, INPS, AMO)</h2><p class="warn">' + esc(rules.warning || 'Ces règles doivent être validées juridiquement avant activation.') + '</p>' +
      '<div class="card"><b>Application dans les bulletins</b>' + T(['Cotisation', 'Étapes', 'Règles actives', 'En attente', 'Dans la paie', ''], (st.modules || []).map(function (m) {
        return [esc(m.label), m.prerequisites.map(function (p) { return (p.ok ? '✅ ' : '⬜ ') + esc(p.label); }).join('<br>'), m.active_rules, m.pending_rules, m.flag_on ? '<span class="tag">Activée</span>' : '<span class="tag x">Désactivée</span>',
          mg ? (m.flag_on ? '<button class="bd" type="button" onclick="gapFlag(\'' + m.code + '\',false)">Désactiver</button>' : (m.can_enable_flag ? '<button type="button" onclick="gapFlag(\'' + m.code + '\',true)">Activer</button>' : '')) : ''];
      })) + '<p class="muted">Mode sécurité : <b>' + esc((st.checklist || []).filter(function (c) { return c.id === 'security_mode'; }).map(function (c) { return c.value; })[0] || '—') + '</b></p></div>';
    FAM.forEach(function (fm, i) {
      var rows = r[2 + i];
      out += '<div class="card"><b>' + fm[1] + '</b>' + T(['Version', 'Libellé', 'Taux / barème', 'Juridique', 'Technique', ''], rows.map(function (x) {
        var tx = fm[2] === 'its' ? (x.brackets || []).map(function (b) { return (b.from || 0) + '→' + (b.to == null ? '∞' : b.to) + ' : ' + b.rate + ' %'; }).join('<br>') : (fm[2] === 'chg' ? (x.fixed_amount ? f(x.fixed_amount) : x.rate + ' %') : 'Salarié ' + x.employee_rate + ' % · Employeur ' + x.employer_rate + ' %');
        return [esc((x.code ? x.code + ' ' : '') + 'v' + x.version), esc(x.label || ''), tx, x.legal_status === 'confirmee' ? '<span class="tag">Confirmée</span>' : '<span class="tag x">À confirmer</span>', x.technical_status === 'active' ? '<span class="tag">Active</span>' : '<span class="tag x">Inactive</span>',
          mg ? (x.legal_status !== 'confirmee' ? '<button class="b2" type="button" onclick="gapRule(\'' + fm[0] + '\',' + x.id + ',\'confirm\')">Confirmer</button>' : (x.technical_status === 'active' ? '<button class="bd" type="button" onclick="gapRule(\'' + fm[0] + '\',' + x.id + ',\'deactivate\')">Désactiver</button>' : '<button type="button" onclick="gapRule(\'' + fm[0] + '\',' + x.id + ',\'activate\')">Activer</button>')) : ''];
      })) + (mg ? '<div class="bar"><button class="b2" type="button" onclick="gapRuleNew(\'' + fm[0] + '\')">＋ Nouvelle version</button></div>' : '') + '</div>';
    });
    return out + back('rhctl', 'Contrôle paie');
  };
  window.gapRule = run(async function (fam, id, act) { var why = prompt('Motif (obligatoire) :'); if (!why) return; await Po('/hr/' + fam + '/' + id + '/' + act, { reason: why }); ok('Fait'); go('rhrules'); });
  window.gapFlag = run(async function (flag, on) {
    var why = prompt('Motif (obligatoire) :'); if (!why || why.length < 5) return toast('Motif trop court', 'error');
    if (on) { if (!confirm('Activer cette cotisation dans les bulletins ? Les montants des prochains bulletins changeront.')) return; await Po('/hr/activation/enable-flag', { flag: flag, reason: why, confirm: true }); }
    else await Po('/hr/activation/disable-flag', { flag: flag, reason: why });
    ok('Mis à jour'); go('rhrules');
  });
  window.gapRuleNew = function (fam) {
    var its = fam === 'its-brackets', chg = fam === 'employer-charges';
    modal('<h3>Nouvelle version — ' + esc(fam) + '</h3>' + (its ? '<label>Libellé<input id="ru-l"></label><label>Tranches (une par ligne : de;à;taux%  — « à » vide = sans plafond)<textarea id="ru-b" rows="5" placeholder="0;100000;0\n100000;300000;10\n300000;;20"></textarea></label>'
      : '<label>Code<input id="ru-c"></label><label>Libellé<input id="ru-l"></label>' + (chg ? '<label>Taux (%)<input id="ru-r" type="number" step="any" value="0"></label>' : '<div class="g"><label>Part salarié (%)<input id="ru-e" type="number" step="any" value="0"></label><label>Part employeur (%)<input id="ru-p" type="number" step="any" value="0"></label></div>')) +
      '<div class="g"><label>Source (organisme)<input id="ru-so"></label><label>Référence<input id="ru-sr"></label><label>Effective à partir du<input id="ru-d" type="date"></label></div>' +
      '<p class="muted">La nouvelle version est créée « à confirmer » et désactivée.</p><div class="r"><button class="b2" type="button" onclick="closeM()">Annuler</button><button type="button" onclick="gapRuleSave(\'' + fam + '\')">Créer</button></div>');
  };
  window.gapRuleSave = run(async function (fam) {
    var b = { source_org: val('ru-so') || undefined, source_ref: val('ru-sr') || undefined, effective_from: val('ru-d') || undefined };
    if (fam === 'its-brackets') { b.label = val('ru-l') || undefined; b.brackets = val('ru-b').split(/\n+/).filter(Boolean).map(function (ln) { var p = ln.split(';'); return { from: Number(p[0]), to: p[1] === '' || p[1] == null ? null : Number(p[1]), rate: Number(p[2]) }; }); }
    else { b.code = val('ru-c'); b.label = val('ru-l'); if (fam === 'employer-charges') b.rate = Number(val('ru-r')); else { b.employee_rate = Number(val('ru-e')); b.employer_rate = Number(val('ru-p')); } }
    await Po('/hr/' + fam, b); closeM(); ok('Version créée'); go('rhrules');
  });

  /* ───────── Prêts : historique des remboursements (bouton dans Caisse) ───────── */
  window.loanPayments = run(async function (id) {
    var rows = await G('/finance/loans/' + id + '/payments');
    modal('<h3>Remboursements</h3>' + T(['Date', 'Montant', 'Mode', 'Note', 'Par'], rows.map(function (x) { return [dt(x.paid_at), f(x.amount), esc(x.method || ''), esc(x.notes || ''), esc(x.login || '')]; })) + '<div class="r"><button class="b2" type="button" onclick="closeM()">Fermer</button></div>');
  });

  /* ───────── Transferts de stock entre stations ───────── */
  VM.transferts = async function () {
    var r = await Promise.all([G('/stock/transfers'), G('/stock/transfers/stations').catch(function () { return []; })]), rows = r[0], mg = can_('transfer.manage');
    var ST = { envoye: ['En transit', ''], recu: ['Reçu', ''], annule: ['Annulé', 'x'] };
    return '<h2 style="margin-top:0">Transferts de stock entre stations</h2><p class="muted">L’envoi retire le stock de la station source ; la réception l’ajoute à la station de destination (changez de station pour réceptionner). Un transfert non reçu peut être annulé.</p>' +
      T(['N°', 'Sens', 'Station', 'Produits', 'État', 'Date', ''], rows.map(function (t) {
        var s = ST[t.status] || [t.status, ''], act = '';
        if (mg && t.status === 'envoye') act = t.outgoing ? '<button class="bd" type="button" onclick="gapTrCancel(' + t.id + ')">Annuler</button>' : '<button type="button" onclick="gapTrRecv(' + t.id + ')">Réceptionner</button>';
        return [t.id, t.outgoing ? '➡️ Envoi' : '⬅️ Réception', esc(t.outgoing ? t.to_station : t.from_station), t.items.map(function (i) { return esc(i.product) + ' × ' + i.quantity; }).join('<br>'), '<span class="tag ' + s[1] + '">' + s[0] + '</span>', dt(t.sent_at), act];
      })) + (mg ? (r[1].length ? '<div class="bar"><button type="button" onclick="gapTrNew()">＋ Nouveau transfert</button></div>' : '<p class="muted">Aucune autre station accessible : le transfert nécessite au moins deux stations du même compte.</p>') : '');
  };
  window.gapTrNew = run(async function () {
    var r = await Promise.all([G('/stock/transfers/stations'), G('/products')]), ds = r[0], ps = r[1].filter(function (p) { return p.active !== false && p.active !== 0 && p.category != 'CARBURANT'; });
    window.__trP = ps;
    modal('<h3>Nouveau transfert</h3><label>Station de destination<select id="tn-d">' + opts(ds, 'id', 'name') + '</select></label><div id="tn-l"></div><div class="bar"><button class="b2" type="button" onclick="gapTrLine()">＋ Produit</button></div><label>Commentaire<input id="tn-c"></label>' +
      '<div class="r"><button class="b2" type="button" onclick="closeM()">Annuler</button><button type="button" onclick="gapTrSave()">Envoyer</button></div>');
    gapTrLine();
  });
  window.gapTrLine = function () {
    var d = document.createElement('div'); d.className = 'bar'; d.setAttribute('data-trl', '1');
    d.innerHTML = '<select>' + opts(window.__trP || [], 'id', function (p) { return p.name + ' (stock ' + p.stock + ')'; }) + '</select><input type="number" min="0" step="any" placeholder="Quantité" style="width:110px">';
    document.getElementById('tn-l').appendChild(d);
  };
  window.gapTrSave = run(async function () {
    var items = [].slice.call(document.querySelectorAll('[data-trl]')).map(function (d) { return { product_id: +d.querySelector('select').value, quantity: Number(d.querySelector('input').value) }; }).filter(function (i) { return i.quantity > 0; });
    if (!items.length) return toast('Ajoutez au moins un produit avec une quantité', 'error');
    await Po('/stock/transfers', { to_station_id: +val('tn-d'), items: items, comment: val('tn-c') || null }); closeM(); ok('Transfert envoyé'); go('transferts');
  });
  window.gapTrRecv = run(async function (id) { await Po('/stock/transfers/' + id + '/receive', {}); ok('Stock reçu'); go('transferts'); });
  window.gapTrCancel = run(async function (id) { if (!confirm('Annuler ce transfert ? Le stock sera restitué.')) return; await Po('/stock/transfers/' + id + '/cancel', {}); ok('Transfert annulé'); go('transferts'); });

  /* ───────── Historique des compteurs ───────── */
  VM.histcompteurs = async function () {
    var rows = await G('/pumps/counter-history'), L = { produit: 'Changement de produit', correction: 'Correction d’index', reset: 'Remise à zéro', replace: 'Remplacement', calibration: 'Calibrage' };
    return '<h2 style="margin-top:0">Historique des compteurs</h2><p class="muted">Changements de produit et corrections d’index des pompes, avec l’auteur et le motif.</p>' +
      T(['Date', 'Pompe', 'Compteur', 'Événement', 'Détail', 'Par'], rows.map(function (x) {
        return [dt(x.at), esc(x.pump), 'C' + x.counter_number, esc(L[x.kind] || x.kind), x.detail ? esc(x.detail) : (x.index_before != null ? x.index_before + ' → ' + x.index_after + (x.reason ? ' · ' + esc(x.reason) : '') : ''), esc(x.login || '')];
      })) + back('pompes', 'Pompes');
  };

  /* ───────── Licence & modules ───────── */
  VM.licence = async function () {
    var r = await Promise.all([G('/me/quotas').catch(function () { return null; }), G('/modules/catalog').catch(function () { return []; }), G('/license/warnings').catch(function () { return null; })]), q = r[0], cat = r[1], w = r[2];
    var qs = q && q.quotas ? Object.keys(q.quotas).map(function (k) { var x = q.quotas[k]; return [esc(k === 'stations' ? 'Stations' : k === 'users' ? 'Utilisateurs' : k), x.unlimited ? 'Illimité' : (x.used + ' / ' + x.max)]; }) : [];
    return '<h2 style="margin-top:0">Licence & modules</h2>' + (q && q.client_name ? '<p>Compte : <b>' + esc(q.client_name) + '</b> · contrat <b>' + esc(q.contract_status || '—') + '</b></p>' : '') +
      (w && w.contract ? '<p>Échéance du contrat : <b>' + fd(w.contract.end_date) + '</b>' + (w.contract.days_left != null ? ' (dans ' + w.contract.days_left + ' jour(s))' : '') + '</p>' : '') +
      '<div class="card"><b>Quotas</b>' + T(['Ressource', 'Utilisation'], qs) + '</div>' +
      '<div class="card"><b>Modules disponibles</b>' + T(['Module', 'Description', 'Option'], cat.map(function (m) { return [esc(m.label), esc(m.description || ''), m.premium ? '<span class="tag x">Premium</span>' : '<span class="tag">Inclus</span>']; })) + '</div>' +
      '<div class="card"><b>Avertissements d’échéance envoyés</b>' + T(['Seuil', 'Envoyé le', 'Canal'], ((w && w.warnings) || []).map(function (x) { return ['J-' + x.threshold_days, dt(x.warned_at), esc(x.channel)]; })) + '</div>';
  };

  /* ───────── Mon tableau de bord (préférences personnelles) ───────── */
  var CARDS = [['revenue', "Chiffre d'affaires"], ['fuel', 'Ventes carburant'], ['products', 'Ventes produits'], ['expenses', 'Dépenses'], ['net', 'Résultat net'], ['margin', 'Marge brute'], ['cash', 'Liquidités caisse'], ['receivables', 'Créances clients'], ['payables', 'Dettes fournisseurs'], ['low_stock', 'Stock bas'], ['open_shift', 'Quarts ouverts'], ['alerts', 'Alertes']];
  VM.moidash = async function () {
    var r = await Promise.all([G('/dashboard/config'), G('/dashboard/my-prefs')]), eff = r[0].config || {}, mine = r[1] || {};
    var on = CARDS.filter(function (c) { return (eff.cards || {})[c[0]] !== false && (mine.cards || {})[c[0]] === false || (eff.cards || {})[c[0]]; });
    return '<h2 style="margin-top:0">Mon tableau de bord</h2><p class="muted">Masquez les cartes que vous ne voulez pas voir. Vous ne pouvez pas afficher plus que ce que votre responsable a autorisé.</p>' +
      '<div class="card">' + on.map(function (c) { return '<label style="display:block"><input type="checkbox" data-mp="' + c[0] + '"' + ((mine.cards || {})[c[0]] === false ? '' : ' checked') + '> ' + esc(c[1]) + '</label>'; }).join('') + '</div>' +
      '<div class="bar"><button type="button" onclick="gapPrefSave()">Enregistrer</button><button class="b2" type="button" onclick="gapPrefReset()">Tout réafficher</button></div>';
  };
  window.gapPrefSave = run(async function () { var cards = {}; [].slice.call(document.querySelectorAll('[data-mp]')).forEach(function (i) { if (!i.checked) cards[i.getAttribute('data-mp')] = false; }); await api('PUT', '/dashboard/my-prefs', { cards: cards }); ok('Préférences enregistrées'); go('dash'); });
  window.gapPrefReset = run(async function () { await api('PUT', '/dashboard/my-prefs', { cards: {} }); ok('Tout est réaffiché'); go('moidash'); });

  /* ───────── Estimation fiscale ───────── */
  VM.fiscalest = async function () {
    var d = await G('/fiscal/modules'), act = (d.modules || []).filter(function (m) { return m.activated_by_client; });
    if (!act.length) return '<h2 style="margin-top:0">Estimation fiscale</h2><p class="warn">Aucun module fiscal activé. Activez un module dans « La Fiscalité » pour obtenir une estimation.</p>' + back('fiscalhub', 'La Fiscalité');
    var m0 = today().slice(0, 8) + '01';
    return '<h2 style="margin-top:0">Estimation fiscale</h2><p class="muted">' + esc(d.disclaimer || 'Estimation indicative, à valider par un professionnel.') + '</p><div class="card"><div class="g"><label>Module<select id="fe-m">' + opts(act, 'code', function (m) { return m.label || m.code; }) +
      '</select></label><label>Du<input id="fe-s" type="date" value="' + m0 + '"></label><label>Au<input id="fe-e" type="date" value="' + today() + '"></label></div><div class="bar"><button type="button" onclick="gapEstimate()">Calculer</button></div><div id="fe-r"></div></div>' + back('fiscalhub', 'La Fiscalité');
  };
  window.gapEstimate = run(async function () {
    var r = await Po('/fiscal/estimate', { module_code: val('fe-m'), period_start: val('fe-s'), period_end: val('fe-e') });
    var flat = []; (function walk(o, p) { Object.keys(o || {}).forEach(function (k) { var v = o[k]; if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, p + k + ' › '); else if (!Array.isArray(v)) flat.push([esc(p + k), typeof v === 'number' ? f(v) : esc(v)]); }); })(r, '');
    document.getElementById('fe-r').innerHTML = T(['Élément', 'Valeur'], flat);
  });

  /* ───────── Déclarations ───────── */
  V.rhteams = ['Équipes', 'hr.schedule.view|hr.view|hr.manage'];
  V.rhskills = ['Compétences', 'hr.skills.view|hr.view|hr.manage'];
  V.rhtrain = ['Formations', 'hr.training.view|hr.view|hr.manage'];
  V.rheval = ['Évaluations', 'hr.evaluation.view|hr.view|hr.manage'];
  V.rhdisc = ['Sanctions & récompenses', 'hr.employee.view|hr.view|hr.manage'];
  V.rhme = ['Mon espace RH', 'hr.leave.request|hr.view|hr.manage|sale.create|shift.open'];
  V.rhrules = ['Règles de paie', 'hr.view|hr.manage|hr.payroll'];
  V.transferts = ['Transferts de stock', 'transfer.manage|stock.adjust|report.view'];
  V.histcompteurs = ['Historique des compteurs', 'settings.edit|shift.open|report.view'];
  V.licence = ['Licence & modules', 'settings.edit|user.manage'];
  V.moidash = ['Mon tableau de bord', 'report.view|finance.view'];
  V.fiscalest = ['Estimation fiscale', 'settings.edit'];
  if (typeof NAV_ICONS !== 'undefined') Object.assign(NAV_ICONS, { rhteams: '👥', rhskills: '🎓', rhtrain: '📚', rheval: '📝', rhdisc: '⚖️', rhme: '🙋', rhrules: '🧮', transferts: '🔁', histcompteurs: '🕘', licence: '🔑', moidash: '🎛️', fiscalest: '🧾' });
})();
