'use strict';
// Messages de fin de quart (WhatsApp) — gabarits uniques, MÊME style et MÊMES icônes pour le rapport complet du clôturant
// et pour la situation individuelle de chaque employé. Modules purs : aucune base.
// Le rapport complet suit l'ordre : en-tête, ventes, paiements, caisse, employés, anomalies, justifications, synthèse, signature du clôturant.
// Chaque employé ne reçoit que SA situation (ses pompes, ses ventes, sa caisse, ses écarts de stock, ses anomalies).
// Signature : l'identité du clôturant vient TOUJOURS du compte qui a réellement validé la clôture (jamais du responsable du quart, jamais saisie à la main).

const SEP = '━━━━━━━━━━━━━━━━━━';
const KEYCAPS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
const KINDS = { personnalise: 'Personnalisé', jour: 'Jour', nuit: 'Nuit', matin: 'Matin', soir: 'Soir', apresmidi: 'Après-midi' };
const TZ = 'Africa/Bamako', TOL = 0.05;
const tidy = s => String(s).replace(/[  ]/g, ' ').replace(/−/g, '-');
const r2 = v => Math.round((Number(v) || 0) * 100) / 100;
const nf2 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }), nf3 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 });
const isNum = v => v != null && v !== '' && Number.isFinite(Number(v));
const clean = v => { const t = String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); return t === '-' ? '' : t; };
const bold = s => `*${s}*`;   // gras WhatsApp

function kindLabel(kind) {
  const raw = String(kind || '').trim(); if (!raw) return '';
  const key = raw.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
  return KINDS[key] || raw.charAt(0).toUpperCase() + raw.slice(1);
}
function parts(d, tz) {
  const o = {}; for (const p of new Intl.DateTimeFormat('fr-FR', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(d))) o[p.type] = p.value;
  if (o.hour === '24') o.hour = '00';
  return o;
}
const hhmm = (d, tz) => { if (!d) return 'n/d'; const p = parts(d, tz); return `${p.hour}h${p.minute}`; };
const dmy = (d, tz) => { if (!d) return 'n/d'; const p = parts(d, tz); return `${p.day}/${p.month}/${p.year}`; };
const dmyHm = (d, tz) => (d ? `${dmy(d, tz)} à ${hhmm(d, tz)}` : 'n/d');
function duration(a, b) {
  if (!a || !b) return 'n/d';
  const m = Math.max(0, Math.round((new Date(b) - new Date(a)) / 60000));
  const pl = (n, w) => `${n} ${w}${n > 1 ? 's' : ''}`;
  if (m < 60) return pl(m, 'minute');
  const h = Math.floor(m / 60), rest = m % 60;
  return pl(h, 'heure') + (rest ? ' ' + pl(rest, 'minute') : '');
}
const pumpLabel = p => { const m = String(p).trim().match(/^(?:pompe\s*(?:n°|no|num[eé]ro)?\s*)?(\d+)$/i); return m ? 'Pompe N° ' + m[1] : String(p); };
const stationLabel = n => String(n || 'Station').replace(/\s+/g, ' ').trim().toUpperCase();
/** 🟢 équilibré · 🔴 déficit · 🟠 excédent · ⚪ non disponible */
const gapIcon = g => (g == null ? '⚪' : Math.abs(g) < 0.005 ? '🟢' : g < 0 ? '🔴' : '🟠');

/** Bloc « SIGNATURE DU CLÔTURANT » : nom, date et heure réelles de la clôture, tirés du compte qui l'a validée. */
function signatureLines({ name, closedAt, tz = TZ }) {
  const nm = clean(name);
  const L = ['✍️ *SIGNATURE DU CLÔTURANT*', ''];
  L.push(nm ? `👤 Nom : ${nm}` : '👤 Nom : non disponible (clôturant non enregistré pour ce quart)');
  L.push(`📅 Date : ${closedAt ? dmy(closedAt, tz) : 'non disponible'}`, `🕒 Heure : ${closedAt ? hhmm(closedAt, tz) : 'non disponible'}`);
  if (nm) L.push('', `Clôturé par : ${nm}`);
  return L;
}
/** « Généré par : identifiant » — utilisateur qui produit le message ; tout en bas. */
const generatedByLines = by => (clean(by) ? ['', `📄 Généré par : ${clean(by)}`] : []);

/** Famille d'un moyen de paiement (libellé libre → espèces / mobile / carte / crédit / autres). */
function methodKey(m) {
  const k = String(m || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (/esp|cash|liquide/.test(k)) return 'especes';
  if (/mobile|orange|wave|moov|momo|mtn|malitel|telecel/.test(k)) return 'mobile';
  if (/carte|card|visa|bancaire/.test(k)) return 'carte';
  if (/credit/.test(k)) return 'credit';
  return 'autres';
}
/** Ventes et paiements du quart : carburant (compteurs) + autres produits, répartis par moyen de paiement. */
function totals(c) {
  const fuel = r2(c.fuel_total), other = r2(c.other_sales && c.other_sales.total), fp = c.fuel_payments || {};
  const pay = { especes: 0, mobile: 0, carte: 0, credit: 0, autres: 0 };
  pay.especes += Number(fp.especes) || 0; pay.mobile += Number(fp.mobile_money) || 0; pay.carte += Number(fp.carte) || 0; pay.credit += Number(fp.credit) || 0; pay.autres += Number(fp.autres) || 0;
  for (const x of (c.other_sales && c.other_sales.by_method) || []) pay[methodKey(x.method)] += Number(x.amount) || 0;
  for (const k of Object.keys(pay)) pay[k] = r2(pay[k]);
  return { fuel, other, sales: r2(fuel + other), pay, paid: r2(Object.values(pay).reduce((a, v) => a + v, 0)) };
}

/** Cohérence automatique : renvoie la liste des incohérences (vide si tout concorde). Ne modifie jamais un chiffre. */
function consistency(c, money) {
  const W = [], t = totals(c), cash = c.cash || {};
  if (Math.abs(t.paid - t.sales) > TOL) W.push(`Les paiements enregistrés (${money(t.paid)}) diffèrent des ventes (${money(t.sales)}) : ${money(t.paid - t.sales)}.`);
  if (c.fuel_declared && Number(c.fuel_declared.total) > r2(c.fuel_total) + TOL) W.push(`Les ventes de carburant déclarées (${money(c.fuel_declared.total)}) dépassent les compteurs (${money(c.fuel_total)}).`);
  if (isNum(cash.counted) && isNum(cash.theoretical) && isNum(cash.gap) && Math.abs(Number(cash.counted) - Number(cash.theoretical) - Number(cash.gap)) > TOL) W.push('L\'écart de caisse ne correspond pas à la différence entre la caisse comptée et la caisse théorique.');
  const emps = Array.isArray(c.employees) ? c.employees : [];
  if (emps.length) {
    if (isNum(cash.gap) && emps.every(e => isNum(e.cash_gap)) && (!c.unassigned || c.unassigned.cash_gap == null || isNum(c.unassigned.cash_gap))) {
      const sum = r2(emps.reduce((a, e) => a + Number(e.cash_gap), 0) + (c.unassigned ? Number(c.unassigned.cash_gap) || 0 : 0));
      if (Math.abs(sum - r2(cash.gap)) > TOL) W.push(`La somme des écarts de caisse individuels (${money(sum)}) diffère de l'écart global (${money(cash.gap)}).`);
    }
    const sumFuel = r2(emps.reduce((a, e) => a + (Number(e.fuel_amount) || 0), 0) + (c.unassigned ? Number(c.unassigned.fuel_amount) || 0 : 0));
    if (Math.abs(sumFuel - t.fuel) > TOL) W.push(`La somme des ventes de carburant par employé (${money(sumFuel)}) diffère du total des compteurs (${money(t.fuel)}).`);
  }
  return W;
}

const gapStatus = (g, money, label) => {
  if (g == null) return `⚪ ${label} : non disponible`;
  if (Math.abs(g) < 0.005) return `🟢 ${label} : ${money(0)}`;
  return g < 0 ? `🔴 ${label} : ${bold(money(g))}` : `🟠 ${label} : ${bold('+' + money(g))}`;
};
const stockTxt = list => (list || []).filter(x => x && Math.abs(Number(x.amount)) > 0).map(x => `${clean(x.product)} : ${tidy(nf2.format(r2(x.amount)))}`).join(' ; ');

/** Rapport COMPLET du clôturant.
 *  report : contenu du rapport de quart figé à la clôture ; closerName : compte qui a réellement clôturé ; managerName : responsable du quart ;
 *  generatedBy : utilisateur qui génère le message ; justification / observations : saisies du clôturant. */
function closerMessage({ stationName, currency = 'FCFA', shift, report: c, managerName, closerName, generatedBy, justification, observations, tz = TZ }) {
  const money = v => tidy(nf2.format(r2(v))) + ' ' + currency;
  const qty = v => tidy(nf2.format(r2(v)));
  const num6 = String(shift.number).padStart(6, '0'), kl = kindLabel(shift.kind), t = totals(c), cash = c.cash || {};
  const gap = isNum(cash.gap) ? r2(cash.gap) : null;
  const emps = Array.isArray(c.employees) ? c.employees : [];
  const L = [];
  L.push('📊 *RAPPORT DE FIN DE QUART*', '');
  L.push(`🏢 Station : ${stationLabel(stationName)}`, `🔖 Rapport N° : ${num6}`, `🕘 Type de quart : ${kl || 'n/d'}`, `🔓 Ouverture : ${dmyHm(shift.opened_at, tz)}`, `🔒 Fermeture : ${dmyHm(shift.closed_at, tz)}`, `👔 Responsable du quart : ${clean(managerName) || 'n/d'}`, '');

  L.push(SEP, '⛽ *RÉCAPITULATIF DES VENTES*', '');
  L.push(`• Ventes carburant (compteurs) : ${bold(money(t.fuel))}`, `• Autres produits : ${bold(money(t.other))}`, `• Total des ventes : ${bold(money(t.sales))}`, '');
  const rows = (c.counters || []).filter(x => Number(x.liters) !== 0 || Number(x.amount) !== 0);
  if (rows.length) {
    L.push('Détail par pompe et compteur :');
    for (const x of rows) L.push(`▪️ ${pumpLabel(x.pump)} / Cpt ${x.counter} – ${clean(x.product)}`, `   Index ${tidy(nf3.format(Number(x.index_start) || 0))} → ${tidy(nf3.format(Number(x.index_end) || 0))} · ${tidy(nf3.format(Number(x.liters) || 0))} L · ${bold(money(x.amount))}`);
  } else L.push('• Aucune vente de carburant enregistrée sur les compteurs.');
  L.push('');

  L.push(SEP, '💳 *RÉPARTITION DES PAIEMENTS*', '');
  L.push(`• Espèces : ${money(t.pay.especes)}`, `• Mobile Money : ${money(t.pay.mobile)}`, `• Carte bancaire : ${money(t.pay.carte)}`, `• Crédit : ${money(t.pay.credit)}`);
  if (t.pay.autres) L.push(`• Autres moyens : ${money(t.pay.autres)}`);
  L.push(`• Total des paiements : ${bold(money(t.paid))}`, '');

  L.push(SEP, '💰 *SITUATION DE LA CAISSE*', '');
  L.push(`• Caisse théorique : ${isNum(cash.theoretical) ? money(cash.theoretical) : 'non disponible'}`, `• Caisse comptée : ${isNum(cash.counted) ? money(cash.counted) : 'non disponible'}`, '');
  if (gap == null) L.push('⚪ Écart constaté : non disponible');
  else if (Math.abs(gap) < 0.005) L.push(`🟢 Écart constaté : ${money(0)}`, '✅ Caisse équilibrée.');
  else if (gap < 0) L.push(`🔴 Écart constaté : ${bold(money(gap))}`, `🔴 DÉFICIT de caisse de ${bold(money(-gap))}.`);
  else L.push(`🟠 Écart constaté : ${bold('+' + money(gap))}`, `🟠 EXCÉDENT de caisse de ${bold(money(gap))}.`);
  L.push('');

  L.push(SEP, '👥 *SITUATION PAR EMPLOYÉ*', '');
  const unas = c.unassigned && ((c.unassigned.cash_gap && Math.abs(c.unassigned.cash_gap) > 0.004) || (c.unassigned.stock_gaps || []).length) ? c.unassigned : null;
  if (emps.length) {
    for (const e of emps) {
      const g = isNum(e.cash_gap) ? r2(e.cash_gap) : null, st = stockTxt(e.stock_gaps), pumps = (e.pumps || []).map(pumpLabel);
      L.push(`👤 ${bold(clean(e.name) || 'Employé')}`, `   Poste : ${pumps.length ? pumps.join(', ') : 'aucune pompe affectée'}`,
        `   Écart de caisse : ${g == null ? '⚪ non disponible' : gapIcon(g) + ' ' + (Math.abs(g) < 0.005 ? money(0) : money(g))}`,
        `   Écart de stock : ${st ? '🔴 ' + st : '🟢 aucun'}`, '');
    }
    if (unas) L.push(`👤 ${bold('Non attribué à un employé')}`, `   Écart de caisse : ${unas.cash_gap && Math.abs(unas.cash_gap) > 0.004 ? gapIcon(r2(unas.cash_gap)) + ' ' + money(unas.cash_gap) : '🟢 ' + money(0)}`, `   Écart de stock : ${stockTxt(unas.stock_gaps) ? '🔴 ' + stockTxt(unas.stock_gaps) : '🟢 aucun'}`, '');
  } else L.push('Situation individuelle non disponible pour ce quart (rapport enregistré avant la séparation par employé).', '');

  // Anomalies : commerciales (nature + employé + montant) d'un côté, écarts physiques de caisse / stock de l'autre. Chaque élément n'est compté qu'UNE fois :
  // les écarts de caisse et de stock proviennent de la situation par employé, jamais de la liste des anomalies (qui les répète sous une autre forme).
  const commercial = (c.anomalies || []).filter(a => a && a.kind !== 'ecart_caisse' && a.kind !== 'ecart_stock');
  const physical = [];
  if (emps.length) {
    for (const e of emps) {
      if (isNum(e.cash_gap) && Math.abs(e.cash_gap) >= 0.005) physical.push(`💵 Écart de caisse – ${clean(e.name)} : ${money(e.cash_gap)}`);
      for (const x of (e.stock_gaps || []).filter(x => x && Math.abs(Number(x.amount)) > 0)) physical.push(`📦 Écart de stock – ${clean(e.name)} : ${clean(x.product)} : ${qty(x.amount)}`);
    }
    if (unas) {
      if (unas.cash_gap && Math.abs(unas.cash_gap) > 0.004) physical.push(`💵 Écart de caisse – non attribué : ${money(unas.cash_gap)}`);
      for (const x of (unas.stock_gaps || []).filter(x => x && Math.abs(Number(x.amount)) > 0)) physical.push(`📦 Écart de stock – non attribué : ${clean(x.product)} : ${qty(x.amount)}`);
    }
  } else if (gap != null && Math.abs(gap) >= 0.005) physical.push(`💵 Écart de caisse – ensemble du quart : ${money(gap)}`);
  L.push(SEP, '⚠️ *ANOMALIES DÉTECTÉES*', '');
  L.push('🛒 Anomalies commerciales :');
  if (commercial.length) commercial.forEach((a, i) => {
    const desc = clean(a.description).replace(/\.$/, ''), digits = String(Math.abs(Math.round(Number(a.amount) || 0)));
    const showAmt = isNum(a.amount) && Number(a.amount) !== 0 && !desc.replace(/[\s.,]/g, '').includes(digits);
    const rep = a.reported_by && a.kind !== 'rattachement' ? (a.reported_self ? ' (signalée par l\'employé lui-même)' : ` (signalée par ${clean(a.reported_by)})`) : '';
    L.push(`${KEYCAPS[i] || (i + 1) + '.'} 🔴 ${clean(a.employee) || 'Ensemble du quart'} : ${desc}${rep}${showAmt ? ' – Montant : ' + money(a.amount) : ''}.`);
  }); else L.push('🟢 Aucune anomalie commerciale.');
  L.push('', '💵 Écarts physiques de caisse et de stock :');
  if (physical.length) physical.forEach((p, i) => L.push(`${KEYCAPS[i] || (i + 1) + '.'} 🔴 ${p}`)); else L.push('🟢 Aucun écart physique.');
  L.push('');

  const just = clean(justification), obs = clean(observations);
  L.push(SEP, '📝 *JUSTIFICATIONS ET OBSERVATIONS*', '');
  L.push(`• Justification des écarts : ${just || 'Aucune justification renseignée'}`, `• Observations du responsable : ${obs || 'Aucune observation renseignée'}`, '');

  const warn = consistency(c, money);
  const gapEmps = emps.filter(e => (isNum(e.cash_gap) && Math.abs(e.cash_gap) >= 0.005) || (e.stock_gaps || []).some(x => x && Math.abs(Number(x.amount)) > 0)).map(e => clean(e.name));
  L.push(SEP, '📌 *SYNTHÈSE FINALE*', '');
  L.push(`• Ventes totales : ${bold(money(t.sales))}`, `• Total des paiements : ${bold(money(t.paid))}`, `• ${gapStatus(gap, money, 'Écart de caisse')}`,
    `• Anomalies commerciales : ${commercial.length ? '🔴 ' + commercial.length : '🟢 0'}`, `• Écarts physiques : ${physical.length ? '🔴 ' + physical.length : '🟢 0'}`, '');
  const todo = [];
  if (gap != null && Math.abs(gap) >= 0.005) todo.push(`🔴 Écart de caisse de ${money(gap)} à vérifier.`);
  if (gapEmps.length) todo.push(`🔴 Écarts individuels à vérifier : ${gapEmps.join(', ')}.`);
  if (commercial.length) todo.push(`🔴 ${commercial.length} anomalie${commercial.length > 1 ? 's commerciales' : ' commerciale'} à examiner.`);
  if (c.fuel_declared && Number(c.fuel_declared.undeclared) > TOL) todo.push(`🟠 Carburant non déclaré à la saisie : ${money(c.fuel_declared.undeclared)} (compté en espèces).`);
  for (const w of warn) todo.push(`🔴 Incohérence : ${w}`);
  if ((gap != null && Math.abs(gap) >= 0.005 || commercial.length || physical.length) && !just) todo.push('🟠 Aucune justification renseignée alors que des écarts ou anomalies existent.');
  L.push('Points à vérifier :');
  if (todo.length) todo.forEach(x => L.push(x)); else L.push('🟢 Aucun point de vigilance : situation conforme.');
  L.push('', SEP, ...signatureLines({ name: closerName, closedAt: shift.closed_at, tz }), ...generatedByLines(generatedBy));
  return L.join('\n');
}

/** Situation INDIVIDUELLE d'un employé — même style et mêmes icônes que le rapport du clôturant.
 *  ctx : { stationName, currency, shift: { number, kind, opened_at, closed_at }, tz }
 *  mine : entrée report.employees de l'employé ; anomalies : report.anomalies ; fixes : report.attribution_check.fixes ;
 *  managerName : responsable du quart ; closerName : compte qui a réellement clôturé ; generatedBy : utilisateur qui génère le message. */
function individualMessage({ stationName, currency = 'FCFA', shift, mine, anomalies = [], fixes = [], tz = TZ, managerName, closerName, generatedBy }) {
  const money = v => tidy(nf2.format(r2(v))) + ' ' + currency;
  const qty = v => tidy(nf2.format(r2(v)));   // quantités (stock, litres) : jamais de devise
  const station = stationLabel(stationName);
  const num6 = String(shift.number).padStart(6, '0'), kl = kindLabel(shift.kind), name = String(mine.name || 'Employé').replace(/\s+/g, ' ').trim();
  const nc = mine.non_cash || {};
  const pumps = (mine.pumps || []).map(pumpLabel);
  const L = [];
  L.push('📊 *RAPPORT INDIVIDUEL DE FIN DE QUART*', '');
  L.push(`🏢 Station : ${station}`, `🔖 Rapport N° : ${num6}`, `🕘 Type de quart : ${kl || 'n/d'}`, `👤 Employé : ${name}`);
  if (clean(managerName)) L.push(`👔 Responsable du quart : ${clean(managerName)}`);
  L.push(`📅 Date : ${dmy(shift.opened_at || shift.closed_at, tz)}`, `🔓 Ouverture : ${hhmm(shift.opened_at, tz)}`, `🔒 Fermeture : ${hhmm(shift.closed_at, tz)}`, `⏱️ Durée : ${duration(shift.opened_at, shift.closed_at)}`, '');

  L.push(SEP, '⛽ *RÉCAPITULATIF DES VENTES*', '');
  L.push(pumps.length ? `${pumps.length > 1 ? 'Pompes concernées' : 'Pompe concernée'} : ${pumps.join(', ')}` : 'Pompe concernée : aucune pompe affectée', '');
  const lit = Number(mine.fuel_liters) || 0;
  L.push(`💰 Total des ventes : ${bold(money(mine.fuel_amount))}`, `🛢️ Volume distribué : ${tidy(nf3.format(lit))} litre${Math.abs(lit) > 1 ? 's' : ''}`, '');
  L.push(`• Montant déclaré à la saisie : ${money(mine.declared_fuel)}`, `• Montant non déclaré (comptabilisé en espèces) : ${money(mine.undeclared)}`, '');

  L.push(SEP, '💳 *RÉPARTITION DES PAIEMENTS*', '');
  L.push('• Espèces : selon rapprochement de caisse', `• Mobile Money : ${money(nc.mobile_money)}`, `• Carte bancaire : ${money(nc.card)}`, `• Crédit : ${money(nc.credit)}`, '');

  L.push(SEP, '💰 *SITUATION DE LA CAISSE*', '');
  L.push(`• Espèces attendues : ${isNum(mine.expected_cash) ? money(mine.expected_cash) : 'non disponible'}`, `• Espèces effectivement remises : ${isNum(mine.counted_cash) ? money(mine.counted_cash) : 'non disponible'}`, '');
  const gap = isNum(mine.cash_gap) ? r2(mine.cash_gap) : null;
  if (gap == null) L.push('⚪ ÉCART DE CAISSE : non disponible');
  else if (Math.abs(gap) < 0.005) L.push('🟢 ÉCART DE CAISSE : 0 ' + currency, '', 'La caisse est équilibrée à la clôture du quart.');
  else if (gap < 0) L.push(`🔴 ÉCART DE CAISSE : ${money(gap)}`, '', `Un déficit de caisse de ${money(-gap)} est constaté à la clôture du quart.`);
  else L.push(`🟠 ÉCART DE CAISSE : +${money(gap)}`, '', `Un excédent de caisse de ${money(gap)} est constaté à la clôture du quart.`);
  L.push('');

  const sg = (mine.stock_gaps || []).filter(x => x && Math.abs(Number(x.amount)) > 0).map(x => ({ ...x, product: String(x.product || '').replace(/\s+/g, ' ').trim() }));
  L.push(SEP, '📦 *ÉCARTS DE STOCK IMPUTÉS*', '');
  if (sg.length) { for (const x of sg) L.push(`• ${x.product} : ${qty(x.amount)}`); L.push('', `Ces écarts sont enregistrés au titre du quart de ${name}.`); }
  else L.push('• Aucun écart de stock imputé.');
  L.push('');

  const items = [];
  if (gap != null && Math.abs(gap) >= 0.005) items.push(`Écart de caisse imputé à ${name} : ${money(gap)}.`);
  for (const x of sg) items.push(`Écart de stock ${x.product} imputé à ${name} : ${qty(x.amount)}.`);
  for (const a of anomalies || []) {
    if (a.employee_id == null || Number(a.employee_id) !== Number(mine.employee_id)) continue;
    if (a.kind === 'ecart_caisse' || a.kind === 'ecart_stock') continue;   // déjà couverts ci-dessus (une seule ligne par écart)
    const who = a.reported_by && a.kind !== 'rattachement' ? (a.reported_self ? ' (signalée par vous-même)' : ` (signalée par ${a.reported_by})`) : '';   // qui a signalé : l'employé lui-même ou un responsable / clôturant
    items.push(String(a.description || '').trim().replace(/\.?$/, '') + who + '.');
  }
  for (const fx of fixes || []) {
    if (fx.to === name) items.push(`Vente de ${money(fx.total)} initialement saisie au nom de ${fx.from}, réattribuée à ${name} (responsable de la pompe).`);
    else if (fx.from === name) items.push(`Vente de ${money(fx.total)} saisie au nom de ${name}, réattribuée à ${fx.to} (responsable de la pompe).`);
  }
  L.push(SEP, '⚠️ *ANOMALIES DÉTECTÉES*', '');
  if (items.length) items.forEach((x, i) => { L.push(`${KEYCAPS[i] || (i + 1) + '.'} 🔴 ${x}`, ''); });
  else L.push('🟢 Aucune anomalie signalée.', '');

  L.push(SEP, '📝 *JUSTIFICATIONS ET OBSERVATIONS*', '');
  L.push(items.length ? "Les anomalies constatées devront faire l'objet d'une vérification et d'explications de la part de l'employé concerné." : "Aucune anomalie n'a été constatée sur la situation de l'employé pour ce quart.", '');
  L.push("📌 IMPORTANT : Aucune retenue financière n'est automatique. Le gérant prend toute décision éventuelle après avoir entendu l'employé et examiné les éléments justificatifs.", '');

  L.push(SEP, '📌 *SYNTHÈSE FINALE*', '');
  L.push(`• Total des ventes : ${bold(money(mine.fuel_amount))}`, `• Écart de caisse : ${gap == null ? '⚪ non disponible' : gapIcon(gap) + ' ' + (Math.abs(gap) < 0.005 ? money(0) : (gap > 0 ? '+' : '') + money(gap))}`,
    `• Écarts de stock : ${sg.length ? '🔴 ' + sg.length + ' produit' + (sg.length > 1 ? 's' : '') : '🟢 aucun'}`, `• Anomalies : ${items.length ? '🔴 ' + items.length : '🟢 0'}`, '');
  L.push(SEP, ...signatureLines({ name: closerName, closedAt: shift.closed_at, tz }), ...generatedByLines(generatedBy));
  return L.join('\n');
}

module.exports = { individualMessage, closerMessage, signatureLines, generatedByLines, consistency, totals, methodKey, kindLabel, duration, SEP };
