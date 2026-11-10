# Marge, résultat de gestion et rapport client (23/10/2026)

## Audit des liens entre modules
- Fiscalité ↔ RH : ITS et CFE/TFP lisaient `payroll_bulletins` / `payroll_runs` (inexistantes) → toujours 0. Corrigé : lecture de `payslips`.
- Fiscalité ↔ ventes : IBIC/IS et synthétique ignoraient les compteurs carburant ; charges uniquement manuelles. Corrigé : CA et charges repris du système (saisie manuelle prioritaire ; « Impôts et taxes » non repris).
- TVA : avertissement si le CA des lignes de vente diffère du CA de référence.
- Paie ↔ dépenses : la dépense « Salaires » = brut seul ; les charges patronales sont ajoutées au résultat (à la date de paiement du bulletin).
- Marge : n'existait que dans le rapport financier, masquée si un coût d'achat manquait.

## Ajouts
- `src/profitability.js` : source unique marge brute / résultat de gestion.
- `GET /api/reports/client-profit?from&to&group&station_ids&format=json|xlsx|pdf|csv` (période libre, 5 ans max).
- Dashboard : cartes Marge brute, Taux de marge, Résultat de gestion (profils finance ; « partielle » si coûts manquants).
- Page « Rapport client & marges » (menu Finance & rapports). Cache PWA `smp-static-v27`. Aucune migration.

## Test
`node test/profitability-static.js`
Non vérifié : exécution du SQL sur PostgreSQL et rendu de l'interface.

## Calculatrice flottante (23/10/2026)
- Bouton rond en bas à droite, visible partout une fois connecté ; raccourci clavier Alt+C ; Échap pour fermer.
- Évaluateur maison (sans eval, compatible CSP) : + − × ÷ ( ) et %, virgule ou point ; « 200 + 10 % » = 220.
- Copier le résultat ; « Insérer dans le champ » écrit le résultat dans le dernier champ numérique/texte utilisé ; historique de session en mémoire uniquement (effacé à la déconnexion).
- Masquée à l'impression. Fichiers : `public/ext-calc.js`, `public/ext-calc.css`, `index.html`, `sw.js` (cache v28).
- Tests : `node test/calculator-static.js` (21 contrôles), `node test/calculator-dom.js` (10 contrôles, jsdom).
