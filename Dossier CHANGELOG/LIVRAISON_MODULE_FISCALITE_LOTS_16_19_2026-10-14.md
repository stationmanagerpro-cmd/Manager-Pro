# Livraison — Module Fiscalité Lots 16–19 (optionnels)
**Date :** 14 octobre 2026

## Lot 16 — Prévisualisation
- `GET /fiscal/documents/:id/preview` (inline PDF / images)
- Bouton **Aperçu** dans les pièces

## Lot 17 — Quota stockage
- Feature contrat `fiscal_storage_mb` (défaut 100, `0` = illimité)
- Contrôle à l’upload + affichage dans **Stockage**
- Champ dans le formulaire Superadmin (contrat)

## Lot 18 — Règles / vérification
- UI lecture seule enrichie : processus juridique, compteurs vérifiée / à vérifier, réf. légale

## Lot 19 — Pack deploy

## Déploiement
Aucune migration SQL obligatoire. `npm start` après déploiement code.
