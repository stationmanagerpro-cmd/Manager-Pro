'use strict';
// Rapprochement ligne à ligne (pur, sans base) : une ligne de relevé ↔ un mouvement comptable.
// Règles métier : même compte, même montant signé (au centime), écart de date ≤ 2 jours (valeur opérateur / saisie caisse),
// 1 ligne ↔ 1 mouvement. Priorité : référence identique, puis date la plus proche, puis le plus ancien.
const fl2 = n => Math.round(Number(n) * 100) / 100;
const DAY = 86400000;
const dayNum = d => Math.floor(new Date(String(d).slice(0, 10) + 'T00:00:00Z').getTime() / DAY);
const norm = s => String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, '');

function lineHash(l) {
  return [String(l.line_date).slice(0, 10), fl2(l.amount).toFixed(2), norm(l.reference), norm(l.label)].join('|');
}

/** lines: [{id,line_date,amount,reference}] ; movements: [{id,moved_on,amount,reference}] (non déjà rapprochés) */
function matchLines(lines, movements, { maxDays = 2 } = {}) {
  const free = movements.slice().sort((a, b) => dayNum(a.moved_on) - dayNum(b.moved_on) || a.id - b.id);
  const taken = new Set(), matches = [], unmatchedLines = [];
  const ordered = lines.slice().sort((a, b) => dayNum(a.line_date) - dayNum(b.line_date) || a.id - b.id);
  // 1re passe : références identiques ; 2e passe : montant + date seulement
  const pass = byRef => {
    for (const l of ordered) {
      if (l._done) continue;
      let best = null, bestScore = null;
      for (const m of free) {
        if (taken.has(m.id)) continue;
        if (fl2(m.amount) !== fl2(l.amount)) continue;
        const dd = Math.abs(dayNum(m.moved_on) - dayNum(l.line_date));
        if (dd > maxDays) continue;
        const sameRef = norm(l.reference) && norm(l.reference) === norm(m.reference);
        if (byRef && !sameRef) continue;
        const score = dd;
        if (best === null || score < bestScore) { best = m; bestScore = score; }
      }
      if (best) { taken.add(best.id); l._done = true; matches.push({ line_id: l.id, movement_id: best.id, day_gap: bestScore, by_reference: byRef }); }
    }
  };
  pass(true); pass(false);
  for (const l of ordered) if (!l._done) unmatchedLines.push(l.id);
  const unmatchedMovements = free.filter(m => !taken.has(m.id)).map(m => m.id);
  for (const l of ordered) delete l._done;
  return { matches, unmatchedLines, unmatchedMovements };
}

/** Analyse d'un relevé collé en texte : « date;libellé;référence;montant » (; , ou tabulation). Date AAAA-MM-JJ ou JJ/MM/AAAA. */
function parseStatementText(text) {
  const out = [], errors = [];
  String(text || '').split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim(); if (!line) return;
    const parts = line.split(/[;\t]/).map(s => s.trim());
    if (parts.length < 3) { errors.push({ line: i + 1, error: 'Au moins 3 colonnes : date ; libellé ; montant (référence facultative)' }); return; }
    if (/^date$/i.test(parts[0])) return;   // en-tête
    let d = parts[0], m;
    if ((m = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) d = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d + 'T00:00:00Z')) || new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) !== d) { errors.push({ line: i + 1, error: 'Date invalide : ' + parts[0] }); return; }
    const amtRaw = parts[parts.length - 1].replace(/\s/g, '').replace(/[A-Za-z]+$/, '').replace(',', '.');
    const amount = Number(amtRaw);
    if (!Number.isFinite(amount) || amount === 0) { errors.push({ line: i + 1, error: 'Montant invalide : ' + parts[parts.length - 1] }); return; }
    const label = parts[1] || null, reference = parts.length >= 4 ? (parts[2] || null) : null;
    out.push({ line_date: d, label, reference, amount: fl2(amount) });
  });
  return { lines: out, errors };
}

module.exports = { matchLines, lineHash, parseStatementText, fl2 };
