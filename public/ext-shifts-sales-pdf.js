/* ext-shifts-sales-pdf.js — Export PDF + filtre par période des écrans « Quarts de service » et « Ventes ».
   Même moteur et même barre que les autres rapports (RT : Date de début / Date de fin / Filtrer / Réinitialiser / Exporter en PDF).
   Le PDF reprend exactement la liste affichée (période appliquée). Sans période : les derniers éléments affichés à l'écran. */
(function () {
  'use strict';
  if (!window.RT) return;
  var STAT = { cloture: 'Clôturé', ferme: 'Fermé', ouvert: 'Ouvert', annule: 'Annulé', valide: 'Valide' };
  function st(s) { var k = String(s == null ? '' : s).trim().toLowerCase(); return STAT[k] || (s == null ? '' : s); }
  function n(v) { return Number(v) || 0; }
  function scope(key, count) {
    return RT.applied(key) ? RT.label(key) : 'Toutes les dates (liste affichée : ' + count + ' lignes)';
  }

  function quartPdf() {
    var ls = window.__rtShifts;
    if (!Array.isArray(ls) || !ls.length) { toast('Aucun quart à exporter pour cet affichage', 'info'); return null; }
    var open = ls.filter(function (s) { return String(s.status).toLowerCase() === 'ouvert'; }).length;
    var gap = ls.reduce(function (a, s) { return a + (s.cash_gap == null || s.cash_gap === '' ? 0 : n(s.cash_gap)); }, 0);
    var cur = RT.H.cur(), sections = [];
    sections.push(RT.H.kv('Filtres appliqués', [['Période', RT.applied('quart') ? RT.label('quart') : 'Toutes les dates (liste affichée)'], ['Nombre de quarts', String(ls.length)]]));
    sections.push(RT.H.kpis([
      { label: 'Quarts listés', value: ls.length }, { label: 'Quarts ouverts', value: open },
      { label: 'Écart de caisse cumulé (' + cur + ')', value: gap }
    ], 'Synthèse'));
    sections.push({
      type: 'table', title: 'Quarts de service',
      head: ['N°', 'Type', 'Début', 'Fin', 'Statut', 'Écart caisse'],
      rows: ls.map(function (s) { return [s.number, s.kind || '', RT.H.dateTime(s.opened_at), RT.H.dateTime(s.closed_at), st(s.status), s.cash_gap == null || s.cash_gap === '' ? '' : n(s.cash_gap)]; }),
      totals: ['TOTAL', '', '', '', '', gap]
    });
    return { title: 'Quarts de service', subtitle: 'Liste des quarts', period: scope('quart', ls.length), sections: sections, filename: 'quarts-de-service' };
  }

  function ventesPdf() {
    var ls = window.__rtSales;
    if (!Array.isArray(ls) || !ls.length) { toast('Aucune vente à exporter pour cet affichage', 'info'); return null; }
    var valid = ls.filter(function (x) { return String(x.status).toLowerCase() === 'valide'; });
    var cancelled = ls.filter(function (x) { return String(x.status).toLowerCase() === 'annule'; });
    var total = valid.reduce(function (a, x) { return a + n(x.total); }, 0);
    var cur = RT.H.cur(), sections = [];
    sections.push(RT.H.kv('Filtres appliqués', [['Période', RT.applied('ventes') ? RT.label('ventes') : 'Toutes les dates (liste affichée)'], ['Nombre de ventes', String(ls.length)]]));
    sections.push(RT.H.kpis([
      { label: 'Ventes valides', value: valid.length }, { label: 'Ventes annulées', value: cancelled.length },
      { label: 'Total des ventes valides (' + cur + ')', value: total, note: 'ventes annulées exclues' }
    ], 'Synthèse'));
    sections.push({
      type: 'table', title: 'Ventes',
      head: ['N°', 'Facture', 'Quart', 'Type', 'Date', 'Total', 'Statut'],
      rows: ls.map(function (x) { return [x.id, x.invoice_no || '', x.shift_id == null ? '' : x.shift_id, x.kind === 'carburant' ? 'Carburant' + (x.input_mode ? ' (' + x.input_mode + ')' : '') : 'Produits', RT.H.dateTime(x.sold_at), n(x.total), st(x.status)]; }),
      totals: ['TOTAL VALIDES', '', '', '', '', total, ''],
      notes: ['Le total ne compte que les ventes valides ; les ventes annulées sont listées mais exclues.']
    });
    return { title: 'Ventes', subtitle: 'Liste des ventes', period: scope('ventes', ls.length), sections: sections, filename: 'ventes' };
  }

  RT.register('quart', { view: 'quart', pdf: quartPdf });
  RT.register('ventes', { view: 'ventes', pdf: ventesPdf });
})();
