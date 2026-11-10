-- Signature personnalisée du compte client (manuscrite et/ou image importée).
-- L'autorisation (aucune / manuscrite / image / les deux) est accordée par le Super Admin
-- dans le contrat : client_contracts.features->>'signature_mode'.
CREATE TABLE IF NOT EXISTS client_signatures (
  client_id        BIGINT PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  handwritten_path TEXT,
  image_path       TEXT,
  active           BOOLEAN NOT NULL DEFAULT false,
  active_mode      TEXT CHECK (active_mode IN ('handwritten','image')),
  signer_name      TEXT,
  updated_by       BIGINT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
