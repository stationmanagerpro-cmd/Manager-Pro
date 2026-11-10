-- Module Exploitation › Bon de commande (réceptions partielles/successives, paiement obligatoire à la réception).
-- Additif : les achats existants restent 'legacy' et gardent leur circuit commande → réception → facture → paiement.
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS flow TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS expected_date DATE;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS validated_at TIMESTAMPTZ;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS validated_by BIGINT REFERENCES users(id);
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
ALTER TABLE purchases DROP CONSTRAINT IF EXISTS purchases_flow_check;
ALTER TABLE purchases ADD CONSTRAINT purchases_flow_check CHECK (flow IN ('legacy','bc'));
ALTER TABLE purchases DROP CONSTRAINT IF EXISTS purchases_status_check;
ALTER TABLE purchases ADD CONSTRAINT purchases_status_check
  CHECK (status IN ('brouillon','commande','partiel','recu','facture','paye','archive','annule'));
CREATE INDEX IF NOT EXISTS purchases_flow_idx ON purchases(station_id, flow, id DESC);

-- Historique des réceptions (une ligne par réception physique)
CREATE TABLE IF NOT EXISTS purchase_receipts (
  id            BIGSERIAL PRIMARY KEY,
  station_id    BIGINT NOT NULL REFERENCES stations(id),
  purchase_id   BIGINT NOT NULL REFERENCES purchases(id),
  receipt_no    TEXT,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  received_by   BIGINT REFERENCES users(id),
  value_received NUMERIC(14,2) NOT NULL DEFAULT 0,
  payment_mode  TEXT NOT NULL CHECK (payment_mode IN ('differe','immediat')),
  payment_method TEXT,
  amount_paid   NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  note          TEXT,
  client_ref    TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS purchase_receipts_ref_uq ON purchase_receipts(station_id, client_ref) WHERE client_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS purchase_receipts_po_idx ON purchase_receipts(purchase_id);

CREATE TABLE IF NOT EXISTS purchase_receipt_lines (
  id          BIGSERIAL PRIMARY KEY,
  receipt_id  BIGINT NOT NULL REFERENCES purchase_receipts(id) ON DELETE CASCADE,
  detail_id   BIGINT NOT NULL REFERENCES purchase_details(id),
  product_id  BIGINT NOT NULL REFERENCES products(id),
  quantity    NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  unit_cost   NUMERIC(14,2) NOT NULL
);
CREATE INDEX IF NOT EXISTS purchase_receipt_lines_rc_idx ON purchase_receipt_lines(receipt_id);

ALTER TABLE supplier_payments ADD COLUMN IF NOT EXISTS receipt_id BIGINT REFERENCES purchase_receipts(id);
ALTER TABLE supplier_payments ADD COLUMN IF NOT EXISTS client_ref TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS supplier_payments_ref_uq ON supplier_payments(supplier_id, client_ref) WHERE client_ref IS NOT NULL;
