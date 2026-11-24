-- Performance : deux index pour des requêtes déjà présentes dans l'application (audit 2026-11-24, docs/audit/AUDIT_INDEX_SQL_2026-11-24.md).
-- Additif et idempotent : aucune colonne, donnée ni contrainte modifiée. Réversible : DROP INDEX IF EXISTS reports_shift_kind_idx, customer_ledger_station_kind_idx.
-- reports : lecture du rapport d'un quart (WHERE shift_id = $1 AND kind = 'quart' ORDER BY id DESC LIMIT 1).
CREATE INDEX IF NOT EXISTS reports_shift_kind_idx ON reports (shift_id, kind);
-- customer_ledger : agrégats par station et type d'écriture (WHERE station_id = $1 AND kind = ...).
CREATE INDEX IF NOT EXISTS customer_ledger_station_kind_idx ON customer_ledger (station_id, kind, occurred_at);
