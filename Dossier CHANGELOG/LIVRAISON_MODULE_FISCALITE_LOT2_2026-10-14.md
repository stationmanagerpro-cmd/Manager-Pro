# Livraison — Module Fiscalité Lot 2
**Date :** 14 octobre 2026  
**Suite du Lot 1** — estimations, formulaires conditionnels, ITS, échéances, UI Superadmin.

## Contenu livré

### 1. Moteur d’estimation TVA
- Base = `sale_details.tax_rate` + `amount` (ventes validées de la période)
- TVA collectée calculée ligne à ligne
- TVA déductible : **saisie manuelle** (ou approximation si montant TTC fourni)
- Crédit antérieur + régularisations
- Avertissements explicites si règle non vérifiée ou données incomplètes
- API : `POST /fiscal/estimate` et `PATCH /fiscal/periods/:id` avec `run_estimate: true`

### 2. Formulaires conditionnels IBIC / IS / synthétique
- Champs adaptés au module (CA, charges, amortissements, acomptes, déficits…)
- Résultat comptable ≠ résultat fiscal (affichés séparément)
- IBIC et IS traités comme des modules distincts
- Synthétique : CA de référence + montants déjà payés

### 3. Liaison ITS ↔ bulletins RH
- Agrégation des montants ITS depuis les bulletins / runs de paie existants
- Aucun double calcul : réutilise le moteur RH déjà en place
- Avertissement si aucun bulletin sur la période

### 4. Échéances paramétrables
- CRUD `fiscal_deadlines` (interne / réglementaire / paramètre)
- Statuts : à venir, en cours, dépassé, terminé, annulé
- Visible sur le tableau de bord fiscal

### 5. Écran Superadmin (contrats)
- Cases à cocher dans le formulaire d’autorisations client :
  - Accès Fiscalité, estimations, exports, préparation, échéances
  - Sous-modules : TVA, synthétique, IBIC, IS, ITS, CFE, TFP, autres
- Défaut **OFF** (autorisation explicite obligatoire)

### 6. Règles versionnées (seed)
- Migration `047_fiscal_rules_seed.sql` : taux placeholders **statut `a_verifier`**
- Ne jamais présenter comme officiels tant que non confirmés

## Fichiers

| Fichier | Action |
|---------|--------|
| `src/fiscal.js` | + estimateTVA, IBIC/IS, synthétique, ITS, deadlines, PATCH période |
| `public/ext-fiscal.js` | Formulaires conditionnels, estimation, échéances |
| `public/ext-contracts.js` | Champs Superadmin Fiscalité |
| `public/ext-shell.js` | Menu échéances |
| `migrations/047_fiscal_rules_seed.sql` | Seed règles a_verifier |
| `LIVRAISON_MODULE_FISCALITE_LOT2_2026-10-14.md` | Ce rapport |

## Déploiement

```bash
npm run backup
npm run migrate   # 046 (si pas encore) + 047
npm start
```

## Tests minimaux Lot 2

1. Superadmin coche « Fiscalité — accès » + « TVA » + « estimations » sur un client.
2. Client active le module TVA → crée une période → Ouvrir → renseigne TVA déductible → estimation.
3. Vérifier que la TVA collectée reflète les `tax_rate` des ventes de la période.
4. Module ITS activé + bulletins RH présents → estimation ITS = somme des bulletins.
5. Règle TVA en `a_verifier` → warning affiché, pas de « fiable ».
6. Client B ne voit pas les périodes / échéances du client A.
7. Non-régression : ventes, caisse, RH inchangés.

## Limites connues (assumées)

- Pas de TVA ligne à ligne sur les achats (schema purchases sans tax_rate) → saisie manuelle déductible.
- Taux seed non officiels (`a_verifier`).
- Pas d’export PDF fiscal dédié (lot ultérieur).
- Pas de dépôt DGI / télédéclaration.
- CFE / TFP / logement : structure prête, moteur de calcul détaillé non implémenté.

## Lot 3 possible

- Export PDF « préparation déclaration »
- Taux TVA sur lignes d’achat
- Moteurs CFE / TFP
- Confirmation juridique des règles (workflow Superadmin → `verifiee`)
- Alertes automatiques J-7 / J-1 sur échéances
