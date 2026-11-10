# 27/10/2026 — Imputation manuelle des avoirs, règlement lié au compte, fiche quart, échéance

- **Imputation des avoirs client** : le bouton ouvre un formulaire (date, dette concernée en liste déroulante, montant, motif).
  Dettes proposées = factures émises/partielles du client + créance globale hors facture. L'imputation consomme les avoirs ouverts
  (du plus ancien au plus récent), réduit la facture (paiement méthode « avoir »), le solde client et le grand livre si la dette vient d'une vente à crédit.
  Historique dans l'onglet « Avoirs / créances » (table `customer_credit_applications`, migration 075). Routes : `GET /customers/:id/credit-imputations`, `POST /customers/:id/credits/impute`.
- **Règlement ↔ compte** : liste déroulante des comptes actifs, refus serveur si le moyen n'est pas lié à un compte actif, `account_id` mémorisé (migration 074).
- **Fiche quart** : jointure `sh.opened_by` (inexistante) remplacée par `sh.manager_id`.
- **Modifier l'échéance** : remet le contrat « expire » à « actif » si la nouvelle date est future.
- Cache service worker : v60.
