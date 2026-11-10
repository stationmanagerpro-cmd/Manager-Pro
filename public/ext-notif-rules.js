/* Règles de notification sur rapports — formulaire type captures + rapports 1–5, priorité, périodicité */
(function () {
  'use strict';
  if (typeof V === 'undefined' || typeof VM === 'undefined') return;

  var meta = null;
  var state = { rules: [], users: [] };

  function canManage() {
    return typeof can === 'function' && (can('settings.edit') || can('user.manage'));
  }

  async function loadMeta() {
    if (!meta) meta = await G('/notification-rules/meta');
    return meta;
  }

  async function loadRules() {
    var data = await G('/notification-rules');
    state.rules = data.rules || [];
    state.users = data.users || [];
    if (data.reports) {
      meta = meta || {};
      meta.reports = data.reports;
    }
    return data;
  }

  async function vNotifRules() {
    if (ME && ME.is_global) {
      return '<p class="warn">Les règles de notification sont réservées aux comptes clients.</p>';
    }
    if (!canManage()) {
      return '<p class="warn">Permission settings.edit ou user.manage requise.</p>';
    }
    try {
      await loadMeta();
      await loadRules();
    } catch (e) {
      return '<p class="warn">' + esc(e.message || 'Chargement impossible') + '</p>';
    }

    var CH = { app: 'Application', email: 'E-mail', sms: 'SMS', whatsapp: 'WhatsApp' };
    var FQ = { daily: 'Quotidien', weekly: 'Hebdomadaire', quarterly: 'Trimestriel', semester: 'Semestriel', annual: 'Annuel', once: 'Date précise' };
    var fdt = function (v) { return v ? new Date(v).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—'; };
    var rows = (state.rules || []).map(function (r) {
      var reports = (r.report_keys || []).map(function (k) {
        var f = (meta.reports || []).find(function (x) { return x.key === k; });
        return f ? f.label : k;
      }).join(', ');
      var trig = (meta.triggers || []).find(function (t) { return t.id === r.trigger_event; });
      var sched = r.trigger_event === 'on_schedule';
      var status = !r.active ? '<span class="tag">Inactive</span>'
        : r.last_error ? '<span class="tag r" title="' + esc(r.last_error) + '">⚠ Erreur</span>'
        : '<span class="tag g">Active</span>';
      return [
        '<b>' + esc(r.name) + '</b><br><small class="muted">' + esc(reports || '—') + '</small>',
        esc(trig ? trig.label : r.trigger_event) + (sched ? '<br><small class="muted">' + esc(FQ[r.frequency] || '') + ' à ' + esc((r.send_time || '08:00').slice(0, 5)) + '</small>' : ''),
        '<span class="tag">' + esc(r.priority) + '</span>',
        esc((r.delivery_channels || ['app']).map(function (c) { return CH[c] || c; }).join(', ')),
        sched ? (r.active ? esc(fdt(r.next_run_at)) : '—') : '<span class="muted">À l’événement</span>',
        esc(fdt(r.last_sent_at)) + (r.last_error ? '<br><small style="color:var(--e,#dc2626)">' + esc(r.last_error) + '</small>' : ''),
        status,
        '<div style="display:flex;flex-wrap:wrap;gap:6px">' +
        '<button type="button" class="b2" onclick="nrTest(' + r.id + ')">▶ Tester</button>' +
        '<button type="button" class="b1" onclick="nrEdit(' + r.id + ')">✎ Modifier</button>' +
        '<button type="button" class="b2" onclick="nrToggle(' + r.id + ',' + (r.active ? 'false' : 'true') + ')">' + (r.active ? 'Désactiver' : 'Activer') + '</button>' +
        '<button type="button" class="bd" onclick="nrDelete(' + r.id + ')">🗑</button></div>'
      ];
    });

    return '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:4px">' +
      '<div><h2 style="margin:0">Règles de notification</h2>' +
      '<p class="muted" style="margin:6px 0 0">Déclencheur, rapports (1 à 5), priorité, modèle d’e-mail et périodicité.</p></div>' +
      '<button type="button" class="b1" style="white-space:nowrap;font-size:15px;padding:10px 18px" onclick="nrNew()">＋ Créer une règle</button>' +
      '</div>' +
      '<div class="bar" style="flex-wrap:wrap;gap:8px;margin:12px 0">' +
      '<button type="button" class="b1" onclick="nrNew()">＋ Nouvelle règle</button>' +
      '<button type="button" class="b2" onclick="go(\'notifrules\')">Actualiser</button>' +
      '<button type="button" class="b2" onclick="go(\'alertcfg\')">Config. alertes opérationnelles</button>' +
      '</div>' +
      (rows.length
        ? T(['Règle', 'Déclencheur', 'Priorité', 'Canaux', 'Prochain envoi', 'Dernier envoi', 'État', 'Actions'], rows)
        : '<div class="card" style="text-align:center;padding:28px 16px;margin-top:8px">' +
          '<div style="font-size:36px;margin-bottom:8px">📬</div>' +
          '<b>Aucune règle pour le moment</b>' +
          '<p class="muted" style="margin:8px auto 16px;max-width:420px">Créez une règle pour notifier à la création, modification, approbation d’un rapport, ou selon un calendrier.</p>' +
          '<button type="button" class="b1" style="font-size:15px;padding:10px 20px" onclick="nrNew()">＋ Créer une règle</button>' +
          '</div>') +
      (!(meta && meta.email_configured)
        ? '<p class="warn" style="margin-top:12px">SMTP non configuré sur le serveur : les e-mails ne partiront pas tant que SMTP_HOST n’est pas défini. Les règles restent enregistrables.</p>'
        : '');
  }


  function channelOptions(selected) {
    selected = selected || ['app'];
    var set = new Set(selected);
    var list = (meta && meta.channels) || [
      { id: 'app', label: 'Application (interne)', available: true },
      { id: 'email', label: 'E-mail', available: false, reason: 'non disponible' },
      { id: 'sms', label: 'SMS', available: false, reason: 'non disponible' },
      { id: 'whatsapp', label: 'WhatsApp', available: false, reason: 'non disponible' }
    ];
    return list.map(function (c) {
      return '<label class="nr-report-item" style="' + (c.available ? '' : 'opacity:.55') + '"><input type="checkbox" class="nr-channel" value="' + esc(c.id) + '"' +
        (set.has(c.id) && c.available ? ' checked' : '') + (c.available ? '' : ' disabled') + '> ' + esc(c.label) +
        (c.available ? '' : ' <span class="muted">— ' + esc(c.reason || 'non disponible') + '</span>') + '</label>';
    }).join('');
  }

  function reportCheckboxes(selected) {
    selected = selected || [];
    var set = new Set(selected);
    return (meta.reports || []).map(function (r) {
      return '<label class="nr-report-item"><input type="checkbox" class="nr-report" value="' + esc(r.key) + '" ' +
        (set.has(r.key) ? 'checked' : '') + '> ' + esc(r.label) + '</label>';
    }).join('');
  }

  function userCheckboxes(selected) {
    selected = (selected || []).map(Number);
    var set = new Set(selected);
    if (!(state.users || []).length) return '<p class="muted">Aucun utilisateur.</p>';
    return state.users.map(function (u) {
      return '<label class="nr-report-item"><input type="checkbox" class="nr-user" value="' + Number(u.id) + '" ' +
        (set.has(Number(u.id)) ? 'checked' : '') + '> ' + esc(u.full_name || u.login) +
        (u.email ? ' <span class="muted">&lt;' + esc(u.email) + '&gt;</span>' : '') + '</label>';
    }).join('');
  }

  function openForm(rule) {
    rule = rule || {};
    var isEdit = !!rule.id;
    var triggers = (meta.triggers || []).map(function (t) {
      return '<option value="' + t.id + '"' + (rule.trigger_event === t.id ? ' selected' : '') + '>' + esc(t.label) + '</option>';
    }).join('');
    var modes = (meta.email_modes || []).map(function (m) {
      return '<option value="' + m.id + '"' + ((rule.email_mode || 'system_default') === m.id ? ' selected' : '') + '>' + esc(m.label) + '</option>';
    }).join('');
    var priorities = (meta.priorities || []).map(function (p) {
      return '<option value="' + p.id + '"' + ((rule.priority || 'important') === p.id ? ' selected' : '') + '>' + esc(p.label) + '</option>';
    }).join('');
    var freqs = (meta.frequencies || []).map(function (f) {
      return '<option value="' + f.id + '"' + (rule.frequency === f.id ? ' selected' : '') + '>' + esc(f.label) + '</option>';
    }).join('');

    modal(
      '<h3 style="margin-top:0">' + (isEdit ? 'Modifier la règle' : 'Nouvelle règle de notification') + '</h3>' +
      '<div class="nr-form">' +
      '<label class="nr-row"><span>Nom de la règle</span><input id="nr_name" type="text" placeholder="Ex: notification d’incident grave" value="' + esc(rule.name || '') + '"></label>' +
      '<label class="nr-row"><span>Déclencheur de notification</span><select id="nr_trigger" onchange="nrTriggerChange()">' + triggers + '</select></label>' +
      '<p class="muted" id="nr_trigger_hint" style="font-size:12px;margin:-4px 0 8px"></p>' +
      '<label class="nr-row"><span>Modèle de courriel</span><select id="nr_email_mode" onchange="nrEmailModeChange()">' + modes + '</select></label>' +
      '<div id="nr_custom_wrap" style="display:none">' +
      '<label class="nr-row"><span>Sujet par défaut</span><input id="nr_subject" type="text" placeholder="Entrer l’objet par défaut" value="' + esc(rule.subject_default || '') + '"></label>' +
      '<label class="nr-row"><span>Corps par défaut</span><textarea id="nr_body" rows="5" placeholder="Entrer le corps par défaut">' + esc(rule.body_default || '') + '</textarea></label>' +
      '</div>' +
      '<label class="nr-row"><span>Inclure les pièces jointes</span><select id="nr_attach"><option value="0">Non</option><option value="1"' + (rule.include_attachments ? ' selected' : '') + '>Oui</option></select></label>' +
      '<div class="nr-row nr-stack"><span>Canaux d’envoi</span><div class="nr-report-grid" id="nr_channels">' + channelOptions(rule.delivery_channels || ['app']) + '</div></div>' +
      '<p class="muted" style="font-size:12px;margin:-4px 0 8px">« Application » arrive dans la messagerie et la cloche des destinataires. « E-mail » exige un serveur SMTP configuré.</p>' +
      '<label class="nr-row"><span>Priorité / degré</span><select id="nr_priority">' + priorities + '</select></label>' +
      '<div class="nr-row nr-stack"><span>Rapports concernés <small class="muted">(min. 1 — max. 5)</small></span>' +
      '<div class="nr-report-grid" id="nr_reports">' + reportCheckboxes(rule.report_keys || []) + '</div></div>' +
      '<div id="nr_schedule_wrap">' +
      '<label class="nr-row"><span>Périodicité d’envoi</span><select id="nr_frequency" onchange="nrFreqChange()"><option value="">—</option>' + freqs + '</select></label>' +
      '<p class="muted" id="nr_freq_hint" style="font-size:12px;margin:-4px 0 8px"></p>' +
      '<label class="nr-row" id="nr_date_row" style="display:none"><span>Date précise</span><input id="nr_date" type="date" value="' + esc(rule.scheduled_date || '') + '"></label>' +
      '<label class="nr-row"><span>Heure d’envoi</span><input id="nr_time" type="time" value="' + esc((rule.send_time || '08:00').slice(0, 5)) + '"></label>' +
      '</div>' +
      '<div class="nr-row nr-stack"><span>Destinataires (utilisateurs) <small class="muted">— si aucun n’est choisi : les administrateurs du compte</small></span><div class="nr-report-grid">' + userCheckboxes(rule.recipient_user_ids || []) + '</div></div>' +
      '<label class="nr-row"><span>E-mails additionnels</span><textarea id="nr_emails" rows="2" placeholder="ex: direction@entreprise.com, compta@entreprise.com">' +
      esc((rule.email_recipients || []).join(', ')) + '</textarea></label>' +
      '<label class="nr-row"><span>Active</span><select id="nr_active"><option value="1"' + (rule.active !== false ? ' selected' : '') + '>Oui</option><option value="0"' + (rule.active === false ? ' selected' : '') + '>Non</option></select></label>' +
      '</div>' +
      '<div class="r" style="margin-top:14px;gap:8px"><button class="b2" onclick="closeM()">Annuler</button>' +
      '<button class="b1" onclick="nrSave(' + (rule.id || 'null') + ')">Enregistrer</button></div>'
    );

    setTimeout(function () {
      nrEmailModeChange();
      nrTriggerChange();
      nrFreqChange();
      if (rule.frequency) {
        var sel = document.getElementById('nr_frequency');
        if (sel) sel.value = rule.frequency;
        nrFreqChange();
      }
    }, 30);
  }

  window.nrEmailModeChange = function () {
    var mode = (document.getElementById('nr_email_mode') || {}).value;
    var wrap = document.getElementById('nr_custom_wrap');
    if (wrap) wrap.style.display = mode === 'custom' ? 'block' : 'none';
  };
  window.nrTriggerChange = function () {
    var t = (document.getElementById('nr_trigger') || {}).value;
    var wrap = document.getElementById('nr_schedule_wrap');
    if (wrap) wrap.style.display = t === 'on_schedule' ? 'block' : 'none';
    var hint = document.getElementById('nr_trigger_hint');
    if (hint) hint.textContent = ({
      on_schedule: 'Envoi automatique à la périodicité et à l’heure choisies, avec une synthèse chiffrée du jour.',
      on_report_create: 'Envoi dès qu’un des rapports choisis est créé (ex. clôture d’un quart pour « Quarts de service »).',
      on_report_update: 'Envoi dès qu’un des rapports choisis est modifié.',
      on_report_approve: 'Envoi dès qu’un des rapports choisis est approuvé.'
    })[t] || '';
  };
  window.nrFreqHint = function () {
    var f = (document.getElementById('nr_frequency') || {}).value;
    var h = document.getElementById('nr_freq_hint');
    if (h) h.textContent = ({ daily: 'Tous les jours à l’heure indiquée.', weekly: 'Chaque lundi à l’heure indiquée.', quarterly: 'Le 1er janvier, avril, juillet et octobre.', semester: 'Le 1er janvier et le 1er juillet.', annual: 'Chaque 1er janvier.', once: 'Une seule fois, à la date et l’heure indiquées (la règle se désactive ensuite).' })[f] || '';
  };
  window.nrFreqChange = function () {
    var f = (document.getElementById('nr_frequency') || {}).value;
    var row = document.getElementById('nr_date_row');
    if (row) row.style.display = f === 'once' ? 'flex' : 'none';
    if (typeof nrFreqHint === 'function') nrFreqHint();
  };

  window.nrTest = async function (id) {
    try {
      toast('Envoi du test…', 'info');
      var r = await api('POST', '/notification-rules/' + id + '/test', {});
      if (r.ok) toast('Test envoyé : ' + (r.app ? r.app + ' destinataire(s) dans l’application' : '') + (r.app && r.email ? ', ' : '') + (r.email ? r.email + ' e-mail(s)' : ''), 'success');
      else toast('Test non délivré : ' + ((r.errors || []).join(' | ') || 'aucun destinataire'), 'error');
      go('notifrules');
    } catch (e) { toast(typeof errMsg === 'function' ? errMsg(e) : e.message, 'error'); }
  };

  window.nrNew = async function () {
    try {
      await loadMeta();
      await loadRules();
      openForm(null);
    } catch (e) {
      toast(typeof errMsg === 'function' ? errMsg(e) : e.message, 'error');
    }
  };

  window.nrEdit = async function (id) {
    try {
      await loadMeta();
      await loadRules();
      var rule = state.rules.find(function (x) { return Number(x.id) === Number(id); });
      if (!rule) return toast('Règle introuvable', 'error');
      openForm(rule);
    } catch (e) {
      toast(typeof errMsg === 'function' ? errMsg(e) : e.message, 'error');
    }
  };

  window.nrSave = async function (id) {
    var reports = Array.prototype.slice.call(document.querySelectorAll('.nr-report:checked')).map(function (el) { return el.value; });
    if (reports.length < 1 || reports.length > 5) {
      toast('Sélectionnez entre 1 et 5 rapports.', 'error');
      return;
    }
    var chSel = Array.prototype.slice.call(document.querySelectorAll('.nr-channel:checked')).map(function (o) { return o.value; });
    if (!chSel.length) {
      toast('Choisissez au moins un canal d\'envoi disponible.', 'error');
      return;
    }
    var users = Array.prototype.slice.call(document.querySelectorAll('.nr-user:checked')).map(function (el) { return Number(el.value); });
    var emails = String((document.getElementById('nr_emails') || {}).value || '')
      .split(/[,;\n]/).map(function (x) { return x.trim(); }).filter(Boolean);
    var body = {
      name: String((document.getElementById('nr_name') || {}).value || '').trim(),
      trigger_event: (document.getElementById('nr_trigger') || {}).value,
      email_mode: (document.getElementById('nr_email_mode') || {}).value,
      subject_default: (document.getElementById('nr_subject') || {}).value || null,
      body_default: (document.getElementById('nr_body') || {}).value || null,
      include_attachments: (document.getElementById('nr_attach') || {}).value === '1',
      delivery_channels: chSel,
      priority: (document.getElementById('nr_priority') || {}).value || 'important',
      report_keys: reports,
      frequency: (document.getElementById('nr_frequency') || {}).value || null,
      scheduled_date: (document.getElementById('nr_date') || {}).value || null,
      send_time: ((document.getElementById('nr_time') || {}).value || '08:00').slice(0, 5),
      recipient_user_ids: users,
      email_recipients: emails,
      active: (document.getElementById('nr_active') || {}).value !== '0'
    };
    if (body.trigger_event !== 'on_schedule') {
      // frequency optional for event triggers
    } else if (!body.frequency) {
      toast('Choisissez une périodicité pour un envoi planifié.', 'error');
      return;
    }
    try {
      if (id) await api('PUT', '/notification-rules/' + id, body);
      else await Po('/notification-rules', body);
      closeM();
      toast('Règle enregistrée', 'success');
      go('notifrules');
    } catch (e) {
      toast(typeof errMsg === 'function' ? errMsg(e) : e.message, 'error');
    }
  };

  window.nrToggle = async function (id, active) {
    try {
      await api('PATCH', '/notification-rules/' + id + '/active', { active: active === true || active === 'true' });
      toast(active === true || active === 'true' ? 'Règle activée' : 'Règle désactivée', 'success');
      go('notifrules');
    } catch (e) {
      toast(typeof errMsg === 'function' ? errMsg(e) : e.message, 'error');
    }
  };

  window.nrDelete = async function (id) {
    if (!confirm('Supprimer cette règle ?')) return;
    try {
      await api('DELETE', '/notification-rules/' + id);
      toast('Règle supprimée', 'success');
      go('notifrules');
    } catch (e) {
      toast(typeof errMsg === 'function' ? errMsg(e) : e.message, 'error');
    }
  };

  V.notifrules = ['Règles notification', 'settings.edit|user.manage|report.view'];
  VM.notifrules = vNotifRules;
  if (typeof NAV_ICONS !== 'undefined') NAV_ICONS.notifrules = '📬';
})();
