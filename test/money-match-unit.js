'use strict';
const assert = require('assert');
const { matchLines, lineHash, parseStatementText } = require('../src/money_match_logic');
let n = 0; const ok = (c, m) => { assert(c, m); n++; };
// appariement simple, tolérance de 2 jours, 1↔1
let r = matchLines([{ id: 1, line_date: '2026-11-03', amount: 5000 }, { id: 2, line_date: '2026-11-03', amount: 5000 }],
  [{ id: 10, moved_on: '2026-11-04', amount: 5000 }]);
ok(r.matches.length === 1 && r.unmatchedLines.length === 1, '1 mouvement ne rapproche qu\'une seule ligne');
r = matchLines([{ id: 1, line_date: '2026-11-03', amount: 5000 }], [{ id: 10, moved_on: '2026-11-07', amount: 5000 }]);
ok(r.matches.length === 0 && r.unmatchedMovements[0] === 10, 'au-delà de 2 jours : pas de rapprochement');
// montant différent d'un centime = refus ; signe opposé = refus
r = matchLines([{ id: 1, line_date: '2026-11-03', amount: 5000.01 }], [{ id: 10, moved_on: '2026-11-03', amount: 5000 }]);
ok(r.matches.length === 0, 'montant au centime');
r = matchLines([{ id: 1, line_date: '2026-11-03', amount: -5000 }], [{ id: 10, moved_on: '2026-11-03', amount: 5000 }]);
ok(r.matches.length === 0, 'signe opposé');
// priorité à la référence identique, même si une autre date est plus proche
r = matchLines([{ id: 1, line_date: '2026-11-03', amount: 7000, reference: 'MP123' }],
  [{ id: 10, moved_on: '2026-11-03', amount: 7000, reference: 'AUTRE' }, { id: 11, moved_on: '2026-11-05', amount: 7000, reference: 'mp 123' }]);
ok(r.matches[0].movement_id === 11 && r.matches[0].by_reference, 'référence prioritaire (casse/espaces ignorés)');
// date la plus proche sans référence
r = matchLines([{ id: 1, line_date: '2026-11-03', amount: 900 }], [{ id: 10, moved_on: '2026-11-05', amount: 900 }, { id: 11, moved_on: '2026-11-04', amount: 900 }]);
ok(r.matches[0].movement_id === 11, 'date la plus proche');
// hash stable
ok(lineHash({ line_date: '2026-11-03', amount: 5000, reference: ' A b ', label: 'X' }) === lineHash({ line_date: '2026-11-03', amount: '5000.00', reference: 'ab', label: 'x' }), 'hash stable');
// analyse de texte
const p = parseStatementText('Date;Libellé;Réf;Montant\n03/11/2026;Paiement client;MP1;5 000\n2026-11-04;Frais;;-150,5\n31/02/2026;Bad;;100\n2026-11-05;x;;abc\nligne\n');
ok(p.lines.length === 2 && p.lines[0].line_date === '2026-11-03' && p.lines[0].amount === 5000 && p.lines[1].amount === -150.5, 'analyse CSV');
ok(p.errors.length === 3, 'erreurs signalées : ' + p.errors.length);
console.log(n + ' contrôles OK');
