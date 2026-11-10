# Livraison — Module Fiscalité Lot 3
**Date :** 14 octobre 2026

## Contenu

| Fonction | Détail |
|----------|--------|
| **Export PDF préparation** | `GET /fiscal/periods/:id/pdf` — document interne avec disclaimer, synthèse, signatures |
| **TVA sur lignes d’achat** | `purchase_details.tax_rate` (migration 048) + estimation TVA déductible depuis les lignes |
| **Moteurs CFE / TFP** | Estimation = masse salariale RH × taux règle (saisie manuelle possible) |
| **Confirmation juridique des règles** | `POST /fiscal/rules/:id/confirm` (Superadmin) → statut `verifiee` |
| **Alertes échéances J-7 / J-0** | `scanFiscalDeadlines` intégré au planificateur d’alertes (toutes les 5 min) |
| **UI** | Bouton PDF période, formulaires CFE/TFP, champs masse salariale |

## Fichiers

- `migrations/048_fiscal_lot3.sql` — tax_rate achats
- `migrations/049_fiscal_cfe_tfp_seed.sql` — règles CFE/TFP a_verifier
- `src/fiscal.js` — PDF, confirm, CFE/TFP, scan échéances, TVA lignes
- `src/purchases.js` — acceptation `tax_rate` à la création de commande
- `src/alerts_scheduler.js` — appel scanFiscalDeadlines
- `public/ext-fiscal.js` — PDF, formulaires CFE/TFP
- `LIVRAISON_MODULE_FISCALITE_LOT3_2026-10-14.md`

## Déploiement

```bash
npm run backup
npm run migrate   # 048 + 049
npm start
```

### Activation exports
Sur le contrat client : cocher **Fiscalité — exports documents** (`can_fiscal_exports`).

### Confirmer une règle (Superadmin)
```http
POST /api/fiscal/rules/:id/confirm
{ "reason": "Vérifié d’après le CGI / note X du …" }
```

## Tests minimaux

1. Créer une période TVA → estimation → bouton **PDF** → document avec disclaimer.
2. Commande d’achat avec `tax_rate: 18` → estimation TVA déductible > 0 après réception/facture.
3. Activer CFE → période → estimation (masse RH ou saisie).
4. Superadmin confirme une règle TVA → status `verifiee` → warning « non vérifiée » disparaît.
5. Créer une échéance dans 3 jours → après scan, alerte système / statut `en_cours`.
6. Isolation client A / B inchangée ; ventes / RH non régressés.

## Limites

- Taux CFE/TFP seed = 0 (a_verifier) : à confirmer juridiquement.
- PDF = **préparation interne**, pas un formulaire DGI officiel.
- Alertes échéances via `sendSystemAlert` (nécessite messagerie / auto_alerts selon config existante).
- Admissibilité réelle de la TVA déductible reste une vérification humaine (justificatifs).

## Suite possible (Lot 4)

- UI Superadmin liste des règles + bouton « Confirmer »
- Export Excel multi-périodes
- Checklist pièces justificatives par période
- Paramétrage taux CFE/TFP après validation expert local
