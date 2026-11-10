-- 020 Modules abonnement activables — évolution non destructive
-- Chaque module peut être activé/désactivé par client (features.modules JSONB).
-- En local sans client lié : comportement unrestricted inchangé.

-- Packs / offres commercialisables (catalogue admin)
CREATE TABLE IF NOT EXISTS subscription_packs (
  id            SMALLSERIAL PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,
  label         TEXT NOT NULL,
  description   TEXT,
  duration_unit TEXT NOT NULL DEFAULT 'month'
    CHECK (duration_unit IN ('day','month','year','indefinite')),
  duration_value INT,
  max_users     INT,
  max_stations  INT,
  price_label   TEXT,           -- indicatif (ex. "25 000 FCFA / mois") — pas de paiement intégré
  features      JSONB NOT NULL DEFAULT '{}'::jsonb,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order    SMALLINT NOT NULL DEFAULT 100,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO subscription_packs(code, label, description, duration_unit, duration_value, max_users, max_stations, price_label, features, sort_order) VALUES
('essentiel', 'Essentiel', 'Ventes, stock, caisse, rapports de base', 'month', 1, 5, 1, 'Sur devis',
 '{"modules":{"sales":true,"stock":true,"reports":true,"finance":true,"hr":false,"reconcile":false,"period_lock":false,"receipts":true,"price_history":false},"can_access_hr":false,"can_access_finance":true}'::jsonb, 10),
('pro', 'Pro', 'Essentiel + réconciliation pompes, clôture période, historique prix', 'month', 1, 15, 3, 'Sur devis',
 '{"modules":{"sales":true,"stock":true,"reports":true,"finance":true,"hr":false,"reconcile":true,"period_lock":true,"receipts":true,"price_history":true},"can_access_hr":false,"can_access_finance":true,"can_view_advanced_reports":true}'::jsonb, 20),
('rh_plus', 'RH+', 'Pro + module RH / paie Mali', 'month', 1, 30, 5, 'Sur devis',
 '{"modules":{"sales":true,"stock":true,"reports":true,"finance":true,"hr":true,"reconcile":true,"period_lock":true,"receipts":true,"price_history":true},"can_access_hr":true,"can_manage_hr":true,"can_access_finance":true,"can_view_advanced_reports":true}'::jsonb, 30),
('illimite', 'Illimité', 'Tous modules, sans limite users/stations (licence indéfinie possible)', 'indefinite', NULL, NULL, NULL, 'Sur devis',
 '{"modules":{"sales":true,"stock":true,"reports":true,"finance":true,"hr":true,"reconcile":true,"period_lock":true,"receipts":true,"price_history":true,"personalization":true},"can_access_hr":true,"can_manage_hr":true,"can_access_finance":true,"can_view_advanced_reports":true,"can_customize_signature":true}'::jsonb, 40)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE client_contracts
  ADD COLUMN IF NOT EXISTS pack_code TEXT REFERENCES subscription_packs(code);

-- Clôture de période (journée / mois) — verrouillage écritures
CREATE TABLE IF NOT EXISTS period_locks (
  id            BIGSERIAL PRIMARY KEY,
  station_id    BIGINT NOT NULL REFERENCES stations(id),
  period_type   TEXT NOT NULL CHECK (period_type IN ('day','month')),
  period_key    TEXT NOT NULL,  -- YYYY-MM-DD ou YYYY-MM
  locked_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_by     BIGINT REFERENCES users(id),
  note          TEXT,
  unlocked_at   TIMESTAMPTZ,
  unlocked_by   BIGINT REFERENCES users(id),
  unlock_reason TEXT,
  UNIQUE (station_id, period_type, period_key)
);
CREATE INDEX IF NOT EXISTS period_locks_station ON period_locks (station_id, period_key);

-- Historique des prix produits / carburant
CREATE TABLE IF NOT EXISTS price_history (
  id            BIGSERIAL PRIMARY KEY,
  station_id    BIGINT NOT NULL REFERENCES stations(id),
  product_id    BIGINT NOT NULL REFERENCES products(id),
  price         NUMERIC(14,2) NOT NULL CHECK (price >= 0),
  effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_to  TIMESTAMPTZ,
  created_by    BIGINT REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  note          TEXT
);
CREATE INDEX IF NOT EXISTS price_history_product ON price_history (station_id, product_id, effective_from DESC);

-- Réconciliation pompes / ventes / stock (journal)
CREATE TABLE IF NOT EXISTS reconciliation_runs (
  id            BIGSERIAL PRIMARY KEY,
  station_id    BIGINT NOT NULL REFERENCES stations(id),
  shift_id      BIGINT REFERENCES shifts(id),
  period_from   TIMESTAMPTZ,
  period_to     TIMESTAMPTZ,
  status        TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','warning','critical')),
  summary       JSONB NOT NULL DEFAULT '{}'::jsonb,
  gaps          JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by    BIGINT REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reconciliation_station ON reconciliation_runs (station_id, created_at DESC);

-- Demandes de renouvellement licence (client → admin)
CREATE TABLE IF NOT EXISTS license_renewal_requests (
  id            BIGSERIAL PRIMARY KEY,
  client_id     BIGINT NOT NULL REFERENCES clients(id),
  requested_by  BIGINT REFERENCES users(id),
  message       TEXT,
  preferred_duration_unit TEXT,
  preferred_duration_value INT,
  status        TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','accepted','rejected','cancelled')),
  handled_by    BIGINT REFERENCES users(id),
  handled_at    TIMESTAMPTZ,
  admin_note    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS renewal_req_client ON license_renewal_requests (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS renewal_req_status ON license_renewal_requests (status) WHERE status = 'pending';

-- Seuil stock par produit (si colonne absente)
DO $$ BEGIN
  ALTER TABLE products ADD COLUMN IF NOT EXISTS min_stock NUMERIC(14,3) DEFAULT 0;
EXCEPTION WHEN others THEN NULL;
END $$;

COMMENT ON TABLE subscription_packs IS 'Catalogue offres abonnement — modules activables par pack';
COMMENT ON TABLE period_locks IS 'Clôture jour/mois — bloque les écritures de la période';
COMMENT ON TABLE reconciliation_runs IS 'Réconciliation pompes vs ventes vs stock';
COMMENT ON TABLE license_renewal_requests IS 'Demandes de renouvellement émises par le client';
