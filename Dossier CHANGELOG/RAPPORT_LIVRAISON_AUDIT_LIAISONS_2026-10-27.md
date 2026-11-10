# Manage Pro — Livraison audit & correction des liaisons
**Date :** 2026-10-27  
**Périmètre :** comptes, modules, agrégats, Caisse & dépenses, stock carburant  
**Méthode :** Phases 1 → 9 (inventaire, cartographie, diagnostic, corrections, tests, vérification, livraison)

---

## 1. Résumé exécutif

Audit technique complet des liaisons entre caisses, comptes banque/Mobile Money, dépenses, ventes, quarts, stock carburant et agrégats.  
Corrections **additives** appliquées sur les écarts critiques (P1, P2, P3, P5, P7) et durcissement complémentaire en Phase 8 (clôture de quart, imports).

- **Aucune donnée opérationnelle supprimée ou réécrite.**
- **Aucune migration destructive.**
- **Historique des soldes non recalculé artificiellement.**

---

## 2. Cartographie des relations (synthèse)

### Sources de vérité des soldes

| Solde | Source |
|-------|--------|
| Caisse | `cash_registers.balance` (mis à jour par `cashMove`) + historique `cash_movements` |
| Banque / MM | `opening_balance + SUM(money_movements.amount)` |
| Créances clients | `customers.balance` + `customer_ledger` |
| Dettes fournisseurs | `suppliers.balance_due` + paiements |

### Helper central

`settle` / `cashMove` / `accountMove` / `assertLinkedMethod` / `recordFinancialEvent` (`src/core.js`).

### Agrégats

- `/cash/overview` : liquidités caisses + comptes, dépenses `spent_on`.
- `/dashboard/jour` : ventes **produits** du jour ; fuel = **quarts fermés** uniquement ; bloc `scope` explicite ajouté.
- Clôture de quart : sortie stock fuel + espèces fuel + écart caisse.

---

## 3. Tableau des liaisons vérifiées

| Liaison | Statut avant | Statut après | Preuve |
|---------|--------------|--------------|--------|
| Dépense → caisse/compte via `settle` | OK | OK | `operations.js` POST `/expenses` |
| Dépôt caisse → banque (`/money/deposit`) | OK | OK | double écriture inchangée |
| `POST /cash/movements` depot/retrait | **Incorrect** (caisse seule) | **Corrigé** (`account_id` + `money_movements`) | P1 |
| Transfert compte A → B | **Absent** | **Ajouté** `POST /money/transfer` | P3 |
| Vente MM/banque sans compte lié | **Silencieux** | **Refus 409** | P5 |
| Ventes → `financial_events` | **Absent** | **VENTE** journalisé | P2 |
| Clôture fuel MM/carte | Partiel | **assertLinkedMethod** | Phase 8 |
| Imports ventes non espèces | Partiel | **assertLinkedMethod** | Phase 8 |
| Intégrité solde caisse vs mouvements | Absent | `GET /finance/integrity/cash` | P7 |
| Isolation station/client | OK | OK | tests statiques |
| Idempotence ventes/dépenses | OK | OK | 20/20 |
| Stock fuel à la clôture | OK (design) | OK | `shifts.js` |
| Interdiction vente boutique CARBURANT | OK | OK | `operations.js` |

---

## 4. Problèmes identifiés et corrections

### Corrigés

| ID | Problème | Correction | Fichiers |
|----|----------|------------|----------|
| P1 | Dépôt/retrait caisse sans compte | `account_id` obligatoire + miroir `money_movements` | `operations.js`, `public/app.js` |
| P2 | Ventes hors journal métier | `recordFinancialEvent` type `VENTE` | `operations.js`, `fuelsales.js` |
| P3 | Pas de transfert inter-comptes | `POST /money/transfer` + UI | `finance.js`, `ext-fin.js` |
| P5 | Moyens non liés acceptés | `assertLinkedMethod` dans `settle`, ventes, clôture, imports | `core.js`, `operations`, `fuelsales`, `shifts`, `imports` |
| P4 | Agrégats ambigus | Bloc `scope` sur dashboard jour | `ops_plus.js` |
| P7 | Pas de contrôle solde caisse | `GET /finance/integrity/cash` | `finance.js` |

### Non corrigés (volontairement ou reportés)

| ID | Description | Raison |
|----|-------------|--------|
| S1 | Stock cuve non décrémenté pendant quart ouvert | Design métier (compteurs → clôture) |
| P4 suite | Unification totale home / marges / EOD | Nécessite arbitrage produit + tests DB |
| Backfill | `financial_events` pour ventes anciennes | Pas d’écriture artificielle sur l’historique |
| Intégrité stock | `quantity` vs SUM(mouvements) | À ajouter après base de test |
| UI integrity | Bouton contrôles finance | Cosmétique |

---

## 5. Fichiers modifiés / ajoutés

### Modifiés
- `src/core.js` — `settle` + `assertLinkedMethod`
- `src/operations.js` — dépenses inchangées ; caisse P1 ; ventes P2/P5
- `src/fuelsales.js` — P2/P5
- `src/finance.js` — transfert P3, integrity P7
- `src/ops_plus.js` — `scope` agrégats
- `src/shifts.js` — clôture MM/carte (Phase 8)
- `src/imports.js` — ventes importées (Phase 8)
- `public/app.js` — formulaire mouvement de caisse
- `public/ext-fin.js` — transfert entre comptes

### Ajoutés
- `CHANGELOG_PHASE6_LIAISONS_FINANCIERES_2026-10-27.md`
- `test/finance-liaisons-static.js` (38 contrôles)
- `test/finance-liaisons-integration.js` (SQL sur base test)
- `RAPPORT_LIVRAISON_AUDIT_LIAISONS_2026-10-27.md` (ce document)

### Migrations SQL
- **Aucune nouvelle migration requise** pour ces corrections (colonnes et tables déjà présentes : `money_movements`, `financial_events`, `payment_methods.account_id`).

---

## 6. Tests

### Exécutés dans l’environnement de livraison
- `test/finance-liaisons-static.js` → **38/38**
- `test/business-idempotency-static.js` → **20/20**
- `test/tenant-isolation-static.js` → **11/11**
- + 16 autres tests unitaires/statiques → **PASS**
- `node --check` sur tous les `src/*.js` → **OK**

### Non exécutés (infrastructure absente)
- Suite `npm test` / HTTP + PostgreSQL
- `test/finance-liaisons-integration.js` (SKIP sans `DATABASE_URL` locale `*test*`/`*ci*`)

### Rejeu recommandé sur copie isolée
```bash
# 1. Sauvegarde production (Super Admin / procédure existante)
# 2. Créer base jetable
createdb managepro_test
export DATABASE_URL=postgres://...@127.0.0.1:5432/managepro_test
export ALLOW_DESTRUCTIVE_TESTS=1
npm run migrate
# 3. Tests
node test/finance-liaisons-static.js
node test/finance-liaisons-integration.js
npm test   # si données de seed présentes
```

---

## 7. Critères d’acceptation

| Critère | État |
|---------|------|
| Relations essentielles identifiées | **Oui** (Phases 1–3) |
| Relations incorrectes corrigées si nécessaire | **Oui** (P1, P3, P5, P2, P7) |
| Chaque agrégat a une source identifiable | **Oui** (+ `scope` dashboard) |
| Opérations rattachées (caisse/compte) | **Oui** pour chemins corrigés |
| Pas de double comptage introduit | **Oui** (transferts neutral / dépôt double écriture équilibrée) |
| Isolation clients | **Préservée** |
| Tests reproductibles | **Statiques oui** ; intégration SQL prête, à jouer sur copie |

---

## 8. Anomalies restantes (liste courte)

1. Stock carburant affiché optimiste pendant quart ouvert (S1).  
2. Divergences possibles d’affichage CA entre écrans (fuel clôturé vs ouvert) — documentées via `scope`.  
3. Validation numérique bout-en-bout non rejouée ici (pas de PostgreSQL de test dans l’environnement agent).  
4. Endpoint d’intégrité caisse non encore branché dans l’UI des contrôles finance.

---

## 9. Instructions de déploiement

1. Déployer le code (pas de migration SQL obligatoire pour ce lot).  
2. Vérifier que chaque moyen de paiement banque/MM/carte est **rattaché à un compte actif** (sinon les ventes/règlements non espèces seront refusés — P5).  
3. Former les utilisateurs : dépôt/retrait caisse nécessite un **compte** ; préférer « Remise en banque » ou « Transfert entre comptes ».  
4. Optionnel : appeler `GET /api/finance/integrity/cash` après déploiement pour détecter d’éventuels écarts historiques caisse.

---

## 10. Archive

Voir l’archive livrée dans le répertoire artefacts :
`ManagePro_v21_liaisons_finance_2026-10-27.zip`
