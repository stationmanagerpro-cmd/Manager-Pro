-- Pièces jointes des bons de commande (photo du bon de livraison / de la facture fournisseur)
CREATE TABLE IF NOT EXISTS purchase_attachments (
  id          BIGSERIAL PRIMARY KEY,
  station_id  BIGINT NOT NULL REFERENCES stations(id),
  purchase_id BIGINT NOT NULL REFERENCES purchases(id),
  receipt_id  BIGINT REFERENCES purchase_receipts(id),
  filename    TEXT NOT NULL,
  mime        TEXT NOT NULL CHECK (mime IN ('image/jpeg','image/png','image/webp','application/pdf')),
  size        INTEGER NOT NULL CHECK (size > 0),
  data        BYTEA NOT NULL,
  note        TEXT,
  created_by  BIGINT REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS purchase_attachments_po_idx ON purchase_attachments(purchase_id);
