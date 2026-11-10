-- Commissions vendeurs / pompistes : objectifs de performance, taux personnalisables,
-- primes exceptionnelles et règlements. Liés aux ventes (sales.employee_id).

-- Objectif mensuel (FCFA HT à atteindre) et taux de commission (%) par employé
ALTER TABLE employees ADD COLUMN IF NOT EXISTS sales_target NUMERIC(14,2);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS commission_rate NUMERIC(5,2);

COMMENT ON COLUMN employees.sales_target IS 'Objectif de ventes HT (période) pour déclencher / calculer la commission';
COMMENT ON COLUMN employees.commission_rate IS 'Taux de commission personnalisé en % du CA HT (NULL = taux par défaut station)';

-- Paramètres par défaut de la station (stockés aussi dans settings si besoin)
-- settings.key = 'seller_commission_defaults'
-- value JSONB : { "default_rate": 3, "default_target": 400000, "currency": "FCFA" }

-- Historique des primes, commissions figées et règlements
CREATE TABLE IF NOT EXISTS seller_commission_entries (
  id            BIGSERIAL PRIMARY KEY,
  station_id    BIGINT NOT NULL REFERENCES stations(id),
  employee_id   BIGINT NOT NULL REFERENCES employees(id),
  kind          TEXT NOT NULL CHECK (kind IN ('prime', 'reglement', 'ajustement')),
  period_from   DATE,
  period_to     DATE,
  amount        NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  note          TEXT,
  status        TEXT NOT NULL DEFAULT 'du' CHECK (status IN ('du', 'regle', 'annule')),
  created_by    BIGINT REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at    TIMESTAMPTZ,
  settled_by    BIGINT REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_seller_comm_entries_station
  ON seller_commission_entries(station_id, employee_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_seller_comm_entries_status
  ON seller_commission_entries(station_id, status)
  WHERE status = 'du';
