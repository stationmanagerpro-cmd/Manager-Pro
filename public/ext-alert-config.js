/* Configuration moderne des alertes / notifications — champs directs + bascule Actif */
(function () {
  'use strict';
  if (typeof V === 'undefined' || typeof VM === 'undefined') return;

  var ALERT_KINDS = [
    { id: 'stock_low', label: 'Stock sous le minimum', desc: 'Quand la quantité d’un produit passe sous le seuil défini sur la fiche produit.', needsThreshold: false },
    { id: 'cash_variance', label: 'Écart de caisse', desc: 'Écart entre caisse théorique et caisse comptée.', needsThreshold: true, units: [['XOF', 'Montant (FCFA)'], ['percent', 'Pourcentage %']] },
    { id: 'shift_close', label: 'Écart à la clôture de quart', desc: 'Écart détecté à la fermeture d’un quart.', needsThreshold: true, units: [['XOF', 'Montant (FCFA)'], ['percent', 'Pourcentage %']] },
    { id: 'counter_anomaly', label: 'Compteur / jauge incohérent', desc: 'Index pompe ou jaugeage anormal.', needsThreshold: true, units: [['litres', 'Litres'], ['percent', 'Pourcentage %']] },
    { id: 'tank_variance', label: 'Écart de cuve (jaugeage)', desc: 'Stock mesuré en cuve différent du théorique (jauge d’ouverture + réceptions − litres pompés) au-delà de la tolérance de 0,5 %.', needsThreshold: false },
    { id: 'stock_anomaly', label: 'Écart de stock', desc: 'Différence inventaire / stock système.', needsThreshold: true, units: [['units', 'Unités'], ['litres', 'Litres'], ['percent', 'Pourcentage %']] },
    { id: 'purchase_variance', label: 'Écart facture fournisseur', desc: 'Écart entre commande et facture fournisseur.', needsThreshold: true, units: [['XOF', 'Montant (FCFA)'], ['percent', 'Pourcentage %']] },
    { id: 'late_arrival', label: 'Retard employé', desc: 'Retard au-delà du seuil en minutes.', needsThreshold: true, units: [['minutes', 'Minutes']] },
    { id: 'absence', label: 'Absence', desc: 'Absence signalée ou détectée.', needsThreshold: false },
    { id: 'account_inactive', label: 'Compte utilisateur inactif', desc: 'Compte sans connexion depuis X jours.', needsThreshold: true, units: [['days', 'Jours']] },
    { id: 'account_locked', label: 'Compte bloqué', desc: 'Compte verrouillé après échecs de connexion.', needsThreshold: false },
    { id: 'payroll_pending', label: 'Bulletins de paie en attente', desc: 'Paie non finalisée.', needsThreshold: false },
    { id: 'payroll_anomaly', label: 'Anomalie de paie', desc: 'Incohérence détectée sur la paie.', needsThreshold: false },
    { id: 'incident_note', label: 'Note d’incident', desc: 'Incident saisi dans le système.', needsThreshold: false },
    { id: 'license_expiring', label: 'Licence bientôt expirée', desc: 'Avertissement avant expiration du contrat.', needsThreshold: true, units: [['days', 'Jours']] },
    { id: 'backup_failure', label: 'Échec de sauvegarde', desc: 'La sauvegarde automatique a échoué.', needsThreshold: false }
  ];

  var state = { data: null };

  function canManage() {
    return typeof can === 'function' && (can('settings.edit') || can('user.manage'));
  }

  function cfgByKind(kind) {
    var list = (state.data && state.data.configs) || [];
    return list.find(function (c) { return c.alert_kind === kind; }) || null;
  }

  function unitsFor(kindMeta) {
    return kindMeta.units || [];
  }

  async function load() {
    state.data = await G('/messaging/alert-config');
    return state.data;
  }

  async function vAlertCfg() {
    if (ME && ME.is_global) {
      return '<p class="warn">La configuration des alertes station est réservée aux comptes clients.</p>';
    }
    if (!canManage()) {
      return '<p class="warn">Permission settings.edit ou user.manage requise.</p>';
    }
    try {
      await load();
    } catch (e) {
      return '<p class="warn">' + esc(e.message || 'Impossible de charger les alertes') + '</p>' +
        '<p class="muted">Vérifiez que le contrat autorise les alertes automatiques (can_use_auto_alerts).</p>';
    }
    if (state.data && state.data.enabled === false) {
      return '<p class="warn">Alertes automatiques désactivées par le contrat. Demandez à l’Administrateur Principal d’activer cette option.</p>';
    }

    var users = state.data.users || [];
    var html = '<h2 style="margin-top:0">Configuration des alertes</h2>' +
      '<p class="muted">Pour chaque type d’alerte : renseignez les champs, choisissez les destinataires, puis activez ou désactivez avec le bouton. Les modifications s’enregistrent par alerte.</p>' +
      '<div class="bar" style="flex-wrap:wrap;gap:8px">' +
      '<button class="b2" onclick="go(\'alertcfg\')">Actualiser</button>' +
      '<button class="b2" onclick="go(\'alert\')">Centre d’alertes</button>' +
      '<button class="b2" onclick="go(\'notifrules\')">Règles notification rapports</button>' +
      '<button class="b2" onclick="go(\'msg\')">Messagerie</button>' +
      '</div>';

    ALERT_KINDS.forEach(function (meta) {
      var cfg = cfgByKind(meta.id);
      var active = cfg ? !!cfg.active : false;
      var thr = cfg && cfg.threshold_value != null ? cfg.threshold_value : '';
      var unit = cfg && cfg.threshold_unit ? cfg.threshold_unit : (meta.units && meta.units[0] ? meta.units[0][0] : '');
      var notifyEmp = cfg ? !!cfg.notify_employee : true;
      var selected = new Set((cfg && cfg.copy_user_ids ? cfg.copy_user_ids : []).map(Number));
      var cardId = 'acard-' + meta.id;

      html += '<div class="alert-cfg-card' + (active ? ' is-active' : '') + '" id="' + cardId + '">' +
        '<div class="alert-cfg-head">' +
        '<div class="alert-cfg-titles"><b>' + esc(meta.label) + '</b>' +
        '<span class="muted" style="font-size:12.5px;display:block;margin-top:4px">' + esc(meta.desc) + '</span></div>' +
        '<label class="alert-toggle" title="Activer / désactiver">' +
        '<input type="checkbox" ' + (active ? 'checked' : '') + ' onchange="alertCfgToggle(\'' + meta.id + '\', this.checked)">' +
        '<span class="alert-toggle-ui"></span>' +
        '<span class="alert-toggle-label">' + (active ? 'Active' : 'Inactive') + '</span>' +
        '</label></div>';

      html += '<div class="alert-cfg-body">';
      if (meta.needsThreshold) {
        html += '<div class="g alert-cfg-fields">' +
          '<label>Seuil <input type="number" step="any" min="0" id="thr-' + meta.id + '" value="' + esc(String(thr)) + '" placeholder="Ex. 5000"></label>' +
          '<label>Unité <select id="unit-' + meta.id + '">';
        unitsFor(meta).forEach(function (u) {
          html += '<option value="' + u[0] + '"' + (u[0] === unit ? ' selected' : '') + '>' + esc(u[1]) + '</option>';
        });
        html += '</select></label></div>';
      } else {
        html += '<p class="muted" style="font-size:12px;margin:0 0 8px">Aucun seuil numérique requis pour ce type.</p>';
      }

      html += '<label class="alert-cfg-check"><input type="checkbox" id="emp-' + meta.id + '" ' + (notifyEmp ? 'checked' : '') + '> Notifier aussi l’employé concerné (si applicable)</label>';

      var chSel = new Set((cfg && cfg.channels ? cfg.channels : ['app']));
      var chInfo = (state.data && state.data.channels) || {};
      var chLab = { app: 'Application', email: 'E-mail', sms: 'SMS', whatsapp: 'WhatsApp' };
      html += '<div class="alert-cfg-recipients"><b style="font-size:13px">Canaux d’envoi</b><div class="alert-cfg-usergrid">';
      ['app', 'email', 'sms', 'whatsapp'].forEach(function (ch) {
        var info = chInfo[ch] || { available: ch === 'app' };
        html += '<label class="alert-cfg-check"' + (info.available ? '' : ' title="' + esc(info.reason || 'Indisponible') + '"') + '><input type="checkbox" class="ac-ch-' + meta.id + '" value="' + ch + '" ' +
          (chSel.has(ch) || ch === 'app' ? 'checked ' : '') + (ch === 'app' ? 'disabled ' : '') + '> ' + chLab[ch] +
          (info.available ? '' : ' <span class="muted">(désactivé : ' + esc(info.reason || 'non configuré') + ')</span>') + '</label>';
      });
      html += '</div></div>';

      html += '<div class="alert-cfg-recipients"><b style="font-size:13px">Destinataires</b>';
      if (!users.length) {
        html += '<p class="warn" style="font-size:12px">Aucun utilisateur disponible. Créez des comptes utilisateurs d’abord.</p>';
      } else {
        html += '<div class="alert-cfg-usergrid">';
        users.forEach(function (u) {
          var id = Number(u.id);
          html += '<label class="alert-cfg-check"><input type="checkbox" class="ac-rec-' + meta.id + '" value="' + id + '" ' +
            (selected.has(id) ? 'checked' : '') + '> ' + esc(u.login || u.name || ('#' + id)) +
            (u.role ? ' <span class="muted">(' + esc(u.role) + ')</span>' : '') + '</label>';
        });
        html += '</div>';
      }
      html += '</div>';

      html += '<div class="bar" style="margin-top:12px;gap:8px;flex-wrap:wrap">' +
        '<button class="b1" onclick="alertCfgSave(\'' + meta.id + '\')">Enregistrer</button>' +
        (cfg && cfg.id ? '<span class="muted" style="font-size:12px">ID config : ' + cfg.id + (cfg.updated_at ? ' · maj ' + (typeof dt === 'function' ? dt(cfg.updated_at) : cfg.updated_at) : '') + '</span>' : '') +
        '</div>';

      html += '</div></div>';
    });

    return html;
  }

  function collectRecipients(kind) {
    return Array.prototype.slice.call(document.querySelectorAll('.ac-rec-' + kind + ':checked'))
      .map(function (el) { return Number(el.value); })
      .filter(Boolean);
  }

  window.alertCfgSave = async function (kind) {
    var meta = ALERT_KINDS.find(function (x) { return x.id === kind; });
    if (!meta) return;
    var cfg = cfgByKind(kind);
    var activeEl = document.querySelector('#acard-' + kind + ' .alert-toggle input');
    var active = activeEl ? !!activeEl.checked : false;
    var body = {
      alert_kind: kind,
      station_id: null,
      notify_employee: !!(document.getElementById('emp-' + kind) || {}).checked,
      copy_user_ids: collectRecipients(kind),
      channels: ['app'].concat(Array.prototype.slice.call(document.querySelectorAll('.ac-ch-' + kind + ':checked')).map(function (el) { return el.value; }).filter(function (v) { return v !== 'app'; })),
      active: active
    };
    if (meta.needsThreshold) {
      var thrEl = document.getElementById('thr-' + kind);
      var unitEl = document.getElementById('unit-' + kind);
      var thr = thrEl ? parseFloat(thrEl.value) : null;
      body.threshold_value = Number.isFinite(thr) && thr > 0 ? thr : null;
      body.threshold_unit = unitEl ? unitEl.value : null;
    }
    try {
      await api('PUT', '/messaging/alert-config', body);
      toast('Configuration « ' + meta.label + ' » enregistrée', 'success');
      go('alertcfg');
    } catch (e) {
      toast(typeof errMsg === 'function' ? errMsg(e) : (e.message || e), 'error');
    }
  };

  window.alertCfgToggle = async function (kind, wantActive) {
    var meta = ALERT_KINDS.find(function (x) { return x.id === kind; });
    var cfg = cfgByKind(kind);
    var label = document.querySelector('#acard-' + kind + ' .alert-toggle-label');
    if (label) label.textContent = wantActive ? 'Active' : 'Inactive';
    var card = document.getElementById('acard-' + kind);
    if (card) card.classList.toggle('is-active', wantActive);

    // Si config existe → PATCH rapide
    if (cfg && cfg.id) {
      try {
        await api('PATCH', '/messaging/alert-config/' + cfg.id + '/active', { active: !!wantActive });
        toast((wantActive ? 'Activée' : 'Désactivée') + ' : ' + (meta ? meta.label : kind), 'success');
        await load();
      } catch (e) {
        // revert UI
        var input = document.querySelector('#acard-' + kind + ' .alert-toggle input');
        if (input) input.checked = !wantActive;
        if (label) label.textContent = !wantActive ? 'Active' : 'Inactive';
        if (card) card.classList.toggle('is-active', !wantActive);
        toast(typeof errMsg === 'function' ? errMsg(e) : (e.message || e), 'error');
      }
      return;
    }

    // Pas encore de config : forcer enregistrement avec les champs du formulaire
    if (wantActive) {
      toast('Renseignez les champs puis cliquez Enregistrer pour activer cette alerte.', 'info');
    }
  };

  // Remplace l’ancien modal par la page dédiée
  window.msgAlertConfigOpen = function () {
    if (typeof go === 'function') go('alertcfg');
    else toast('Ouvrez le menu Configuration des alertes', 'info');
  };

  V.alertcfg = ['Config. alertes', 'settings.edit|user.manage'];
  VM.alertcfg = vAlertCfg;
  if (typeof NAV_ICONS !== 'undefined') NAV_ICONS.alertcfg = '⚙️';
})();
