# Livraison — Module Fiscalité Lot 13
**Date :** 14 octobre 2026

## Rôles
- Superadmin (`is_global`) : autorisations contrat uniquement  
- Compte client (`client_id`) : ce lot

## Contenu
| Fonction | Détail |
|----------|--------|
| Verrouillage | `valide_interne` / `archive` : pas de modif sans « Rouvrir » |
| Recherche | `q` (notes/data) + filtre `tag` |
| Tags | `POST /fiscal/periods/:id/tags` |
| Activité récente | `GET /fiscal/activity` + vue `fiscalactivity` |

## Déploiement
Aucune migration. `npm start`
