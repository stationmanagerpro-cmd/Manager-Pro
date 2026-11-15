/* « Ma journée » : synthèse du jour, objectif du mois, classement des employés (gérant). */
(function () {
  'use strict';
  const money = n => Math.round(Number(n) || 0).toLocaleString('fr-FR').replace(/ /g, ' ') + ' F';
  const lit = n => Math.round(Number(n) || 0).toLocaleString('fr-FR').replace(/ /g, ' ') + ' L';
  const STATUS = { atteint: ['🎯 Objectif atteint', '#16a34a'], en_avance: ['✅ En avance', '#16a34a'], dans_le_rythme: ['🟡 Dans le rythme', '#d97706'], en_retard: ['🔴 En retard', '#dc2626'] };

  window.smpMyDay = async function () {
    let d; try { d = await G('/my-day'); } catch (e) { return toast('Indisponible : ' + (e.message || e)); }
    const card = (t, v, sub) => '<div style="flex:1;min-width:130px;border:1px solid var(--bd,#e2e8f0);border-radius:12px;padding:10px"><div style="font-size:12px;color:var(--m)">' + t + '</div><div style="font-size:20px;font-weight:700">' + v + '</div>' + (sub ? '<div style="font-size:12px;color:var(--m)">' + sub + '</div>' : '') + '</div>';
    const tg = d.target;
    const gauge = tg ? (function () {
      const st = STATUS[tg.status] || ['', '#64748b'], f = v => tg.type === 'liters' ? lit(v) : money(v);
      return '<div style="margin:10px 0"><b>Objectif du mois</b> — ' + f(tg.done) + ' / ' + f(tg.value) + ' (' + tg.pct + ' %)<div style="height:12px;background:#e2e8f0;border-radius:8px;overflow:hidden;margin:6px 0"><div style="height:100%;width:' + Math.min(100, tg.pct) + '%;background:' + st[1] + '"></div></div>'
        + '<small style="color:' + st[1] + '">' + st[0] + '</small> <small style="color:var(--m)">· rythme attendu ' + tg.expected_pct + ' % · reste ' + f(tg.remaining) + '</small></div>';
    })() : '<p style="color:var(--m);margin:10px 0">Aucun objectif de ventes défini pour ce mois.</p>';
    const shifts = d.open_shifts.length ? d.open_shifts.map(s => '<li>Quart n° ' + esc(String(s.number)) + ' (' + esc(s.kind) + ') — ' + esc(s.manager) + ', ouvert à ' + new Date(s.opened_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) + '</li>').join('') : '<li>Aucun quart ouvert</li>';
    const low = d.tank_low.length ? d.tank_low.map(t => '<li>⛽ ' + esc(t.name) + ' : ~' + lit(t.stock) + ' (' + (t.days <= 0 ? 'vide' : Math.floor(t.days) + ' j restants') + ')</li>').join('') : '<li>Niveaux de cuves corrects</li>';
    const rk = d.ranking.length ? '<div style="overflow:auto;max-height:240px"><table style="width:100%"><thead><tr><th>#</th><th>Employé</th><th>Ventes (30 j)</th><th>Montant</th><th>Écarts de caisse</th></tr></thead><tbody>'
      + d.ranking.map((x, i) => '<tr><td>' + (i + 1) + '</td><td><b>' + esc(x.name) + '</b><br><small>' + esc(x.position || '') + '</small></td><td>' + x.sales_count + '</td><td>' + money(x.amount) + '</td><td>' + (x.gap_shifts ? '<span style="color:#dc2626">' + x.gap_shifts + ' quart(s) · ' + money(x.gap_total) + '</span>' : '—') + '</td></tr>').join('') + '</tbody></table></div>' : '<p style="color:var(--m)">Aucune vente enregistrée sur 30 jours.</p>';
    modal('<h3>📅 Ma journée <small style="color:var(--m);font-weight:400">' + new Date(d.date).toLocaleDateString('fr-FR') + '</small></h3>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap">' + card('Ventes du jour', money(d.today.amount), lit(d.today.liters) + ' de carburant') + card('Ventes du mois', money(d.month.amount), lit(d.month.liters) + ' de carburant') + card('Quarts ouverts', d.open_shifts.length) + '</div>'
      + gauge
      + '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:8px"><small>Objectif :</small><select id="md_t"><option value="amount"' + (!tg || tg.type === 'amount' ? ' selected' : '') + '>Montant (F)</option><option value="liters"' + (tg && tg.type === 'liters' ? ' selected' : '') + '>Litres</option></select><input id="md_v" type="number" min="0" step="1" value="' + (tg ? tg.value : '') + '" style="width:130px" placeholder="0 = aucun"><button class="btn" onclick="smpMyDayTarget()">Enregistrer</button></div>'
      + '<b>Quarts</b><ul style="margin:4px 0 8px;padding-left:18px">' + shifts + '</ul><b>Cuves</b><ul style="margin:4px 0 8px;padding-left:18px">' + low + '</ul>'
      + '<b>Classement des employés</b>' + rk
      + '<div style="text-align:right;margin-top:10px"><button class="btn" onclick="smpMyDay()">↻ Actualiser</button> <button class="btn" onclick="closeM()">Fermer</button></div>');
  };
  window.smpMyDayTarget = async function () {
    try { await Pu('/my-day/target', { type: document.getElementById('md_t').value, value: Number(document.getElementById('md_v').value) || 0 }); toast('Objectif enregistré'); smpMyDay(); }
    catch (e) { toast('Erreur : ' + (e.message || e)); }
  };
})();
