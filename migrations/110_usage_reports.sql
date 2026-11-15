-- Rapports d'utilisation mensuels (PDF) générés automatiquement pour le Superadmin.
CREATE TABLE IF NOT EXISTS usage_reports (
  id         BIGSERIAL PRIMARY KEY,
  label      TEXT NOT NULL,
  days       INTEGER NOT NULL,
  pdf        BYTEA NOT NULL,
  emailed_to TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
