/* ext-sa-rules.js — Superadmin : onglet « Règle des notification » du Centre de contrôle (groupe Pilotage).
   Contient : 1) le rapport mensuel automatique (déplacé depuis le tableau de bord d'utilisation, comportement inchangé) ;
   2) les règles d'alerte de la PLATEFORME (stockage séparé des règles client). API : src/usage_report.js, src/platform_alerts.js. */
(function () {
  'use strict';
  if (typeof G === 'undefined') return;

  const dtl = d => (d ? new Date(d).toLocaleString('fr-FR') : 'jamais');
  const errText = e => (typeof errMsg === 'function' ? errMsg(e) : '') || (e && e.message) || String(e);

  /* ---- Rapport mensuel automatique (ex-« sad_rep » du tableau de bord) ---- */
  async function saDl(path, name) {
    try {
      const r = await fetch('/api' + path, { headers: { Authorization: 'Bearer ' + TK } });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
      const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = name; document.body.appendChild(a); a.click(); a.remove();
    } catch (e) { toast('Téléchargement impossible : ' + errText(e)); }
  }
  window.sadRepDl = id => saDl(`/admin/platform/usage-report/file/${id}`, 'rapport_utilisation_' + id + '.pdf');

  function reportCard(d) {
    const c = d.settings;
    return `<div style="border:1px solid var(--bd,#e2e8f0);border-radius:12px;padding:10px 12px;margin:8px 0">
      <b>📬 Rapport mensuel automatique</b>
      <div style="margin-top:6px;color:var(--m)">
      <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="rep_on" ${c.enabled ? 'checked' : ''}> Activer l’envoi automatique chaque mois</label>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin:8px 0;align-items:end"><label>Jour du mois<br><input type="number" id="rep_day" min="1" max="28" value="${c.day}" style="width:70px"></label>
      <label>Heure (UTC)<br><input type="number" id="rep_hour" min="0" max="23" value="${c.hour}" style="width:70px"></label>
      <label style="flex:1;min-width:200px">E-mail du destinataire<br><input type="email" id="rep_mail" value="${esc(c.email || '')}" placeholder="vous@exemple.com" style="width:100%"></label>
      <button class="b2" onclick="sadRepSave()">Enregistrer</button><button class="b2" onclick="sadRepNow()">Envoyer maintenant</button></div>
      <small>${d.email_available ? 'E-mail disponible.' : '⚠ E-mail non configuré sur le serveur (SMTP) : le rapport est seulement archivé ci-dessous.'} Dernier envoi automatique : ${c.last_sent || 'aucun'}.</small>
      ${d.reports.length ? '<div style="margin-top:8px"><b>Rapports archivés</b><ul style="margin:4px 0 0;padding-left:18px">' + d.reports.map(r => `<li>${esc(r.label)} — ${new Date(r.created_at).toLocaleString('fr-FR')}${r.emailed_to ? ' — envoyé à ' + esc(r.emailed_to) : ''} <a href="#" onclick="sadRepDl(${Number(r.id)});return false">PDF</a></li>`).join('') + '</ul></div>' : ''}
      </div></div>`;
  }
  window.sadRepSave = async function () {
    try {
      await Pu('/admin/platform/usage-report/settings', { enabled: document.getElementById('rep_on').checked, day: +document.getElementById('rep_day').value || 1, hour: +document.getElementById('rep_hour').value || 0, email: document.getElementById('rep_mail').value.trim() });
      toast('Réglage enregistré'); goAdminTab('rules');
    } catch (e) { toast('Erreur : ' + errText(e), 'error'); }
  };
  window.sadRepNow = async function () {
    try { const r = await Po('/admin/platform/usage-report/send-now', {}); toast(r.emailed ? 'Rapport envoyé à ' + r.emailed : 'Rapport généré et archivé' + (r.mail_error ? ' (e-mail : ' + r.mail_error + ')' : '')); goAdminTab('rules'); }
    catch (e) { toast('Erreur : ' + errText(e), 'error'); }
  };

  /* ---- Règles d'alerte de la plateforme ---- */
  function ruleCard(r) {
    const id = r.alert_kind;
    const thr = r.threshold
      ? `<label>${esc(r.threshold.label)}<br><input type="number" id="sar_t_${id}" min="${r.threshold.min}" max="${r.threshold.max}" value="${r.threshold_value ?? ""}" style="width:110px"></label>` : '';
    const status = r.active ? '<span class="tag" style="background:#16a34a22;color:#16a34a">Active</span>' : '<span class="tag">Inactive</span>';
    return `<div class="card" style="text-align:left;min-width:0">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:start"><b>${esc(r.label)}</b>${status}</div>
      <small style="color:var(--m)">${r.type === 'event' ? 'Envoi à chaque événement' : 'Rappel tant que la situation dure (au plus une fois par 24 h)'}</small>
      <p style="font-size:12px;color:var(--m);margin:6px 0">${esc(r.help)}</p>
      <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="sar_a_${id}" ${r.active ? 'checked' : ''}> Règle active</label>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end;margin-top:8px">
        ${thr}
        <label style="flex:1;min-width:200px">E-mail du destinataire<br><input type="email" id="sar_m_${id}" value="${esc(r.email)}" placeholder="vous@exemple.com" style="width:100%"></label>
      </div>
      <div style="margin-top:8px"><button class="b2" onclick="saRuleSave('${id}')">Enregistrer</button></div>
      <small style="display:block;margin-top:6px;color:var(--m)">Dernière vérification : ${dtl(r.last_checked_at)} · Dernier envoi : ${dtl(r.last_fired_at)}${r.last_value != null ? ' · Valeur : ' + esc(r.last_value) : ''}</small>
      ${r.last_error ? `<p class="warn" style="font-size:12px;margin:6px 0 0">Erreur d’envoi : ${esc(r.last_error)}</p>` : ''}
    </div>`;
  }

  window.saRuleSave = async function (kind) {
    const tEl = document.getElementById('sar_t_' + kind);
    const body = { active: !!document.getElementById('sar_a_' + kind)?.checked, email: (document.getElementById('sar_m_' + kind)?.value || '').trim() };
    if (tEl) body.threshold_value = +tEl.value;
    try { await Pu('/admin/platform/alert-rules/' + encodeURIComponent(kind), body); toast('Règle enregistrée', 'success'); goAdminTab('rules'); }
    catch (e) { toast('Erreur : ' + errText(e), 'error'); }
  };

  window.saRuleRun = async function () {
    try {
      const r = await Po('/admin/platform/alert-rules/run', {});
      if (r.skipped) return toast('Vérification déjà en cours sur une autre instance', 'info');
      const sent = (r.results || []).filter(x => x.sent).length;
      toast(sent ? sent + ' alerte(s) envoyée(s)' : 'Aucune alerte à envoyer', 'success');
      goAdminTab('rules');
    } catch (e) { toast('Erreur : ' + errText(e), 'error'); }
  };

  window.renderSaRules = async function () {
    if (!ME?.is_global) return '<p class="warn">Réservé à l’Administrateur Principal.</p>';
    const [rep, rules] = await Promise.all([
      G('/admin/platform/usage-report/settings').catch(e => ({ error: errText(e) })),
      G('/admin/platform/alert-rules').catch(e => ({ error: errText(e) }))
    ]);
    const repHtml = rep.error ? `<p class="warn">Rapport mensuel indisponible : ${esc(rep.error)}</p>` : reportCard(rep);
    const ruleHtml = rules.error ? `<p class="warn">Règles indisponibles : ${esc(rules.error)}</p>` : `
      <div style="display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(280px,1fr))">${rules.rules.map(ruleCard).join('')}</div>
      <p style="font-size:12px;color:var(--m);margin:8px 0 0">${rules.email_available ? '' : '⚠ E-mail non configuré sur le serveur (SMTP) : les alertes ne peuvent pas partir tant que SMTP n’est pas renseigné.'}
        Ces règles sont propres à la plateforme : elles n’apparaissent dans aucun compte client.</p>`;
    return `<h2 style="margin-top:0">Règle des notification</h2>
      <p style="font-size:13px;color:var(--m);margin-top:0">Vos alertes de superadministrateur (licences, erreurs, sauvegardes, stations et clients), et votre rapport mensuel.</p>
      ${repHtml}
      <h3 style="margin:16px 0 6px">Alertes de la plateforme</h3>
      <div class="bar" style="margin-bottom:8px"><button class="b2" onclick="saRuleRun()">Lancer la vérification maintenant</button></div>
      ${ruleHtml}`;
  };
})();
