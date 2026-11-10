-- Reprises réseau des réceptions et paiements fournisseurs.
-- Migration additive : aucune table ni donnée métier existante n'est supprimée.
CREATE TABLE IF NOT EXISTS purchase_operation_requests (
  id SERIAL PRIMARY KEY,
  station_id BIGINT NOT NULL REFERENCES stations(id) ON DELETE RESTRICT,
  purchase_id BIGINT NOT NULL REFERENCES purchases(id) ON DELETE RESTRICT,
  operation TEXT NOT NULL CHECK (operation IN ('receive', 'pay')),
  client_ref TEXT NOT NULL CHECK (length(trim(client_ref)) BETWEEN 1 AND 128),
  request_payload JSONB NOT NULL,
  result JSONB NOT NULL,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (station_id, operation, client_ref)
);

CREATE INDEX IF NOT EXISTS purchase_operation_requests_purchase
  ON purchase_operation_requests (station_id, purchase_id, created_at DESC);
