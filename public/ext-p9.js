/* Priorité 9 — Hub exports PDF / Excel */
(function () {
  if (typeof V === 'undefined' || typeof VM === 'undefined') return;

  async function vExports() {
    const kinds = await G('/exports/kinds').catch(() => []);
    const from = new Date().toISOString().slice(0, 8) + '01';
    const to = new Date().toISOString().slice(0, 10);
    const rows = (kinds || []).map(k => [
      esc(k.label),
      `<button class="b2" onclick="dlFile('/exports/${k.key}?from=${from}&to=${to}&format=pdf','${k.key}')">PDF</button>
       <button class="b2" onclick="dlFile('/exports/${k.key}?from=${from}&to=${to}&format=xlsx','${k.key}')">Excel</button>`
    ]);
    return `<h2 style="margin-top:0">Exports</h2>
      <p style="font-size:13px;color:var(--m)">Période par défaut : ${from} → ${to}. Les exports finance avancés restent dans Finance.</p>
      <div class="bar">
        <input id="ex_from" type="date" value="${from}">
        <input id="ex_to" type="date" value="${to}">
        <button class="b2" onclick="go('exports')">Actualiser</button>
      </div>
      ${T(['Rapport', 'Télécharger'], rows)}
      <p style="font-size:12px;color:var(--m)">Aussi : déclarations RH, rapports finance, bulletins PDF.</p>`;
  }

  // Use date inputs if user changed them - override download via helper
  window.exportDl = safe(async (key, fmt) => {
    const from = document.getElementById('ex_from')?.value || new Date().toISOString().slice(0, 8) + '01';
    const to = document.getElementById('ex_to')?.value || new Date().toISOString().slice(0, 10);
    dlFile(`/exports/${key}?from=${from}&to=${to}&format=${fmt}`, key);
  });

  // Better buttons with exportDl
  VM.exports = async function () {
    const kinds = await G('/exports/kinds').catch(() => []);
    const from = new Date().toISOString().slice(0, 8) + '01';
    const to = new Date().toISOString().slice(0, 10);
    const colorsPanel = !ME?.is_global && (can('appearance.manage') || can('settings.edit')) ? `<div class="card" style="margin:12px 0"><b>Couleurs des rapports</b><p style="font-size:12px;color:var(--m)">Personnalisation globale pour les rapports PDF et Excel, uniquement si le Super Admin l’a autorisée dans le contrat.</p><button class="b2" onclick="editExportColors()">Personnaliser les couleurs</button></div>` : '';
    return `<h2 style="margin-top:0">Exports PDF / Excel</h2>${colorsPanel}
      <div class="bar">
        <label>Du <input id="ex_from" type="date" value="${from}"></label>
        <label>Au <input id="ex_to" type="date" value="${to}"></label>
      </div>
      ${T(['Rapport', 'PDF', 'Excel'], (kinds || []).map(k => [
        esc(k.label),
        `<button class="b2" onclick="exportDl('${k.key}','pdf')">PDF</button>`,
        `<button class="b2" onclick="exportDl('${k.key}','xlsx')">Excel</button>`
      ]))}
      <div class="bar">
        <button class="b2" onclick="go('declarations')">Déclarations sociales</button>
        <button class="b2" onclick="go('finevents')">Journal finance</button>
      </div>`;
  };

  window.editExportColors = safe(async () => {
    let c;
    try { c = await G('/report-export-colors'); }
    catch (e) { toast('Cette option doit être autorisée par le Super Admin dans le contrat client.', 'error'); return; }
    modal(`<h3>Couleurs globales des rapports</h3><div class="g">
      <label>Couleur principale <input id="erc_primary" type="color" value="${esc(c.primary || '#0A6B5C')}"></label>
      <label>Fond des en-têtes <input id="erc_secondary" type="color" value="${esc(c.secondary || '#E8F3F0')}"></label>
      <label>Couleur du texte <input id="erc_text" type="color" value="${esc(c.text || '#111827')}"></label></div>
      <p style="font-size:12px;color:var(--m)">Les couleurs s’appliqueront aux prochains exports PDF et Excel de toutes les stations rattachées à ce client.</p>
      <div class="r"><button class="b2" onclick="closeM()">Annuler</button><button onclick="saveExportColors()">Enregistrer</button></div>`);
  });
  window.saveExportColors = safe(async () => {
    const colors = { primary: $('#erc_primary').value, secondary: $('#erc_secondary').value, text: $('#erc_text').value };
    // Serveur attend PUT (pas POST).
    await api('PUT', '/report-export-colors', { colors }); closeM(); toast('Couleurs globales des rapports enregistrées', 'success');
  });

  Object.assign(V, { exports: ['Exports', 'report.view|finance.view|cash.manage'] });
})();
