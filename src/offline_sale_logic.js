'use strict';
/** Vente carburant saisie hors ligne (CORR-043) : l'heure réelle saisie sur l'appareil est conservée si elle est plausible
 *  et si la vente appartient bien au quart ouvert ; sinon elle est rejetée (jamais rattachée à un autre quart). */
const MAX_AGE_HOURS = 72, FUTURE_SLACK_MS = 5 * 60 * 1000;

function resolveOfflineSale({ offlineAt, nowMs, shiftOpenedAt }) {
  if (!offlineAt) return { ok: true, soldAt: null };
  const t = Date.parse(offlineAt);
  if (Number.isNaN(t)) return { ok: false, reason: 'Heure de saisie hors ligne invalide.' };
  if (t > nowMs + FUTURE_SLACK_MS) return { ok: false, reason: 'Heure de saisie hors ligne dans le futur : vérifiez l’horloge de l’appareil.' };
  if (nowMs - t > MAX_AGE_HOURS * 3600 * 1000) return { ok: false, reason: `Vente hors ligne trop ancienne (plus de ${MAX_AGE_HOURS} h) : à ressaisir après vérification par le gérant.` };
  const opened = shiftOpenedAt ? Date.parse(shiftOpenedAt) : NaN;
  if (!Number.isNaN(opened) && t < opened) return { ok: false, reason: 'Cette vente a été saisie avant l’ouverture du quart actuel (quart déjà clôturé) : à ressaisir par le gérant.' };
  return { ok: true, soldAt: new Date(t).toISOString() };
}
module.exports = { resolveOfflineSale, MAX_AGE_HOURS };
