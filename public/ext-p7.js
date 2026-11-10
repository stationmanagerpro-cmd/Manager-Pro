/* Priorité 7 — Rapport consolidé de quart (fiche complète) */
(function () {
  if (typeof V === 'undefined' || typeof VM === 'undefined') return;

  function safeEsc(v) {
    try { return typeof esc === 'function' ? esc(v == null ? '' : String(v)) : String(v == null ? '' : v); }
    catch (_) { return String(v == null ? '' : v); }
  }
  function safeF(v) {
    try { return typeof f === 'function' ? f(v) : (v == null ? '—' : String(v)); }
    catch (_) { return String(v == null ? '—' : v); }
  }
  function safeDt(v) {
    try { return typeof dt === 'function' ? dt(v) : (v ? String(v) : '—'); }
    catch (_) { return v ? String(v) : '—'; }
  }
  function safeT(headers, rows) {
    try {
      if (typeof T === 'function') return T(headers, rows);
    } catch (_) {}
    if (!rows || !rows.length) return '<p class="muted">Aucune donnée</p>';
    return '<table><thead><tr>' + headers.map(h => '<th>' + h + '</th>').join('') +
      '</tr></thead><tbody>' + rows.map(r => '<tr>' + r.map(c => '<td>' + c + '</td>').join('') + '</tr>').join('') +
      '</tbody></table>';
  }

  window.showShiftFull = async function (id) {
    try {
      id = Number(id);
      if (!id || Number.isNaN(id)) {
        if (typeof toast === 'function') toast('Identifiant de quart invalide', 'error');
        return;
      }
      if (typeof toast === 'function') toast('Chargement de la fiche…', 'info');
      let d;
      // Pas de repli silencieux : un faux rapport à 0 est pire qu'un message d'erreur clair.
      d = await G('/shifts/' + id + '/full');
      const s = d.shift || {};
      const sum = d.summary || {};
      if (d.own_report) {
        const reportText = typeof d.report === 'string' ? d.report : JSON.stringify(d.report || {}, null, 2);
        modal(`<h3>Mon rapport de quart N° ${safeEsc(s.number)} · ${safeEsc(s.status)}</h3>
          <p>${safeEsc(s.kind)} · ${safeDt(s.opened_at)} → ${s.closed_at ? safeDt(s.closed_at) : 'en cours'}</p>
          <p>Consultation en lecture seule.</p>
          <pre style="white-space:pre-wrap;max-height:55vh;overflow:auto">${safeEsc(reportText || 'Aucun rapport de clôture.')}</pre>
          <div class="r"><button class="b2" type="button" onclick="closeM()">Fermer</button></div>`);
        return;
      }
      const kpi = (l, v) => `<div class="card"><small>${safeEsc(l)}</small><b>${v}</b></div>`;
      const liters = sum.fuel_liters != null ? Number(sum.fuel_liters) : 0;
      modal(`<h3 style="margin-top:0">Quart N° ${safeEsc(s.number)} · ${safeEsc(s.status)}</h3>
        <p style="font-size:13px">
          ${safeEsc(s.kind)} · ${safeDt(s.opened_at)} → ${s.closed_at ? safeDt(s.closed_at) : 'en cours'}<br/>
          Ouvert par ${safeEsc(s.opened_by || '')} · Caisse ${safeEsc(s.cash_register || '')}<br/>
          Ouverture ${safeF(s.opening_cash)} · Théorique ${safeF(s.theoretical_cash)} · Compté ${safeF(s.counted_cash)} · Écart ${safeF(s.cash_gap)}
        </p>
        <div class="cards">
          ${kpi('Ventes (total)', safeF(sum.sales_total))}
          ${kpi('Ventes produits', safeF(sum.product_sales_amount))}
          ${kpi('Carburant' + (sum.fuel_is_live ? ' (déclaré)' : ''), safeF(sum.fuel_amount))}
          ${kpi('Litres' + (sum.fuel_is_live ? ' (déclarés)' : ''), liters + ' L')}
          ${kpi('Nb ventes', sum.sales_count || 0)}
          ${kpi('Dépenses', safeF(sum.expenses_total))}
          ${kpi('Anomalies', sum.anomalies_count || (d.anomalies || []).length || 0)}
          ${kpi('Écarts', sum.gaps_count || 0)}
        </div>
        <h4>Équipe</h4>
        ${safeT(['Matricule', 'Nom', 'Poste'], (d.employees || []).map(e => [
          safeEsc(e.matricule), safeEsc((e.first_name || '') + ' ' + (e.last_name || '')), safeEsc(e.position)
        ]))}
        <h4>Compteurs</h4>
        ${safeT(['Pompe', 'Cpt', 'Produit', 'Début', 'Fin', 'Litres', 'Montant'], (d.meters || []).map(m => [
          safeEsc(m.pump), m.counter_number, safeEsc(m.product),
          m.index_start, m.index_end, m.liters, safeF(m.amount)
        ]))}
        <h4>Paiements</h4>
        ${safeT(['Mode', 'Nb', 'Montant'], (d.payments_by_method || []).map(p => [
          safeEsc(p.method), p.n, safeF(p.amount)
        ]))}
        <h4>Dépenses</h4>
        ${safeT(['Catégorie', 'Montant', 'Mode'], (d.expenses || []).map(e => [
          safeEsc(e.category), safeF(e.amount), safeEsc(e.method)
        ]))}
        <h4>Anomalies</h4>
        ${safeT(['Type', 'Description', 'Montant'], (d.anomalies || []).map(a => [
          safeEsc(a.kind), safeEsc(a.description), safeF(a.amount)
        ]))}
        <h4>Avances (période du quart)</h4>
        ${safeT(['Employé', 'Montant', 'Motif', 'Statut'], (d.advances_during_shift || []).map(a => [
          safeEsc(a.employee), safeF(a.amount), safeEsc(a.reason || ''), safeEsc(a.status)
        ]))}
        <p><b>Justification écart</b> : ${safeEsc(s.gap_justification || '—')}</p>
        <p><b>Observations</b> : ${safeEsc(s.observations || '—')}</p>
        <div class="r" style="margin-top:12px">
          <button class="b2" type="button" onclick="closeM()">Fermer</button>
          ${s.status === 'ferme' ? `<button class="b2" type="button" onclick="closeM();go('rapq',${Number(s.id)})">Rapport clôture</button>` : ''}
          ${s.status === 'ferme' ? `<button class="b2" type="button" onclick="typeof dlFile==='function'&&dlFile('/shifts/${Number(s.id)}/report.pdf','quart-${safeEsc(s.number)}')">PDF</button>` : ''}
        </div>`);
    } catch (e) {
      console.error('[showShiftFull]', e);
      const msg = typeof errMsg === 'function' ? errMsg(e) : (e && e.message) || String(e);
      if (typeof toast === 'function') toast(msg || 'Impossible de charger la fiche du quart', 'error');
    }
  };

  /* L'ancien tableau « Historique des quarts » (doublon de la liste principale) est supprimé :
     la liste des quarts porte désormais « Voir » (fiche complète) et « Afficher » (ventes du quart). */
})();
