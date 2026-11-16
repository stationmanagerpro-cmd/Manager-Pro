# Fiche client / fournisseur / employé — affichage téléphone — 2026-11-16

## Demandé
Écran de fiche client trop grand sur téléphone (valeurs « 195 000 FCFA » qui débordent, page très haute). Mêmes classes utilisées par les fiches fournisseur, employé et l'onglet Comportement : corrigé pour toutes.

## Réalisé
- public/ext-sa-dash.css : bloc ajouté, limité à `.ps-wrap` et à `max-width: 600px`. Cartes KPI en colonne (icône, libellé, valeur sous la cartes), valeurs réduites et qui se retournent à la ligne, grilles 2 colonnes compactes, graphiques moins hauts, marges réduites.
- Le tableau de bord superadmin et l'affichage ordinaire sur ordinateur ne sont pas modifiés.
- public/sw.js régénéré (smp-static-bb77d89f440).

## Vérifications
- Rendu Playwright à 390 px avec les valeurs de la capture : aucun débordement de valeur, largeur de page 390 px (pas de défilement horizontal). Capture contrôlée visuellement.
- Non vérifié : rendu réel dans l'application (fiche client réelle, données réelles) et fiches fournisseur / employé.

## Non traité
- Demande 1 (désactiver un sous-compte station) : voir la suite de la conversation — à préciser.
