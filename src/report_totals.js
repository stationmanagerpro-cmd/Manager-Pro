// Totaux de fin de rapport (fonctions pures, testées sans base : test/report-totals-unit.js).
// Règle : le total est calculé sur TOUTES les lignes réellement exportées (donc après filtres) ; arrondi à 3 décimales comme docs.js.
const num = v => (typeof v === 'number' ? v : (+v || 0));
const round = n => Math.round(n * 1000) / 1000;

/** Ligne de total : libellé en 1re colonne, somme pour chaque colonne de `sumCols`, vide ailleurs. Renvoie null s'il n'y a aucune colonne à totaliser. */
function totalsRow(head, rows, sumCols, label = 'TOTAL') {
  if (!Array.isArray(sumCols) || !sumCols.length) return null;
  return head.map((_, i) => (i === 0 ? label : sumCols.includes(i) ? round(rows.reduce((a, r) => a + num(r[i]), 0)) : ''));
}

/** Lignes de total d'un rapport de plateforme : `def.totals(rows)` si défini, sinon une ligne par `def.sumCols`. */
function reportTotals(def, rows) {
  if (typeof def.totals === 'function') return def.totals(rows);
  const t = totalsRow(def.columns, rows, def.sumCols);
  return t ? [t] : [];
}

module.exports = { totalsRow, reportTotals, round };
