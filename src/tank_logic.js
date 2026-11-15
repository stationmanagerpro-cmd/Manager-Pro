'use strict';
/** Réconciliation de stock en cuve (« wet stock ») : logique pure, sans base de données (testable seule).
 *  théorique = jauge d'ouverture + réceptions + autres mouvements − litres pompés ; écart = jauge de clôture − théorique.
 *  Tolérance : TOL_PCT % des litres pompés (0,5 % par défaut), jamais sous MIN_TOL litres ; critique au-delà de 5 × la tolérance. */
const r3 = n => Math.round(Number(n) * 1000) / 1000;
const MIN_TOL = 1;

function tolerancePct(env = process.env) {
  const v = Number(env.RECONCILE_TOLERANCE_PCT);
  return Number.isFinite(v) && v > 0 ? v : 0.5;
}

/** Tolérance effective : réglage de la station (tank_tolerance_pct) s'il est valide, sinon variable serveur, sinon 0,5 %. */
function resolveTolerancePct(stationValue, env = process.env) {
  const v = Number(stationValue);
  return stationValue != null && stationValue !== '' && Number.isFinite(v) && v > 0 ? v : tolerancePct(env);
}
/** Mode de blocage de la clôture : 'off' (défaut), 'critical' ou 'warning'. Toute autre valeur = 'off'. */
const BLOCK_MODES = ['off', 'critical', 'warning'];
const blockMode = v => (BLOCK_MODES.includes(v) ? v : 'off');
/** Produits dont l'écart exige une justification pour clôturer, selon le mode. */
function blockingProducts(products, mode) {
  const m = blockMode(mode);
  if (m === 'off') return [];
  const bad = m === 'warning' ? ['warning', 'critical'] : ['critical'];
  return (products || []).filter(p => p && bad.includes(p.level));
}
/** Écart de livraison : litres reçus selon la jauge (après − avant) comparés aux litres facturés/reçus. */
function deliveryVariance({ before, after, received, tolPct = tolerancePct() }) {
  const b = Number(before), a = Number(after), q = Number(received);
  if (![b, a, q].every(Number.isFinite) || q <= 0) return null;
  const measured = r3(a - b), variance = r3(measured - q), tolerance = r3(Math.max(MIN_TOL, q * tolPct / 100));
  const abs = Math.abs(variance), level = abs <= tolerance ? 'ok' : abs <= 5 * tolerance ? 'warning' : 'critical';
  return { measured, received: r3(q), variance, variance_pct: Math.round(variance / q * 10000) / 100, tolerance, level,
    diagnosis: level === 'ok' ? null : variance < 0 ? 'Livraison incomplète : moins de carburant en cuve que reçu (manque à la livraison, jauge erronée ou fuite)' : 'Plus de carburant en cuve que reçu : quantité reçue sous-déclarée ou jauge erronée' };
}
/** tanks : [{ id, name, opening, closing }] (opening/closing = null si aucune jauge disponible). */
function reconcileProduct({ tanks, received = 0, other = 0, pumped = 0, tolPct = tolerancePct() }) {
  const missing = [];
  for (const t of tanks) {
    if (t.opening == null) missing.push({ tank_id: t.id, name: t.name, what: 'ouverture' });
    if (t.closing == null) missing.push({ tank_id: t.id, name: t.name, what: 'clôture' });
  }
  if (!tanks.length) return { status: 'sans_cuve', level: 'info', missing };
  if (missing.length) return { status: 'incomplet', level: 'info', missing };
  const opening = r3(tanks.reduce((a, t) => a + Number(t.opening), 0));
  const closing = r3(tanks.reduce((a, t) => a + Number(t.closing), 0));
  const theoretical = r3(opening + Number(received) + Number(other) - Number(pumped));
  const variance = r3(closing - theoretical);
  const tolerance = r3(Math.max(MIN_TOL, Math.abs(Number(pumped)) * tolPct / 100));
  const abs = Math.abs(variance);
  const level = abs <= tolerance ? 'ok' : abs <= 5 * tolerance ? 'warning' : 'critical';
  return {
    status: 'calcule', level, opening, received: r3(received), other: r3(other), pumped: r3(pumped), theoretical, closing, variance,
    variance_pct: Number(pumped) > 0 ? Math.round(variance / Number(pumped) * 10000) / 100 : null,
    tolerance, tolerance_pct: tolPct,
    diagnosis: level === 'ok' ? null : variance < 0 ? 'Manque en cuve : fuite, vol, livraison incomplète ou compteur sous-évalué' : 'Excédent en cuve : livraison non saisie, jauge erronée ou compteur sur-évalué'
  };
}
module.exports = { reconcileProduct, tolerancePct, resolveTolerancePct, blockMode, blockingProducts, deliveryVariance, BLOCK_MODES, r3, MIN_TOL };
