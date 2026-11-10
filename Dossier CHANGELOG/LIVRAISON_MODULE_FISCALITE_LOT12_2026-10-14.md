# Livraison — Module Fiscalité Lot 12
**Date :** 14 octobre 2026

## Rôles
- Superadmin (`is_global`) : autorisations contrat uniquement  
- Compte client (`client_id`) : ce lot

## Contenu
| Fonction | Détail |
|----------|--------|
| Chevauchement | Warning à la création si périodes du même module se chevauchent |
| Recalcul | `POST /fiscal/periods/:id/recalculate` |
| Bulk prêt | `POST /fiscal/periods/bulk-ready` |
| PDF complétude | `GET /fiscal/completeness.pdf` |

## Déploiement
Aucune migration. `npm start`
