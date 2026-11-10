-- 093 employees.updated_at (audit 2026-11-03, réf. B3)
-- PATCH /employees/:id (catalog.js) écrit cette colonne ; elle n'existait dans aucune migration.
-- Réversible : ALTER TABLE employees DROP COLUMN IF EXISTS updated_at;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
