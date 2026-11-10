-- 092 Index de performance complémentaires (audit 2026-11-03, réf. C1)
-- Non destructif, idempotent, réversible (DROP INDEX IF EXISTS <nom>).
-- Les index déjà créés par 021 (sales, stock, shifts, user_sessions, audit_logs) ne sont pas redéclarés.

CREATE INDEX IF NOT EXISTS payments_station_paid_at   ON payments (station_id, paid_at DESC);
CREATE INDEX IF NOT EXISTS payments_sale              ON payments (sale_id) WHERE sale_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS payments_shift             ON payments (shift_id) WHERE shift_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS sale_details_sale          ON sale_details (sale_id);
CREATE INDEX IF NOT EXISTS sale_details_product       ON sale_details (product_id);
CREATE INDEX IF NOT EXISTS purchases_station_ordered  ON purchases (station_id, ordered_at DESC);
CREATE INDEX IF NOT EXISTS supplier_payments_supplier ON supplier_payments (supplier_id, paid_at DESC);
CREATE INDEX IF NOT EXISTS customer_payments_customer ON customer_payments (customer_id, paid_at DESC);
CREATE INDEX IF NOT EXISTS shift_anomalies_shift      ON shift_anomalies (shift_id);
