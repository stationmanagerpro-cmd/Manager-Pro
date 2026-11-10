/* Dashboard Jour J, déclarations, notifications, audit enrichi */
(function () {
  if (typeof V === 'undefined' || typeof VM === 'undefined') return;

  async function vJour() {
    const d = await G('/dashboard/jour').catch(e => ({ error: e.message }));
    if (d.error) return `<p class="warn">${esc(d.error)}</p>`;
    const k = d.kpis || {};
    const alerts = (d.alerts || []).map(a =>
      `<li><span class="tag ${a.level === 'critical' || a.level === 'warning' ? 'x' : ''}">${esc(a.level)}</span> <b>${esc(a.type)}</b> — ${esc(a.message)}</li>`
    ).join('');
    const low = (d.low_stock || []).map(x => `<li>${esc(x.name)} : ${x.quantity} / min ${x.min_stock}</li>`).join('');
    const cash = (k.cash_registers || []).map(c => `<li>${esc(c.name)} : ${Number(c.balance).toLocaleString('fr-FR')}</li>`).join('');
    return `<h2 style="margin-top:0">Journée — ${esc(d.date)}</h2>
      <div class="cards">
        ${card('Ventes produits', k.product_sales)}
        ${card('Carburant', k.fuel_amount)}
        ${card('Litres', k.fuel_liters)}
        ${card('Dépenses', k.expenses)}
      </div>
      <div class="card"><h3 style="margin-top:0">Alertes</h3>
        <ul style="font-size:13px">${alerts || '<li>Aucune</li>'}</ul>
        <p style="font-size:12px;color:var(--m)">Période paie : ${esc(d.payroll_period || 'ouvert')}</p>
      </div>
      <div class="card"><h3 style="margin-top:0">Caisses</h3><ul style="font-size:13px">${cash || '<li>—</li>'}</ul></div>
      <div class="card"><h3 style="margin-top:0">Stock bas</h3><ul style="font-size:13px">${low || '<li>Aucun</li>'}</ul></div>
      <div class="bar">
        <button class="b2" onclick="go('dash')">Dashboard classique</button>
        <button class="b2" onclick="go('declarations')">Déclarations</button>
        <button class="b2" onclick="go('auditx')">Audit</button>
        <button onclick="opsScanNotif()">Scanner alertes</button>
        <button class="b2" onclick="opsEmailDigest()">E-mail digest</button>
      </div>`;
  }

  async function vDeclarations() {
    const month = (typeof EMON !== 'undefined' && EMON) || new Date().toISOString().slice(0, 7);
    const d = await G('/hr/declarations?month=' + month).catch(e => ({ error: e.message }));
    if (d.error) return `<p class="warn">${esc(d.error)}</p><p class="muted">Si le message parle de schéma, sauvegardez la base puis lancez <code>npm run migrate</code> (migrations 003–009) sans réinitialiser les données.</p>`;
    const s = d.summary || {};
    const schemaWarn = s.schema_note ? `<div class="warn" style="margin-top:8px">${esc(s.schema_note)}</div>` : '';
    return `<h2 style="margin-top:0">Déclarations sociales & fiscales — ${esc(s.month || month)}</h2>
      <div class="muted" style="font-size:13px">${esc(s.note || '')}</div>
      ${schemaWarn}
      <div class="cards">
        ${card('Salariés', s.employees || 0)}
        ${card('Brut', s.gross_total)}
        ${card('ITS', s.its_total)}
        ${card('INPS sal.', s.inps_employee_total)}
        ${card('INPS pat.', s.inps_employer_total)}
        ${card('AMO sal.', s.amo_employee_total)}
        ${card('AMO pat.', s.amo_employer_total)}
        ${card('Charges pat.', s.employer_charges_total)}
        ${card('Net', s.net_total)}
      </div>
      ${T(['Matricule', 'Nom', 'Brut', 'ITS', 'INPS S', 'AMO S', 'Net', 'Statut'], (d.lines || []).map(x => [
        esc(x.matricule), esc(x.last_name + ' ' + x.first_name), x.gross_pay, x.its_amount, x.inps_employee, x.amo_employee, x.net_pay, esc(x.status)
      ]))}
      <div class="bar">
        <button onclick="dlFile('/hr/declarations?month=${month}&format=csv','declarations-${month}.csv')">Export CSV</button>
        <button class="b2" onclick="go('jour')">Jour J</button>
      </div>`;
  }

  async function vAuditX() {
    const from = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
    const to = new Date().toISOString().slice(0, 10);
    const modules = await G('/audit/modules').catch(() => []);
    const modOpts = [['', 'Tous modules'], ...(modules || []).map(m => [m.module, `${m.module} (${m.n})`])];
    return `<h2 style="margin-top:0">Journal d'audit (filtres)</h2>
      <div class="bar" style="flex-wrap:wrap;gap:8px">
        <input id="af_from" type="date" value="${from}">
        <input id="af_to" type="date" value="${to}">
        <input id="af_login" class="q" placeholder="Login">
        <input id="af_q" class="q" placeholder="Recherche action…">
        <select id="af_mod">${modOpts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select>
        <button onclick="auditSearch()" title="Appliquer les filtres du journal">Filtrer</button>
        <button class="b2" onclick="auditExport('xlsx')" title="Exporter les résultats en fichier compatible Excel">Exporter Excel</button>
        <button class="b2" onclick="auditExport('pdf')" title="Imprimer ou enregistrer le journal en PDF">Exporter PDF</button>
      </div>
      <div id="audit_results"><p style="color:var(--m)">Cliquez sur Filtrer.</p></div>`;
  }

  window.auditExport = safe(async (format) => {
    const qs = new URLSearchParams({ limit: 500 });
    for (const [id, key] of [['af_from','from'],['af_to','to'],['af_login','login'],['af_q','q'],['af_mod','module']]) {
      const value = document.getElementById(id)?.value;
      if (value) qs.set(key, value);
    }
    const d = await G('/audit/search?' + qs.toString());
    const lines = [['Date','Utilisateur','Module','Action','Avant','Après'], ...(d.lines || []).map(a => [a.created_at || '', a.login || '', a.module || '', a.action || '', a.old_value ? JSON.stringify(a.old_value) : '', a.new_value ? JSON.stringify(a.new_value) : ''])];
    if (format === 'xlsx') {
      const csv = '\ufeff' + lines.map(row => row.map(v => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(';')).join('\r\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob); const a = document.createElement('a');
      a.href = url; a.download = 'journal-audit.csv'; a.click(); URL.revokeObjectURL(url);
      toast('Export compatible Excel téléchargé', 'success'); return;
    }
    const escHtml = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const html = '<!doctype html><html lang="fr"><meta charset="utf-8"><title>Journal d’audit</title><style>body{font:12px Arial;margin:20px}h1{font-size:18px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #bbb;padding:5px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#eee}@media print{button{display:none}}</style><h1>Journal d’audit</h1><p>Généré le ' + new Date().toLocaleString('fr-FR') + '</p><button onclick="print()">Imprimer / Enregistrer en PDF</button><table><thead><tr>' + lines[0].map(x => '<th>' + escHtml(x) + '</th>').join('') + '</tr></thead><tbody>' + lines.slice(1).map(row => '<tr>' + row.map(x => '<td>' + escHtml(x) + '</td>').join('') + '</tr>').join('') + '</tbody></table></html>';
    const w = window.open('', '_blank'); if (!w) throw new Error('Autorisez les fenêtres contextuelles pour exporter le PDF');
    w.document.write(html); w.document.close();
  });

  window.auditSearch = safe(async () => {
    const from = document.getElementById('af_from')?.value;
    const to = document.getElementById('af_to')?.value;
    const login = document.getElementById('af_login')?.value;
    const q = document.getElementById('af_q')?.value;
    const module = document.getElementById('af_mod')?.value;
    const qs = new URLSearchParams({ limit: 150 });
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    if (login) qs.set('login', login);
    if (q) qs.set('q', q);
    if (module) qs.set('module', module);
    const d = await G('/audit/search?' + qs.toString());
    const el = document.getElementById('audit_results');
    if (!el) return;
    el.innerHTML = `<p style="font-size:12px;color:var(--m)">${d.total || 0} résultat(s)</p>` +
      T(['Date', 'User', 'Module', 'Action', 'Avant', 'Après'], (d.lines || []).map(a => [
        dt(a.created_at), esc(a.login || ''), esc(a.module), esc(a.action),
        esc(a.old_value ? JSON.stringify(a.old_value).slice(0, 80) : ''),
        esc(a.new_value ? JSON.stringify(a.new_value).slice(0, 80) : '')
      ]));
  });

  window.opsScanNotif = safe(async () => {
    const r = await Po('/notifications/scan', {});
    const created = r.created || 0;
    const skipped = r.skipped || 0;
    if (created === 0 && skipped > 0) {
      toast(skipped + ' alerte(s) déjà signalée(s) dans les 24 h (aucun doublon créé)', 'info');
    } else if (created === 0) {
      toast('Aucune nouvelle alerte', 'info');
    } else {
      toast(created + ' alerte(s) créée(s)' + (skipped ? ', ' + skipped + ' ignorée(s) (24 h)' : ''), 'success');
    }
    go('alert');
  });
  window.opsEmailDigest = safe(async () => {
    const to = prompt('E-mail destinataire (vide = e-mail station) :') || undefined;
    const r = await Po('/notifications/email-digest', to ? { to } : {});
    toast(r.sent ? 'Digest envoyé à ' + r.to : (r.note || 'Rien à envoyer'), r.sent ? 'success' : undefined);
  });

  Object.assign(V, {
    jour: ['Jour J', 'report.view|finance.view'],
    declarations: ['Déclarations', 'hr.payroll|hr.manage|report.view'],
    auditx: ['Audit filtré', 'audit.view']
  });
  Object.assign(VM, {
    jour: vJour,
    declarations: vDeclarations,
    auditx: vAuditX
  });
})();
