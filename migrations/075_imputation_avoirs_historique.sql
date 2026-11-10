-- Historique des imputations d'avoirs client : quelle dette (facture ou créance globale), quel avoir, quel montant, quelle date, quel motif.
CREATE TABLE IF NOT EXISTS customer_credit_applications (
  id          BIGSERIAL PRIMARY KEY,
  station_id  BIGINT NOT NULL REFERENCES stations(id),
  customer_id BIGINT NOT NULL REFERENCES customers(id),
  credit_id   BIGINT NOT NULL REFERENCES customer_credits(id),
  invoice_id  BIGINT REFERENCES invoices(id),          -- NULL = créance globale du client (hors facture)
  amount      NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  applied_on  DATE NOT NULL DEFAULT CURRENT_DATE,
  reason      TEXT,
  created_by  BIGINT REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cca_customer_idx ON customer_credit_applications (customer_id, applied_on DESC, id DESC);
CREATE INDEX IF NOT EXISTS cca_invoice_idx  ON customer_credit_applications (invoice_id) WHERE invoice_id IS NOT NULL;
