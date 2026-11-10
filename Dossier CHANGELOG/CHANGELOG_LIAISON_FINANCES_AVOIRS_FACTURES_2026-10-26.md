# Liaison profils client / fournisseur ↔ finances (26/10/2026)

## Avoirs (client et fournisseur) — désormais imputés financièrement
- **Avoir fournisseur** : réduit la dette (`suppliers.balance_due`) en s'imputant sur les factures ouvertes
  (lignes `supplier_payments` avec méthode `avoir`, sans mouvement de caisse). Le reliquat reste « ouvert » et
  s'impute automatiquement à la prochaine facture fournisseur, ou via `POST /suppliers/:id/credits/apply`.
- **Avoir client** : réduit la créance (`customers.balance`) sans jamais la rendre négative ; écriture au grand livre
  (`customer_ledger.kind = 'avoir'`, migration `073`). Reliquat via `POST /customers/:id/credits/apply`.
- Chaque imputation est tracée dans `financial_events` (type `AUTRE`, sens neutre) et dans le journal d'audit.
- Les contrôles de réconciliation existants (dette = factures − paiements ; solde client = grand livre) restent exacts.

## Paiement des factures clientes (module Facturation)
- Le paiement entre réellement en caisse / sur le compte du moyen de paiement, avec événement `PAIEMENT_CLIENT`.
- Facture issue d'une vente à crédit : la créance du client baisse à chaque paiement (solde + grand livre).
- Facture issue d'une vente : la part déjà encaissée à la vente est marquée payée dès l'émission (pas de double encaissement).
- Refus : paiement par « crédit », montant supérieur à la dette actuelle du client.
- Facture manuelle (sans vente) : l'argent entre en caisse mais aucune créance n'existait, donc le solde client ne change pas.

## Limites connues
- Les paiements de factures enregistrés AVANT cette version n'ont pas de mouvement de caisse ni d'écriture au grand livre ; ils ne sont pas rétro-corrigés.
- Un avoir client ne s'impute pas automatiquement sur une future vente à crédit (utiliser le bouton « Imputer les avoirs »).

## Fichiers
`src/credits.js` (nouveau), `src/catalog.js`, `src/purchases.js`, `src/billing.js`, `migrations/073_avoirs_imputation_financiere.sql`,
`public/ext-detail-pages.js`, `public/ext-p3.js`, `public/sw.js` (cache v59).
