# Audit des index SQL — 2026-11-24

Lecture seule côté projet : aucune migration ajoutée, aucun fichier de code modifié. Base de travail jetable, supprimée après l'audit.

## Méthode
1. PostgreSQL 16 local ; les 125 fichiers de `migrations/` appliqués dans l'ordre sur une base vide : 0 échec, 176 tables.
2. Clés étrangères sans index (catalogue `pg_constraint` / `pg_index`) : 271 sur 447, dont 131 sont des colonnes d'audit (`created_by`, `updated_by`, `*_by`).
3. Index existants relus sur les tables qui grossissent : `sales`, `financial_events`, `expenses`, `tank_measurements`, `customer_payments`, `loyalty_events`, `qr_scans`, `money_movements`, `customer_ledger`, `reports`, `payslip_email_log`.
4. Requêtes réelles de `src/` rapprochées des index, puis mesure `EXPLAIN ANALYZE` avant et après sur données générées (copie jetable de la base).

## Résultats
- Les 271 clés sans index ne sont **pas** toutes à indexer : indexer des colonnes d'audit ralentit les écritures sans bénéfice. Aucune recommandation globale.
- Tables principales : bien couvertes (`sales`, `financial_events`, `expenses`, `tank_measurements`).
- Deux requêtes réelles sans index adapté :

| Requête (source) | Index testé | Avant | Après | Données générées |
|---|---|---|---|---|
| `FROM reports WHERE shift_id = $1 AND kind = 'quart' ORDER BY id DESC LIMIT 1` (`src/finance.js:521`, `:633` ; `src/shifts.js:369`) | `reports (shift_id, kind)` | 17,5 ms (parcours complet) | 0,04 ms | 200 000 lignes |
| `FROM customer_ledger WHERE station_id=$1 AND kind='solde_initial' AND occurred_at::date<=$2 GROUP BY 1` (`src/accounting.js:75`) | `customer_ledger (station_id, kind, occurred_at)` | 27 ms | 11 ms | 500 000 lignes, 8 333 concernées |

Coût des index sur ces volumes : 5,7 Mo (`reports`) et 3,6 Mo (`customer_ledger`).

## Limites
- Données **générées** (répartition uniforme) : les gains réels dépendent du volume et de la répartition en production, non mesurés.
- La requête `customer_ledger` filtre sur `occurred_at::date` : l'index ne couvre pas ce filtre sous cette forme ; le gain vient de `station_id` et `kind`.
- Index redondants repérés sur `sales` : `sales_shift` et `sales_shift_id_idx` (même colonne) ; `sales_station_sold_at` et `sales_station_id_sold_at_idx` (même couple, ordre différent). Les supprimer n'est pas additif : **non proposé**, à décider séparément.
- Mesures sur un seul poste, sans charge simultanée. Aucun serveur applicatif lancé (npm indisponible).

## Proposition (en attente d'accord du propriétaire)
Migration `126_index_reports_ledger.sql`, additive et réversible :
```
CREATE INDEX IF NOT EXISTS reports_shift_kind_idx ON reports (shift_id, kind);
CREATE INDEX IF NOT EXISTS customer_ledger_station_kind_idx ON customer_ledger (station_id, kind, occurred_at);
```
Avant livraison : mise à jour de `docs/MIGRATIONS_INDEX.md`, test de numérotation, second passage sur PostgreSQL, changelog daté. Le déploiement Render s'exécute à chaque push sur `main`.
