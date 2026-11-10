/* Priorité 8 — Centre d'alertes unifié */
(function () {
  if (typeof V === 'undefined' || typeof VM === 'undefined') return;

  async function vAlertCenter() {
    const d = await G('/alerts/center').catch(e => ({ error: e.message, items: [] }));
    if (d.error && !d.items) return `<p class="warn">${esc(d.error)}</p>`;
    const bl = d.by_level || {};
    const items = d.items || [];
    return `<h2 style="margin-top:0">Centre d'alertes</h2>
      <p style="font-size:12px;color:var(--m)">${esc(d.note || '')}</p>
      <div class="cards">
        ${card('Total', d.count || 0)}
        ${card('Critiques', bl.critical || 0)}
        ${card('Avertissements', bl.warning || 0)}
        ${card('Info', bl.info || 0)}
      </div>
      <div class="bar">
        <button onclick="opsScanNotif()">Scanner</button>
        <button class="b2" onclick="opsEmailDigest()">E-mail digest</button>
        <button class="b2" onclick="go('auditx')">Audit filtré</button>
      </div>
      ${T(['Niveau', 'Type', 'Module', 'Message', ''], items.map(a => [
        `<span class="tag ${a.level === 'critical' || a.level === 'warning' ? 'x' : ''}">${esc(a.level)}</span>`,
        esc(a.type), esc(a.module || a.source), esc(a.message),
        (a.source === 'notifications' || a.source === 'hr_alerts') && a.id
          ? `<button class="b2" onclick="ackAlert('${a.source}',${a.id})">OK</button>` : ''
      ]))}
      <p style="font-size:12px;color:var(--m)">Types : ${(d.types || []).join(', ')}</p>`;
  }

  window.ackAlert = safe(async (source, id) => {
    await Po(`/alerts/center/${source}/${id}/ack`, {});
    toast('Acquitté', 'success');
    go('alert');
  });

  // Remplacer la vue alertes simple
  VM.alert = vAlertCenter;
})();
