# Livraison — Module Fiscalité Lot 7
**Date :** 14 octobre 2026

## Rôles

- **Superadmin** (`is_global`) : autorisations contrat uniquement  
- **Compte client** (`client_id`) : ce lot

## Contenu

| Fonction | Détail |
|----------|--------|
| **Validation interne** | `POST .../validate-internal` (après statut « prêt ») |
| **Cloner période** | Nouvelles dates, brouillon, checklist réinitialisée |
| **Règles applicables** | Lecture seule client (`/fiscal/rules/applicable`) |
| **Calendrier annuel** | Génération 12 échéances mensuelles |
| **Stockage** | Volume documents fiscaux du client |

## Déploiement

Pas de migration. `npm start`

## Bilan

Lots 1→7 + correctif rôles. Module = **aide à la préparation**, pas dépôt DGI.
