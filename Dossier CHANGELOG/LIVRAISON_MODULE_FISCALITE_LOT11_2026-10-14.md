# Livraison — Module Fiscalité Lot 11
**Date :** 14 octobre 2026

## Rôles
- Superadmin (`is_global`) : autorisations contrat uniquement  
- Compte client (`client_id`) : ce lot

## Contenu
| Fonction | API / UI |
|----------|----------|
| Suggestion période suivante | `GET /fiscal/periods/suggest-next?module=` |
| Score de complétude | `GET /fiscal/completeness` + vue `fiscalscore` |
| Synthèse PDF globale | `GET /fiscal/summary.pdf` |

## Déploiement
Aucune migration. `npm start`
