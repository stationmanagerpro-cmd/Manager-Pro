# Livraison — Module Fiscalité Lot 8
**Date :** 14 octobre 2026

## Rôles
- Superadmin (`is_global`) : autorisations contrat uniquement  
- Compte client (`client_id`) : ce lot

## Contenu
| Fonction | API / UI |
|----------|----------|
| Rouvrir période | `POST /fiscal/periods/:id/reopen` → `a_completer` |
| Export Excel unitaire | `GET /fiscal/periods/:id/export.xlsx` |
| Archivage groupé | `POST /fiscal/periods/bulk-archive` |
| Filtres liste | Module + statut |
| Guide rapide | Hub Fiscalité |

## Déploiement
Aucune migration. `npm start`

## Bilan
Lots 1–8 + correctif rôles. Assistance préparation uniquement, pas dépôt DGI.
