/* Module Fiscalité — parcours guidé 4 étapes + tableau de bord dynamique
   Visible uniquement si contrat.can_access_fiscal / module:fiscal autorisé.
   Aucune donnée fictive. Estimations toujours accompagnées du disclaimer. */
(function () {
  'use strict';
  if (typeof V === 'undefined' || typeof VM === 'undefined') return;

  // Échappement HTML d'une valeur éventuellement vide (escv n'existait que dans ext-detail-pages.js, hors de portée ici)
  const escv = v => esc(v == null ? '' : String(v));

  const DISCLAIMER = 'Les montants sont des estimations indicatives. Ils ne constituent ni une déclaration officielle ni un avis de la DGI. Faites valider par un professionnel habilité.';

  // Aucun message de refus : un utilisateur ne voit que ce qui lui est permis. Si l'accès Fiscalité n'est pas ouvert
  // (contrat ou rôle), le menu est déjà masqué ; en accès direct on revient silencieusement à la vue autorisée.
  function fiscalDeniedHtml() {
    setTimeout(function () { try { go(typeof defaultView === 'function' ? defaultView() : 'dash'); } catch (e) { /* ignoré */ } }, 0);
    return '';
  }

  function fiscalAllowed() {
    try {
      // `ME` est déclaré avec `let` dans app.js : il n'existe PAS comme propriété de l'objet window.
      // Il faut donc lire la variable globale lexicale directement (l'ancienne lecture via window était toujours undefined).
      const me = (typeof ME !== 'undefined' && ME) ? ME : null;
      if (!me) return false;
      if (me.is_global) return false;
      const f = (me.contract && me.contract.features) || {};
      const truthy = (v) => v === true || v === 'true' || v === 1 || v === '1';
      const modules = f.modules || {};
      const fiscalSubmoduleOn = Object.entries(modules).some(([name, value]) =>
        name.startsWith('fiscal_') && truthy(value)
      );
      const contractAllowed = !!(me.contract && me.contract.unrestricted)
        || truthy(f.can_access_fiscal) || truthy(modules.fiscal) || fiscalSubmoduleOn;
      return Array.isArray(me.permissions) && me.permissions.includes('fiscal.access') && contractAllowed;
    } catch (e) { return false; }
  }

  // ---------- Étape 1 : Profil entreprise ----------
  async function vFiscalProfile() {
    if (!fiscalAllowed()) return fiscalDeniedHtml();
    const d = await G('/fiscal/profile');
    const p = d.profile || {};
    return `<div class="card">
      <h2 style="margin-top:0">1. Mon entreprise et mon régime fiscal</h2>
      <p class="muted" style="font-size:13px">${esc(DISCLAIMER)}</p>
      <form onsubmit="return saveFiscalProfile(event)">
        <div class="detail-grid">
          <label>Raison sociale<input name="legal_name" value="${escv(p.legal_name || '')}"></label>
          <label>Nom commercial<input name="trade_name" value="${escv(p.trade_name || '')}"></label>
          <label>Forme juridique<input name="legal_form" value="${escv(p.legal_form || '')}" placeholder="SARL, SA, EI…"></label>
          <label>NIF<input name="nif" value="${escv(p.nif || '')}"></label>
          <label>Secteur d’activité<input name="activity_sector" value="${escv(p.activity_sector || '')}"></label>
          <label>Activité principale<input name="main_activity" value="${escv(p.main_activity || '')}"></label>
          <label>Adresse<input name="address" value="${escv(p.address || '')}"></label>
          <label>Ville<input name="city" value="${escv(p.city || '')}"></label>
          <label>Centre des impôts<input name="tax_center" value="${escv(p.tax_center || '')}"></label>
          <label>Date début d’activité<input name="activity_start_date" type="date" value="${escv(p.activity_start_date || '')}"></label>
          <label>Régime déclaré
            <select name="declared_regime">
              <option value="">— Choisir —</option>
              ${['synthetique','reel_simplifie','reel_normal','IS','autre'].map(r =>
                `<option value="${r}" ${p.declared_regime===r?'selected':''}>${r}</option>`).join('')}
            </select>
          </label>
          <label>Statut immatriculation
            <select name="registration_status">
              ${['a_completer','en_cours','valide','a_verifier'].map(s =>
                `<option value="${s}" ${(p.registration_status||'a_completer')===s?'selected':''}>${s}</option>`).join('')}
            </select>
          </label>
          <label>CA annuel estimé (FCFA)<input name="estimated_annual_ca" type="number" min="0" step="1" value="${p.estimated_annual_ca != null ? p.estimated_annual_ca : ''}"></label>
          <label>CA exercice en cours<input name="current_year_ca" type="number" min="0" step="1" value="${p.current_year_ca != null ? p.current_year_ca : ''}"></label>
          <label>Nombre d’employés<input name="employee_count" type="number" min="0" value="${p.employee_count != null ? p.employee_count : ''}"></label>
          <label>Notes<textarea name="notes" rows="2">${escv(p.notes || '')}</textarea></label>
        </div>
        <div class="detail-actions" style="margin-top:14px">
          <button type="submit">Enregistrer le profil</button>
          <button type="button" class="b2" onclick="go('fiscal2')">Étape suivante → Modules</button>
          <button type="button" class="b2" onclick="typeof dlFile==='function'&&dlFile('/fiscal/profile.pdf','fiscal-profil')">PDF profil</button>
        </div>
      </form>
    </div>`;
  }

  window.saveFiscalProfile = async function (ev) {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const body = {};
    for (const [k, v] of fd.entries()) {
      if (v === '') body[k] = null;
      else if (['estimated_annual_ca','current_year_ca','employee_count'].includes(k)) body[k] = Number(v);
      else body[k] = v;
    }
    body.has_employees = (body.employee_count || 0) > 0;
    try {
      await api('PUT', '/fiscal/profile', body);
      toast('Profil fiscal enregistré', 'success');
      go('fiscal');
    } catch (e) { toast(e.message || 'Erreur', 'error'); }
    return false;
  };

  // ---------- Étape 2 : Choix des modules ----------
  async function vFiscalModules() {
    if (!fiscalAllowed()) return fiscalDeniedHtml();
    const d = await G('/fiscal/modules');
    const cards = (d.modules || []).map(m => {
      const badge = m.allowed_by_superadmin
        ? (m.activated_by_client ? `<span class="tag ok">Activé · paramètres v${esc(m.settings_version)}</span>`
          : (m.needs_wizard ? '<span class="tag x">À reconfirmer (aucun calcul)</span>' : '<span class="tag">Module non activé</span>'))
        : '<span class="tag x">Non autorisé</span>';
      const btn = m.allowed_by_superadmin
        ? (m.activated_by_client
          ? `<button onclick="fiscalWizardOpen('${m.code}')">Paramètres</button> <button class="b2" onclick="fiscalWizardHistory('${m.code}')">Historique</button> <button class="b2" onclick="fiscalDeact('${m.code}')">Désactiver</button>`
          : `<button onclick="fiscalWizardOpen('${m.code}')">${m.needs_wizard ? 'Confirmer les paramètres' : 'Activer avec l’assistant'}</button>`)
        : '';
      return `<div class="card" style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <h3 style="margin:0">${esc(m.label)}</h3>${badge}
        </div>
        <p style="margin:8px 0;font-size:13px">${esc(m.desc)}</p>
        ${btn}
      </div>`;
    }).join('');
    return `<div>
      <h2 style="margin-top:0">2. Diagnostic et choix des modules</h2>
      <p class="muted" style="font-size:13px">${esc(d.disclaimer || DISCLAIMER)}</p>
      <p>Seuls les modules autorisés par l’Administrateur Principal peuvent être activés. L’activation n’équivaut pas à une obligation légale confirmée.</p>
      ${cards}
      <div class="detail-actions" style="margin-top:12px">
        <button class="b2" onclick="go('fiscal')">← Profil</button>
        <button class="b2" onclick="go('fiscal3')">Étape suivante → Périodes</button>
        <button class="b2" onclick="go('fiscaldash')">Tableau de bord fiscal</button>
      </div>
    </div>`;
  }

  window.fiscalAct = async function (code) {
    try {
      await Po('/fiscal/modules/' + code + '/activate', {});
      toast('Module activé', 'success');
      go('fiscal2');
    } catch (e) { toast(e.message || 'Erreur', 'error'); }
  };
  window.fiscalDeact = async function (code) {
    if (!confirm('Désactiver ce module ? Les données déjà saisies sont conservées.')) return;
    try {
      await Po('/fiscal/modules/' + code + '/deactivate', {});
      toast('Module désactivé', 'success');
      go('fiscal2');
    } catch (e) { toast(e.message || 'Erreur', 'error'); }
  };

  // ---------- Étape 3 : Périodes + formulaires conditionnels + estimation ----------
  async function vFiscalPeriods() {
    if (!fiscalAllowed()) return fiscalDeniedHtml();
    const filtMod = window._fiscalFiltMod || '';
    const filtSt = window._fiscalFiltSt || '';
    const filtFrom = window._fiscalFiltFrom || '';
    const filtTo = window._fiscalFiltTo || '';
    const filtQ = window._fiscalFiltQ || '';
    const filtTag = window._fiscalFiltTag || '';
    const qs = [];
    if (filtMod) qs.push('module=' + encodeURIComponent(filtMod));
    if (filtSt) qs.push('status=' + encodeURIComponent(filtSt));
    if (filtFrom) qs.push('from=' + encodeURIComponent(filtFrom));
    if (filtTo) qs.push('to=' + encodeURIComponent(filtTo));
    if (filtQ) qs.push('q=' + encodeURIComponent(filtQ));
    if (filtTag) qs.push('tag=' + encodeURIComponent(filtTag));
    if (window._fiscalFiltPinned) qs.push('pinned=1');
    const [mods, per] = await Promise.all([
      G('/fiscal/modules'),
      G('/fiscal/periods' + (qs.length ? '?' + qs.join('&') : ''))
    ]);
    const active = (mods.modules || []).filter(m => m.activated_by_client);
    window._fiscalPeriods = per.periods || [];
    let list = per.periods || [];
    const rows = list.map(p => {
      const est = p.estimates && typeof p.estimates === 'object' ? p.estimates : null;
      let estLabel = '—';
      if (est && est.module_not_activated) {
        estLabel = '<span class="tag x">Module non activé</span>';
      } else if (est) {
        if (est.tva_nette_estimee != null) estLabel = f(est.tva_nette_estimee);
        else if (est.solde_estime != null) estLabel = f(est.solde_estime);
        else if (est.estimation != null) estLabel = f(est.estimation);
        else if (est.total_its != null) estLabel = f(est.total_its);
        else if (Object.keys(est).length) estLabel = 'Voir';
      }
      const tags = (p.data && Array.isArray(p.data.tags) ? p.data.tags : []).map(t =>
        `<span class="tag">${esc(t)}</span>`
      ).join(' ');
      const pin = p.data && p.data.pinned ? '📌 ' : '';
      return [
        `<label><input type="checkbox" class="fiscal-arch-cb" value="${p.id}"> ${pin}${esc(p.module_code)}</label> ${tags}`,
        p.period_start,
        p.period_end,
        `<span class="tag">${esc(p.status)}</span>`,
        estLabel,
        `<button class="b2" style="padding:2px 8px;font-size:12px" onclick="openFiscalPeriod(${p.id})">Ouvrir</button>
         <button class="b2" style="padding:2px 8px;font-size:12px" onclick="fiscalShowDetail(${p.id})">Fiche</button>
         <button class="b2" style="padding:2px 8px;font-size:12px" onclick="typeof dlFile==='function'&&dlFile('/fiscal/periods/${p.id}/pdf','fiscal-${p.module_code}-${p.period_start}')">PDF</button>
         <button class="b2" style="padding:2px 8px;font-size:12px" onclick="typeof dlFile==='function'&&dlFile('/fiscal/periods/${p.id}/export.xlsx','fiscal-p-${p.id}')">XLS</button>
         <button class="b2" style="padding:2px 8px;font-size:12px" onclick="window._fiscalCheckId=${p.id};go('fiscalcheck')">Pièces</button>
         <button class="b2" style="padding:2px 8px;font-size:12px" onclick="fiscalMarkReady(${p.id})">Prêt</button>
         <button class="b2" style="padding:2px 8px;font-size:12px" onclick="fiscalRecalculate(${p.id})">Recalc</button>
         <button class="b2" style="padding:2px 8px;font-size:12px" onclick="fiscalValidateInternal(${p.id})">Valider</button>
         <button class="b2" style="padding:2px 8px;font-size:12px" onclick="fiscalReopenPeriod(${p.id})">Rouvrir</button>
         <button class="b2" style="padding:2px 8px;font-size:12px" onclick="fiscalClonePeriod(${p.id})">Cloner</button>
         <button class="b2" style="padding:2px 8px;font-size:12px" onclick="fiscalAddNote(${p.id})">Note</button>
         <button class="b2" style="padding:2px 8px;font-size:12px" onclick="fiscalSetTags(${p.id})">Tags</button>
         <button class="b2" style="padding:2px 8px;font-size:12px" onclick="fiscalTogglePin(${p.id})">${p.data && p.data.pinned ? 'Désépingler' : 'Épingler'}</button>
         <button class="b2" style="padding:2px 8px;font-size:12px" onclick="typeof dlFile==='function'&&dlFile('/fiscal/periods/${p.id}/documents.zip','pieces-${p.id}')">ZIP</button>`
      ];
    });
    const modOpts = ['<option value="">Tous modules</option>']
      .concat((active.length ? active : (mods.modules || [])).map(m =>
        `<option value="${esc(m.code)}" ${filtMod === m.code ? 'selected' : ''}>${esc(m.code)}</option>`));
    const stOpts = ['', 'brouillon', 'a_completer', 'pret', 'valide_interne', 'archive']
      .map(s => `<option value="${s}" ${filtSt === s ? 'selected' : ''}>${s || 'Tous statuts'}</option>`);
    return `<div>
      <h2 style="margin-top:0">3. Périodes fiscales</h2>
      <p class="muted" style="font-size:13px">${esc(DISCLAIMER)}</p>
      ${active.length ? `<div class="bar">
        <button onclick="newFiscalPeriod()">Nouvelle période</button>
        <button class="b2" onclick="go('fiscaldl')">Échéances</button>
        <button class="b2" onclick="typeof dlFile==='function'&&dlFile('/fiscal/export.xlsx','fiscal-periodes')">Export Excel</button>
        <button class="b2" onclick="fiscalBulkArchive()">Archiver sélection</button>
        <button class="b2" onclick="fiscalBulkReady()">Prêt sélection</button>
        <button class="b2" onclick="fiscalBulkExportXls()">Export sélection XLS</button>
      </div>
      <div class="bar" style="margin-top:6px">
        <select id="fiscalFiltMod" onchange="window._fiscalFiltMod=this.value;go('fiscal3')">${modOpts.join('')}</select>
        <select id="fiscalFiltSt" onchange="window._fiscalFiltSt=this.value;go('fiscal3')">${stOpts.join('')}</select>
        <input type="date" value="${esc(filtFrom)}" title="Début ≥" onchange="window._fiscalFiltFrom=this.value;go('fiscal3')">
        <input type="date" value="${esc(filtTo)}" title="Fin ≤" onchange="window._fiscalFiltTo=this.value;go('fiscal3')">
        <input type="search" placeholder="Recherche notes…" value="${esc(filtQ)}"
          onchange="window._fiscalFiltQ=this.value;go('fiscal3')" style="min-width:120px">
        <input type="text" placeholder="Tag" value="${esc(filtTag)}"
          onchange="window._fiscalFiltTag=this.value;go('fiscal3')" style="width:90px">
        <label style="font-size:12px;margin-left:6px"><input type="checkbox" ${window._fiscalFiltPinned ? 'checked' : ''}
          onchange="window._fiscalFiltPinned=this.checked;go('fiscal3')"> Épinglées</label>
        <button class="b2" onclick="fiscalComparePrompt()">Comparer 2 périodes</button>
      </div>` : '<p class="warn">Activez au moins un module (étape 2) avant de créer une période.</p>'}
      ${T(['Module', 'Début', 'Fin', 'Statut', 'Estimation', ''], rows)}
      <div class="detail-actions" style="margin-top:12px">
        <button class="b2" onclick="go('fiscal2')">← Modules</button>
        <button class="b2" onclick="go('fiscaldash')">Tableau de bord →</button>
      </div>
    </div>`;
  }

  window.newFiscalPeriod = async function () {
    const mods = await G('/fiscal/modules');
    const opts = (mods.modules || []).filter(m => m.activated_by_client).map(m => [m.code, m.label]);
    if (!opts.length) return toast('Aucun module activé', 'error');
    let defaults = { period_type: 'month', module_code: opts[0][0] };
    try {
      const sug = await G('/fiscal/periods/suggest-next?module=' + encodeURIComponent(opts[0][0]));
      if (sug.suggestion) {
        defaults.period_type = sug.suggestion.period_type || 'month';
        defaults.period_start = sug.suggestion.period_start;
        defaults.period_end = sug.suggestion.period_end;
      }
    } catch (_) {}
    form('Nouvelle période fiscale', [
      ['module_code', 'Module', 's', opts],
      ['period_type', 'Type', 's', [['month','Mois'],['quarter','Trimestre'],['year','Année'],['custom','Personnalisé']]],
      ['period_start', 'Début', 'date'],
      ['period_end', 'Fin', 'date'],
      ['notes', 'Notes']
    ], defaults, async d => {
      const r = await Po('/fiscal/periods', d);
      closeM();
      if (r.warnings && r.warnings.length) toast(r.warnings.join(' · '), 'error');
      else toast('Période créée (brouillon)', 'success');
      go('fiscal3');
    });
  };

  /** Formulaire conditionnel selon le module */
  function fiscalFormFields(moduleCode, data) {
    data = data || {};
    if (moduleCode === 'tva') {
      return [
        ['tva_deductible', 'TVA déductible admissible (saisie manuelle)', 'number'],
        ['purchases_with_vat', 'OU montant achats TTC (approx. déductible)', 'number'],
        ['credit_anterieur', 'Crédit de TVA antérieur', 'number'],
        ['regularisations', 'Régularisations (+ ou −)', 'number']
      ];
    }
    if (moduleCode === 'ibic' || moduleCode === 'is') {
      return [
        ['chiffre_affaires', 'Chiffre d’affaires (laisser vide = ventes enregistrées)', 'number'],
        ['charges_deductibles', 'Charges professionnelles déductibles', 'number'],
        ['charges_non_deductibles', 'Charges non déductibles', 'number'],
        ['amortissements', 'Amortissements', 'number'],
        ['deficits_anterieurs', 'Déficits antérieurs imputables', 'number'],
        ['acomptes', 'Acomptes déjà versés', 'number']
      ];
    }
    if (moduleCode === 'synthetique') {
      return [
        ['chiffre_affaires', 'CA de référence (laisser vide = ventes)', 'number'],
        ['montants_payes', 'Montants déjà payés', 'number']
      ];
    }
    if (moduleCode === 'its') {
      return []; // calcul auto depuis RH
    }
    if (moduleCode === 'cfe' || moduleCode === 'tfp') {
      return [
        ['masse_salariale', 'Masse salariale (vide = bulletins RH)', 'number'],
        ['montants_payes', 'Montants déjà payés', 'number']
      ];
    }
    if (moduleCode === 'logement' || moduleCode === 'retenues' || moduleCode === 'autres') {
      return [
        ['base_imposable', 'Base imposable (optionnel)', 'number'],
        ['taux', 'Taux % (optionnel)', 'number'],
        ['montant_fixe', 'OU montant fixe estimé', 'number'],
        ['montants_payes', 'Montants déjà payés', 'number']
      ];
    }
    return [['notes_data', 'Notes / données complémentaires']];
  }

  window.openFiscalPeriod = async function (id) {
    const list = window._fiscalPeriods || [];
    let p = list.find(x => x.id == id);
    if (!p) {
      const all = await G('/fiscal/periods');
      p = (all.periods || []).find(x => x.id == id);
    }
    if (!p) return toast('Période introuvable', 'error');
    const data = p.data || {};
    const fields = fiscalFormFields(p.module_code, data);
    const defaults = { ...data };
    fields.forEach(([k]) => { if (defaults[k] == null) defaults[k] = ''; });
    const extra = fields.length
      ? fields
      : [['_info', 'Info', 's', [['ok', 'Estimation automatique depuis les bulletins RH']]]];

    form(
      `Période ${p.module_code.toUpperCase()} · ${p.period_start} → ${p.period_end}`,
      [
        ...extra,
        ['status', 'Statut', 's', [['brouillon','Brouillon'],['a_completer','À compléter'],['pret','Prêt (revue humaine)'],['valide_interne','Validé en interne'],['archive','Archivé']]],
        ['notes', 'Notes']
      ],
      { ...defaults, status: p.status, notes: p.notes || '' },
      async d => {
        const payload = { data: {}, status: d.status, notes: d.notes, run_estimate: true };
        for (const [k] of fields) {
          if (d[k] !== undefined && d[k] !== '') {
            payload.data[k] = ['tva_deductible','purchases_with_vat','credit_anterieur','regularisations',
              'chiffre_affaires','charges_deductibles','charges_non_deductibles','amortissements',
              'deficits_anterieurs','acomptes','montants_payes','masse_salariale',
              'base_imposable','taux','montant_fixe','estimation'].includes(k) ? Number(d[k]) : d[k];
          }
        }
        try {
          const res = await api('PATCH', '/fiscal/periods/' + id, payload);
          closeM();
          const est = res.period && res.period.estimates;
          if (est && est.warnings && est.warnings.length) {
            toast('Estimation calculée — voir avertissements', 'info');
          } else {
            toast('Période mise à jour + estimation', 'success');
          }
          // Afficher le résultat
          showFiscalEstimate(est || res);
          go('fiscal3');
        } catch (e) { toast(e.message || 'Erreur', 'error'); }
      }
    );
  };

  function showFiscalEstimate(est) {
    if (!est || typeof est !== 'object') return;
    if (est.module_not_activated) { toast('Module non activé : aucun montant. Activez-le avec l’assistant (Étape 2).', 'error'); return; }
    let html = `<div class="card" style="margin:12px 0"><h3>Résultat de l’estimation</h3>`;
    html += `<p class="muted" style="font-size:12px">${esc(est.disclaimer || DISCLAIMER)}</p>`;
    if (est.tva_nette_estimee != null) {
      html += `<p><b>TVA nette estimée :</b> ${f(est.tva_nette_estimee)}</p>
        <p>Collectée : ${f(est.sales && est.sales.tva_collected)} · Déductible est. : ${f(est.purchases && est.purchases.tva_deductible_estimated)}</p>
        <p>${esc(est.interpretation || '')}</p>`;
    } else if (est.solde_estime != null) {
      html += `<p><b>Solde ${esc((est.module||'').toUpperCase())} estimé :</b> ${f(est.solde_estime)}</p>
        <p>Résultat fiscal : ${f(est.resultat_fiscal)} · Impôt brut : ${f(est.impot_brut_estime)}</p>`;
    } else if (est.estimation != null) {
      html += `<p><b>Estimation synthétique :</b> ${f(est.estimation)} · Reste : ${f(est.reste_estime)}</p>`;
    } else if (est.total_its != null) {
      html += `<p><b>ITS (depuis bulletins RH) :</b> ${f(est.total_its)} (${est.bulletin_count || 0} bulletin(s))</p>`;
    } else if (est.part_salariale != null) {
      html += `<p><b>${esc((est.module || '').toUpperCase())} estimé :</b> ${f(est.estimation)} · part salariale ${f(est.part_salariale)} · part employeur ${f(est.part_employeur)} (${est.bulletin_count || 0} bulletin(s))</p>`;
    } else if (est.masse_salariale != null) {
      html += `<p><b>${esc((est.module || '').toUpperCase())} estimé :</b> ${f(est.estimation)} · Reste : ${f(est.reste_estime)}</p>
        <p>Masse salariale : ${f(est.masse_salariale)} · Taux : ${est.taux_applique != null ? est.taux_applique + ' %' : '—'}</p>`;
    }
    if (est.minimum_applique) html += `<p><b>Impôt minimum forfaitaire appliqué :</b> ${f(est.impot_minimum_forfaitaire)} (impôt au taux normal : ${f(est.impot_au_taux_normal)})</p>`;
    if (est.seuil_depasse) html += `<p style="color:#d33"><b>Seuil du régime dépassé</b> (${f(est.seuil_regime)}) : examiner le régime réel.</p>`;
    if (est.purchases && est.purchases.deductible_calculable === false) html += `<p style="color:#d33"><b>TVA déductible non calculable</b> : la TVA nette est probablement surestimée.</p>`;
    if (est.ecart_base && est.ecart_base.ecart) html += `<p>Écart de base TVA (compteurs de pompes / lignes de vente) : ${f(est.ecart_base.ecart)} — TVA potentielle ${f(est.ecart_base.tva_potentielle_sur_ecart)} ${est.ecart_base.inclus_dans_le_calcul ? '(incluse)' : '(non incluse)'}</p>`;
    if (est.rule_used && est.rule_used.kind === 'parametres') html += `<p class="muted" style="font-size:12px">Paramètres v${esc(est.rule_used.version)} · jeu de référence ${esc(est.rule_used.dataset_version)} · effet ${esc(est.rule_used.effective_from || '—')}${(est.rule_used.customized || []).length ? ' · <b>valeurs personnalisées : ' + est.rule_used.customized.map(esc).join(', ') + '</b>' : ' · valeurs de référence'}</p>`;
    if (est.warnings && est.warnings.length) {
      html += `<ul style="color:var(--warn,#b45309)">${est.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>`;
    }
    html += `</div>`;
    // Toast long ou injection temporaire
    const box = document.createElement('div');
    box.innerHTML = html;
    box.style.cssText = 'position:fixed;bottom:20px;right:20px;max-width:420px;z-index:9999;background:var(--card,#fff);box-shadow:0 8px 24px rgba(0,0,0,.15);border-radius:8px;padding:4px';
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 12000);
  }

  // ---------- Échéances ----------
  async function vFiscalDeadlines() {
    if (!fiscalAllowed()) return fiscalDeniedHtml();
    const d = await G('/fiscal/deadlines');
    const rows = (d.deadlines || []).map(x => [
      esc(x.module_code), esc(x.title), x.due_date,
      `<span class="tag">${esc(x.status)}</span>`,
      esc(x.source || ''),
      `<button class="b2" style="padding:2px 8px;font-size:12px" onclick="markDeadline(${x.id},'termine')">OK</button>
       <button class="b2" style="padding:2px 8px;font-size:12px" onclick="markDeadline(${x.id},'depasse')">Dépassé</button>`
    ]);
    return `<div>
      <h2 style="margin-top:0">Échéances fiscales</h2>
      <p class="muted" style="font-size:13px">${esc(DISCLAIMER)}</p>
      <div class="bar">
        <button onclick="newFiscalDeadline()">Ajouter une échéance</button>
        <button class="b2" onclick="fiscalGenerateYearDeadlines()">Générer année (mensuel)</button>
        <button class="b2" onclick="fiscalRefreshDeadlines()">Actualiser statuts</button>
        <button class="b2" onclick="go('fiscalrulesview')">Règles applicables</button>
        <button class="b2" onclick="go('fiscal3')">← Périodes</button>
      </div>
      ${T(['Module', 'Titre', 'Date limite', 'Statut', 'Source', ''], rows)}
    </div>`;
  }

  window.fiscalRefreshDeadlines = async function () {
    try {
      const r = await Po('/fiscal/deadlines/refresh', {});
      toast(r.message || 'Échéances actualisées', 'success');
      go('fiscaldl');
    } catch (e) { toast(e.message || 'Erreur', 'error'); }
  };

  window.fiscalGenerateYearDeadlines = function () {
    const y = new Date().getFullYear();
    form('Générer un calendrier annuel', [
      ['year', 'Année', 'number'],
      ['module_code', 'Module', 's', [['tva','TVA'],['synthetique','Synthétique'],['ibic','IBIC'],['is','IS'],['its','ITS'],['cfe','CFE'],['tfp','TFP']]],
      ['day_of_month', 'Jour du mois (1–28)', 'number'],
      ['title_prefix', 'Préfixe du titre']
    ], { year: y, module_code: 'tva', day_of_month: 15 }, async d => {
      d.year = Number(d.year);
      d.day_of_month = Number(d.day_of_month) || 15;
      const r = await Po('/fiscal/deadlines/generate-year', d);
      closeM();
      toast(r.message || 'Échéances créées', 'success');
      go('fiscaldl');
    });
  };

  window.newFiscalDeadline = function () {
    form('Nouvelle échéance', [
      ['module_code', 'Module', 's', [['tva','TVA'],['synthetique','Synthétique'],['ibic','IBIC'],['is','IS'],['its','ITS'],['cfe','CFE'],['tfp','TFP'],['autres','Autres']]],
      ['title', 'Titre'],
      ['due_date', 'Date limite', 'date'],
      ['period_label', 'Période concernée'],
      ['source', 'Source', 's', [['interne','Interne'],['reglementaire','Réglementaire'],['parametre','Paramètre']]],
      ['legal_reference', 'Référence légale (si connue)'],
      ['notes', 'Notes']
    ], { source: 'interne' }, async d => {
      await Po('/fiscal/deadlines', d);
      closeM();
      toast('Échéance ajoutée', 'success');
      go('fiscaldl');
    });
  };

  window.markDeadline = async function (id, status) {
    try {
      await api('PATCH', '/fiscal/deadlines/' + id, { status });
      toast('Statut mis à jour', 'success');
      go('fiscaldl');
    } catch (e) { toast(e.message || 'Erreur', 'error'); }
  };

  window.fiscalMarkReady = async function (id) {
    try {
      const r = await Po('/fiscal/periods/' + id + '/mark-ready', {});
      toast(r.message || 'Période prête (revue interne)', 'success');
      go('fiscal3');
    } catch (e) { toast(e.message || 'Impossible : complétez les pièces requises', 'error'); }
  };

  window.fiscalValidateInternal = async function (id) {
    try {
      const r = await Po('/fiscal/periods/' + id + '/validate-internal', {});
      toast(r.message || 'Validé en interne', 'success');
      go('fiscal3');
    } catch (e) { toast(e.message || 'Passez d’abord la période en « Prêt »', 'error'); }
  };

  window.fiscalClonePeriod = function (id) {
    form('Cloner la période', [
      ['period_start', 'Nouveau début', 'date'],
      ['period_end', 'Nouvelle fin', 'date'],
      ['period_type', 'Type', 's', [['month','Mois'],['quarter','Trimestre'],['year','Année'],['custom','Personnalisé']]]
    ], {}, async d => {
      await Po('/fiscal/periods/' + id + '/clone', d);
      closeM();
      toast('Période clonée (brouillon)', 'success');
      go('fiscal3');
    });
  };

  window.fiscalReopenPeriod = async function (id) {
    const reason = prompt('Motif de réouverture (optionnel) :') || undefined;
    try {
      const r = await Po('/fiscal/periods/' + id + '/reopen', reason ? { reason } : {});
      toast(r.message || 'Période rouverte', 'success');
      go('fiscal3');
    } catch (e) { toast(e.message || 'Réouverture impossible', 'error'); }
  };

  window.fiscalBulkArchive = async function () {
    const ids = Array.from(document.querySelectorAll('.fiscal-arch-cb:checked')).map(el => Number(el.value)).filter(Boolean);
    if (!ids.length) return toast('Sélectionnez au moins une période', 'error');
    if (!confirm('Archiver ' + ids.length + ' période(s) ?')) return;
    try {
      const r = await Po('/fiscal/periods/bulk-archive', { ids });
      toast((r.archived || 0) + ' période(s) archivée(s)', 'success');
      go('fiscal3');
    } catch (e) { toast(e.message || 'Erreur', 'error'); }
  };

  window.fiscalBulkReady = async function () {
    const ids = Array.from(document.querySelectorAll('.fiscal-arch-cb:checked')).map(el => Number(el.value)).filter(Boolean);
    if (!ids.length) return toast('Sélectionnez au moins une période', 'error');
    if (!confirm('Marquer « prêt » ' + ids.length + ' période(s) ? (checklist requise)')) return;
    try {
      const r = await Po('/fiscal/periods/bulk-ready', { ids });
      toast((r.ready || 0) + ' prête(s), ' + (r.failed || 0) + ' échec(s)', r.failed ? 'error' : 'success');
      go('fiscal3');
    } catch (e) { toast(e.message || 'Erreur', 'error'); }
  };

  window.fiscalRecalculate = async function (id) {
    try {
      await Po('/fiscal/periods/' + id + '/recalculate', {});
      toast('Estimation recalculée', 'success');
      go('fiscal3');
    } catch (e) { toast(e.message || 'Recalcul impossible', 'error'); }
  };

  window.fiscalAddNote = async function (id) {
    const text = prompt('Note à ajouter sur la période :');
    if (!text || !text.trim()) return;
    try {
      await Po('/fiscal/periods/' + id + '/notes', { text: text.trim() });
      toast('Note enregistrée', 'success');
      go('fiscal3');
    } catch (e) { toast(e.message || 'Erreur', 'error'); }
  };

  window.fiscalSetTags = async function (id) {
    const list = window._fiscalPeriods || [];
    const p = list.find(x => x.id == id);
    const current = (p && p.data && Array.isArray(p.data.tags)) ? p.data.tags.join(', ') : '';
    const raw = prompt('Tags (séparés par des virgules) :', current);
    if (raw == null) return;
    const tags = raw.split(',').map(t => t.trim()).filter(Boolean);
    try {
      await Po('/fiscal/periods/' + id + '/tags', { tags });
      toast('Tags mis à jour', 'success');
      go('fiscal3');
    } catch (e) { toast(e.message || 'Erreur', 'error'); }
  };

  window.fiscalTogglePin = async function (id) {
    const list = window._fiscalPeriods || [];
    const p = list.find(x => x.id == id);
    const pinned = !(p && p.data && p.data.pinned);
    try {
      await Po('/fiscal/periods/' + id + '/pin', { pinned });
      toast(pinned ? 'Période épinglée' : 'Période désépinglée', 'success');
      go('fiscal3');
    } catch (e) { toast(e.message || 'Erreur', 'error'); }
  };

  window.fiscalBulkExportXls = async function () {
    const ids = Array.from(document.querySelectorAll('.fiscal-arch-cb:checked')).map(el => Number(el.value)).filter(Boolean);
    if (!ids.length) return toast('Sélectionnez au moins une période', 'error');
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (typeof TK !== 'undefined' && TK) headers.Authorization = 'Bearer ' + TK;
      if (typeof SID !== 'undefined' && SID) headers['X-Station-Id'] = String(SID);
      const r = await fetch('/api/fiscal/periods/bulk-export.xlsx', {
        method: 'POST',
        headers,
        credentials: 'same-origin',
        body: JSON.stringify({ ids })
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || j.message || ('HTTP ' + r.status));
      }
      const blob = await r.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'fiscal-selection.xlsx';
      a.click();
      URL.revokeObjectURL(a.href);
      toast('Export téléchargé', 'success');
    } catch (e) { toast(e.message || 'Export impossible', 'error'); }
  };

  window.fiscalComparePrompt = async function () {
    const a = prompt('ID période A :');
    const b = prompt('ID période B :');
    if (!a || !b) return;
    try {
      const d = await G('/fiscal/periods/compare?a=' + encodeURIComponent(a) + '&b=' + encodeURIComponent(b));
      const delta = d.delta
        ? `Écart (${d.delta.key}) : ${d.delta.a} → ${d.delta.b} (Δ ${d.delta.diff})`
        : 'Pas d’écart numérique comparable (modules ou indicateurs différents).';
      modal(`<h3>Comparaison périodes</h3>
        <p><b>#${d.period_a.id}</b> ${esc(d.period_a.module_code)} ${d.period_a.period_start}→${d.period_a.period_end} [${esc(d.period_a.status)}]</p>
        <p><b>#${d.period_b.id}</b> ${esc(d.period_b.module_code)} ${d.period_b.period_start}→${d.period_b.period_end} [${esc(d.period_b.status)}]</p>
        <p>${esc(delta)}</p>
        <p class="muted" style="font-size:12px">${esc(d.disclaimer || DISCLAIMER)}</p>
        <button class="b2" onclick="closeM()">Fermer</button>`);
    } catch (e) { toast(e.message || 'Comparaison impossible', 'error'); }
  };

  window.fiscalShowDetail = async function (id) {
    try {
      const d = await G('/fiscal/periods/' + id + '/detail');
      const p = d.period || {};
      const w = d.workflow || {};
      const steps = (w.steps || []).map(s =>
        s === w.current ? `<b style="color:var(--ok,#0a6b5c)">${esc(s)}</b>` : esc(s)
      ).join(' → ');
      const ch = d.checklist || {};
      const hist = (d.history || []).slice(0, 8).map(h =>
        `<li><small>${h.created_at ? new Date(h.created_at).toLocaleString() : ''}</small> — ${esc(h.action)}</li>`
      ).join('') || '<li class="muted">Aucun historique</li>';
      const notes = (d.notes_log || []).slice(-5).map(n =>
        `<li><small>${n.at ? new Date(n.at).toLocaleString() : ''}</small> — ${esc(n.text)}</li>`
      ).join('') || '<li class="muted">Aucune note</li>';
      modal(`<h3>Fiche période #${p.id}</h3>
        <p>${esc((p.module_code || '').toUpperCase())} · ${p.period_start} → ${p.period_end}</p>
        <p>Workflow : ${steps}</p>
        <p>Pièces : <b>${ch.done || 0}/${ch.total || 0}</b> · Manquantes requises : <b>${ch.missing_required || 0}</b></p>
        <p>Documents : <b>${(d.documents || []).length}</b></p>
        <h4>Historique</h4><ul style="font-size:13px">${hist}</ul>
        <h4>Notes récentes</h4><ul style="font-size:13px">${notes}</ul>
        <p class="muted" style="font-size:12px">${esc(d.disclaimer || DISCLAIMER)}</p>
        <button onclick="closeM();openFiscalPeriod(${p.id})">Éditer / estimer</button>
        <button class="b2" onclick="closeM();window._fiscalCheckId=${p.id};go('fiscalcheck')">Pièces</button>
        <button class="b2" onclick="closeM()">Fermer</button>`);
    } catch (e) { toast(e.message || 'Fiche indisponible', 'error'); }
  };

  // ---------- Tableau de bord fiscal ----------
  async function vFiscalDash() {
    if (!fiscalAllowed()) return fiscalDeniedHtml();
    const [d, sum] = await Promise.all([
      G('/fiscal/dashboard'),
      G('/fiscal/dashboard/summary').catch(() => null)
    ]);
    const cards = (d.cards || []).map(c =>
      `<div class="card kpi-card"><div class="card-body">
        <small>${esc(c.title)}</small><b>${esc(String(c.value))}</b>
        <div class="muted" style="font-size:12px">${esc(c.hint || '')}</div>
      </div></div>`
    ).join('');
    let extra = '';
    if (sum) {
      const p = sum.periods || {}, c = sum.checklist || {}, dl2 = sum.deadlines || {};
      extra = `<div class="cards" style="margin-top:8px">
        <div class="card kpi-card"><div class="card-body"><small>Périodes</small><b>${p.total || 0}</b>
          <div class="muted" style="font-size:12px">prêtes ${p.pret || 0} · brouillon ${p.brouillon || 0}</div></div></div>
        <div class="card kpi-card"><div class="card-body"><small>Pièces</small><b>${c.done || 0}/${c.total || 0}</b>
          <div class="muted" style="font-size:12px">manquantes requises : ${c.missing_required || 0}</div></div></div>
        <div class="card kpi-card"><div class="card-body"><small>Échéances ≤7j</small><b>${dl2.upcoming || 0}</b>
          <div class="muted" style="font-size:12px">dépassées : ${dl2.overdue || 0}</div></div></div>
        <div class="card kpi-card" style="cursor:pointer" onclick="go('fiscalstorage')"><div class="card-body"><small>Documents</small><b>${sum.documents_count || 0}</b>
          <div class="muted" style="font-size:12px">Stockage →</div></div></div>
      </div>`;
    }
    const dl = (d.upcoming_deadlines || []).map(x =>
      `<li>${esc(x.title)} — <b>${x.due_date}</b> <span class="tag">${x.status}</span></li>`
    ).join('') || '<li class="muted">Aucune échéance paramétrée</li>';
    return `<div>
      <h2 style="margin-top:0">Tableau de bord fiscal</h2>
      <p class="muted" style="font-size:13px">${esc(d.disclaimer || DISCLAIMER)}</p>
      <div class="cards">${cards}</div>
      ${extra}
      <div class="card" style="margin-top:14px">
        <h3 style="margin-top:0">Échéances à venir</h3>
        <ul>${dl}</ul>
        <button class="b2" onclick="go('fiscaldl')">Gérer les échéances</button>
        <button class="b2" onclick="go('fiscalaudit')">Journal d’activité</button>
      </div>
      <div class="detail-actions" style="margin-top:12px">
        <button class="b2" onclick="go('fiscal')">Profil</button>
        <button class="b2" onclick="go('fiscal2')">Modules</button>
        <button class="b2" onclick="go('fiscal3')">Périodes</button>
      </div>
    </div>`;
  }

  async function vFiscalAudit() {
    if (!fiscalAllowed()) return fiscalDeniedHtml();
    const d = await G('/fiscal/audit?limit=80');
    const rows = (d.entries || []).map(e => [
      e.created_at ? new Date(e.created_at).toLocaleString() : '—',
      esc(e.action),
      esc(e.entity_type || '—'),
      e.entity_id || '—',
      esc((e.ip || '').toString())
    ]);
    return `<div>
      <h2 style="margin-top:0">Journal d’activité fiscale</h2>
      <p class="muted" style="font-size:13px">${esc(d.disclaimer || DISCLAIMER)}</p>
      ${rows.length ? T(['Date', 'Action', 'Entité', 'ID', 'IP'], rows) : '<p class="muted">Aucune entrée.</p>'}
      <button class="b2" onclick="go('fiscaldash')">← Dashboard</button>
      <button class="b2" onclick="typeof dlFile==='function'&&dlFile('/fiscal/audit.csv','fiscal-audit')">Export CSV</button>
    </div>`;
  }

  async function vFiscalRulesView() {
    if (!fiscalAllowed()) return fiscalDeniedHtml();
    const d = await G('/fiscal/rules/applicable');
    const rules = d.rules || [];
    const verified = rules.filter(r => r.verification_status === 'verifiee').length;
    const pending = rules.length - verified;
    const rows = rules.map(r => {
      const val = r.rule_value || {};
      const rate = val.rate != null ? val.rate + ' %' : (val.fixed_amount != null ? String(val.fixed_amount) : '—');
      const st = r.verification_status === 'verifiee'
        ? '<span class="tag ok">Vérifiée</span>'
        : '<span class="tag x">À vérifier</span>';
      return [
        esc(r.tax_code), esc(r.rule_key), 'v' + r.version, rate, st,
        r.effective_from || '—',
        esc(r.legal_reference || r.legal_source || '—')
      ];
    });
    return `<div>
      <h2 style="margin-top:0">Règles applicables (lecture seule)</h2>
      <p class="muted" style="font-size:13px">${esc(d.note || '')} ${esc(d.disclaimer || DISCLAIMER)}</p>
      <div class="card" style="margin-bottom:12px">
        <b>Processus de vérification juridique</b>
        <ol style="margin:6px 0 0;padding-left:18px;font-size:13px;line-height:1.45">
          <li>Les taux seedés sont en statut <b>à vérifier</b> tant qu’un professionnel n’a pas confirmé le texte officiel.</li>
          <li>Une règle <b>vérifiée</b> peut être utilisée pour des estimations plus fiables (toujours indicatives).</li>
          <li>Le Superadmin active le module sur le contrat ; la confirmation des barèmes reste une démarche externe (conseil / textes DGI).</li>
          <li>Toute estimation reste une <b>aide à la préparation</b>, jamais une déclaration officielle.</li>
        </ol>
        <p style="font-size:13px">Résumé : <b>${verified}</b> vérifiée(s) · <b>${pending}</b> à vérifier · total ${rules.length}</p>
      </div>
      ${rows.length ? T(['Impôt', 'Clé', 'Version', 'Valeur', 'Statut', 'Depuis', 'Réf. légale'], rows) : '<p class="muted">Aucune règle active.</p>'}
      <button class="b2" onclick="go('fiscaldl')">← Échéances</button>
      <button class="b2" onclick="go('fiscaldash')">Dashboard</button>
    </div>`;
  }

  // ---------- Hub d’entrée ----------
  async function vFiscalHub() {
    if (!fiscalAllowed()) {
      return `<div class="card"><h2>Fiscalité</h2>
        <p class="warn">Ce module n’est pas autorisé sur votre contrat. Demandez à l’Administrateur Principal d’activer « Fiscalité » dans les autorisations du compte client.</p>
        <p class="muted">${esc(DISCLAIMER)}</p></div>`;
    }
    let alertHtml = '';
    try {
      const [sum, health] = await Promise.all([
        G('/fiscal/dashboard/summary'),
        G('/fiscal/health').catch(() => null)
      ]);
      const ov = (sum.deadlines && sum.deadlines.overdue) || 0;
      const up = (sum.deadlines && sum.deadlines.upcoming) || 0;
      const miss = (sum.checklist && sum.checklist.missing_required) || 0;
      const bad = (health && health.checks || []).filter(c => !c.ok);
      if (ov || up || miss || bad.length) {
        alertHtml = `<div class="card" style="margin-bottom:12px;border-left:4px solid #b83227">
          <b>À surveiller</b>
          <ul style="margin:6px 0 0;padding-left:18px;font-size:13px">
            ${bad.map(c => `<li>${esc(c.label)}</li>`).join('')}
            ${ov ? `<li><b>${ov}</b> échéance(s) dépassée(s)</li>` : ''}
            ${up ? `<li><b>${up}</b> échéance(s) dans les 7 jours</li>` : ''}
            ${miss ? `<li><b>${miss}</b> pièce(s) obligatoire(s) manquante(s)</li>` : ''}
          </ul>
          <button class="b2" onclick="go('fiscal')">Profil</button>
          <button class="b2" onclick="go('fiscaldl')">Échéances</button>
          <button class="b2" onclick="go('fiscal3')">Périodes</button>
        </div>`;
      }
    } catch (_) {}
    return `<div>
      <h2 style="margin-top:0">Fiscalité</h2>
      <p class="muted" style="font-size:13px">${esc(DISCLAIMER)}</p>
      ${alertHtml}
      <p>Parcours guidé pour organiser vos informations fiscales et préparer vos obligations (assistance uniquement).</p>
      <div class="cards">
        <div class="card kpi-card" style="cursor:pointer" onclick="go('fiscal')"><div class="card-body"><small>Étape 1</small><b>Mon entreprise</b></div></div>
        <div class="card kpi-card" style="cursor:pointer" onclick="go('fiscal2')"><div class="card-body"><small>Étape 2</small><b>Modules fiscaux</b></div></div>
        <div class="card kpi-card" style="cursor:pointer" onclick="go('fiscal3')"><div class="card-body"><small>Étape 3</small><b>Périodes</b></div></div>
        <div class="card kpi-card" style="cursor:pointer" onclick="go('fiscaldash')"><div class="card-body"><small>Pilotage</small><b>Tableau de bord</b></div></div>
      </div>
      <div class="card" style="margin-top:14px">
        <h3 style="margin-top:0">Guide rapide</h3>
        <ol style="margin:0;padding-left:18px;font-size:13px;line-height:1.5">
          <li>Compléter le <b>profil</b> (NIF, régime déclaré).</li>
          <li>Activer les <b>modules</b> autorisés sur votre contrat.</li>
          <li>Créer une <b>période</b> → estimer → joindre les <b>pièces</b>.</li>
          <li>Passer en <b>Prêt</b> (checklist OK) puis <b>Valider</b> en interne.</li>
          <li>Exporter PDF / Excel / ZIP pour votre conseil ou comptable.</li>
        </ol>
        <p class="muted" style="font-size:12px;margin-top:8px">Ce n’est pas un dépôt à la DGI. En cas de doute, contactez un professionnel habilité.</p>
        <button class="b2" onclick="go('fiscaldl')">Échéances</button>
        <button class="b2" onclick="go('fiscalrulesview')">Règles applicables</button>
        <button class="b2" onclick="go('fiscalaudit')">Journal</button>
        <button class="b2" onclick="typeof dlFile==='function'&&dlFile('/fiscal/summary.pdf','fiscal-synthese')">Synthèse PDF</button>
        <button class="b2" onclick="go('fiscalscore')">Score complétude</button>
        <button class="b2" onclick="go('fiscalactivity')">Activité récente</button>
        <button class="b2" onclick="go('fiscalyear')">Vue annuelle</button>
        <button class="b2" onclick="typeof dlFile==='function'&&dlFile('/fiscal/profile.pdf','fiscal-profil')">PDF profil</button>
      </div>
    </div>`;
  }

  async function vFiscalYear() {
    if (!fiscalAllowed()) return fiscalDeniedHtml();
    const year = window._fiscalYear || new Date().getFullYear();
    const d = await G('/fiscal/year-overview?year=' + year);
    const mods = (d.modules || []).map(m => [
      esc(m.module_code),
      m.count,
      m.ready,
      m.total_estimate != null ? f(m.total_estimate) : '—',
      (m.periods || []).map(p => '#' + p.id).join(', ')
    ]);
    const dl = (d.deadlines || []).map(x => [
      esc(x.module_code), esc(x.title), x.due_date, `<span class="tag">${esc(x.status)}</span>`
    ]);
    return `<div>
      <h2 style="margin-top:0">Vue annuelle ${year}</h2>
      <p class="muted" style="font-size:13px">${esc(d.disclaimer || DISCLAIMER)}</p>
      <div class="bar">
        <button class="b2" onclick="window._fiscalYear=${year - 1};go('fiscalyear')">← ${year - 1}</button>
        <button class="b2" onclick="window._fiscalYear=${year + 1};go('fiscalyear')">${year + 1} →</button>
        <button onclick="fiscalBatchYear()">Créer 12 mois (batch)</button>
        <button class="b2" onclick="go('fiscalhub')">← Hub</button>
      </div>
      <p>Périodes : <b>${d.periods_total || 0}</b></p>
      ${mods.length ? T(['Module', 'Périodes', 'Prêtes', 'Σ estimations', 'IDs'], mods) : '<p class="muted">Aucune période cette année.</p>'}
      <h3>Échéances ${year}</h3>
      ${dl.length ? T(['Module', 'Titre', 'Date', 'Statut'], dl) : '<p class="muted">Aucune échéance.</p>'}
    </div>`;
  }

  window.fiscalBatchYear = async function () {
    const mods = await G('/fiscal/modules');
    const opts = (mods.modules || []).filter(m => m.activated_by_client).map(m => [m.code, m.label]);
    if (!opts.length) return toast('Aucun module activé', 'error');
    form('Créer 12 périodes mensuelles', [
      ['module_code', 'Module', 's', opts],
      ['year', 'Année', 'number']
    ], { year: window._fiscalYear || new Date().getFullYear(), module_code: opts[0][0] }, async d => {
      d.year = Number(d.year);
      const r = await Po('/fiscal/periods/batch-year', d);
      closeM();
      toast(r.message || 'Batch créé', 'success');
      window._fiscalYear = d.year;
      go('fiscalyear');
    });
  };

  async function vFiscalActivity() {
    if (!fiscalAllowed()) return fiscalDeniedHtml();
    const d = await G('/fiscal/activity?limit=30');
    const rows = (d.activity || []).map(e => [
      e.created_at ? new Date(e.created_at).toLocaleString() : '—',
      esc(e.action),
      esc(e.entity_type || '—'),
      e.entity_id || '—'
    ]);
    return `<div>
      <h2 style="margin-top:0">Activité fiscale récente</h2>
      <p class="muted" style="font-size:13px">${esc(d.disclaimer || DISCLAIMER)}</p>
      ${rows.length ? T(['Date', 'Action', 'Entité', 'ID'], rows) : '<p class="muted">Aucune activité.</p>'}
      <button class="b2" onclick="go('fiscalhub')">← Hub</button>
      <button class="b2" onclick="go('fiscalaudit')">Journal complet</button>
    </div>`;
  }

  async function vFiscalScore() {
    if (!fiscalAllowed()) return fiscalDeniedHtml();
    const d = await G('/fiscal/completeness');
    const rows = (d.items || []).map(it => [
      it.ok ? '<span class="tag ok">OK</span>' : '<span class="tag x">—</span>',
      esc(it.label),
      it.points || 0
    ]);
    return `<div>
      <h2 style="margin-top:0">Score de complétude fiscale</h2>
      <p class="muted" style="font-size:13px">${esc(d.disclaimer || DISCLAIMER)}</p>
      <div class="cards">
        <div class="card kpi-card"><div class="card-body"><small>Score</small><b>${d.score || 0} / ${d.max || 100}</b></div></div>
        <div class="card kpi-card"><div class="card-body"><small>Périodes prêtes</small><b>${(d.summary && d.summary.periods_ready) || 0}</b></div></div>
        <div class="card kpi-card"><div class="card-body"><small>Pièces</small><b>${(d.summary && d.summary.checklist_done) || 0}/${(d.summary && d.summary.checklist_total) || 0}</b></div></div>
      </div>
      ${T(['', 'Critère', 'Points'], rows)}
      <button class="b2" onclick="go('fiscalhub')">← Hub</button>
      <button class="b2" onclick="typeof dlFile==='function'&&dlFile('/fiscal/summary.pdf','fiscal-synthese')">Synthèse PDF</button>
      <button class="b2" onclick="typeof dlFile==='function'&&dlFile('/fiscal/completeness.pdf','fiscal-completude')">PDF complétude</button>
    </div>`;
  }

  // ---------- Checklist pièces + upload (Lot 5) ----------
  async function vFiscalChecklist() {
    if (!fiscalAllowed()) return fiscalDeniedHtml();
    const pid = window._fiscalCheckId;
    if (!pid) {
      return `<div class="card"><p>Sélectionnez une période (bouton « Pièces ») depuis la liste des périodes.</p>
        <button class="b2" onclick="go('fiscal3')">← Périodes</button></div>`;
    }
    const [d, docs] = await Promise.all([
      G('/fiscal/periods/' + pid + '/checklist'),
      G('/fiscal/periods/' + pid + '/documents').catch(() => ({ documents: [] }))
    ]);
    const prog = d.progress || { done: 0, total: 0 };
    const rows = (d.items || []).map(it => [
      esc(it.label) + (it.required ? ' <span class="tag x">requis</span>' : ''),
      `<span class="tag">${esc(it.status)}</span>`,
      esc(it.notes || '—'),
      `<select onchange="fiscalSetCheckItem(${pid},${it.id},this.value)" style="font-size:12px">
        ${['manquant','fourni','non_applicable','a_verifier'].map(s =>
          `<option value="${s}" ${it.status===s?'selected':''}>${s}</option>`).join('')}
      </select>
       <button class="b2" style="font-size:11px;padding:2px 6px" onclick='fiscalUploadDoc(${pid},${it.id},${JSON.stringify(String(it.label || ''))})'>Joindre</button>`
    ]);
    const docRows = (docs.documents || []).map(x => [
      esc(x.doc_type), esc(x.title),
      x.uploaded_at ? new Date(x.uploaded_at).toLocaleString() : '—',
      x.file_path
        ? `<button class="b2" style="font-size:11px;padding:2px 6px" onclick="fiscalPreviewDoc(${x.id})">Aperçu</button>
           <button class="b2" style="font-size:11px;padding:2px 6px" onclick="typeof dlFile==='function'&&dlFile('/fiscal/documents/${x.id}/file','doc')">Télécharger</button>
           <button class="bd" style="font-size:11px;padding:2px 6px" onclick="fiscalDeleteDoc(${x.id},${pid})">Suppr.</button>`
        : '—'
    ]);
    return `<div>
      <h2 style="margin-top:0">Pièces justificatives — période #${pid}</h2>
      <p class="muted" style="font-size:13px">${esc(DISCLAIMER)}</p>
      <p>Avancement : <b>${prog.done} / ${prog.total}</b> · Module : <b>${esc(d.module_code || '')}</b></p>
      ${T(['Pièce', 'Statut', 'Notes', 'Actions'], rows)}
      <div class="bar" style="margin-top:12px">
        <button onclick="fiscalUploadDoc(${pid},null,'Justificatif')">＋ Déposer un fichier (PDF/PNG/JPEG, 2 Mo max)</button>
      </div>
      <h3>Fichiers déposés</h3>
      ${docRows.length ? T(['Type', 'Titre', 'Date', ''], docRows) : '<p class="muted">Aucun fichier.</p>'}
      <div class="detail-actions" style="margin-top:12px">
        <button class="b2" onclick="go('fiscal3')">← Périodes</button>
        <button class="b2" onclick="typeof dlFile==='function'&&dlFile('/fiscal/periods/${pid}/pdf','fiscal-prep')">PDF (avec checklist)</button>
      </div>
    </div>`;
  }

  window.fiscalSetCheckItem = async function (periodId, itemId, status) {
    try {
      await api('PATCH', `/fiscal/periods/${periodId}/checklist/${itemId}`, { status });
      toast('Statut mis à jour', 'success');
      window._fiscalCheckId = periodId;
      go('fiscalcheck');
    } catch (e) { toast(e.message || 'Erreur', 'error'); }
  };

  window.fiscalUploadDoc = function (periodId, checklistItemId, defaultTitle) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg';
    input.onchange = () => {
      const file = input.files && input.files[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) return toast('Fichier trop volumineux (2 Mo max)', 'error');
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const title = prompt('Titre du document :', defaultTitle || file.name) || file.name;
          const doc_type = prompt('Type (facture, quittance, attestation, autre) :', 'justificatif') || 'justificatif';
          await Po('/fiscal/periods/' + periodId + '/documents/upload', {
            data_url: reader.result,
            doc_type,
            title,
            checklist_item_id: checklistItemId || null
          });
          toast('Fichier déposé', 'success');
          window._fiscalCheckId = periodId;
          go('fiscalcheck');
        } catch (e) { toast(e.message || 'Échec upload', 'error'); }
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  window.fiscalDeleteDoc = async function (docId, periodId) {
    if (!confirm('Supprimer ce document ?')) return;
    try {
      await api('DELETE', '/fiscal/documents/' + docId);
      toast('Document supprimé', 'success');
      window._fiscalCheckId = periodId;
      go('fiscalcheck');
    } catch (e) { toast(e.message || 'Erreur', 'error'); }
  };

  window.fiscalPreviewDoc = async function (docId) {
    try {
      const headers = {};
      if (typeof TK !== 'undefined' && TK) headers.Authorization = 'Bearer ' + TK;
      if (typeof SID !== 'undefined' && SID) headers['X-Station-Id'] = String(SID);
      const r = await fetch('/api/fiscal/documents/' + docId + '/preview', {
        headers, credentials: 'same-origin'
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || j.message || ('HTTP ' + r.status));
      }
      const blob = await r.blob();
      const blobUrl = URL.createObjectURL(blob);
      const isPdf = (blob.type || '').includes('pdf');
      const body = isPdf
        ? `<iframe src="${blobUrl}" style="width:100%;min-height:65vh;border:0;background:#fff" title="aperçu"></iframe>`
        : `<img src="${blobUrl}" alt="aperçu" style="max-width:100%;max-height:65vh;object-fit:contain">`;
      modal(`<h3>Aperçu pièce #${docId}</h3>
        <div style="max-height:70vh;overflow:auto;background:#111;text-align:center;padding:8px">${body}</div>
        <p class="muted" style="font-size:12px">PDF et images uniquement.</p>
        <button class="b2" onclick="URL.revokeObjectURL('${blobUrl}');closeM()">Fermer</button>
        <button class="b2" onclick="typeof dlFile==='function'&&dlFile('/fiscal/documents/${docId}/file','doc')">Télécharger</button>`);
    } catch (e) { toast(e.message || 'Aperçu impossible', 'error'); }
  };

  // Enregistrement des vues
  Object.assign(V, {
    fiscalhub: ['Fiscalité', 'fiscal.access'],
    fiscal: ['Fiscalité · Profil', 'fiscal.access'],
    fiscal2: ['Fiscalité · Modules', 'fiscal.access'],
    fiscal3: ['Fiscalité · Périodes', 'fiscal.access'],
    fiscaldash: ['Fiscalité · Dashboard', 'fiscal.access'],
    fiscaldl: ['Fiscalité · Échéances', 'fiscal.access'],
    fiscalcheck: ['Fiscalité · Pièces', 'fiscal.access'],
    fiscalaudit: ['Fiscalité · Journal', 'fiscal.access'],
    fiscalrulesview: ['Fiscalité · Règles', 'fiscal.access'],
    fiscalstorage: ['Fiscalité · Stockage', 'fiscal.access'],
    fiscalscore: ['Fiscalité · Complétude', 'fiscal.access'],
    fiscalactivity: ['Fiscalité · Activité', 'fiscal.access'],
    fiscalyear: ['Fiscalité · Année', 'fiscal.access']
  });
  Object.assign(VM, {
    fiscalhub: vFiscalHub,
    fiscal: vFiscalProfile,
    fiscal2: vFiscalModules,
    fiscal3: vFiscalPeriods,
    fiscaldash: vFiscalDash,
    fiscaldl: vFiscalDeadlines,
    fiscalcheck: vFiscalChecklist,
    fiscalaudit: vFiscalAudit,
    fiscalrulesview: vFiscalRulesView,
    fiscalscore: vFiscalScore,
    fiscalactivity: vFiscalActivity,
    fiscalyear: vFiscalYear,
    fiscalstorage: async function vFiscalStorage() {
      if (!fiscalAllowed()) return fiscalDeniedHtml();
      const d = await G('/fiscal/storage');
      const quotaLabel = d.quota_unlimited ? 'Illimité' : ((d.quota_mb != null ? d.quota_mb : 100) + ' Mo');
      const rem = d.quota_unlimited ? '—' : ((d.remaining_mb != null ? d.remaining_mb : '—') + ' Mo');
      return `<div>
        <h2 style="margin-top:0">Stockage des justificatifs</h2>
        <p class="muted" style="font-size:13px">${esc(d.note || '')} ${esc(d.disclaimer || DISCLAIMER)}</p>
        <div class="cards">
          <div class="card kpi-card"><div class="card-body"><small>Documents</small><b>${d.documents || 0}</b></div></div>
          <div class="card kpi-card"><div class="card-body"><small>Sur disque</small><b>${d.files_on_disk || 0}</b></div></div>
          <div class="card kpi-card"><div class="card-body"><small>Volume utilisé</small><b>${d.mb || 0} Mo</b></div></div>
          <div class="card kpi-card"><div class="card-body"><small>Quota contrat</small><b>${esc(String(quotaLabel))}</b>
            <div class="muted" style="font-size:12px">Reste : ${esc(String(rem))}</div></div></div>
        </div>
        <button class="b2" onclick="go('fiscaldash')">← Dashboard</button>
        <button class="b2" onclick="typeof dlFile==='function'&&dlFile('/fiscal/documents.csv','fiscal-documents')">Export CSV documents</button>
      </div>`;
    }
  });
  if (typeof NAV_ICONS !== 'undefined') {
    NAV_ICONS.fiscalhub = '⚖️';
    NAV_ICONS.fiscal = '⚖️';
    NAV_ICONS.fiscal2 = '⚖️';
    NAV_ICONS.fiscal3 = '⚖️';
    NAV_ICONS.fiscaldash = '⚖️';
    NAV_ICONS.fiscaldl = '📅';
    NAV_ICONS.fiscalcheck = '📎';
    NAV_ICONS.fiscalaudit = '📋';
    NAV_ICONS.fiscalrulesview = '📜';
    NAV_ICONS.fiscalstorage = '💾';
    NAV_ICONS.fiscalscore = '✅';
    NAV_ICONS.fiscalactivity = '🕐';
    NAV_ICONS.fiscalyear = '📆';
  }

  // Injection menu latéral si autorisé
  document.addEventListener('DOMContentLoaded', function () {
    // Le shell lit V/VM ; l’onglet n’apparaît que si feature ok (côté shell ou filtre existant)
  });
})();
