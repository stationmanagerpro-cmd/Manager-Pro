# Index sur `reports` et `customer_ledger` — 2026-11-24

Migration `126_index_reports_ledger.sql` (additive, idempotente, réversible). Aucun changement de règle métier, de route, de donnée ni de fichier `public/` (`npm run build:sw` sans objet).

## Pourquoi
Audit des index SQL (`docs/audit/AUDIT_INDEX_SQL_2026-11-24.md`). Mesures sur données générées, indicatives : lecture du rapport d'un quart 17,5 ms → 0,04 ms (200 000 lignes) ; agrégat de `customer_ledger` 27 ms → 11 ms (500 000 lignes).

## Fichiers
- `migrations/126_index_reports_ledger.sql` (nouveau)
- `docs/MIGRATIONS_INDEX.md`, `docs/ETAT_ACTUEL.md`, `docs/audit/AUDIT_INDEX_SQL_2026-11-24.md`

## Retour arrière
`DROP INDEX IF EXISTS reports_shift_kind_idx; DROP INDEX IF EXISTS customer_ledger_station_kind_idx;`

## Vérification
PostgreSQL 16 jetable : 125 fichiers appliqués, 0 échec, 176 tables ; index présents ; rejeu OK ; suppression puis recréation OK. Tests statiques : migration-numbering 3/3, migration-safety 7/7, repo-hygiene 7/7.
Non vérifié : production, `npm test` (npm indisponible).
