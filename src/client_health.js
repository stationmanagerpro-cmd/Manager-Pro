'use strict';
/** Santé d'un client (0 à 100) : logique pure, testable sans base.
 *  Pondération : activité 30 · quarts clôturés 30 · écarts de caisse 20 · licence 20.
 *  Entrées : { activeDays, windowDays, shiftsOpened, shiftsClosed, staleOpenShifts, gapShifts, license: { status, daysRemaining, indefinite } }.
 *  Une composante sans donnée exploitable est neutre (la moitié des points) et signalée : on ne fabrique pas de bonne ou mauvaise note. */
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const round = n => Math.round(n);

function licensePoints(lic) {
  if (!lic) return { pts: 10, note: 'licence inconnue', known: false };
  const s = String(lic.status || '').toUpperCase();
  if (s === 'SUSPENDUE') return { pts: 0, note: 'licence suspendue', known: true };
  if (s === 'EXPIREE') return { pts: 0, note: 'licence expirée', known: true };
  if (lic.indefinite || s === 'INDEFINIE') return { pts: 20, note: 'licence illimitée', known: true };
  const d = Number(lic.daysRemaining);
  if (!Number.isFinite(d)) return { pts: 10, note: 'échéance inconnue', known: false };
  if (d <= 7) return { pts: 5, note: `licence : ${d} j restants`, known: true };
  if (d <= 15) return { pts: 10, note: `licence : ${d} j restants`, known: true };
  if (d <= 30) return { pts: 15, note: `licence : ${d} j restants`, known: true };
  return { pts: 20, note: null, known: true };
}

function healthScore(i) {
  const reasons = [];
  const win = Math.max(1, Number(i.windowDays) || 30);
  // Activité : jours avec connexion / jours de la fenêtre (7 jours sur 10 suffisent pour le maximum)
  const act = clamp((Number(i.activeDays) || 0) / (win * 0.7), 0, 1) * 30;
  if ((Number(i.activeDays) || 0) === 0) reasons.push('aucune connexion sur la période');
  else if (act < 15) reasons.push('activité faible');
  // Quarts : clôturés / ouverts, pénalité par quart resté ouvert trop longtemps
  let shifts, shiftsKnown = true;
  const opened = Number(i.shiftsOpened) || 0, closed = Number(i.shiftsClosed) || 0, stale = Number(i.staleOpenShifts) || 0;
  if (opened === 0) { shifts = 15; shiftsKnown = false; reasons.push('aucun quart sur la période (composante neutre)'); }
  else { shifts = clamp(closed / opened, 0, 1) * 30 - stale * 5; shifts = clamp(shifts, 0, 30); if (stale) reasons.push(`${stale} quart(s) resté(s) ouvert(s) trop longtemps`); else if (closed / opened < 0.8) reasons.push('quarts non clôturés'); }
  // Écarts de caisse : part des quarts clôturés avec écart (0 % = 20 pts, 50 % et plus = 0)
  let gaps, gapsKnown = closed > 0;
  if (!gapsKnown) gaps = 10;
  else { const rate = clamp((Number(i.gapShifts) || 0) / closed, 0, 1); gaps = clamp(1 - rate / 0.5, 0, 1) * 20; if (rate >= 0.25) reasons.push(`écarts de caisse sur ${Math.round(rate * 100)} % des quarts`); }
  const lic = licensePoints(i.license); if (lic.note) reasons.push(lic.note);
  const score = round(clamp(act + shifts + gaps + lic.pts, 0, 100));
  const level = score >= 70 ? 'bon' : score >= 40 ? 'a_surveiller' : 'a_risque';
  return { score, level, parts: { activite: round(act), quarts: round(shifts), ecarts: round(gaps), licence: lic.pts },
    incomplete: !shiftsKnown || !gapsKnown || !lic.known, reasons };
}
module.exports = { healthScore, licensePoints };
