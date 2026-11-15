'use strict';
/** Relance automatique avant expiration de licence (30, 15 et 7 jours) : logique pure + planificateur quotidien.
 *  Une relance par (client, échéance, palier) : un renouvellement qui change l'échéance relance un nouveau cycle. */
const BANDS = [30, 15, 7];

/** Palier à relancer pour un nombre de jours restants, ou null. Palier = plus petit seuil ≥ jours (ex. 12 j → 15). */
function dueBand(daysRemaining, bands = BANDS) {
  if (daysRemaining == null || daysRemaining === '') return null;
  const d = Number(daysRemaining);
  if (!Number.isFinite(d) || d < 0) return null;
  const sorted = [...bands].sort((a, b) => a - b);
  return sorted.find(t => d <= t) ?? null;
}
function reminderText({ clientName, band, days, expiresOn }) {
  const when = new Date(expiresOn).toLocaleDateString('fr-FR');
  return `Licence : il reste ${days} jour${days > 1 ? 's' : ''} avant l'expiration (${when}). Pour continuer sans interruption, cliquez sur « Renouveler » pour envoyer votre demande à l'administrateur principal.`;
}
module.exports = { dueBand, reminderText, BANDS };
