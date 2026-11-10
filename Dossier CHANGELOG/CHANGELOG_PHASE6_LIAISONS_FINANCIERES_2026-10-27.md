# Phase 6 — Corrections liaisons financières / caisse / agrégats (2026-10-27)

Corrections additives, sans suppression de données ni réécriture d’historique.

## P1 — Dépôt / retrait caisse ↔ compte
- `POST /cash/movements` : `account_id` **obligatoire** pour `depot_bancaire` et `retrait`.
- Écriture miroir dans `money_movements` (`depot` +amount / `retrait` −amount) dans la même transaction.
- UI caisse (`addM`) : sélection du compte si des comptes existent.

## P2 — Journal des ventes
- Ventes produits et carburant : `recordFinancialEvent` type `VENTE` pour chaque paiement (hors crédit purement ledger).

## P3 — Transfert inter-comptes
- Nouvelle route `POST /money/transfer` : deux mouvements liés (`transfert_sortant` / `transfert_entrant`) + références croisées `xfer:<id>` + événement `TRANSFERT`.
- UI Finance : bouton « Transfert entre comptes ».

## P5 — Moyens de paiement non liés
- `settle` passe par `assertLinkedMethod`.
- Ventes produits / carburant : `assertLinkedMethod` avant `accountMove` ; refus si aucun compte.

## P4 — Agrégats (documentation)
- `GET /dashboard/jour` expose un bloc `scope` décrivant les périmètres (produits, fuel quarts fermés, dépenses, caisses instantanées).

## P7 — Intégrité caisse
- `GET /finance/integrity/cash` : compare `cash_registers.balance` et `SUM(cash_movements)`.

## Non modifié (volontairement)
- Cycle stock fuel à la clôture (S1 design métier).
- Historique et soldes existants.
- `/money/deposit` conservé (chemin recommandé pour remise en banque).

## Tests
- `node test/finance-liaisons-static.js` → 38/38.
