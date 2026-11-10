-- 002 : idempotence (mode hors connexion), transferts entre stations, mises à niveau des achats.

-- Idempotence : une opération envoyée deux fois (réseau instable) n'est enregistrée qu'une fois
ALTER TABLE sales ADD COLUMN IF NOT EXISTS client_ref TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS sales_client_ref ON sales(station_id, client_ref) WHERE client_ref IS NOT NULL;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS client_ref TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS expenses_client_ref ON expenses(station_id, client_ref) WHERE client_ref IS NOT NULL;

-- Transferts de stock entre stations : envoi (sortie du stock source), puis réception (entrée dans la destination)
CREATE TABLE IF NOT EXISTS stock_transfers (
  id               BIGSERIAL PRIMARY KEY,
  from_station_id  BIGINT NOT NULL REFERENCES stations(id),
  to_station_id    BIGINT NOT NULL REFERENCES stations(id),
  status           TEXT NOT NULL DEFAULT 'envoye' CHECK (status IN ('envoye','recu','annule')),
  comment          TEXT,
  sent_by          BIGINT REFERENCES users(id),
  sent_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  received_by      BIGINT REFERENCES users(id),
  received_at      TIMESTAMPTZ,
  CHECK (from_station_id <> to_station_id)
);
CREATE TABLE IF NOT EXISTS stock_transfer_items (
  id               BIGSERIAL PRIMARY KEY,
  transfer_id      BIGINT NOT NULL REFERENCES stock_transfers(id),
  from_product_id  BIGINT NOT NULL REFERENCES products(id),
  to_product_id    BIGINT NOT NULL REFERENCES products(id),
  quantity         NUMERIC(14,3) NOT NULL CHECK (quantity > 0)
);
CREATE INDEX IF NOT EXISTS transfers_stations ON stock_transfers(from_station_id, to_station_id);

-- Mise à niveau des bases créées avec la première version du schéma (achats)
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS invoice_date DATE;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS due_date DATE;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS invoice_total NUMERIC(14,2);
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS paid NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS cancel_reason TEXT;
ALTER TABLE purchases DROP CONSTRAINT IF EXISTS purchases_status_check;
ALTER TABLE purchases ADD CONSTRAINT purchases_status_check CHECK (status IN ('commande','partiel','recu','facture','paye','archive','annule'));

INSERT INTO permissions (code, label) VALUES
 ('purchase.manage','Gérer les achats (commande, réception, facture)'),
 ('purchase.pay','Payer les fournisseurs'),
 ('transfer.manage','Transférer du stock entre stations')
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions SELECT r.id, p.id FROM roles r, permissions p WHERE r.code = 'ADMIN' AND p.code IN ('purchase.manage','purchase.pay','transfer.manage') ON CONFLICT DO NOTHING;
