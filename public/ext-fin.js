'use strict';
// Extensions du client (suite) : centre de rapports financiers, contrôles, validations, et paramètres réorganisés par catégories.
/* safe() est défini dans app.js (chargé avant ext-core.js, qui l'utilise) */
const cellHtml = v => typeof v == 'number' ? fmtN(v) : (typeof v == 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) ? dt(v) : esc(v ?? ''));

/* ---------- Rapports financiers ---------- */
let FIN = { kind: 'consolide', mode: 'period', from: monthFirst(), to: dayNow(), date: dayNow(), level: 'detail', flt: {} }, FDATA = {};
async function vFin() {
  const [kinds, em, pm, pr] = await Promise.all([G('/finance/kinds'), G('/employees').catch(() => []), G('/pumps').catch(() => []), G('/products').catch(() => [])]), o = (a, sel) => a.map(([v, l]) => `<option value="${v}" ${String(v) == String(sel) ? 'selected' : ''}>${esc(l)}</option>`).join(''), F = FIN.flt;
  return `<div class="card"><div class="g">
    <label>Rapport<select id="fk">${o(kinds.map(k => [k.key, k.label]), FIN.kind)}</select></label>
    <label>Type de période<select id="fmd" onchange="finMode()">${o([['period', 'Période (mouvements)'], ['date', 'Date précise (soldes à cette date)']], FIN.mode)}</select></label>
    <label class="fpp">Du<input type="date" id="ffr" value="${FIN.from}"></label><label class="fpp">Au<input type="date" id="fto" value="${FIN.to}"></label><label class="fdd" style="display:none">Date de situation<input type="date" id="fdt" value="${FIN.date}"></label>
    <label>Raccourci<select id="fqk" onchange="finQuick(this.value)">${o([['', '-'], ['today', "Aujourd'hui"], ['yday', 'Hier'], ['week', 'Cette semaine'], ['month', 'Ce mois'], ['quarter', 'Ce trimestre'], ['year', 'Cette année']], '')}</select></label>
    <label>Niveau de détail<select id="flv">${o([['detail', 'Détaillé'], ['summary', 'Synthèse']], FIN.level)}</select></label></div>
    <details style="margin-top:10px"><summary>Filtres (ventes) : employé, pompe, produit, moyen de paiement, quart</summary><div class="g" style="margin-top:8px">
    <label>Employé<select id="fe2">${o([['', 'Tous'], ...em.map(e => [e.id, e.first_name + ' ' + e.last_name])], F.employee_id)}</select></label>
    <label>Pompe<select id="fp2">${o([['', 'Toutes'], ...pm.map(p => [p.id, p.name])], F.pump_id)}</select></label>
    <label>Produit<select id="fpr">${o([['', 'Tous'], ...pr.map(p => [p.id, p.name])], F.product_id)}</select></label>
    <label>Moyen de paiement<select id="fmt">${o([['', 'Tous'], ...pmOpts()], F.method)}</select></label>
    <label>N° interne du quart<input id="fsh" type="number" value="${F.shift_id || ''}" placeholder="id du quart"></label></div></details>
    <div class="r"><button class="b2" onclick="finControls()">Contrôles et réconciliations</button><button onclick="finPreview()">Aperçu</button><button class="b2" onclick="finExport('pdf')">Exporter en PDF</button><button class="b2" onclick="finExport('xlsx')">Exporter en Excel</button></div></div><div id="finout"><p style="color:var(--m)">Choisissez un rapport puis « Aperçu ». Les chiffres proviennent uniquement des enregistrements de la base ; ils ne constituent pas un résultat comptable certifié.</p></div>`;
}
function finRead() {
  FIN.kind = $('#fk').value; FIN.mode = $('#fmd').value; FIN.from = $('#ffr').value; FIN.to = $('#fto').value; FIN.date = $('#fdt').value; FIN.level = $('#flv').value;
  FIN.flt = { employee_id: $('#fe2').value, pump_id: $('#fp2').value, product_id: $('#fpr').value, method: $('#fmt').value, shift_id: $('#fsh').value };
  const p = new URLSearchParams(FIN.mode == 'date' ? { date: FIN.date } : { from: FIN.from, to: FIN.to }); for (const [k, v] of Object.entries(FIN.flt)) if (v) p.set(k, v); return p;
}
function finMode() { const d = $('#fmd').value == 'date'; document.querySelectorAll('.fpp').forEach(x => x.style.display = d ? 'none' : ''); document.querySelectorAll('.fdd').forEach(x => x.style.display = d ? '' : 'none'); }
function finQuick(v) {
  if (!v) return; const n = new Date(), t = new Date(n.getFullYear(), n.getMonth(), n.getDate()), iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); let a = t, b = t;
  if (v == 'yday') a = b = new Date(t - 864e5); else if (v == 'week') a = new Date(t - ((t.getDay() + 6) % 7) * 864e5); else if (v == 'month') a = new Date(n.getFullYear(), n.getMonth(), 1); else if (v == 'quarter') a = new Date(n.getFullYear(), Math.floor(n.getMonth() / 3) * 3, 1); else if (v == 'year') a = new Date(n.getFullYear(), 0, 1);
  $('#fmd').value = 'period'; finMode(); $('#ffr').value = iso(a); $('#fto').value = iso(b);
}
function renderSection(s) {
  if (s.type == 'kpis') return `<h3>${esc(s.title || '')}</h3><div class="cards">${s.items.map(k => card(esc(k.label), typeof k.value == 'number' ? f(k.value) : esc(k.value), esc(k.note || ''))).join('')}</div>`;
  if (s.type == 'kv') return (s.title ? `<h3>${esc(s.title)}</h3>` : '') + `<div class="card">${kvh(s.rows.map(([k, v]) => [esc(k), cellHtml(v)]))}</div>`;
  if (s.type == 'text') return (s.title ? `<h3>${esc(s.title)}</h3>` : '') + `<div class="warn">${esc(s.text).replace(/\n/g, '<br>')}</div>`;
  const tot = s.sumCols?.length && s.rows.length ? s.head.map((_, i) => i == 0 ? '<b>Total</b>' : s.sumCols.includes(i) ? `<b>${fmtN(fl(s.rows.reduce((a, r) => a + (+r[i] || 0), 0)))}</b>` : '') : null;
  return `<h3>${esc(s.title || '')}</h3>` + T(s.head.map(esc), [...s.rows.map(r => r.map(cellHtml)), ...(tot ? [tot] : [])]) + (s.notes || []).map(n => `<div class="warn">${esc(n)}</div>`).join('');
}
const finPreview = safe(async () => {
  const q = finRead(), [sit, rep] = await Promise.all([G('/finance/situation?' + q), G(`/finance/report?kind=${FIN.kind}&format=json&level=${FIN.level}&${q}`)]); FDATA = { sit, rep };
  const al = sit.alerts.length ? `<div class="warn err"><b>Alertes</b><br>${sit.alerts.slice(0, 15).map(esc).join('<br>')}</div>` : '';
  $('#finout').innerHTML = `<h2>${esc(rep.title)}</h2><p style="color:var(--m)">${FIN.mode == 'date' ? 'Situation au ' + FIN.date : 'Période du ' + FIN.from + ' au ' + FIN.to}${rep.notes.length ? '' : ''} · Contrôles : ${sit.controls_summary.ok} conformes, ${sit.controls_summary.ecart} écart(s), ${sit.controls_summary.info} à traiter</p>` + rep.notes.map(n => `<div class="warn">${esc(n)}</div>`).join('') + al + (rep.sections.some(s => s.type == 'kpis') ? '' : `<div class="cards">${sit.kpis.slice(0, 6).map(k => card(esc(k.label), typeof k.value == 'number' ? f(k.value) : esc(k.value), esc(k.note))).join('')}</div>`) + rep.sections.map(renderSection).join('') + valPanel();
});
const finControls = safe(async () => {
  const q = finRead(), ls = await G('/finance/controls?' + q);
  $('#finout').innerHTML = '<h2>Contrôles et réconciliations</h2>' + T(['Contrôle', 'Modules', 'Attendu', 'Constaté', 'Écart', 'Statut', 'Action recommandée'], ls.map(c => [esc(c.label), esc(c.modules || ''), c.expected ?? '', c.actual ?? '', c.diff ?? '', `<span class="tag ${c.status == 'ok' ? '' : 'x'}">${c.status == 'ok' ? 'Conforme' : c.status == 'ecart' ? 'ÉCART' : 'À traiter'}</span>`, esc(c.action || c.note || '')])) + '<div class="warn">Aucune anomalie financière n\'est corrigée automatiquement : toute correction passe par une opération autorisée et tracée.</div>';
});
const finExport = safe(async fmt => { const q = finRead(); q.set('kind', FIN.kind); q.set('format', fmt); q.set('level', FIN.level); await dlFile('/finance/report?' + q, `${FIN.kind}-${FIN.mode == 'date' ? FIN.date : FIN.to}`); });
const valPanel = () => `<h3>Validation du rapport</h3><div class="card"><div class="g"><label>Rôle<select id="vr"><option>Préparé par</option><option>Vérifié par</option><option>Approuvé par</option></select></label><label>Action<select id="vs"><option value="prepare">Préparé</option><option value="verifie">Vérifié</option><option value="approuve">Approuvé</option><option value="conteste">Contesté</option></select></label><label>Commentaire (obligatoire si contesté)<input id="vc"></label></div><div class="r"><button onclick="finValidate()">Enregistrer ma validation</button></div><p style="color:var(--m)">La validation enregistre votre identité authentifiée, la date et l'action ; elle apparaît sur le PDF exporté. Les rôles non validés restent à signer à la main.</p></div>`;
const finValidate = safe(async () => { const q = finRead(), p = Object.fromEntries(q), from = p.date || p.from, to = p.date || p.to; await Po('/finance/validations', { report_key: FIN.kind, from, to, role_label: $('#vr').value, status: $('#vs').value, comment: $('#vc').value || undefined }); toast('Validation enregistrée'); });

/* ---------- Paramètres : navigation par catégories ---------- */
let SEC = 'gen', SET = {};
const SECS = [['gen', 'Général', 'settings.edit', 'Station, logo, devise'], ['ident', "Identité de l'application", 'appearance.manage|settings.edit|user.manage', 'Nom, slogan, logo'], ['app', 'Apparence', 'appearance.manage', 'Thème et couleurs'], ['sec', 'Utilisateurs et sécurité', 'user.manage', 'Comptes, rôles, sessions'], ['exp', 'Exploitation', 'settings.edit', 'Carburant, quarts, ventes'], ['fin', 'Finances', 'settings.edit|money.manage', 'Paiements, banques, mobile money'], ['rh', 'Gestion RH', 'hr.manage', 'Règles de paie'], ['doc', 'Rapports et documents', 'appearance.manage', 'Pied de page, mentions'], ['sig', 'Signature', 'appearance.manage|settings.edit', 'Manuscrite ou image, activation'], ['data', 'Données et maintenance', 'user.manage', 'Sauvegardes, informations']];
const check = (id, v, label) => `<label style="flex-direction:row;align-items:center;gap:8px;color:var(--t)"><input type="checkbox" id="${id}" ${v ? 'checked' : ''} style="width:auto"> ${label}</label>`;
async function vParamHub() {
  const vis = SECS.filter(s => (ME.is_global ? s[0] != 'sig' : !['ident', 'data'].includes(s[0])) && can(s[2])); if (!vis.find(s => s[0] == SEC)) SEC = vis[0][0];
  SET = await G('/settings').catch(() => ({}));
  const body = await SEC_FN[SEC]();
  return `<div class="split"><div class="side card">${vis.map(s => `<a class="${s[0] == SEC ? 'on' : ''}" onclick="SEC='${s[0]}';go('param')">${s[1]}<br><small style="font-weight:400;color:var(--m)">${s[3]}</small></a>`).join('')}</div><div class="grow">${body}</div></div>`;
}
const SEC_FN = {
  async gen() { const s = AP.station; return `<h2 style="margin-top:0">Général</h2><p style="color:var(--m);font-size:13px;margin:0 0 8px">Le nom officiel, le slogan, l'adresse et le logo ci-dessous sont ceux de <b>votre station</b> : ils s'affichent en haut de l'écran et sur vos documents. Ils sont indépendants du nom et du logo du site (Manager Pro), gérés par l'administrateur principal.</p><div class="card"><div class="split"><div>${av('stations', SID, s.has_logo, s.name, true)}<br><small style="color:var(--m)">Logo (cliquer)</small>${can('appearance.manage') ? `<br><br><small style="color:var(--m)">Le grand bandeau du tableau de bord se modifie dans <a onclick="openBannerSettings()" style="cursor:pointer;text-decoration:underline">Paramètres → Apparence</a>.</small>` : ''}</div><div class="grow g"><label>Nom officiel de la station<input id="g_name" value="${esc(s.name)}" maxlength="80"></label><label>Slogan de la station<input id="g_tagline" value="${esc(s.tagline)}" maxlength="120" placeholder="ex. Votre carburant, notre engagement"></label><label>Adresse<input id="g_address" value="${esc(s.address)}"></label><label>Latitude<input id="g_lat" inputmode="decimal" placeholder="ex. 12.6392" value="${esc(s.latitude ?? '')}"></label><label>Longitude<input id="g_lng" inputmode="decimal" placeholder="ex. -7.9981" value="${esc(s.longitude ?? '')}"></label><small style="color:var(--m)">Coordonnées GPS décimales de la station (clic droit sur Google Maps → copier les coordonnées). Elles positionnent la station sur la <a onclick="go('carte')" style="cursor:pointer;text-decoration:underline">carte</a>. Laissez les deux champs vides pour ne pas localiser la station.</small><label>Téléphone<input id="g_phone" value="${esc(s.phone)}"></label><label>Email<input id="g_email" value="${esc(s.email)}"></label><label>Devise<input id="g_currency" value="${esc(s.currency)}" maxlength="4"></label><label>Numéro fiscal<input id="g_tax_id" value="${esc(s.tax_id)}"></label></div></div><div class="r"><button onclick="saveGen()">Enregistrer</button></div></div>${ME.is_global && can('user.manage') ? `<div class="bar"><button class="b2" onclick="newStation()">Ajouter une station</button></div>` : ''}<p style="color:var(--m)">La langue et les formats sont le français (dates JJ/MM/AAAA, nombres à l'espace) ; l'heure est celle de l'appareil.</p>`; },
  async app() {
    const t = { ...AP.theme }, sw = ['#0a6b5c', '#0b5fa5', '#3f51b5', '#8e2b3a', '#b45309', '#334155'];
    const bs = AP.station || {};
    const bannerCard = ME.is_global ? '' : `<div class="card" id="a_banner"><h3 style="margin-top:0">Bandeau d'accueil</h3><p style="color:var(--m);font-size:13px;margin:0 0 10px">Le grand bandeau affiché tout en haut du tableau de bord : photo de couverture, titre, slogan, position et couleur du texte. Il ne se modifie qu'ici.</p><button type="button" onclick="openBannerDialog()">🖼 Personnaliser le bandeau</button>${bs.banner_legibility === 'warn' && bs.has_banner ? '<p style="color:#8a5a00;font-weight:700;margin:10px 0 0">⚠ Le nom est difficile à lire sur la photo actuelle</p>' : ''}</div>`;
    return `<h2 style="margin-top:0">Apparence</h2>${bannerCard}<div class="card"><div class="g"><label>Thème<select id="a_mode" onchange="prevTheme()"><option value="light" ${t.mode == 'light' ? 'selected' : ''}>Clair</option><option value="dark" ${t.mode == 'dark' ? 'selected' : ''}>Sombre</option></select></label>
      <label>Couleur principale personnalisée<input type="color" id="a_pri" value="${t.primary}" onchange="prevTheme()"></label><label>Couleur secondaire (textes discrets)<input type="color" id="a_sec" value="${t.secondary}" onchange="prevTheme()"></label></div>
      <p>Palettes : ${sw.map(c => `<span class="sw ${c == t.primary ? 'on' : ''}" style="background:${c}" onclick="$('#a_pri').value='${c}';prevTheme()"></span>`).join('')}</p>
      <div class="card" id="a_prev"></div><div class="r"><button class="b2" onclick="resetTheme()">Réinitialiser</button><button class="b2" onclick="applyAppearance().then(()=>go('param'))">Annuler l'aperçu</button><button onclick="saveTheme()">Enregistrer</button></div></div>
      <div class="warn">Les couleurs des alertes (rouge, orange) et le fonctionnement ne changent pas. Les boutons gardent un texte lisible quelle que soit la couleur choisie.</div>`;
  },
  async sec() {
    const [roles, users] = await Promise.all([G('/admin/roles'), vParam()]);
    return `<h2 style="margin-top:0">Utilisateurs et sécurité</h2>${users}<h3>Rôles et permissions</h3>` + T(['Rôle', 'Permissions'], roles.map(r => [esc(r.label), r.permissions.map(p => `<span class="tag">${esc(p)}</span>`).join(' ') || '-'])) + `<div class="card"><b>Sessions et mots de passe</b><p>Sessions de 12 h révocables ; connexion temporairement bloquée après 5 échecs depuis la même adresse (déblocage possible par un administrateur) ; mots de passe chiffrés (bcrypt) de 8 caractères minimum.</p><div class="bar"><button class="b2" onclick="chgPwd()">Changer mon mot de passe</button><button class="b2" onclick="go('audit')">Ouvrir le journal d'audit</button></div></div>`;
  },
  async exp() { return `<h2 style="margin-top:0">Exploitation</h2><div class="card"><div class="g"><label>Tolérance d'écart de stock carburant (litres)<input id="x_tol" type="number" step="any" value="${SET.tolerance_fuel_liters}"></label></div>${check('x_amt', SET.fuel_amount_entry_allowed, "Autoriser la saisie des ventes de carburant par montant (chiffre d'affaires)")}<div class="r"><button onclick="saveExp()">Enregistrer</button></div></div><div class="bar"><button class="b2" onclick="go('pompes')">Pompes et compteurs</button><button class="b2" onclick="go('prod')">Produits et prix</button><button class="b2" onclick="go('quart')">Quarts de service</button></div><p style="color:var(--m)">Les règles de vente sont appliquées par le serveur : prix lus en base, stock vérifié, quart ouvert obligatoire.</p>`; },
  async fin() {
    const accs = await G('/money/accounts').catch(() => []);
    const recent = await G('/money/recent?limit=15').catch(() => ({ statements: [], deposits: [], transfers: [], movements: [] }));
    const m = SET.payment_methods || [];
    const opts = a => `<option value="">Aucun (non suivi)</option>${accs.map(x => `<option value="${x.id}" ${x.id == a ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}`;
    const empty = msg => `<p style="color:var(--m);font-size:13px;margin:6px 0">${esc(msg)}</p>`;
    const stmts = (recent.statements || []).length
      ? T(['Date relevé', 'Compte', 'Solde relevé', 'Note', 'Saisi le'], recent.statements.map(x => [
          x.statement_date, esc(x.account_name), f(x.balance), esc(x.note || '—'), esc(x.created_at || '') + (x.login ? ' · ' + esc(x.login) : '')
        ]))
      : empty('Aucun relevé saisi pour le moment.');
    const deps = (recent.deposits || []).length
      ? T(['Date', 'Compte', 'Montant', 'Libellé', 'Saisi le'], recent.deposits.map(x => [
          x.moved_on, esc(x.account_name), f(x.amount), esc(x.label || ''), esc(x.created_at || '')
        ]))
      : empty('Aucune remise en banque enregistrée.');
    const xfers = (recent.transfers || []).length
      ? T(['Date', 'Compte', 'Sens', 'Montant', 'Libellé', 'Réf.'], recent.transfers.map(x => [
          x.moved_on, esc(x.account_name),
          x.kind === 'transfert_sortant' ? 'Sortant' : 'Entrant',
          f(x.amount), esc(x.label || ''), esc(x.reference || '—')
        ]))
      : empty('Aucun transfert entre comptes.');
    const moves = (recent.movements || []).length
      ? T(['Date', 'Compte', 'Nature', 'Montant', 'Libellé'], recent.movements.map(x => [
          x.moved_on, esc(x.account_name), esc(x.kind), f(x.amount), esc(x.label || '')
        ]))
      : empty('Aucun mouvement sur les comptes.');
    return `<h2 style="margin-top:0">Finances</h2><h3>Moyens de paiement</h3>` + T(['Code', 'Libellé', 'Nature', 'Compte rattaché', 'Actif'], m.map(x => [esc(x.code), esc(x.label), x.kind, ['banque', 'mobile_money', 'carte', 'autre'].includes(x.kind) ? `<select onchange="mapMethod('${x.code}',this.value)">${opts(x.account_id)}</select>` : '-', x.code == 'especes' ? 'oui' : `<input type="checkbox" ${x.active ? 'checked' : ''} onchange="actMethod('${x.code}',this.checked)">`])) + `<div class="bar"><button class="b2" onclick="newMethod()">Ajouter un moyen de paiement</button></div>
      <h3>Comptes bancaires et Mobile Money</h3>` + T(['Compte', 'Nature', 'Fournisseur / réf.', 'Solde théorique'], accs.map(a => [esc(a.name), a.kind, esc(a.provider || a.account_ref || ''), f(a.balance)])) + `<div class="bar">${can('money.manage') ? `<button onclick="newAcc()">Nouveau compte</button><button class="b2" onclick="newMove()">Mouvement</button><button class="b2" onclick="newDeposit()">Remise en banque depuis la caisse</button><button class="b2" onclick="newTransfer()">Transfert entre comptes</button><button class="b2" onclick="newStmt()">Saisir un relevé</button>` : ''}</div>
      <h4 style="margin:18px 0 6px">Derniers relevés (rapprochement)</h4>${stmts}
      <h4 style="margin:18px 0 6px">Remises en banque (sortie de caisse)</h4>${deps}
      <h4 style="margin:18px 0 6px">Transferts entre comptes</h4>${xfers}
      <h4 style="margin:18px 0 6px">Mouvements sur les comptes</h4>${moves}
      <h3>Règles financières</h3><div class="card"><label>Catégories de charges (une par ligne)<textarea id="f_cat" rows="8">${esc((SET.expense_categories || []).join('\n'))}</textarea></label>${check('f_cmp', SET.accounting_complete, "Déclarer la comptabilité complète (charges, amortissements, impôts) : autorise l'affichage d'un résultat net")}<div class="r"><button onclick="saveFin()">Enregistrer</button></div></div>`;
  },
  async rh() {
    const r = SET.payroll_rules || {}, ff = r.feature_flags || {};
    const items = await G('/hr/payroll-items/to-confirm').catch(() => ({ count: 0, items: [] }));
    const secMode = r.security_mode || 'strict';
    return `<h2 style="margin-top:0">Gestion RH & Paie</h2>
<div class="card"><b>Règles de retenue (existantes)</b>
${check('r_all', r.allow_debt_deduction, 'Autoriser la déduction des dettes sur salaire')}
<div class="g"><label>Plafond de retenue de dettes (% du net avant dettes)<input id="r_pct" type="number" value="${r.max_debt_deduction_pct ?? 100}"></label>
<label>Mode sécurité paie<select id="r_sec"><option value="strict" ${secMode==='strict'?'selected':''}>STRICT (recommandé)</option><option value="avertissement" ${secMode==='avertissement'?'selected':''}>Avertissement</option><option value="simulation" ${secMode==='simulation'?'selected':''}>Simulation seule</option></select></label>
</div>
<div class="r"><button onclick="saveRh()">Enregistrer</button></div></div>
<div class="card" style="margin-top:12px"><b>Feature flags réglementaires</b>
<p style="color:var(--m);font-size:13px;margin:6px 0 10px">Tous désactivés par défaut. Aucun calcul AMO / INPS / ITS / charges patronales tant que le flag reste OFF.</p>
<div class="g">
<label>AMO <span class="tag ${ff.payroll_amo_enabled?'ok':'x'}">${ff.payroll_amo_enabled?'ON':'OFF'}</span></label>
<label>INPS <span class="tag ${ff.payroll_inps_enabled?'ok':'x'}">${ff.payroll_inps_enabled?'ON':'OFF'}</span></label>
<label>ITS <span class="tag ${ff.payroll_its_enabled?'ok':'x'}">${ff.payroll_its_enabled?'ON':'OFF'}</span></label>
<label>Charges patronales <span class="tag ${ff.payroll_employer_charges_enabled?'ok':'x'}">${ff.payroll_employer_charges_enabled?'ON':'OFF'}</span></label>
</div>
<p style="color:var(--m);font-size:12px;margin-top:8px">Activation progressive : 1) Confirmer juridiquement 2) Activer la branche/barème 3) Passer le flag correspondant à true.</p></div>
<div class="card" style="margin-top:12px"><b>Barèmes ITS</b>
<p style="color:var(--m);font-size:13px">Le moteur ITS est installé. Aucun barème n'est actif par défaut. Les barèmes se gèrent via l'API <code>/hr/its-brackets</code>.</p>
</div>
<div class="card" style="margin-top:12px"><b>Branches INPS</b>
<p style="color:var(--m);font-size:13px">Moteur INPS installé (retraite, PF, AT/MP…). Aucune branche active par défaut. API : <code>/hr/inps-branches</code>.</p>
</div>
<div class="card" style="margin-top:12px"><b>Branches AMO (CANAM)</b>
<p style="color:var(--m);font-size:13px">Moteur AMO installé (salarié + employeur). Taux indicatifs 3,06 % / 3,50 % en structure, à confirmer. Aucune branche active par défaut. API : <code>/hr/amo-branches</code>.</p>
</div>
<div class="card" style="margin-top:12px"><b>Charges patronales (autres)</b>
<p style="color:var(--m);font-size:13px">ANPE, CFCE et contributions configurables. Taux à 0, à confirmer. <b>Jamais déduites du net salarié</b> — uniquement coût employeur. API : <code>/hr/employer-charges</code>.</p>
</div>
<div class="card" style="margin-top:12px"><b>⚠️ Rubriques à confirmer</b>
<p style="margin:6px 0">${items.count || 0} rubrique(s) en statut « À confirmer ». Elles ne produisent <b>aucun calcul</b>.</p>
${items.count ? T(['Code','Libellé','Type','Juridique','Technique','Source'], (items.items||[]).slice(0,25).map(x => [esc(x.code), esc(x.label), x.item_type, `<span class="tag x">${esc(x.legal_status)}</span>`, esc(x.technical_status), esc(x.source_org||'')])) : '<p style="color:var(--m)">Aucune (appliquez la migration 005).</p>'}
</div>
<div class="warn">Le logiciel ne présume ni la légalité ni l'applicabilité d'une retenue. Toute rubrique incertaine reste désactivée.</div>
<div class="bar"><button class="b2" onclick="go('rh')">Écarts, dettes, bulletins</button><button class="b2" onclick="go('emp')">Employés</button></div>`;
  },

  async doc() { const f = SET.footer || {}; return `<h2 style="margin-top:0">Rapports et documents</h2><div class="card"><div class="g"><label>Texte du pied de page<input id="d_text" value="${esc(f.text)}" maxlength="200"></label><label>Mention de copyright (vide : automatique)<input id="d_copy" value="${esc(f.copyright)}" maxlength="200"></label><label>Texte de la mention publicitaire<input id="d_ad" value="${esc(f.ad_text)}" maxlength="120"></label></div>${check('d_sc', f.show_copyright !== false, 'Afficher la mention de propriété / copyright')}${check('d_sa', f.show_ad, 'Afficher la mention publicitaire dans le site et les documents')}<h4>Prévisualisation</h4><div class="card" id="d_prev"></div><div class="r"><button class="b2" onclick="resetFooter()">Réinitialiser</button><button onclick="saveFooter()">Enregistrer</button></div></div><p style="color:var(--m)">Le pied de page, le logo et les coordonnées de la station figurent sur tous les PDF et Excel exportés. La mention publicitaire n'apparaît que si elle est activée.</p>`; },
  async data() {
    if (!ME.is_global) return '';
    const [bk, info, maintenance, platform] = await Promise.all([
      G('/admin/backups').catch(() => []),
      G('/admin/info').catch(() => ({ migrations: [] })),
      G('/admin/maintenance/backup-status').catch(() => ({ backups: [], logs: [], restore_enabled: false, global_reset_enabled: false, email_configured: false })),
      G('/admin/maintenance/platform-backup-history').catch(() => ({backups:[],logs:[]}))
    ]);
    const logs = maintenance.logs || [];
    return `<h2 style="margin-top:0">Maintenance de la plateforme</h2>
      <div class="card"><h3>Sauvegardes</h3><p>Une sauvegarde réelle de la base doit être confirmée dans l'historique avant toute restauration ou réinitialisation.</p>
      <div class="bar"><button onclick="doBackup()">Créer une sauvegarde maintenant</button><button class="b2" onclick="refreshMaintenance()">Actualiser l'historique</button></div>
      <p>${maintenance.email_configured ? 'Email serveur configuré' : 'Email serveur non configuré'} · Pièce jointe : ${maintenance.email_attachment_enabled ? 'activée' : 'désactivée'} · Restauration : ${maintenance.restore_enabled ? 'activée' : 'désactivée'} · Réinitialisation : ${maintenance.global_reset_enabled ? 'activée' : 'désactivée'}</p>
      <h4>Historique des sauvegardes et résultats</h4>${T(['Date','Opération / résultat','Fichier','Taille',''], logs.map(x => [dt(x.finished_at || x.started_at), `<span class="tag ${x.status === 'ok' ? '' : 'x'}">${esc(x.status === 'ok' ? 'Réussie' : x.status === 'failed' ? 'Échec' : 'En cours')}</span><br>${esc(x.kind || '')}${x.error_message ? '<br>'+esc(x.error_message) : ''}${x.email_sent ? '<br>Email de confirmation envoyé' : (x.email_error ? '<br>Email en échec : '+esc(x.email_error) : '')}`, esc(x.file_name || '-'), x.file_size ? Math.round(x.file_size/1024)+' Ko' : '-', x.file_name && /^[a-zA-Z0-9_.-]+\.sql\.gz$/.test(x.file_name) ? `<button class="b2" onclick="dlFile('/admin/backups/${encodeURIComponent(x.file_name)}',${jsArg(x.file_name)})">Télécharger</button>` : '-']))}
      <h4>Fichiers de sauvegarde disponibles</h4>${T(['Fichier','Date','Taille',''], bk.map(b => [esc(b.name), dt(b.created_at), Math.round(b.size / 1024) + ' Ko', `<button class="b2" onclick="dlFile('/admin/backups/${encodeURIComponent(b.name)}',${jsArg(b.name)})">Télécharger</button>`]))}</div>
      <div class="card"><h3>Restaurer une sauvegarde complète</h3><div class="warn err">Cette opération remplace le schéma public et les données de la base entière. Elle ne restaure pas uniquement un client. Utilisez une base de test avant la production.</div>
      ${maintenance.restore_enabled ? `<label>Fichier .sql.gz<input type="file" id="maint_restore_file" accept=".gz,application/gzip,application/x-gzip"></label><label>Mot de passe Super Admin<input type="password" id="maint_restore_password" autocomplete="current-password"></label><div class="r"><button class="b2" onclick="restoreMaintenance()">Confirmer la restauration</button></div>` : '<p>Fonction désactivée par défaut. Activez RESTORE_ENABLED=1 seulement après avoir testé la procédure et vérifié la sauvegarde.</p>'}</div>
      <div class="card"><h3>Réinitialisation globale</h3><div class="warn err">Suspendue par sécurité : le cahier des charges A5 interdit de toucher aux données opérationnelles des clients. La procédure précédente pouvait les effacer. Utilisez A4 pour réinitialiser un client ; la réinitialisation limitée aux seules données plateforme sera réactivée après validation de son périmètre.</div>
      ${maintenance.global_reset_enabled ? `<label>Confirmation exacte : SUPPRIMER TOUTES LES DONNEES<input id="maint_reset_confirmation" autocomplete="off"></label><label>Mot de passe Super Admin<input type="password" id="maint_reset_password" autocomplete="current-password"></label><div class="r"><button class="danger" onclick="resetMaintenance()">Réinitialiser toutes les données</button></div>` : '<p>Fonction suspendue par sécurité : ne pas activer RESET_GLOBAL_ENABLED. Le périmètre plateforme-only doit être défini et testé avant réactivation.</p>'}</div>
      <div class="card"><h3>Sauvegarde propre au Super Admin / plateforme</h3><p>Cette sauvegarde est distincte des archives clients : elle contient uniquement le compte Super Admin et les paramètres globaux compatibles. Elle ne contient pas les ventes, stocks, employés ou finances des clients.</p><div class="bar"><button onclick="createPlatformBackup()">Créer une sauvegarde plateforme</button><button class="b2" onclick="refreshPlatformBackups()">Actualiser</button></div>${T(['Date','Fichier','Taille',''],(platform.backups||[]).map(b=>[dt(b.created_at),esc(b.name),Math.round(b.size/1024)+' Ko',`<button class="b2" onclick="downloadPlatformBackup('${b.name}')">Télécharger</button>`]))}<h4>Historique de la plateforme</h4>${T(['Date','Résultat','Opération','Fichier / erreur'],(platform.logs||[]).map(x=>[dt(x.finished_at||x.started_at),`<span class="tag ${x.status==='ok'?'':'x'}">${esc(x.status)}</span>`,esc(x.kind),esc(x.file_name||x.error_message||'—')]))}${maintenance.platform_restore_enabled?`<label>Restaurer les paramètres plateforme (.json.gz)<input id="platform_restore_file" type="file" accept=".gz,application/gzip"></label><label>Mot de passe Super Admin<input id="platform_restore_password" type="password" autocomplete="current-password"></label><button class="b2" onclick="restorePlatformBackup()">Restaurer les paramètres plateforme</button>`:'<p>Restauration plateforme désactivée par sécurité (PLATFORM_RESTORE_ENABLED=0).</p>'}</div>
      <h3>Informations techniques</h3><div class="card">${kvh([['Serveur Node.js', esc(info.node)], ['PostgreSQL', esc(info.postgres)], ['Durée de fonctionnement', Math.round((info.uptime_s || 0) / 60) + ' min'], ['Sauvegarde automatique', info.backup_auto ? 'activée' : 'désactivée'], ['Email', info.mail_configured ? 'configuré' : 'non configuré']])}</div><h3>Historique des migrations</h3>${T(['Migration','Appliquée le'], (info.migrations || []).map(m => [esc(m.name), dt(m.applied_at)]))}`;
  },
};
window.refreshMaintenance = safe(async () => { SEC = 'data'; await go('param'); toast('Historique de maintenance actualisé.'); });
window.restoreMaintenance = safe(async () => {
  if (!ME.is_global) throw new Error('Réservé au Super Admin.');
  const file = $('#maint_restore_file')?.files?.[0], password = $('#maint_restore_password')?.value || '';
  if (!file || !password) throw new Error('Sélectionnez un fichier .sql.gz et saisissez le mot de passe Super Admin.');
  if (!file.name.toLowerCase().endsWith('.gz')) throw new Error('Le fichier doit être une sauvegarde .sql.gz.');
  if (!confirm('ATTENTION : cette restauration remplace toute la base. Une sauvegarde de sécurité sera créée avant. Continuer ?')) return;
  const r = await fetch('/api/admin/maintenance/restore', { method: 'POST', headers: { 'Content-Type': 'application/gzip', 'X-SuperAdmin-Password': password, ...(TK && { Authorization: 'Bearer ' + TK }) }, body: file });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Restauration échouée.');
  toast('Restauration terminée. Reconnectez-vous.', 'success'); clearSession(); showLogin();
});
window.resetMaintenance = safe(async () => {
  if (!ME.is_global) throw new Error('Réservé au Super Admin.');
  const confirmation = $('#maint_reset_confirmation')?.value || '', superadmin_password = $('#maint_reset_password')?.value || '';
  if (confirmation !== 'SUPPRIMER TOUTES LES DONNEES' || !superadmin_password) throw new Error('Saisissez la confirmation exacte et le mot de passe Super Admin.');
  if (!confirm('DERNIER AVERTISSEMENT : les données opérationnelles de TOUTES les stations seront supprimées après sauvegarde. Continuer ?')) return;
  const out = await Po('/admin/maintenance/reset-global', { confirmation, superadmin_password });
  toast('Réinitialisation terminée. Sauvegarde préalable : ' + out.backup, 'success'); clearSession(); showLogin();
});
const sset = async (key, value, ok = 'Paramètres enregistrés') => { await api('PUT', '/settings/' + key, { value }); toast(ok); };
const nul = id => $('#' + id).value.trim() || null;
window.newStation = () => form('Nouvelle station', [['name', 'Nom de la station'], ['address', 'Adresse'], ['phone', 'Téléphone'], ['currency', 'Devise']], { currency: 'FCFA' }, async d => { const s = await Po('/stations', { name: d.name, address: d.address || undefined, phone: d.phone || undefined, currency: d.currency }); closeM(); toast('Station créée : ' + s.name); await chSt(s.id); });
window.saveGen = safe(async () => { await api('PATCH', '/stations/current', { name: $('#g_name').value, tagline: nul('g_tagline'), address: nul('g_address'), latitude: nul('g_lat'), longitude: nul('g_lng'), phone: nul('g_phone'), email: nul('g_email'), currency: $('#g_currency').value, tax_id: nul('g_tax_id') }); toast('Informations enregistrées'); await applyAppearance(); go('param'); });
window.prevTheme = () => { const t = { mode: $('#a_mode').value, primary: $('#a_pri').value, secondary: $('#a_sec').value }; paint(t); document.querySelectorAll('.sw').forEach(s => s.classList.toggle('on', s.style.background && rgbHex(s.style.background) == t.primary)); $('#a_prev').innerHTML = `<b>Aperçu</b><p><button>Bouton principal</button> <button class="b2">Secondaire</button> <span class="tag">actif</span> <span class="tag x">alerte</span></p><p style="color:var(--m)">Texte discret (couleur secondaire)</p>${lum(t.primary) > .75 ? '<div class="warn err">Couleur trop claire : lisibilité insuffisante, elle sera refusée.</div>' : ''}`; };
const rgbHex = c => { const m = c.match(/\d+/g); return m && m.length >= 3 ? '#' + m.slice(0, 3).map(x => (+x).toString(16).padStart(2, '0')).join('') : c; };
window.saveTheme = safe(async () => { const t = { mode: $('#a_mode').value, primary: $('#a_pri').value, secondary: $('#a_sec').value }; if (lum(t.primary) > .75) throw new Error('Couleur principale trop claire : lisibilité insuffisante'); await sset('theme', t, 'Thème enregistré pour toute la station'); await applyAppearance(); });
window.resetTheme = () => ask('Revenir au thème par défaut ?', async () => { await Po('/settings/reset/theme'); await applyAppearance(); toast('Thème par défaut rétabli'); go('param'); });
window.saveExp = safe(async () => { await sset('tolerance_fuel_liters', parseFloat($('#x_tol').value) || 0); await sset('fuel_amount_entry_allowed', $('#x_amt').checked); await applyAppearance(); });
window.saveRh = safe(async () => { const cur = SET.payroll_rules || {}; await sset('payroll_rules', { ...cur, allow_debt_deduction: $('#r_all').checked, max_debt_deduction_pct: parseFloat($('#r_pct').value) || 0, security_mode: ($('#r_sec') && $('#r_sec').value) || cur.security_mode || 'strict' }); toast('Règles RH enregistrées', 'success'); });
window.saveFin = safe(async () => { await sset('expense_categories', $('#f_cat').value.split('\n').map(x => x.trim()).filter(Boolean)); await sset('accounting_complete', $('#f_cmp').checked); await applyAppearance(); });
const footVal = () => ({ text: $('#d_text').value, copyright: $('#d_copy').value, show_copyright: $('#d_sc').checked, show_ad: $('#d_sa').checked, ad_text: $('#d_ad').value || 'Salon Informatique Log — 70 76 84 94' });
window.prevFooter = () => { const f = footVal(), s = AP.station, parts = [f.text, f.show_copyright ? (f.copyright || `© ${new Date().getFullYear()} ${s.name}`) : ''].filter(Boolean); $('#d_prev').innerHTML = `<div id="ft" style="margin:0;border:0;padding:0">${parts.length ? `<div>${parts.map(esc).join(' · ')}</div>` : ''}${f.show_ad ? `<div class="ad">${esc(f.ad_text)}</div>` : '<small>(mention publicitaire désactivée)</small>'}</div>`; };
window.saveFooter = safe(async () => { await sset('footer', footVal(), 'Pied de page enregistré'); await applyAppearance(); });
window.resetFooter = () => ask('Réinitialiser le pied de page ?', async () => { await Po('/settings/reset/footer'); await applyAppearance(); go('param'); });
window.mapMethod = safe(async (code, v) => { await api('PUT', '/money/methods/' + code, { account_id: v ? +v : null }); toast('Moyen de paiement rattaché'); await applyAppearance(); });
window.actMethod = safe(async (code, v) => { await api('PUT', '/money/methods/' + code, { active: v }); await applyAppearance(); toast(v ? 'Moyen activé' : 'Moyen désactivé'); });
window.newMethod = () => form('Nouveau moyen de paiement', [['code', 'Code (minuscules, ex. moov_money)'], ['label', 'Libellé'], ['kind', 'Nature', 's', ['mobile_money', 'banque', 'carte', 'autre']]], {}, async d => { await Po('/money/methods', d); await applyAppearance(); closeM(); go('param'); });
window.newAcc = () => form('Nouveau compte', [['kind', 'Nature', 's', [['banque', 'Compte bancaire'], ['mobile_money', 'Portefeuille Mobile Money']]], ['name', 'Libellé du compte'], ['provider', 'Banque / opérateur (Orange Money, Wave…)'], ['account_ref', 'Référence autorisée (ex. 4 derniers chiffres)'], ['opening_balance', "Solde d'ouverture", 'number'], ['opening_date', "Date d'ouverture", 'date']], { opening_date: dayNow() }, async d => { await Po('/money/accounts', { ...d, provider: d.provider || undefined, account_ref: d.account_ref || undefined }); closeM(); go('param'); });
const accSel = async () => (await G('/money/accounts')).map(a => [a.id, a.name]);
window.newMove = async () => form('Mouvement sur un compte', [['account_id', 'Compte', 's', await accSel()], ['kind', 'Nature', 's', ['encaissement', 'depot', 'virement_recu', 'virement_emis', 'frais', 'retrait', 'remboursement', 'transfert_entrant', 'transfert_sortant']], ['amount', 'Montant (positif)', 'number'], ['label', 'Libellé'], ['reference', 'Référence'], ['moved_on', 'Date', 'date']], { moved_on: dayNow() }, async d => { await Po('/money/movements', { ...d, account_id: +d.account_id, reference: d.reference || undefined }); closeM(); toast('Mouvement enregistré'); go('param'); });
window.newDeposit = async () => form('Remise en banque (sortie de caisse)', [['account_id', 'Compte', 's', await accSel()], ['amount', 'Montant', 'number'], ['label', 'Libellé']], { label: 'Remise en banque' }, async d => { await Po('/money/deposit', { ...d, account_id: +d.account_id }); closeM(); toast('Remise enregistrée : caisse et compte mis à jour'); go('param'); });
window.newTransfer = async () => form('Transfert entre comptes', [['from_account_id', 'Compte source', 's', await accSel()], ['to_account_id', 'Compte destination', 's', await accSel()], ['amount', 'Montant', 'number'], ['label', 'Libellé'], ['moved_on', 'Date', 'date']], { label: 'Transfert interne', moved_on: dayNow() }, async d => {
  if (+d.from_account_id === +d.to_account_id) { toast('Choisissez deux comptes distincts', 'error'); return; }
  await Po('/money/transfer', { from_account_id: +d.from_account_id, to_account_id: +d.to_account_id, amount: +d.amount, label: d.label, moved_on: d.moved_on || undefined });
  closeM(); toast('Transfert enregistré (sortie + entrée atomiques)'); go('param');
});
window.newStmt = async () => form('Relevé (rapprochement)', [['account_id', 'Compte', 's', await accSel()], ['statement_date', 'Date du relevé', 'date'], ['balance', 'Solde du relevé', 'number'], ['note', 'Note']], { statement_date: dayNow() }, async d => { await Po('/money/statements', { ...d, account_id: +d.account_id, note: d.note || undefined }); closeM(); toast('Relevé enregistré'); go('param'); });
window.doBackup = safe(async () => { const r = await Po('/admin/backups'); toast('Sauvegarde créée : ' + r.name); go('param'); });
// aperçus en direct (apparence, pied de page) après l'affichage des sections
const _go = go;
go = async function (k, a) { await _go(k, a); if (k == 'param' && $('.grow h2')) { if (SEC == 'app' && $('#a_pri')) prevTheme(); if (SEC == 'doc' && $('#d_text')) { prevFooter(); document.querySelectorAll('#d_text,#d_copy,#d_ad,#d_sc,#d_sa').forEach(x => x.addEventListener('input', prevFooter)); } } };

Object.assign(V, { fin: ['Rapports financiers', 'finance.report|money.manage'], param: ['Paramètres', 'user.manage|settings.edit|appearance.manage|hr.manage|money.manage'] });
Object.assign(VM, { fin: vFin, param: vParamHub });

window.createPlatformBackup = safe(async function(){
  if(!ME?.is_global) throw new Error('Réservé au Super Admin.');
  const password=prompt('Saisissez le mot de passe Super Admin pour créer une sauvegarde séparée de la plateforme :');if(!password)return;
  const out=await fetch('/api/admin/maintenance/platform-backups',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+TK},body:JSON.stringify({superadmin_password:password})});const data=await out.json();if(!out.ok)throw new Error(data.error||data.message||'Sauvegarde refusée.');toast('Sauvegarde plateforme créée : '+data.name,'success');go('param');
});
window.refreshPlatformBackups = safe(async function(){SEC='data';await go('param');toast('Historique plateforme actualisé.');});
window.downloadPlatformBackup = async function(name){if(!ME?.is_global)return toast('Réservé au Super Admin.','error');try{const r=await fetch('/api/admin/maintenance/platform-backups/'+encodeURIComponent(name),{headers:{Authorization:'Bearer '+TK}});if(!r.ok)throw new Error('Téléchargement refusé.');const blob=await r.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){toast(e.message||String(e),'error');}};
window.restorePlatformBackup = safe(async function(){if(!ME?.is_global)throw new Error('Réservé au Super Admin.');const file=$('#platform_restore_file')?.files?.[0],password=$('#platform_restore_password')?.value||'';if(!file||!password)throw new Error('Sélectionnez une archive plateforme et saisissez le mot de passe.');if(!confirm('Restaurer uniquement le compte Super Admin et les paramètres globaux ? Les données clients ne seront pas remplacées.'))return;const r=await fetch('/api/admin/maintenance/platform-restore',{method:'POST',headers:{'Content-Type':'application/gzip','X-SuperAdmin-Password':password,Authorization:'Bearer '+TK},body:file});const out=await r.json();if(!r.ok)throw new Error(out.error||out.message||'Restauration refusée.');toast('Paramètres plateforme restaurés. Reconnectez-vous.','success');clearSession();showLogin();});


/* ---------- Paramètres › Signature du compte client (autorisée par le Super Admin) ---------- */
let SIGST = null;
const SIG_MODES = { none: 'Non autorisée', handwritten: 'Manuscrite', image: 'Image importée', both: 'Manuscrite et image importée' };
SEC_FN.sig = async () => {
  const st = SIGST = await G('/signature');
  const hw = st.allowed === 'both' || st.allowed === 'handwritten', im = st.allowed === 'both' || st.allowed === 'image';
  const head = `<h2 style="margin-top:0">Signature des documents</h2><p style="color:var(--m)">Autorisation accordée par la plateforme : <span class="tag ${st.allowed == 'none' ? 'x' : 'ok'}">${SIG_MODES[st.allowed]}</span></p>`;
  if (st.allowed == 'none') return head + `<div class="warn">La signature personnalisée n'est pas incluse dans votre contrat. Contactez l'administrateur de la plateforme pour la faire autoriser.</div>`;
  const prev = u => u ? `<div style="background:#fff;border:1px solid var(--b,#d5dbe2);border-radius:8px;padding:8px;text-align:center"><img src="${u}" alt="Signature" style="max-width:100%;max-height:90px"></div>` : `<p style="color:var(--m)">Aucune signature enregistrée.</p>`;
  const cards = [];
  if (hw) cards.push(`<div class="card"><b>✍️ Signature manuscrite</b><p style="color:var(--m);font-size:13px;margin:4px 0 8px">Dessinez votre signature au doigt, au stylet ou à la souris.</p>
    <canvas id="sg_cv" width="640" height="200" style="width:100%;max-width:520px;height:auto;aspect-ratio:3.2/1;background:#fff;border:1px dashed #9aa5b1;border-radius:8px;touch-action:none"></canvas>
    <div class="r"><button class="b2" onclick="sigClear()">Effacer</button><button onclick="sigSaveHand()">Enregistrer ce tracé</button>${st.handwritten ? `<button class="b2" onclick="sigDelete('handwritten')">Supprimer l'actuelle</button>` : ''}</div>
    <h4>Enregistrée</h4>${prev(st.handwritten)}</div>`);
  if (im) cards.push(`<div class="card"><b>🖼️ Image de signature</b><p style="color:var(--m);font-size:13px;margin:4px 0 8px">Importez une image (PNG, JPEG, WebP) sur laquelle figure votre signature. Fond transparent ou blanc recommandé.</p>
    <input type="file" id="sg_file" accept="image/png,image/jpeg,image/webp" onchange="sigPickImage(this)"><div id="sg_imgprev" style="margin-top:8px"></div>
    <div class="r"><button onclick="sigSaveImage()">Enregistrer cette image</button>${st.image ? `<button class="b2" onclick="sigDelete('image')">Supprimer l'actuelle</button>` : ''}</div>
    <h4>Enregistrée</h4>${prev(st.image)}</div>`);
  const avail = [['handwritten', 'Manuscrite', st.handwritten], ['image', 'Image importée', st.image]].filter(x => x[2] && ((x[0] == 'handwritten' && hw) || (x[0] == 'image' && im)));
  const act = `<div class="card" style="margin-bottom:12px"><b>Activation</b><p style="color:var(--m);font-size:13px;margin:4px 0 8px">Une fois activée, cette signature est apposée automatiquement sur les prochains documents PDF qui comportent un bloc de signature (hors cases destinées à un tiers : employé, client de la station…).</p>
    <div class="g"><label>Nom du signataire (imprimé sur les documents)<input id="sg_name" maxlength="80" value="${esc(st.signer_name)}"></label>
    <label>Signature utilisée<select id="sg_mode">${avail.length ? avail.map(a => `<option value="${a[0]}" ${st.active_mode == a[0] ? 'selected' : ''}>${a[1]}</option>`).join('') : '<option value="">Enregistrez d\'abord une signature</option>'}</select></label></div>
    <p>État : <span class="tag ${st.active ? 'ok' : 'x'}">${st.active ? 'ACTIVE' : 'Désactivée'}</span></p>
    <div class="r">${st.active ? `<button class="b2" onclick="sigActivate(false)">Désactiver</button><button onclick="sigActivate(true)">Appliquer le changement</button>` : `<button ${avail.length ? '' : 'disabled'} onclick="sigActivate(true)">Activer la signature</button>`}</div></div>`;
  const pend = !st.active && avail.length ? `<div class="warn" style="margin-bottom:12px"><b>⚠️ Signature enregistrée mais NON ACTIVE.</b> Tant que vous n'avez pas cliqué sur « Activer la signature » ci-dessous, vos documents PDF restent sans signature.</div>` : '';
  return head + pend + act + cards.join('') + `<div class="warn">La signature engage son titulaire : n'activez que votre propre signature. Chaque modification est tracée dans le journal d'audit.</div>`;
};
let SIGIMG = null, SIGDRAW = false, SIGINK = false;
const sigInit = () => {
  const cv = document.getElementById('sg_cv'); if (!cv) return; SIGINK = false;
  const c = cv.getContext('2d'); c.lineWidth = 3; c.lineCap = 'round'; c.lineJoin = 'round'; c.strokeStyle = '#111827';
  const pt = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; };
  cv.onpointerdown = e => { SIGDRAW = true; SIGINK = true; cv.setPointerCapture(e.pointerId); const [x, y] = pt(e); c.beginPath(); c.moveTo(x, y); c.lineTo(x + .1, y + .1); c.stroke(); e.preventDefault(); };
  cv.onpointermove = e => { if (!SIGDRAW) return; const [x, y] = pt(e); c.lineTo(x, y); c.stroke(); e.preventDefault(); };
  cv.onpointerup = cv.onpointercancel = () => { SIGDRAW = false; };
};
const sigObserver = new MutationObserver(() => { const cv = document.getElementById('sg_cv'); if (cv && !cv.onpointerdown) sigInit(); });
sigObserver.observe(document.body, { childList: true, subtree: true });
window.sigClear = () => { const cv = $('#sg_cv'); cv.getContext('2d').clearRect(0, 0, cv.width, cv.height); SIGINK = false; };
const sigName = () => ($('#sg_name')?.value || '').trim() || undefined;
const sigPut = async (kind, dataUrl) => { SIGST = await Pu('/signature', { kind, data_url: dataUrl, signer_name: sigName() }); toast('Signature enregistrée'); go('param'); };
window.sigSaveHand = safe(async () => {
  if (!SIGINK) throw new Error("Tracez d'abord votre signature.");
  const cv = $('#sg_cv'), c = cv.getContext('2d'), d = c.getImageData(0, 0, cv.width, cv.height).data;
  let x0 = cv.width, y0 = cv.height, x1 = 0, y1 = 0;
  for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) if (d[(y * cv.width + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 <= x0 || y1 <= y0) throw new Error('Tracé trop court.');
  const m = 8, w = x1 - x0 + 2 * m, h = y1 - y0 + 2 * m, o = document.createElement('canvas'); o.width = w; o.height = h;
  o.getContext('2d').drawImage(cv, x0 - m, y0 - m, w, h, 0, 0, w, h);
  await sigPut('handwritten', o.toDataURL('image/png'));
});
window.sigPickImage = input => {
  const f = input.files && input.files[0]; SIGIMG = null; const box = $('#sg_imgprev'); box.innerHTML = '';
  if (!f) return;
  if (!/^image\/(png|jpeg|webp)$/.test(f.type)) { toast('Formats acceptés : PNG, JPEG, WebP'); input.value = ''; return; }
  if (f.size > 8 * 1024 * 1024) { toast('Image trop volumineuse (8 Mo maximum)'); input.value = ''; return; }
  const img = new Image(), url = URL.createObjectURL(f);
  img.onload = () => { // réduction à 800 px de large max, export PNG (transparence conservée)
    const k = Math.min(1, 800 / img.width), cv = document.createElement('canvas'); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); URL.revokeObjectURL(url); SIGIMG = cv.toDataURL('image/png');
    box.innerHTML = `<div style="background:#fff;border:1px solid #d5dbe2;border-radius:8px;padding:8px;text-align:center"><img src="${SIGIMG}" style="max-width:100%;max-height:90px" alt="Aperçu"></div>`;
  };
  img.onerror = () => { toast("Image illisible"); URL.revokeObjectURL(url); };
  img.src = url;
};
window.sigSaveImage = safe(async () => { if (!SIGIMG) throw new Error("Choisissez d'abord une image."); await sigPut('image', SIGIMG); });
window.sigDelete = kind => ask('Supprimer cette signature ?', safe(async () => { await api('DELETE', '/signature/' + kind); toast('Signature supprimée'); go('param'); }));
window.sigActivate = safe(async active => {
  const mode = $('#sg_mode')?.value || undefined;
  if (active && !mode) throw new Error("Enregistrez d'abord une signature.");
  const nm = sigName(); if (nm && nm !== (SIGST?.signer_name || '')) { const k = SIGST?.[mode]; if (k) await Pu('/signature', { kind: mode, data_url: k, signer_name: nm }); }
  await Po('/signature/activation', { active, mode }); toast(active ? 'Signature activée : elle sera apposée sur vos prochains documents' : 'Signature désactivée'); go('param');
});
