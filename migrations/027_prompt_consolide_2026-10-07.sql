-- 027_prompt_consolide_2026-10-07.sql
-- Compléments additifs, idempotents et non destructifs issus du prompt consolidé.
-- Aucune migration historique n'est modifiée.

ALTER TABLE client_contracts
  ADD COLUMN IF NOT EXISTS access_revoked BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS contract_snapshot JSONB;

ALTER TABLE shift_employees
  ADD COLUMN IF NOT EXISTS role_in_shift TEXT;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS successful_login_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS station_permission_caps (
  station_id BIGINT NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  permission_code TEXT NOT NULL,
  allowed BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by BIGINT REFERENCES users(id),
  PRIMARY KEY (station_id, permission_code)
);

CREATE TABLE IF NOT EXISTS export_column_preferences (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  export_type TEXT NOT NULL,
  columns JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, export_type)
);

CREATE TABLE IF NOT EXISTS smtp_diagnostics (
  id BIGSERIAL PRIMARY KEY,
  station_id BIGINT REFERENCES stations(id),
  tested_by BIGINT REFERENCES users(id),
  success BOOLEAN NOT NULL,
  diagnostic TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shift_employees_shift_role ON shift_employees(shift_id, role_in_shift);
CREATE INDEX IF NOT EXISTS idx_users_successful_login_count ON users(successful_login_count);
CREATE INDEX IF NOT EXISTS idx_station_permission_caps_station ON station_permission_caps(station_id);
CREATE INDEX IF NOT EXISTS idx_export_column_preferences_user ON export_column_preferences(user_id);
CREATE INDEX IF NOT EXISTS idx_smtp_diagnostics_station_created ON smtp_diagnostics(station_id, created_at DESC);

-- Instantané contractuel initial pour les contrats existants.
UPDATE client_contracts
SET contract_snapshot = jsonb_build_object(
  'contract_type', contract_type,
  'start_date', start_date,
  'end_date', end_date,
  'status', status,
  'can_create_station', can_create_station,
  'max_stations', max_stations,
  'can_manage_users', can_manage_users,
  'max_users', max_users,
  'features', features
)
WHERE contract_snapshot IS NULL;
