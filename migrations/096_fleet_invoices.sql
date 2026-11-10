-- 096 Facture mensuelle automatique par client flotte : origine de la facture, mois facturé, lien prise carte -> facture.
-- Réversible : DROP INDEX IF EXISTS invoices_fleet_month_uq; ALTER TABLE fleet_card_events DROP COLUMN IF EXISTS invoice_id; ALTER TABLE invoices DROP COLUMN IF EXISTS period_month, DROP COLUMN IF EXISTS source;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS period_month TEXT;
ALTER TABLE fleet_card_events ADD COLUMN IF NOT EXISTS invoice_id BIGINT REFERENCES invoices(id);
-- Une seule facture flotte active par client et par mois (une annulée libère le mois).
CREATE UNIQUE INDEX IF NOT EXISTS invoices_fleet_month_uq ON invoices (station_id, customer_id, period_month)
  WHERE source = 'fleet' AND status <> 'annulee';
CREATE INDEX IF NOT EXISTS fleet_card_events_invoice_idx ON fleet_card_events (invoice_id) WHERE invoice_id IS NOT NULL;
