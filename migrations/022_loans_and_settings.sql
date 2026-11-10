-- 022 Prêts hors-exploitation + réglages emails secondaires backup
-- Non destructif

CREATE TABLE IF NOT EXISTS personal_loans (
  id              BIGSERIAL PRIMARY KEY,
  station_id      BIGINT NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  borrower_name   TEXT NOT NULL,
  borrower_phone  TEXT,
  amount          NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  loan_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date        DATE,
  notes           TEXT,
  status          TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'partial', 'repaid', 'written_off')),
  repaid_amount   NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (repaid_amount >= 0),
  created_by      BIGINT REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS personal_loans_station ON personal_loans (station_id, status);
CREATE INDEX IF NOT EXISTS personal_loans_due ON personal_loans (station_id, due_date) WHERE status IN ('open', 'partial');

CREATE TABLE IF NOT EXISTS personal_loan_payments (
  id          BIGSERIAL PRIMARY KEY,
  loan_id     BIGINT NOT NULL REFERENCES personal_loans(id) ON DELETE CASCADE,
  amount      NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  paid_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  method      TEXT,
  notes       TEXT,
  created_by  BIGINT REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS personal_loan_payments_loan ON personal_loan_payments (loan_id);

-- Réglages station pour emails backup secondaires (stockés dans settings JSON existant si table settings)
-- Si table settings n'existe pas encore sous cette forme, on utilise stations.settings JSONB
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'stations' AND column_name = 'settings') THEN
    -- OK
    NULL;
  ELSIF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'stations') THEN
    ALTER TABLE stations ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}'::jsonb;
  END IF;
END $$;

-- Table settings générique si absente
CREATE TABLE IF NOT EXISTS app_settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  BIGINT REFERENCES users(id)
);

INSERT INTO app_settings(key, value) VALUES
  ('backup_emails', '{"primary":null,"secondary":[],"max_secondary":2}'::jsonb)
ON CONFLICT (key) DO NOTHING;
