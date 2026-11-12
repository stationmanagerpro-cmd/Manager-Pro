-- Fonctions « marché » : fidélité par téléphone / plaque, espace client (lien privé en lecture seule).

-- Fidélité : réglages par station (désactivée par défaut)
CREATE TABLE IF NOT EXISTS loyalty_settings (
  station_id       BIGINT PRIMARY KEY REFERENCES stations(id),
  enabled          BOOLEAN NOT NULL DEFAULT FALSE,
  earn_per_amount  NUMERIC(14,2) NOT NULL DEFAULT 1000 CHECK (earn_per_amount > 0),   -- 1 point par tranche de X (monnaie de la station)
  point_value      NUMERIC(14,2) NOT NULL DEFAULT 10 CHECK (point_value >= 0),         -- valeur d'un point à l'utilisation
  min_redeem       INTEGER NOT NULL DEFAULT 100 CHECK (min_redeem >= 1),
  fuel_only        BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS loyalty_accounts (
  id              BIGSERIAL PRIMARY KEY,
  station_id      BIGINT NOT NULL REFERENCES stations(id),
  phone           TEXT,
  plate           TEXT,
  name            TEXT,
  points          INTEGER NOT NULL DEFAULT 0 CHECK (points >= 0),
  lifetime_points INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,
  CHECK (phone IS NOT NULL OR plate IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS loyalty_accounts_phone_uq ON loyalty_accounts (station_id, phone) WHERE phone IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS loyalty_accounts_plate_uq ON loyalty_accounts (station_id, plate) WHERE plate IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS loyalty_events (
  id          BIGSERIAL PRIMARY KEY,
  station_id  BIGINT NOT NULL REFERENCES stations(id),
  account_id  BIGINT NOT NULL REFERENCES loyalty_accounts(id),
  kind        TEXT NOT NULL CHECK (kind IN ('gain', 'utilisation', 'ajustement')),
  points      INTEGER NOT NULL,                 -- signé : + gain, − utilisation
  amount      NUMERIC(14,2),                    -- montant de la vente (gain) ou valeur remise (utilisation)
  sale_id     BIGINT REFERENCES sales(id),
  note        TEXT,
  created_by  BIGINT REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS loyalty_events_sale_uq ON loyalty_events (sale_id) WHERE kind = 'gain' AND sale_id IS NOT NULL;   -- une vente ne rapporte des points qu'une fois
CREATE INDEX IF NOT EXISTS loyalty_events_account ON loyalty_events (account_id, created_at DESC);

-- Espace client : lien privé (le jeton n'est stocké que haché), révocable, avec expiration
CREATE TABLE IF NOT EXISTS client_portal_links (
  id            BIGSERIAL PRIMARY KEY,
  station_id    BIGINT NOT NULL REFERENCES stations(id),
  customer_id   BIGINT NOT NULL REFERENCES customers(id),
  token_hash    TEXT NOT NULL UNIQUE,
  created_by    BIGINT REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL,
  revoked_at    TIMESTAMPTZ,
  last_seen_at  TIMESTAMPTZ,
  views         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS client_portal_customer ON client_portal_links (station_id, customer_id);
