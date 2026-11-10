# Livraison — Module Fiscalité Lot 15
**Date :** 14 octobre 2026

## Rôles
- Superadmin (`is_global`) : autorisations contrat (flags fiscaux) uniquement  
- Compte client (`client_id`) : ce lot

## Contenu
| Fonction | API / UI |
|----------|----------|
| Vue annuelle | `GET /fiscal/year-overview?year=` + vue `fiscalyear` |
| PDF profil | `GET /fiscal/profile.pdf` |
| Batch 12 mois | `POST /fiscal/periods/batch-year` |

## Déploiement
Aucune migration. `npm start`

## Note
Le cœur du module (Lots 1–15 + correctif rôles) couvre préparation, estimations, pièces, workflow et exports.  
**Hors périmètre** : dépôt DGI, barèmes juridiques non vérifiés (`a_verifier`).
