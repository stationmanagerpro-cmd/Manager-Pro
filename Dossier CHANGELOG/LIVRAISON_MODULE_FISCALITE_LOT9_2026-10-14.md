# Livraison — Module Fiscalité Lot 9
**Date :** 14 octobre 2026

## Rôles
- Superadmin (`is_global`) : autorisations contrat uniquement
- Compte client (`client_id`) : ce lot

## Contenu
| Fonction | Détail |
|----------|--------|
| Filtres API périodes | `module`, `status`, `from`, `to` |
| Notes chronologiques | `POST /fiscal/periods/:id/notes` |
| Comparaison 2 périodes | `GET /fiscal/periods/compare?a=&b=` |
| Export journal CSV | `GET /fiscal/audit.csv` |
| Hub | Alertes échéances / pièces manquantes |

## Déploiement
Aucune migration. `npm start`
