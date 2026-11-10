-- 017 Moteur financier normalisé (Priorité 4)
-- Journal unifié des mouvements d'argent — ne remplace pas cash_movements / money_movements / payments.
-- Les écritures existantes restent la source opérationnelle ; financial_events = vue métier normalisée.

CREATE TABLE IF NOT EXISTS financial_events (
  id            BIGSERIAL PRIMARY KEY,
  station_id    BIGINT NOT NULL REFERENCES stations(id),
  event_type    TEXT NOT NULL
    CHECK (event_type IN (
      'VENTE','ACHAT','PAIEMENT_CLIENT','PAIEMENT_FOURNISSEUR','DEPENSE',
      'AVANCE','REMBOURSEMENT','PRET','REMBOURSEMENT_PRET','PERTE','ECART','TRANSFERT','AUTRE'
    )),
  direction     TEXT NOT NULL CHECK (direction IN ('in','out','neutral')),
  amount        NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  currency      CHAR(4) NOT NULL DEFAULT 'FCFA',
  method        TEXT,                    -- especes, mobile_money, banque, credit...
  account_id    BIGINT,                  -- money_accounts si applicable
  cash_register_id BIGINT,               -- caisse si applicable
  shift_id      BIGINT REFERENCES shifts(id),
  customer_id   BIGINT REFERENCES customers(id),
  supplier_id   BIGINT REFERENCES suppliers(id),
  employee_id   BIGINT REFERENCES employees(id),
  ref_table     TEXT,
  ref_id        BIGINT,
  label         TEXT NOT NULL,
  description   TEXT,
  event_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    BIGINT REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  meta          JSONB
);

CREATE INDEX IF NOT EXISTS financial_events_station_at ON financial_events (station_id, event_at DESC);
CREATE INDEX IF NOT EXISTS financial_events_type ON financial_events (station_id, event_type);
CREATE INDEX IF NOT EXISTS financial_events_customer ON financial_events (customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS financial_events_supplier ON financial_events (supplier_id) WHERE supplier_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS financial_events_ref ON financial_events (ref_table, ref_id);

COMMENT ON TABLE financial_events IS 'Journal métier normalisé P4. Complète cash_movements/money_movements sans les remplacer.';
