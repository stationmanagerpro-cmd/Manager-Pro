/* Priorité 5 — Caisse consolidée */
(function () {
  if (typeof VM === 'undefined') return;

  /** Export PDF « Caisse & liquidités » : indicateurs, caisses, comptes, dépenses et journal financier du jour. */
  window.caissePdf = async function () {
    try {
      const d = await G('/cash/overview');
      const L = d.liquidity || {}, exp = (d.expenses_today && d.expenses_today.by_category) || [], ev = d.events_today || [], reg = d.registers || [], acc = d.accounts || [];
      const m = v => f(v).replace(/\u2212/g, '-'), n = v => Math.round(Number(v) || 0);
      const sections = [{ type: 'kpis', title: 'Liquidités et position', items: [
        { label: 'Espèces', value: m(L.cash) }, { label: 'Mobile Money', value: m(L.mobile_money) }, { label: 'Banques', value: m(L.bank) },
        { label: 'Liquidité totale', value: m(L.total) }, { label: 'Créances clients', value: m((d.receivables || {}).total) }, { label: 'Dettes fournisseurs', value: m((d.payables || {}).total) },
        { label: 'Position nette', value: m(d.net_position) }, { label: 'Dépenses du jour', value: m((d.expenses_today || {}).total) }] }];
      if (d.gaps && d.gaps.open_count) sections.push({ type: 'text', text: d.gaps.open_count + ' écart(s) de caisse non clôturé(s) pour ' + m(d.gaps.amount) + '.' });
      sections.push({ type: 'table', title: 'Caisses', head: ['Caisse', 'Solde'], rows: reg.map(x => [x.name, n(x.balance)]), totals: reg.length ? ['Total caisses', reg.reduce((a, x) => a + n(x.balance), 0)] : undefined });
      sections.push({ type: 'table', title: 'Comptes (Mobile Money / banques)', head: ['Type', 'Nom', 'Solde'], rows: acc.map(a => [a.kind, a.name, n(a.balance)]), totals: acc.length ? ['Total comptes', '', acc.reduce((t, a) => t + n(a.balance), 0)] : undefined });
      sections.push({ type: 'table', title: 'Dépenses du jour', head: ['Catégorie', 'Nb', 'Total'], rows: exp.map(e => [e.category, n(e.n), n(e.total)]), totals: exp.length ? ['Total', exp.reduce((a, e) => a + n(e.n), 0), exp.reduce((a, e) => a + n(e.total), 0)] : undefined });
      sections.push({ type: 'table', title: 'Journal financier du jour', head: ['Type', 'Sens', 'Nb', 'Montant'], rows: ev.map(e => [e.event_type, e.direction, n(e.n), n(e.total)]) });
      if (L.note) sections.push({ type: 'text', text: String(L.note) });
      toast('Génération du PDF…', 'info');
      await brandedPdf({ title: 'Caisse et liquidités', subtitle: 'Situation du ' + String(d.date || '').split('-').reverse().join('/'), sections, filename: 'caisse_' + (d.date || ''), signatures: [{ label: 'Caissier / Trésorier' }, { label: 'Direction' }] });
    } catch (e) { if (!e || !e.stale) toast((e && e.message) || 'Export PDF impossible', 'error'); }
  };

  VM.caisse = async function vCaisseP5() {
    const d = await G('/cash/overview').catch(e => ({ error: e.message }));
    if (d.error) return `<p class="warn">${esc(d.error)}</p>`;
    const L = d.liquidity || {};
    const exp = (d.expenses_today && d.expenses_today.by_category) || [];
    const ev = d.events_today || [];
    const reg = d.registers || [];
    const acc = d.accounts || [];
    return `<h2 style="margin-top:0">Caisse & liquidités — ${esc(d.date)}</h2>
      <div class="cards">
        ${card('Espèces', L.cash)}
        ${card('Mobile Money', L.mobile_money)}
        ${card('Banques', L.bank)}
        ${card('Liquidité totale', L.total)}
        ${card('Créances clients', (d.receivables || {}).total)}
        ${card('Dettes fournisseurs', (d.payables || {}).total)}
        ${card('Position nette', d.net_position)}
        ${card('Dépenses du jour', (d.expenses_today || {}).total)}
      </div>
      ${(d.gaps && d.gaps.open_count) ? `<div class="warn">${d.gaps.open_count} écart(s) de caisse non clôturé(s) · ${f(d.gaps.amount)}</div>` : ''}
      <div class="bar">
        ${can('expense.create') ? `<button onclick="addX()">Nouvelle dépense</button>` : ''}
        ${can('cash.manage') ? `<button class="b2" onclick="addM()">Mouvement de caisse</button>` : ''}
        <button class="b2" onclick="go('finevents')">Journal finance</button>
        <button class="b2" onclick="go('cli')">Créances</button>
        <button class="b2" onclick="go('four')">Dettes four.</button>
        <button class="b2" onclick="caissePdf()">📄 Export PDF</button>
      </div>
      <h3>Caisses</h3>
      <div class="cards">${reg.map(x => `<div class="card"><small>${esc(x.name)}</small><b>${f(x.balance)}</b></div>`).join('') || '<p>—</p>'}</div>
      <h3>Comptes (MM / banques)</h3>
      ${T(['Type', 'Nom', 'Solde'], acc.map(a => [esc(a.kind), esc(a.name), f(a.balance)]))}
      <h3>Dépenses du jour</h3>
      ${T(['Catégorie', 'Nb', 'Total'], exp.map(e => [esc(e.category), e.n, f(e.total)]))}
      <h3>Journal financier du jour</h3>
      ${T(['Type', 'Sens', 'Nb', 'Montant'], ev.map(e => [esc(e.event_type), esc(e.direction), e.n, f(e.total)]))}
      <p style="font-size:12px;color:var(--m)">${esc((L.note) || '')}</p>`;
  };
})();
