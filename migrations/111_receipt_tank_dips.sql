-- Réception de carburant : jauge de cuve AVANT et APRÈS déchargement, comparée à la quantité reçue (écart de livraison).
-- Additif et idempotent : aucune donnée existante n'est modifiée ; table facultative (réception possible sans jauge).
CREATE TABLE IF NOT EXISTS receipt_tank_dips (
  id            BIGSERIAL PRIMARY KEY,
  station_id    BIGINT NOT NULL REFERENCES stations(id),
  receipt_id    BIGINT NOT NULL REFERENCES purchase_receipts(id),
  tank_id       BIGINT NOT NULL REFERENCES tanks(id),
  product_id    BIGINT NOT NULL,
  before_qty    NUMERIC(14,3) NOT NULL CHECK (before_qty >= 0),
  after_qty     NUMERIC(14,3) NOT NULL CHECK (after_qty >= 0),
  received_qty  NUMERIC(14,3) NOT NULL,
  measured_qty  NUMERIC(14,3) NOT NULL,
  variance      NUMERIC(14,3) NOT NULL,
  level         TEXT NOT NULL CHECK (level IN ('ok','warning','critical')),
  created_by    BIGINT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS receipt_tank_dips_receipt_idx ON receipt_tank_dips(receipt_id);
CREATE INDEX IF NOT EXISTS receipt_tank_dips_station_idx ON receipt_tank_dips(station_id, created_at DESC);
