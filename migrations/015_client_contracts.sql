-- 015 Contrats clients — droits définis uniquement par l'Administrateur Principal (is_global)
-- Non destructif. Compatible multi-station existant.

CREATE TABLE IF NOT EXISTS clients (
  id            BIGSERIAL PRIMARY KEY,
  code          TEXT UNIQUE,
  name          TEXT NOT NULL,
  contact_email TEXT,
  contact_phone TEXT,
  owner_user_id BIGINT REFERENCES users(id), -- Gérant principal (optionnel)
  status        TEXT NOT NULL DEFAULT 'actif'
    CHECK (status IN ('actif','suspendu','archive')),
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    BIGINT REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS client_contracts (
  id              BIGSERIAL PRIMARY KEY,
  client_id       BIGINT NOT NULL UNIQUE REFERENCES clients(id) ON DELETE CASCADE,
  contract_type   TEXT NOT NULL DEFAULT 'standard',
  start_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date        DATE,
  status          TEXT NOT NULL DEFAULT 'actif'
    CHECK (status IN ('actif','expire','suspendu')),
  -- Limites
  can_create_station BOOLEAN NOT NULL DEFAULT false,
  max_stations       INT,          -- NULL = illimité
  can_manage_users   BOOLEAN NOT NULL DEFAULT true,
  max_users          INT,          -- NULL = illimité
  -- Modules / fonctionnalités (extensible)
  features JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Signature imposée si can_customize_signature = false
  forced_signature TEXT,
  notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by BIGINT REFERENCES users(id)
);

-- features JSONB attendu (exemples, tous false par défaut côté code si absent) :
-- {
--   "can_view_reports": true,
--   "can_export_reports": true,
--   "can_view_advanced_reports": false,
--   "can_access_settings": true,
--   "can_access_advanced_settings": false,
--   "can_customize_signature": false,
--   "can_access_hr": false,
--   "can_manage_hr": false,
--   "can_access_finance": true,
--   "can_access_personalization": false,
--   "can_manage_services": false,
--   "modules": { "sales": true, "stock": true, "reports": true, "finance": true, "hr": false, "personalization": false }
-- }

ALTER TABLE stations ADD COLUMN IF NOT EXISTS client_id BIGINT REFERENCES clients(id);
CREATE INDEX IF NOT EXISTS stations_client_id ON stations (client_id);

ALTER TABLE users ADD COLUMN IF NOT EXISTS client_id BIGINT REFERENCES clients(id);
CREATE INDEX IF NOT EXISTS users_client_id ON users (client_id);

COMMENT ON TABLE clients IS 'Organisation cliente. Isolée des autres clients.';
COMMENT ON TABLE client_contracts IS 'Contrat défini UNIQUEMENT par is_global. Le Gérant ne peut jamais le modifier.';
