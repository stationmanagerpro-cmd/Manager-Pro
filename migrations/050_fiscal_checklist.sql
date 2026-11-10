-- Migration 050 : Checklist pièces justificatives par période fiscale
BEGIN;

CREATE TABLE IF NOT EXISTS fiscal_checklist_items (
  id              BIGSERIAL PRIMARY KEY,
  client_id       BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  period_id       BIGINT NOT NULL REFERENCES fiscal_periods(id) ON DELETE CASCADE,
  item_code       TEXT NOT NULL,          -- ex: factures_ventes, factures_achats, quittances, nif, ...
  label           TEXT NOT NULL,
  required        BOOLEAN NOT NULL DEFAULT TRUE,
  status          TEXT NOT NULL DEFAULT 'manquant'
    CHECK (status IN ('manquant', 'fourni', 'non_applicable', 'a_verifier')),
  document_id     BIGINT REFERENCES fiscal_documents(id),
  notes           TEXT,
  updated_by      BIGINT REFERENCES users(id),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (period_id, item_code)
);

CREATE INDEX IF NOT EXISTS fiscal_checklist_period_idx ON fiscal_checklist_items (period_id);
CREATE INDEX IF NOT EXISTS fiscal_checklist_client_idx ON fiscal_checklist_items (client_id);

COMMENT ON TABLE fiscal_checklist_items IS 'Pièces attendues pour une période — aide à la préparation, non officielle.';

COMMIT;
