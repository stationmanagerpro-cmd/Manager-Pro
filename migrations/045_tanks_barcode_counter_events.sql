-- Migration 045 : Cuves (tanks), code-barres produits, événements compteurs (remises à zéro / remplacements)
-- Conforme au cahier de mise à niveau Station Manager Pro — P1/P2
-- Idempotente et réversible (pas de DROP destructif de données métier)

BEGIN;

-- 1. Code-barres / EAN / SKU sur les produits (saisie UI + recherche)
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS barcode TEXT,
  ADD COLUMN IF NOT EXISTS sku TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS products_station_barcode_uidx
  ON products (station_id, barcode)
  WHERE barcode IS NOT NULL AND barcode <> '' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS products_barcode_idx
  ON products (barcode)
  WHERE barcode IS NOT NULL AND barcode <> '';

-- 2. Cuves (tanks) — fiches cuves liées station / produit carburant
CREATE TABLE IF NOT EXISTS tanks (
  id              BIGSERIAL PRIMARY KEY,
  station_id      BIGINT NOT NULL REFERENCES stations(id),
  product_id      BIGINT NOT NULL REFERENCES products(id),
  name            TEXT NOT NULL,
  capacity_liters NUMERIC(14,3),
  unit            TEXT NOT NULL DEFAULT 'L',
  alert_threshold NUMERIC(14,3) NOT NULL DEFAULT 0,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,
  UNIQUE (station_id, name)
);

CREATE INDEX IF NOT EXISTS tanks_station_idx ON tanks (station_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS tanks_product_idx ON tanks (product_id) WHERE deleted_at IS NULL;

-- 3. Mesures physiques de cuve (jaugeages)
CREATE TABLE IF NOT EXISTS tank_measurements (
  id              BIGSERIAL PRIMARY KEY,
  tank_id         BIGINT NOT NULL REFERENCES tanks(id),
  station_id      BIGINT NOT NULL REFERENCES stations(id),
  measured_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  quantity        NUMERIC(14,3) NOT NULL,
  theoretical_qty NUMERIC(14,3),
  variance        NUMERIC(14,3) GENERATED ALWAYS AS (quantity - COALESCE(theoretical_qty, quantity)) STORED,
  measured_by     BIGINT REFERENCES employees(id),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tank_measurements_tank_idx ON tank_measurements (tank_id, measured_at DESC);

-- 4. Événements compteurs (remise à zéro, remplacement, correction d'index)
-- Complète pump_counter_history pour les cas exceptionnels
CREATE TABLE IF NOT EXISTS counter_events (
  id              BIGSERIAL PRIMARY KEY,
  counter_id      BIGINT NOT NULL REFERENCES pump_counters(id),
  station_id      BIGINT NOT NULL REFERENCES stations(id),
  event_type      TEXT NOT NULL CHECK (event_type IN ('reset', 'replace', 'correction', 'calibration')),
  index_before    NUMERIC(14,3),
  index_after     NUMERIC(14,3) NOT NULL,
  reason          TEXT NOT NULL,
  performed_by    BIGINT REFERENCES employees(id),
  validated_by    BIGINT REFERENCES employees(id),
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata        JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS counter_events_counter_idx ON counter_events (counter_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS counter_events_station_idx ON counter_events (station_id, occurred_at DESC);

-- 5. Préférences widgets dashboard par utilisateur / station (configurable admin)
CREATE TABLE IF NOT EXISTS dashboard_widget_prefs (
  id              BIGSERIAL PRIMARY KEY,
  client_id       BIGINT REFERENCES clients(id),
  station_id      BIGINT REFERENCES stations(id),
  user_id         BIGINT REFERENCES users(id),
  config          JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, station_id)
);

COMMENT ON TABLE tanks IS 'Fiches cuves carburant — capacité, seuil alerte, produit associé';
COMMENT ON TABLE tank_measurements IS 'Mesures physiques (jaugeages) et écarts vs théorique';
COMMENT ON TABLE counter_events IS 'Remises à zéro, remplacements et corrections d''index compteurs — audités';
COMMENT ON COLUMN products.barcode IS 'Code-barres / EAN pour produits annexes et recherche rapide';
COMMENT ON COLUMN products.sku IS 'Référence interne produit';

COMMIT;
