# Livraison — Module Fiscalité Lot 14
**Date :** 14 octobre 2026

## Rôles
- Superadmin (`is_global`) : autorisations contrat uniquement  
- Compte client (`client_id`) : ce lot

## Contenu
| Fonction | Détail |
|----------|--------|
| Épingler période | `POST /fiscal/periods/:id/pin` + filtre `pinned=1` |
| Export XLS sélection | `POST /fiscal/periods/bulk-export.xlsx` |
| Actualiser échéances | `POST /fiscal/deadlines/refresh` (uniquement le client courant) |

Suppression de documents déjà présente (Lots précédents).

## Déploiement
Aucune migration. `npm start`
