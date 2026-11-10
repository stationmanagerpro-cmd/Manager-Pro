/* Superadmin — Règles fiscales : liste, confirmation, nouvelle version de taux */
(function () {
  'use strict';
  if (typeof V === 'undefined' || typeof VM === 'undefined') return;

  const DISCLAIMER = 'Les règles non vérifiées ne doivent pas être présentées comme officielles.';

  async function vFiscalRulesAdmin() {
    if (!ME || !ME.is_global) {
      return '<p class="warn">Réservé à l’Administrateur Principal.</p>';
    }
    const d = await G('/admin/fiscal/rules');
    const rules = d.rules || [];
    const rows = rules.map(r => {
      const val = r.rule_value || {};
      const rate = val.rate != null ? val.rate + ' %' : (val.fixed_amount != null ? f(val.fixed_amount) : '—');
      const st = r.verification_status === 'verifiee'
        ? '<span class="tag ok">Vérifiée</span>'
        : '<span class="tag x">À vérifier</span>';
      const actions = r.verification_status === 'verifiee'
        ? `<button class="b2" style="font-size:12px;padding:2px 8px" onclick="fiscalUnconfirmRule(${r.id})">Retirer</button>`
        : `<button style="font-size:12px;padding:2px 8px" onclick="fiscalConfirmRule(${r.id})">Confirmer</button>`;
      return [
        esc(r.tax_code),
        esc(r.rule_key),
        'v' + r.version,
        rate,
        r.effective_from,
        r.effective_to || '∞',
        st,
        actions
      ];
    });
    return `<div>
      <h2 style="margin-top:0">Règles fiscales (paramétrage central)</h2>
      <p class="muted" style="font-size:13px">${esc(DISCLAIMER)}</p>
      <p>Une confirmation marque la règle comme <b>vérifiée</b> après contrôle juridique. Une nouvelle version de taux n’écrase jamais l’historique.</p>
      <div class="bar">
        <button onclick="fiscalNewRuleVersion()">Nouvelle version de taux</button>
        <button class="b2" onclick="go('fiscalrules')">Actualiser</button>
      </div>
      ${T(['Impôt', 'Clé', 'Version', 'Valeur', 'Début', 'Fin', 'Statut', ''], rows)}
    </div>`;
  }

  window.fiscalConfirmRule = async function (id) {
    const reason = prompt('Motif de confirmation juridique (obligatoire) :');
    if (!reason || reason.trim().length < 5) return toast('Motif trop court', 'error');
    try {
      await Po('/fiscal/rules/' + id + '/confirm', { reason: reason.trim() });
      toast('Règle confirmée', 'success');
      go('fiscalrules');
    } catch (e) { toast(e.message || 'Erreur', 'error'); }
  };

  window.fiscalUnconfirmRule = async function (id) {
    const reason = prompt('Motif du retrait de confirmation :');
    if (!reason || reason.trim().length < 5) return;
    try {
      await Po('/fiscal/rules/' + id + '/unconfirm', { reason: reason.trim() });
      toast('Confirmation retirée', 'success');
      go('fiscalrules');
    } catch (e) { toast(e.message || 'Erreur', 'error'); }
  };

  window.fiscalNewRuleVersion = function () {
    form('Nouvelle version de règle fiscale', [
      ['tax_code', 'Code impôt', 's', [
        ['tva', 'TVA'], ['synthetique', 'Synthétique'], ['ibic', 'IBIC'], ['is', 'IS'],
        ['cfe', 'CFE'], ['tfp', 'TFP'], ['its', 'ITS']
      ]],
      ['rule_key', 'Clé', 's', [
        ['standard_rate', 'standard_rate (TVA)'],
        ['rate', 'rate'],
        ['rate_or_amount', 'rate_or_amount (synthétique)']
      ]],
      ['rate', 'Taux (%)', 'number'],
      ['fixed_amount', 'OU montant forfaitaire', 'number'],
      ['label', 'Libellé'],
      ['effective_from', 'Valide à partir du', 'date'],
      ['effective_to', 'Valide jusqu’au (optionnel)', 'date'],
      ['legal_source', 'Source officielle'],
      ['legal_reference', 'Référence juridique'],
      ['notes', 'Notes']
    ], { rule_key: 'rate', effective_from: new Date().toISOString().slice(0, 10) }, async d => {
      const body = {
        tax_code: d.tax_code,
        rule_key: d.rule_key,
        effective_from: d.effective_from,
        effective_to: d.effective_to || null,
        legal_source: d.legal_source || null,
        legal_reference: d.legal_reference || null,
        notes: d.notes || null,
        label: d.label || null
      };
      if (d.rate !== '' && d.rate != null) body.rate = Number(d.rate);
      if (d.fixed_amount !== '' && d.fixed_amount != null) body.fixed_amount = Number(d.fixed_amount);
      await Po('/admin/fiscal/rules/new-version', body);
      closeM();
      toast('Version créée (à vérifier)', 'success');
      go('fiscalrules');
    });
  };

  // ---------- Dashboard consolidé multi-clients (Lot 5) ----------
  async function vFiscalOverviewAdmin() {
    if (!ME || !ME.is_global) {
      return '<p class="warn">Réservé à l’Administrateur Principal.</p>';
    }
    const d = await G('/admin/fiscal/overview');
    const s = d.summary || {};
    const cards = `
      <div class="cards">
        <div class="card kpi-card"><div class="card-body"><small>Clients</small><b>${s.clients_total || 0}</b></div></div>
        <div class="card kpi-card"><div class="card-body"><small>Fiscalité autorisée</small><b>${s.fiscal_enabled || 0}</b></div></div>
        <div class="card kpi-card"><div class="card-body"><small>Profils incomplets</small><b>${s.profiles_incomplete || 0}</b></div></div>
        <div class="card kpi-card"><div class="card-body"><small>Échéances ≤ 7 j</small><b>${s.deadlines_upcoming || 0}</b></div></div>
        <div class="card kpi-card"><div class="card-body"><small>Échéances dépassées</small><b>${s.deadlines_overdue || 0}</b></div></div>
      </div>`;
    const rows = (d.clients || []).map(c => [
      esc(c.name),
      c.fiscal_authorized ? '<span class="tag ok">Oui</span>' : '<span class="tag">Non</span>',
      esc(c.profile_status || '—'),
      esc(c.declared_regime || '—'),
      esc(c.nif || '—'),
      (c.modules_active || []).join(', ') || '—',
      `${c.periods_ready || 0}/${c.periods || 0}`,
      c.deadlines_overdue ? `<span class="tag x">${c.deadlines_overdue}</span>` : String(c.deadlines_upcoming || 0),
      c.checklist_total ? `${c.checklist_done}/${c.checklist_total}` : '—'
    ]);
    return `<div>
      <h2 style="margin-top:0">Pilotage fiscal multi-clients</h2>
      <p class="muted" style="font-size:13px">${esc(d.disclaimer || DISCLAIMER)}</p>
      ${cards}
      <div class="bar" style="margin-top:12px">
        <button class="b2" onclick="go('fiscalrules')">Règles fiscales</button>
        <button class="b2" onclick="go('fiscaloverview')">Actualiser</button>
      </div>
      ${T(['Client', 'Fiscalité', 'Profil', 'Régime', 'NIF', 'Modules actifs', 'Périodes prêtes', 'Échéances', 'Pièces'], rows)}
    </div>`;
  }

  // Correctif rôles : Superadmin = licences + autorisations contrat uniquement.
  // Pas de menu « Règles fiscales » / « Pilotage fiscal multi-clients ».
  // Les handlers ci-dessus restent disponibles si réactivation product owner plus tard.
})();
