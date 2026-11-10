-- Archivage : clients, fournisseurs et employés inactifs sont masqués des listes courantes
-- (consultables via le bouton « Inactifs »). Aucune donnée n'est supprimée.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;
UPDATE suppliers SET active = TRUE WHERE active IS NULL;
CREATE INDEX IF NOT EXISTS idx_customers_station_active ON customers(station_id, active) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_suppliers_station_active ON suppliers(station_id, active) WHERE deleted_at IS NULL;
