# Livraison — Module Fiscalité Lot 10 (finition)
**Date :** 14 octobre 2026

## Rôles
- **Superadmin** (`is_global`) : autorisations contrat uniquement  
- **Compte client** (`client_id`) : parcours ops

## Contenu Lot 10
| Fonction | Détail |
|----------|--------|
| Fiche période | `GET /fiscal/periods/:id/detail` — workflow, pièces, docs, historique, notes |
| Santé module | `GET /fiscal/health` — profil, modules, accès |
| CSV documents | `GET /fiscal/documents.csv` |
| Création période | Checklist auto + warning si profil incomplet |
| UI | Bouton **Fiche**, alertes hub enrichies |

## Déploiement
Aucune migration. `npm start`

## Bilan module Fiscalité (Lots 1–10)

| Lot | Thème |
|-----|--------|
| 1 | Fondation (profil, modules, permissions) |
| 2 | Estimations TVA / IBIC / IS / synthétique / ITS |
| 3 | PDF, CFE/TFP, alertes échéances |
| 4 | Excel multi-périodes, checklist |
| 5 | Upload justificatifs |
| Correctif | Superadmin hors ops fiscal |
| 6 | ZIP, prêt, audit |
| 7 | Validation, clone, calendrier, stockage |
| 8 | Réouverture, filtres, bulk archive |
| 9 | Notes, comparaison, CSV audit |
| **10** | Fiche détail, health, CSV docs |

**Hors périmètre volontaire** : dépôt DGI, connexion officielle, validation légale automatisée, taux juridiques non vérifiés (`a_verifier`).

Le module est une **aide à la préparation fiscale** pour les comptes clients autorisés.
