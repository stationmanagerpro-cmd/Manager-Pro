/* ext-fiscal-wizard.js — Assistant d'activation individuelle par impôt (Fiscalité + paie)
   Parcours identique pour chaque impôt : 1 Présentation · 2 Paramètres (valeurs de référence sourcées, modifiables,
   « personnalisé » + retour à la valeur officielle) · 3 Test sur les données réelles (sans enregistrement) ·
   4 Confirmation (case obligatoire, motif, date d'effet). Désactivation avec motif ; historique versionné.
   Les valeurs préchargées proviennent du jeu de référence de l'éditeur : elles sont « à confirmer » (DGI / expert-comptable). */
(function () {
  'use strict';
  const W = { code: null, desc: null, values: {}, step: 1, errors: {}, sim: null, simErr: null, zero: [], zeroOk: {}, busy: false, mode: 'activate' };
  const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const fmt = n => (typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('fr-FR', { maximumFractionDigits: 2 }) : esc(n == null ? '—' : String(n)));
  const today = () => new Date().toISOString().slice(0, 10);
  const P = key => (W.desc.params || []).find(p => p.key === key);
  const isEmpty = v => v === undefined || v === null || v === '';
  const norm = (p, v) => (p.type === 'select' || p.type === 'bool' ? String(v) : v);
  const isCustom = p => p.has_default && !isEmpty(W.values[p.key]) && JSON.stringify(norm(p, W.values[p.key])) !== JSON.stringify(norm(p, p.default));
  const visible = p => !p.requiredIf || String(W.values[p.requiredIf.key]) === String(p.requiredIf.value) || !p.required;

  // ---------- Éditeurs de listes ----------
  const recomputeFrom = rows => { rows.forEach((b, i) => { b.from = i === 0 ? 0 : Number(rows[i - 1].to) || 0; }); };
  function bracketsEditor(p) {
    const rows = Array.isArray(W.values[p.key]) ? W.values[p.key] : [];
    const body = rows.map((b, i) => `<tr>
      <td>${fmt(b.from)}</td>
      <td>${i === rows.length - 1 ? '<span class="muted">sans plafond</span>' : `<input type="number" min="0" value="${isEmpty(b.to) ? '' : esc(b.to)}" onchange="fwRow('${p.key}',${i},'to',this.value)" style="width:130px">`}</td>
      <td><input type="number" min="0" max="100" step="0.01" value="${isEmpty(b.rate) ? '' : esc(b.rate)}" onchange="fwRow('${p.key}',${i},'rate',this.value)" style="width:80px"> %</td>
      <td>${rows.length > 1 ? `<button class="b2" onclick="fwDel('${p.key}',${i})">✕</button>` : ''}</td></tr>`).join('');
    return `<table><thead><tr><th>De (FCFA)</th><th>Jusqu'à (FCFA)</th><th>Taux</th><th></th></tr></thead><tbody>${body || '<tr><td colspan="4" class="muted">Aucune tranche : choisissez une version ci-dessous ou ajoutez des tranches.</td></tr>'}</tbody></table>
      <button class="b2" onclick="fwAdd('${p.key}')">+ Tranche</button>`;
  }
  function branchesEditor(p) {
    const rows = Array.isArray(W.values[p.key]) ? W.values[p.key] : [];
    const inp = (i, f, w, v, t) => `<input ${t === 'n' ? 'type="number" step="0.01" min="0"' : ''} value="${isEmpty(v) ? '' : esc(v)}" onchange="fwRow('${p.key}',${i},'${f}',this.value)" style="width:${w}px">`;
    const body = rows.map((b, i) => `<tr><td>${inp(i, 'code', 90, b.code)}</td><td>${inp(i, 'label', 150, b.label)}</td><td>${inp(i, 'employee_rate', 70, b.employee_rate, 'n')} %</td><td>${inp(i, 'employer_rate', 70, b.employer_rate, 'n')} %</td><td>${inp(i, 'ceiling', 100, b.ceiling, 'n')}</td><td><button class="b2" onclick="fwDel('${p.key}',${i})">✕</button></td></tr>`).join('');
    return `<table><thead><tr><th>Code</th><th>Libellé</th><th>Salarié</th><th>Employeur</th><th>Plafond</th><th></th></tr></thead><tbody>${body || '<tr><td colspan="6" class="muted">Aucune branche.</td></tr>'}</tbody></table>
      <button class="b2" onclick="fwAdd('${p.key}')">+ Branche</button>`;
  }
  function ratesEditor(p) {
    const rows = Array.isArray(W.values[p.key]) ? W.values[p.key] : [];
    const body = rows.map((b, i) => `<tr><td><input value="${esc(b.label || '')}" onchange="fwRow('${p.key}',${i},'label',this.value)"></td><td><input type="number" min="0" max="100" step="0.01" value="${isEmpty(b.rate) ? '' : esc(b.rate)}" onchange="fwRow('${p.key}',${i},'rate',this.value)" style="width:80px"> %</td><td><button class="b2" onclick="fwDel('${p.key}',${i})">✕</button></td></tr>`).join('');
    return `<table><tbody>${body}</tbody></table><button class="b2" onclick="fwAdd('${p.key}')">+ Taux réduit</button>`;
  }

  function fieldInput(p) {
    const v = W.values[p.key];
    if (p.type === 'brackets') return bracketsEditor(p);
    if (p.type === 'branches') return branchesEditor(p);
    if (p.type === 'rates') return ratesEditor(p);
    if (p.type === 'bool') return `<select onchange="fwSet('${p.key}',this.value)"><option value="true" ${v === true || v === 'true' ? 'selected' : ''}>Oui</option><option value="false" ${v === false || v === 'false' ? 'selected' : ''}>Non</option></select>`;
    if (p.type === 'select') return `<select onchange="fwSet('${p.key}',this.value)"><option value="">— choisir —</option>${(p.options || []).map(o => `<option value="${esc(o[0])}" ${String(v) === String(o[0]) ? 'selected' : ''}>${esc(o[1])}</option>`).join('')}</select>`;
    if (p.type === 'text') return `<input value="${esc(v || '')}" onchange="fwSet('${p.key}',this.value)" style="width:100%">`;
    return `<input type="number" step="any" value="${isEmpty(v) ? '' : esc(v)}" onchange="fwSet('${p.key}',this.value)" style="width:160px">${p.type === 'percent' ? ' %' : ''}`;
  }

  function fieldBlock(p) {
    if (!visible(p)) return '';
    const r = p.reference || {};
    const custom = isCustom(p), err = W.errors[p.key];
    const cand = (p.candidates || []).map((c, i) => `<button class="b2" style="margin:2px" onclick="fwCand('${p.key}',${i})" title="${esc(c.source || '')}">Utiliser : ${esc(c.label)}</button>`).join('');
    return `<div class="card" style="margin-bottom:8px;padding:10px;${err ? 'border:1px solid #d33' : ''}">
      <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap">
        <b>${esc(p.label)}${p.required ? ' *' : ''}</b>
        <span>${custom ? '<span class="tag" style="background:#b8860b;color:#fff">personnalisé</span>' : (p.has_default ? '<span class="tag ok">valeur de référence</span>' : '<span class="tag">à renseigner</span>')}
        ${p.contested ? '<span class="tag x">sources divergentes</span>' : ''}</span>
      </div>
      <div style="margin:6px 0">${fieldInput(p)}</div>
      ${err ? `<div style="color:#d33;font-size:12px">${esc(err)}</div>` : ''}
      ${p.help ? `<div class="muted" style="font-size:12px">${esc(p.help)}</div>` : ''}
      ${cand ? `<div style="margin-top:4px">${cand}</div>` : ''}
      <div class="muted" style="font-size:11px;margin-top:4px">Source : ${esc(r.source || '—')} · relevé le ${esc(r.compiled_on || '—')} · statut : <b>${r.status === 'a_confirmer' ? 'à confirmer' : esc(r.status || '—')}</b>${r.note ? ' · ' + esc(r.note) : ''}${r.verified_on ? ' · vérifié le ' + esc(r.verified_on) : ' · non vérifié'}</div>
      ${custom ? `<div style="font-size:12px;margin-top:4px">Valeur officielle de référence : <b>${esc(typeof p.default === 'object' ? JSON.stringify(p.default) : p.default)}</b> <button class="b2" onclick="fwReset('${p.key}')">Revenir à la valeur officielle</button></div>` : ''}
    </div>`;
  }

  // ---------- Rendu ----------
  const steps = ['Présentation', 'Paramètres', 'Test', 'Confirmation'];
  function stepper() {
    return `<div style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap">${steps.map((s, i) => `<span class="tag ${W.step === i + 1 ? 'ok' : ''}">${i + 1}. ${s}</span>`).join('')}</div>`;
  }
  function renderStep() {
    const d = W.desc;
    if (W.step === 1) {
      const pr = d.presentation || {};
      return `<h3>${esc(d.label)}</h3>
        <p><b>Rôle :</b> ${esc(pr.role)}</p><p><b>Personnes concernées :</b> ${esc(pr.concerned)}</p>
        <p><b>Périodicité :</b> ${esc(pr.periodicity)}</p><p><b>Base légale :</b> ${esc(pr.legal_basis)}</p>
        ${d.payroll_shared ? '<p class="tag">Ces paramètres alimentent aussi la paie (une seule source pour la Fiscalité et les bulletins).</p>' : ''}
        ${d.needs_wizard ? '<p style="color:#b8860b"><b>Ce module avait été activé sans paramètres confirmés : il ne calcule plus tant que vous ne les confirmez pas ici.</b></p>' : ''}
        <p class="muted" style="font-size:12px">Jeu de référence ${esc(d.dataset_version)} (relevé le ${esc(d.compiled_on)}) : aucune valeur n’est validée juridiquement. Elles doivent être confirmées auprès de la DGI Mali, de l’INPS ou d’un expert-comptable avant tout usage réel.</p>
        ${d.dataset_newer ? '<p style="color:#b8860b">Un jeu de référence plus récent est disponible : vos valeurs confirmées ne sont pas modifiées ; comparez-les à l’étape Paramètres.</p>' : ''}`;
    }
    if (W.step === 2) {
      return `<p class="muted" style="font-size:12px">Tous les champs sont modifiables. * = obligatoire. Les champs « sources divergentes » demandent un choix explicite.</p>
        ${(d.params || []).map(fieldBlock).join('')}`;
    }
    if (W.step === 3) {
      let out = '';
      if (W.simErr) out += `<div class="card" style="border:1px solid #d33;padding:10px"><b>${esc(W.simErr.message)}</b>${(W.simErr.errors || []).map(e => `<div>• ${esc((P(e.key) || {}).label || e.key)} : ${esc(e.message)}</div>`).join('')}</div>`;
      if (W.sim) {
        const res = W.sim.result || {};
        const rows = Object.entries(res).filter(([k, v]) => !['warnings', 'disclaimer', 'lines', 'period', 'rule_used', 'sales', 'purchases', 'ecart_base'].includes(k) && (v === null || typeof v !== 'object'))
          .map(([k, v]) => `<tr><td>${esc(k.replace(/_/g, ' '))}</td><td style="text-align:right"><b>${fmt(v)}</b></td></tr>`).join('');
        const lines = (res.lines || []).slice(0, 30).map(l => `<tr>${Object.entries(l).map(([k, v]) => `<td style="text-align:${typeof v === 'number' ? 'right' : 'left'}">${fmt(v)}</td>`).join('')}</tr>`).join('');
        const head = (res.lines && res.lines[0]) ? `<tr>${Object.keys(res.lines[0]).map(k => `<th>${esc(k.replace(/_/g, ' '))}</th>`).join('')}</tr>` : '';
        out += `<p class="muted">Simulation sur vos données réelles — période ${esc(W.sim.period.start)} → ${esc(W.sim.period.end)}. <b>Rien n’est enregistré.</b></p>
          <div class="tw"><table><tbody>${rows}</tbody></table></div>
          ${lines ? `<div class="tw"><table><thead>${head}</thead><tbody>${lines}</tbody></table></div>` : ''}
          ${(res.warnings || []).map(w => `<div style="font-size:12px;margin:3px 0">⚠ ${esc(w)}</div>`).join('')}
          ${(W.sim.customized || []).length ? `<p style="font-size:12px">Valeurs personnalisées : ${W.sim.customized.map(k => esc((P(k) || {}).label || k)).join(', ')}</p>` : ''}`;
      }
      if (!W.sim && !W.simErr) out += '<p class="muted">Lancez la simulation pour contrôler les résultats avant d’activer.</p>';
      return out + `<button onclick="fwSimulate()" ${W.busy ? 'disabled' : ''}>${W.busy ? 'Calcul…' : 'Lancer la simulation'}</button>`;
    }
    // Étape 4 : confirmation
    const custom = (d.params || []).filter(isCustom);
    const act = d.activation;
    return `<h3>${W.mode === 'update' ? 'Nouvelle version des paramètres' : 'Activation du module'}</h3>
      ${custom.length ? `<p><b>Valeurs personnalisées :</b> ${custom.map(p => esc(p.label)).join(' ; ')}</p>` : '<p>Aucune valeur personnalisée : toutes les valeurs sont celles du jeu de référence.</p>'}
      ${W.zero.length ? `<div class="card" style="border:1px solid #d33;padding:10px"><b>Taux nul ou vide — confirmation explicite requise</b>${W.zero.map(z => `<label style="display:block"><input type="checkbox" onchange="fwZero('${esc(z.key)}',this.checked)" ${W.zeroOk[z.key] ? 'checked' : ''}> Je confirme que « ${esc(z.label)} » est réellement nul</label>`).join('')}</div>` : ''}
      <label style="display:block;margin:8px 0">Date d’effet <input type="date" id="fw_eff" value="${esc(W.effective || today())}" ${act && act.settings_version ? `min="${esc(d.current ? d.current.effective_from : '')}"` : ''}></label>
      <label style="display:block;margin:8px 0">Motif <input id="fw_reason" value="${esc(W.reason || '')}" placeholder="Ex. : valeurs confirmées par la DGI le …" style="width:100%"></label>
      <label style="display:block;margin:8px 0"><input type="checkbox" id="fw_ok" ${W.confirm ? 'checked' : ''}> J’ai vérifié ces valeurs auprès de la DGI / de l’organisme concerné / d’un professionnel et je les confirme.</label>
      <p class="muted" style="font-size:12px">Chaque modification crée une nouvelle version (l’historique n’est jamais réécrit) et est journalisée.</p>`;
  }

  function render() {
    const nav = `<div style="display:flex;justify-content:space-between;margin-top:12px;gap:8px">
      <button class="b2" onclick="closeM()">Fermer</button>
      <span>${W.step > 1 ? '<button class="b2" onclick="fwStep(-1)">← Précédent</button> ' : ''}
      ${W.step < 4 ? '<button onclick="fwStep(1)">Suivant →</button>' : `<button onclick="fwSubmit()" ${W.busy ? 'disabled' : ''}>${W.mode === 'update' ? 'Enregistrer la nouvelle version' : 'Activer le module'}</button>`}</span></div>`;
    modal(`<div style="max-width:860px;width:92vw;max-height:86vh;overflow:auto">${stepper()}${renderStep()}${nav}</div>`);
  }

  // ---------- Actions ----------
  function readStep4() {
    const g = id => document.getElementById(id);
    if (g('fw_eff')) W.effective = g('fw_eff').value;
    if (g('fw_reason')) W.reason = g('fw_reason').value;
    if (g('fw_ok')) W.confirm = g('fw_ok').checked;
  }
  const num = v => (v === '' || v === null || v === undefined ? null : Number(v));
  window.fwSet = (k, v) => { const p = P(k); let x = v; if (p.type === 'bool') x = v === 'true'; else if (['percent', 'amount', 'int'].includes(p.type)) x = num(v); else if (p.type === 'select' && v === '') x = null; W.values[k] = x; delete W.errors[k]; render(); };
  window.fwReset = k => { W.values[k] = clone(P(k).default); delete W.errors[k]; render(); };
  window.fwCand = (k, i) => { W.values[k] = clone(P(k).candidates[i].value); delete W.errors[k]; render(); };
  window.fwRow = (k, i, f, v) => {
    const p = P(k), rows = W.values[k] || [];
    rows[i][f] = (['to', 'rate', 'employee_rate', 'employer_rate', 'ceiling'].includes(f)) ? num(v) : v;
    if (p.type === 'brackets') recomputeFrom(rows);
    delete W.errors[k]; render();
  };
  window.fwAdd = k => {
    const p = P(k); const rows = W.values[k] = Array.isArray(W.values[k]) ? W.values[k] : [];
    if (p.type === 'brackets') { if (!rows.length) rows.push({ from: 0, to: null, rate: 0 }); else { const last = rows[rows.length - 1]; const prevTo = rows.length > 1 ? rows[rows.length - 2].to : 0; last.to = (Number(prevTo) || 0) + 100000; rows.push({ from: last.to, to: null, rate: last.rate }); } recomputeFrom(rows); }
    else if (p.type === 'branches') rows.push({ code: '', label: '', employee_rate: null, employer_rate: null, ceiling: null });
    else rows.push({ label: '', rate: null });
    render();
  };
  window.fwDel = (k, i) => { const p = P(k); W.values[k].splice(i, 1); if (p.type === 'brackets') { const rows = W.values[k]; if (rows.length) rows[rows.length - 1].to = null; recomputeFrom(rows); } render(); };
  window.fwZero = (k, on) => { W.zeroOk[k] = on; };
  window.fwStep = d => { if (W.step === 4) readStep4(); W.step = Math.max(1, Math.min(4, W.step + d)); render(); };

  function showApiError(e) {
    const det = e && e.details;
    if (det && det.code === 'FISCAL_PARAMS_INVALID') {
      W.errors = {}; (det.errors || []).forEach(x => { W.errors[x.key] = x.message; });
      W.simErr = { message: 'Paramètres invalides : corrigez les champs signalés (étape Paramètres).', errors: det.errors };
      return true;
    }
    return false;
  }
  window.fwSimulate = async function () {
    W.busy = true; W.simErr = null; W.sim = null; render();
    try { W.sim = await Po('/fiscal/wizard/' + W.code + '/simulate', { params: W.values, confirm_zero: Object.keys(W.zeroOk).filter(k => W.zeroOk[k]) }); }
    catch (e) { if (!showApiError(e)) W.simErr = { message: e.message || 'Simulation impossible' }; }
    W.busy = false; render();
  };
  window.fwSubmit = async function () {
    readStep4();
    if (!W.confirm) { toast('Cochez la confirmation de vérification des valeurs', 'error'); return; }
    if (!W.reason || W.reason.trim().length < 5) { toast('Motif obligatoire (5 caractères minimum)', 'error'); return; }
    W.busy = true; render();
    try {
      const payload = { params: W.values, reason: W.reason.trim(), effective_from: W.effective || today(), confirm_values: true, confirm_zero: Object.keys(W.zeroOk).filter(k => W.zeroOk[k]) };
      if (W.mode === 'update') await Pu('/fiscal/wizard/' + W.code + '/settings', payload); else await Po('/fiscal/wizard/' + W.code + '/activate', payload);
      toast(W.mode === 'update' ? 'Nouvelle version enregistrée' : 'Module activé', 'success');
      closeM(); go('fiscal2');
    } catch (e) {
      const det = e && e.details;
      if (det && det.code === 'FISCAL_ZERO_RATE') { W.zero = det.zero || []; toast('Confirmez explicitement les taux nuls', 'error'); }
      else if (showApiError(e)) { W.step = 2; toast('Paramètres invalides', 'error'); }
      else toast(e.message || 'Erreur', 'error');
      W.busy = false; render(); return;
    }
    W.busy = false;
  };

  window.fiscalWizardOpen = async function (code) {
    try {
      const d = await G('/fiscal/wizard/' + code);
      W.code = code; W.desc = d; W.step = 1; W.errors = {}; W.sim = null; W.simErr = null; W.zero = []; W.zeroOk = {}; W.busy = false;
      W.confirm = false; W.reason = ''; W.effective = today();
      W.mode = d.activation && d.activation.activated && d.activation.settings_version ? 'update' : 'activate';
      // valeurs : version courante si elle existe, sinon valeurs du jeu de référence (sans choix imposé pour les valeurs contestées)
      W.values = {};
      (d.params || []).forEach(p => { const cur = d.current && d.current.params ? d.current.params[p.key] : undefined; W.values[p.key] = clone(cur !== undefined && cur !== null ? cur : (p.has_default ? p.default : null)); });
      render();
    } catch (e) { toast(e.message || 'Assistant indisponible', 'error'); }
  };
  window.fiscalAct = window.fiscalWizardOpen;
  window.fiscalDeact = async function (code) {
    const reason = prompt('Motif de la désactivation (5 caractères minimum). Les périodes déjà clôturées restent figées.');
    if (reason === null) return;
    if (reason.trim().length < 5) { toast('Motif obligatoire (5 caractères minimum)', 'error'); return; }
    try { await Po('/fiscal/wizard/' + code + '/deactivate', { reason: reason.trim() }); toast('Module désactivé', 'success'); go('fiscal2'); }
    catch (e) { toast(e.message || 'Erreur', 'error'); }
  };
  window.fiscalWizardHistory = async function (code) {
    try {
      const h = await G('/fiscal/wizard/' + code + '/history');
      const rows = (h.versions || []).map(v => `<tr><td>v${v.version}</td><td>${esc(v.effective_from)}</td><td>${esc(v.reason)}</td><td>${esc(v.created_by || '')}</td><td>${(v.changed_keys || []).map(esc).join(', ')}</td><td>${(v.customized || []).length ? 'oui' : 'non'}</td></tr>`).join('');
      modal(`<div style="max-width:860px;width:92vw"><h3>Historique des paramètres — ${esc(code.toUpperCase())}</h3>
        <div class="tw"><table><thead><tr><th>Version</th><th>Date d’effet</th><th>Motif</th><th>Par</th><th>Valeurs modifiées</th><th>Personnalisé</th></tr></thead><tbody>${rows || '<tr><td colspan="6">Aucune version.</td></tr>'}</tbody></table></div>
        <button class="b2" onclick="closeM()">Fermer</button></div>`);
    } catch (e) { toast(e.message || 'Erreur', 'error'); }
  };
})();
