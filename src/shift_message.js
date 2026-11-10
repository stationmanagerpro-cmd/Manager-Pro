'use strict';
// Message individuel de fin de quart (WhatsApp) — gabarit unique. Module pur : aucune base.
// Chaque employé ne reçoit que SA situation (ses pompes, ses ventes, sa caisse, ses écarts de stock, ses anomalies).

const SEP = '━━━━━━━━━━━━━━━━━━';
const KEYCAPS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
const KINDS = { personnalise: 'Personnalisé', jour: 'Jour', nuit: 'Nuit', matin: 'Matin', soir: 'Soir', apresmidi: 'Après-midi' };
const tidy = s => String(s).replace(/[\u202f\u00a0]/g, ' ').replace(/\u2212/g, '-');
const r2 = v => Math.round((Number(v) || 0) * 100) / 100;
const nf2 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }), nf3 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 });
const isNum = v => v != null && v !== '' && Number.isFinite(Number(v));

function kindLabel(kind) {
  const raw = String(kind || '').trim(); if (!raw) return '';
  const key = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]/g, '');
  return KINDS[key] || raw.charAt(0).toUpperCase() + raw.slice(1);
}
function parts(d, tz) {
  const o = {}; for (const p of new Intl.DateTimeFormat('fr-FR', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(d))) o[p.type] = p.value;
  if (o.hour === '24') o.hour = '00';
  return o;
}
const hhmm = (d, tz) => { if (!d) return 'n/d'; const p = parts(d, tz); return `${p.hour}h${p.minute}`; };
const dmy = (d, tz) => { if (!d) return 'n/d'; const p = parts(d, tz); return `${p.day}/${p.month}/${p.year}`; };
function duration(a, b) {
  if (!a || !b) return 'n/d';
  const m = Math.max(0, Math.round((new Date(b) - new Date(a)) / 60000));
  const pl = (n, w) => `${n} ${w}${n > 1 ? 's' : ''}`;
  if (m < 60) return pl(m, 'minute');
  const h = Math.floor(m / 60), rest = m % 60;
  return pl(h, 'heure') + (rest ? ' ' + pl(rest, 'minute') : '');
}

/** ctx : { stationName, currency, shift: { number, kind, opened_at, closed_at }, tz }
 *  mine : entrée report.employees de l'employé ; anomalies : report.anomalies ; fixes : report.attribution_check.fixes */
function individualMessage({ stationName, currency = 'FCFA', shift, mine, anomalies = [], fixes = [], tz = 'Africa/Bamako' }) {
  const money = v => tidy(nf2.format(r2(v))) + ' ' + currency;
  const qty = v => tidy(nf2.format(r2(v)));   // quantités (stock, litres) : jamais de devise
  const station = String(stationName || 'Station').replace(/\s+/g, ' ').trim().toUpperCase();
  const num6 = String(shift.number).padStart(6, '0'), kl = kindLabel(shift.kind), name = String(mine.name || 'Employé').replace(/\s+/g, ' ').trim();
  const nc = mine.non_cash || {};
  const pumps = (mine.pumps || []).map(p => { const m = String(p).trim().match(/^(?:pompe\s*(?:n°|no|num[eé]ro)?\s*)?(\d+)$/i); return m ? 'Pompe N° ' + m[1] : String(p); });
  const L = [];
  L.push(`⛽ ${station}`, '📋 RAPPORT INDIVIDUEL DE FIN DE QUART', '');
  L.push(`🔖 Quart N° : ${num6}${kl ? ` (${kl})` : ''}`, '');
  L.push(`👤 Employé : ${name}`, `📅 Date : ${dmy(shift.opened_at || shift.closed_at, tz)}`, `🕐 Ouverture : ${hhmm(shift.opened_at, tz)}`, `🕐 Fermeture : ${hhmm(shift.closed_at, tz)}`, `⏱️ Durée : ${duration(shift.opened_at, shift.closed_at)}`, '');

  L.push(SEP, '⛽ 1. SITUATION DES VENTES', '');
  L.push(pumps.length ? `${pumps.length > 1 ? 'Pompes concernées' : 'Pompe concernée'} : ${pumps.join(', ')}` : 'Pompe concernée : aucune pompe affectée', '');
  const lit = Number(mine.fuel_liters) || 0;
  L.push(`💰 Total des ventes : ${money(mine.fuel_amount)}`, `🛢️ Volume distribué : ${tidy(nf3.format(lit))} litre${Math.abs(lit) > 1 ? 's' : ''}`, '');
  L.push(`• Montant déclaré à la saisie : ${money(mine.declared_fuel)}`, `• Montant non déclaré (comptabilisé en espèces) : ${money(mine.undeclared)}`, '');
  L.push('Modes de paiement :', '• Espèces : selon rapprochement de caisse', `• Mobile Money : ${money(nc.mobile_money)}`, `• Carte bancaire : ${money(nc.card)}`, `• Crédit : ${money(nc.credit)}`, '');

  L.push(SEP, '💵 2. SITUATION DE LA CAISSE', '');
  L.push(`• Espèces attendues : ${isNum(mine.expected_cash) ? money(mine.expected_cash) : 'non disponible'}`, `• Espèces effectivement remises : ${isNum(mine.counted_cash) ? money(mine.counted_cash) : 'non disponible'}`, '');
  const gap = isNum(mine.cash_gap) ? r2(mine.cash_gap) : null;
  if (gap == null) L.push('⚪ ÉCART DE CAISSE : non disponible');
  else if (Math.abs(gap) < 0.005) L.push('🟢 ÉCART DE CAISSE : 0 ' + currency, '', 'La caisse est équilibrée à la clôture du quart.');
  else if (gap < 0) L.push(`🔴 ÉCART DE CAISSE : ${money(gap)}`, '', `Un déficit de caisse de ${money(-gap)} est constaté à la clôture du quart.`);
  else L.push(`🟠 ÉCART DE CAISSE : +${money(gap)}`, '', `Un excédent de caisse de ${money(gap)} est constaté à la clôture du quart.`);
  L.push('');

  const sg = (mine.stock_gaps || []).filter(x => x && Math.abs(Number(x.amount)) > 0).map(x => ({ ...x, product: String(x.product || '').replace(/\s+/g, ' ').trim() }));
  L.push(SEP, '📦 3. ÉCARTS DE STOCK IMPUTÉS', '');
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
  L.push(SEP, '⚠️ 4. ANOMALIES SIGNALÉES', '');
  if (items.length) items.forEach((t, i) => { L.push(`${KEYCAPS[i] || (i + 1) + '.'} ${t}`, ''); });
  else L.push('Aucune anomalie signalée.', '');

  L.push(SEP, '⚖️ 5. OBSERVATION ET RESPONSABILITÉ', '');
  L.push(items.length ? "Les anomalies constatées devront faire l'objet d'une vérification et d'explications de la part de l'employé concerné." : "Aucune anomalie n'a été constatée sur la situation de l'employé pour ce quart.", '');
  L.push("📌 IMPORTANT : Aucune retenue financière n'est automatique. Le gérant prend toute décision éventuelle après avoir entendu l'employé et examiné les éléments justificatifs.", '');
  L.push(SEP, `🏢 ${station}`, 'La Direction – Contrôle et suivi des opérations', '', `📄 Fin du rapport – Quart N° ${num6}.`);
  return L.join('\n');
}

module.exports = { individualMessage, kindLabel, duration, SEP };
