// Fonctions pures de la finance plateforme (sans base de données ni dépendance : testables seules).
/** État de règlement d'une facture ou d'une dépense (fonction pure, testée sans base de données). */
function payState({ amount, paid, due_on, cancelled }, today = new Date().toISOString().slice(0, 10)) {
  if (cancelled) return 'annulee';
  const a = Math.round(+amount * 100), p = Math.round(+paid * 100);
  if (p >= a) return 'soldee';
  if (due_on && String(due_on).slice(0, 10) < today) return 'en_retard';
  return p > 0 ? 'partielle' : 'impayee';
}

/** Conversion de lignes en CSV (séparateur « ; », BOM UTF-8 pour Excel). Neutralise les formules (injection CSV). */
function toCsv(columns, rows) {
  const cell = v => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s)) s = "'" + s;
    return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return '\ufeff' + [columns.map(cell).join(';'), ...rows.map(x => x.map(cell).join(';'))].join('\r\n');
}

module.exports = { payState, toCsv };
