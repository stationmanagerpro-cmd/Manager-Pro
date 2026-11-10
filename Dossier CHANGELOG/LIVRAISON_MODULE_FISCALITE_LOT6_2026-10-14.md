# Livraison — Module Fiscalité Lot 6
**Date :** 14 octobre 2026

## Rôles (rappel)

| Rôle | Clé | Fiscalité |
|------|-----|-----------|
| Superadmin | `is_global` | **Uniquement** cases d’autorisation sur le contrat client |
| Compte client | `client_id` | Parcours ops complet (ce lot) |

## Contenu Lot 6 (compte client)

| Fonction | API / UI |
|----------|----------|
| Estimation manuelle logement / retenues / autres | Base + taux ou montant fixe |
| Marquer période **prête** | `POST /fiscal/periods/:id/mark-ready` (checklist obligatoire OK) |
| Archiver période | `POST /fiscal/periods/:id/archive` |
| **ZIP** des pièces | `GET /fiscal/periods/:id/documents.zip` |
| Journal d’activité | `GET /fiscal/audit` + vue `fiscalaudit` |
| Synthèse dashboard | `GET /fiscal/dashboard/summary` |
| Autorisations SA | `fiscal_logement`, `fiscal_retenues` dans le formulaire contrat |

## Fichiers

- `src/fiscal.js`
- `public/ext-fiscal.js`, `ext-shell.js`, `ext-contracts.js`
- `LIVRAISON_MODULE_FISCALITE_LOT6_2026-10-14.md`

## Déploiement

```bash
# Pas de nouvelle migration
npm start
```

## Bilan Fiscalité

| Lot | Thème |
|-----|--------|
| 1 | Fondation |
| 2 | Estimations principales |
| 3 | PDF, CFE/TFP, alertes |
| 4 | Excel, checklist |
| 5 | Upload pièces |
| Correctif | Superadmin ≠ ops fiscal |
| **6** | ZIP, workflow prêt, audit, manuels, dashboard |

Le module reste une **aide à la préparation** : pas de dépôt DGI.
