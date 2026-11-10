'use strict';
/** Contrôle d'une transaction de carte flotte : logique pure (sans base), testable seule.
 *  Reprend les contrôles du marché : statut, expiration, PIN, produit, jour/heure, plafonds par transaction / jour / mois
 *  (litres et montant), nombre de transactions par jour, kilométrage. Un refus donne TOUTES les raisons (pas seulement la première). */
const r3 = n => Math.round(Number(n) * 1000) / 1000;
const DAYS = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** Jour ISO (1 = lundi), minutes depuis minuit et date AAAA-MM-JJ, à l'heure locale du fuseau. */
function localParts(now, timeZone) {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(now).map(x => [x.type, x.value]));
  return { isoDay: DAYS[p.weekday], minutes: (Number(p.hour) % 24) * 60 + Number(p.minute), date: `${p.year}-${p.month}-${p.day}` };
}
const toMin = t => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };

function evaluateCard({ card, now = new Date(), timeZone = 'Africa/Bamako', tx, usage = {} }) {
  const reasons = []; const no = (code, message) => reasons.push({ code, message });
  const u = { dayLiters: 0, dayAmount: 0, dayCount: 0, monthLiters: 0, monthAmount: 0, ...usage };
  const liters = r3(tx.liters), amount = Number(tx.amount);
  const lp = localParts(now, timeZone);

  if (card.status !== 'active') no('CARTE_INACTIVE', card.status === 'lost' ? 'Carte déclarée perdue' : card.status === 'expired' ? 'Carte expirée' : 'Carte bloquée' + (card.blocked_reason ? ' : ' + card.blocked_reason : ''));
  if (card.expires_on && String(card.expires_on).slice(0, 10) < lp.date) no('CARTE_EXPIREE', 'Carte expirée le ' + String(card.expires_on).slice(0, 10));
  if (card.pin_hash && !tx.pinOk) no('PIN_INVALIDE', 'Code PIN absent ou incorrect');

  const allowed = (card.allowed_product_ids || []).map(Number);
  if (allowed.length && !allowed.includes(Number(tx.productId))) no('PRODUIT_NON_AUTORISE', 'Produit non autorisé pour cette carte');
  const days = (card.allowed_days || []).map(Number);
  if (days.length && !days.includes(lp.isoDay)) no('JOUR_NON_AUTORISE', 'Carte non utilisable ce jour');
  if (card.hours_from && card.hours_to) {
    const a = toMin(card.hours_from), b = toMin(card.hours_to);
    const inside = a <= b ? lp.minutes >= a && lp.minutes <= b : lp.minutes >= a || lp.minutes <= b;   // plage de nuit possible (ex. 22:00 → 06:00)
    if (!inside) no('HORAIRE_NON_AUTORISE', `Carte utilisable de ${String(card.hours_from).slice(0, 5)} à ${String(card.hours_to).slice(0, 5)} seulement`);
  }

  const cap = (limit, value, code, label, unit) => { if (limit != null && value > Number(limit) + 1e-9) no(code, `${label} dépassé : ${r3(value)} ${unit} pour un plafond de ${Number(limit)} ${unit}`); };
  cap(card.max_liters_tx, liters, 'PLAFOND_TRANSACTION_L', 'Plafond par transaction', 'L');
  cap(card.max_amount_tx, amount, 'PLAFOND_TRANSACTION_MONTANT', 'Plafond par transaction', 'FCFA');
  cap(card.max_liters_day, r3(u.dayLiters + liters), 'PLAFOND_JOUR_L', 'Plafond journalier', 'L');
  cap(card.max_amount_day, u.dayAmount + amount, 'PLAFOND_JOUR_MONTANT', 'Plafond journalier', 'FCFA');
  cap(card.max_liters_month, r3(u.monthLiters + liters), 'PLAFOND_MOIS_L', 'Plafond mensuel', 'L');
  cap(card.max_amount_month, u.monthAmount + amount, 'PLAFOND_MOIS_MONTANT', 'Plafond mensuel', 'FCFA');
  if (card.max_tx_day != null && u.dayCount + 1 > Number(card.max_tx_day)) no('NB_TRANSACTIONS_JOUR', `Nombre de prises du jour atteint (${card.max_tx_day})`);

  if (card.requires_odometer) {
    if (tx.odometer == null || !(Number(tx.odometer) >= 0)) no('KILOMETRAGE_REQUIS', 'Kilométrage obligatoire pour cette carte');
    else if (card.last_odometer != null && Number(tx.odometer) < Number(card.last_odometer)) no('KILOMETRAGE_INCOHERENT', `Kilométrage inférieur au dernier relevé (${Number(card.last_odometer)} km)`);
  }

  const rem = (limit, used) => limit == null ? null : Math.max(0, r3(Number(limit) - used));
  return {
    ok: reasons.length === 0, reasons,
    remaining: { day_liters: rem(card.max_liters_day, u.dayLiters), day_amount: rem(card.max_amount_day, u.dayAmount), month_liters: rem(card.max_liters_month, u.monthLiters), month_amount: rem(card.max_amount_month, u.monthAmount) }
  };
}

/** Consommation moyenne (L/100 km) à partir des prises successives [{ liters, odometer }] triées par date : plein à plein. */
function consumption(rows) {
  const pts = rows.filter(x => x.odometer != null).sort((a, b) => a.odometer - b.odometer);
  if (pts.length < 2) return null;
  const km = pts[pts.length - 1].odometer - pts[0].odometer;
  const liters = pts.slice(1).reduce((a, x) => a + Number(x.liters), 0);   // le premier plein ne compte pas : il remplit le réservoir avant le premier relevé
  return km > 0 ? { km: r3(km), liters: r3(liters), l_per_100km: Math.round(liters / km * 10000) / 100 } : null;
}

module.exports = { evaluateCard, consumption, localParts };
