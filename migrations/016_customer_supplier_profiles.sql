-- 016 Profils clients / fournisseurs enrichis (Priorité 3)
-- Non destructif. Isolation toujours par station_id.

ALTER TABLE customers ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS loyalty_points NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS loyalty_tier TEXT DEFAULT 'standard';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS credit_blocked BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS payment_terms_days INT DEFAULT 30;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS bank_info TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Avoirs client (crédit à utiliser) — informatif / traçable
CREATE TABLE IF NOT EXISTS customer_credits (
  id BIGSERIAL PRIMARY KEY,
  station_id BIGINT NOT NULL REFERENCES stations(id),
  customer_id BIGINT NOT NULL REFERENCES customers(id),
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  remaining NUMERIC(14,2) NOT NULL CHECK (remaining >= 0),
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'ouvert' CHECK (status IN ('ouvert','utilise','annule')),
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customer_credits_cust ON customer_credits (customer_id, status);

-- Avoirs / notes fournisseur (traçabilité)
CREATE TABLE IF NOT EXISTS supplier_credits (
  id BIGSERIAL PRIMARY KEY,
  station_id BIGINT NOT NULL REFERENCES stations(id),
  supplier_id BIGINT NOT NULL REFERENCES suppliers(id),
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  remaining NUMERIC(14,2) NOT NULL CHECK (remaining >= 0),
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'ouvert' CHECK (status IN ('ouvert','utilise','annule')),
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE customer_credits IS 'Avoirs client. Utilisation financière = P4 (moteur mouvements).';
COMMENT ON TABLE supplier_credits IS 'Avoirs fournisseur. Utilisation financière = P4.';
