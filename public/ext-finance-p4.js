/* Priorité 4 — Journal financier (filtre entre deux dates + export PDF) */
(function () {
  if (typeof V === 'undefined' || typeof VM === 'undefined') return;
  const DIR = { in: 'Entrée', out: 'Sortie' };
  const dirFr = d => DIR[d] || d || '';
  const monthStart = () => { const n = new Date(); return RT.iso(new Date(n.getFullYear(), n.getMonth(), 1)); };

  async function vFinEvents() {
    // Période par défaut = mois en cours (comportement historique) ; « Réinitialiser » y revient.
    RT.register('finevents', { view: 'finevents', defFrom: monthStart, defTo: RT.today, pdf: finPdf });
    const q = RT.query('finevents');
    const d = await G(`/finance/events?${q}&limit=100`).catch(e => ({ error: e.message, lines: [] }));
    if (d.error && !d.lines.length && !d.totals) return `<p class="warn">${esc(d.error)}</p>`;
    const tot = d.period_totals || d.totals || {};          // totaux de TOUTE la période (pas seulement des lignes affichées)
    const lines = d.lines || [], total = tot.count != null ? tot.count : lines.length;
    return `<h2 style="margin-top:0">Journal financier</h2>
      <p style="font-size:12px;color:var(--m)">${esc(d.note || '')}</p>
      ${RT.bar('finevents')}
      <div class="cards">${card('Entrées', f(tot.in))}${card('Sorties', f(tot.out))}${card('Net', f(tot.net))}${card('Opérations', total)}</div>
      ${total > lines.length ? `<p class="muted" style="font-size:12px">${lines.length} lignes affichées sur ${total} : les totaux couvrent toute la période et le PDF contient toutes les lignes.</p>` : ''}
      ${T(['Date', 'Type', 'Sens', 'Montant', 'Mode', 'Libellé'], lines.map(x => [
        dt(x.event_at), esc(x.event_type), esc(dirFr(x.direction)), f(x.amount), esc(x.method || ''), esc(x.label)
      ]))}
      <div class="bar"><button class="b2" onclick="go('caisse')">Caisse</button></div>`;
  }

  /** PDF : mêmes dates/filtres que l'écran, TOUTES les lignes de la période (jusqu'à 5 000) et totaux exacts. */
  async function finPdf() {
    const q = RT.query('finevents');
    const d = await G(`/finance/events?${q}&limit=5000`);
    const lines = d.lines || [];
    if (!lines.length) { toast('Aucune opération sur la période : rien à exporter', 'info'); return null; }
    const t = d.period_totals || d.totals || {};
    const notes = (t.truncated ? ['Affichage limité aux 5 000 lignes les plus récentes ; les totaux ci-dessus couvrent toute la période.'] : [])
      .concat(['Entrées et sorties ne sont pas additionnées dans le tableau : voir la synthèse (Net = Entrées - Sorties).']);
    return {
      title: 'Journal financier', subtitle: 'Mouvements financiers normalisés', period: RT.label('finevents'), filename: 'journal-financier',
      sections: [
        RT.H.kv('Filtres appliqués', [['Période', RT.label('finevents')], ['Opérations', String(t.count != null ? t.count : lines.length)]]),
        RT.H.kpis([{ label: 'Entrées (' + RT.H.cur() + ')', value: t.in || 0 }, { label: 'Sorties (' + RT.H.cur() + ')', value: t.out || 0 }, { label: 'Net (' + RT.H.cur() + ')', value: t.net || 0 }], 'Synthèse'),
        { type: 'table', title: 'Opérations', head: ['Date', 'Type', 'Sens', 'Montant (' + RT.H.cur() + ')', 'Mode', 'Libellé'], rows: lines.map(x => [RT.H.dateTime(x.event_at), x.event_type, dirFr(x.direction), Number(x.amount) || 0, x.method || '', x.label || '']), notes }
      ]
    };
  }

  Object.assign(V, { finevents: ['Journal finance', 'finance.view|cash.manage|money.manage'] });
  Object.assign(VM, { finevents: vFinEvents });
})();
