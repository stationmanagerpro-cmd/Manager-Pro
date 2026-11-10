# Étape 20 — Fiche D1 : icônes modernes sur les cartes à chiffres

Date : 2026-10-19

## Modifications
- Ajout d'un jeu interne d'icônes SVG en style trait, sans dépendance externe.
- Remplacement des quatre emojis du tableau de bord Pilotage direction par des icônes SVG.
- Décoration automatique des cartes KPI reconnues (`.kpi-card`, `.dv2-mini` et cartes numériques génériques) y compris lors de leur insertion dynamique dans le DOM.
- Correspondances de libellés pour ventes, carburant, litres, dépenses, quarts, stocks, employés, clients, abonnements, échéances, suspensions, renouvellements, utilisateurs, sécurité et sauvegardes.
- Pastilles teintées basées sur les couleurs de thème, variante sombre et respect de `prefers-reduced-motion`.

## Vérifications effectuées
- `node --check public/ext-design.js` : réussi.
- `node --check test/kpi-icons-d1-static.js` : réussi.
- `node test/kpi-icons-d1-static.js` : 8/8 contrôles statiques réussis.
- Validation JSON de `package.json` : réussie.

## Limites
Les tests sont statiques et de syntaxe. Aucun test visuel automatisé en navigateur n'a été effectué. Les cartes dont le libellé ou la structure HTML ne correspond pas aux sélecteurs connus peuvent nécessiter une adaptation spécifique.
