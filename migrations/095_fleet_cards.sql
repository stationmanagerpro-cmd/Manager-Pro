-- 095 Cartes carburant / flottes : carte par véhicule rattachée à un client entreprise, plafonds, restrictions, journal des usages et refus.
-- Réversible : DROP TABLE IF EXISTS fleet_card_events; DROP TABLE IF EXISTS fleet_cards;
CREATE TABLE IF NOT EXISTS fleet_cards (
  id                  BIGSERIAL PRIMARY KEY,
  station_id          BIGINT NOT NULL REFERENCES stations(id),
  customer_id         BIGINT NOT NULL REFERENCES customers(id),
  card_number         TEXT NOT NULL,
  label               TEXT NOT NULL,                       -- plaque / véhicule
  driver_name         TEXT,
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','blocked','lost','expired')),
  blocked_reason      TEXT,
  expires_on          DATE,
  pin_hash            TEXT,
  pin_failures        SMALLINT NOT NULL DEFAULT 0,
  requires_odometer   BOOLEAN NOT NULL DEFAULT FALSE,
  last_odometer       NUMERIC(10,1),
  allowed_product_ids BIGINT[] NOT NULL DEFAULT '{}',      -- vide = tous les produits
  max_liters_tx       NUMERIC(12,3) CHECK (max_liters_tx IS NULL OR max_liters_tx > 0),
  max_amount_tx       NUMERIC(14,2) CHECK (max_amount_tx IS NULL OR max_amount_tx > 0),
  max_liters_day      NUMERIC(12,3) CHECK (max_liters_day IS NULL OR max_liters_day > 0),
  max_amount_day      NUMERIC(14,2) CHECK (max_amount_day IS NULL OR max_amount_day > 0),
  max_liters_month    NUMERIC(12,3) CHECK (max_liters_month IS NULL OR max_liters_month > 0),
  max_amount_month    NUMERIC(14,2) CHECK (max_amount_month IS NULL OR max_amount_month > 0),
  max_tx_day          SMALLINT CHECK (max_tx_day IS NULL OR max_tx_day > 0),
  hours_from          TIME,
  hours_to            TIME,
  allowed_days        SMALLINT[] NOT NULL DEFAULT '{}',    -- 1 = lundi … 7 = dimanche ; vide = tous les jours
  created_by          BIGINT REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at          TIMESTAMPTZ,
  UNIQUE (station_id, card_number)
);
CREATE INDEX IF NOT EXISTS fleet_cards_customer_idx ON fleet_cards (station_id, customer_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS fleet_card_events (
  id          BIGSERIAL PRIMARY KEY,
  card_id     BIGINT NOT NULL REFERENCES fleet_cards(id),
  station_id  BIGINT NOT NULL REFERENCES stations(id),
  kind        TEXT NOT NULL CHECK (kind IN ('use','decline','block','unblock','create','update')),
  sale_id     BIGINT REFERENCES sales(id),
  product_id  BIGINT REFERENCES products(id),
  liters      NUMERIC(12,3),
  amount      NUMERIC(14,2),
  odometer_km NUMERIC(10,1),
  reasons     TEXT[],
  note        TEXT,
  created_by  BIGINT REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fleet_card_events_card_idx ON fleet_card_events (card_id, created_at DESC);
CREATE INDEX IF NOT EXISTS fleet_card_events_station_idx ON fleet_card_events (station_id, created_at DESC);
