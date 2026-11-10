-- Facturation clients (station) — module gratuit, isolé par station_id
CREATE TABLE IF NOT EXISTS invoices (
  id            BIGSERIAL PRIMARY KEY,
  station_id    BIGINT NOT NULL REFERENCES stations(id),
  customer_id   BIGINT REFERENCES customers(id),
  sale_id       BIGINT REFERENCES sales(id),
  invoice_no    TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'brouillon'
                CHECK (status IN ('brouillon', 'emise', 'partielle', 'payee', 'annulee')),
  issued_on     DATE,
  due_date      DATE,
  tax_rate      NUMERIC(5,2) NOT NULL DEFAULT 0,
  total_ht      NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_tax     NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_ttc     NUMERIC(14,2) NOT NULL DEFAULT 0,
  amount_paid   NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes         TEXT,
  created_by    BIGINT REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (station_id, invoice_no)
);

CREATE INDEX IF NOT EXISTS invoices_station_status ON invoices (station_id, status);
CREATE INDEX IF NOT EXISTS invoices_station_customer ON invoices (station_id, customer_id);
CREATE INDEX IF NOT EXISTS invoices_station_issued ON invoices (station_id, issued_on);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id            BIGSERIAL PRIMARY KEY,
  invoice_id    BIGINT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  product_id    BIGINT REFERENCES products(id),
  description   TEXT NOT NULL,
  quantity      NUMERIC(14,3) NOT NULL DEFAULT 1,
  unit_price    NUMERIC(14,2) NOT NULL DEFAULT 0,
  amount        NUMERIC(14,2) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS invoice_lines_invoice ON invoice_lines (invoice_id);

CREATE TABLE IF NOT EXISTS invoice_payments (
  id            BIGSERIAL PRIMARY KEY,
  invoice_id    BIGINT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  station_id    BIGINT NOT NULL REFERENCES stations(id),
  amount        NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  method        TEXT NOT NULL DEFAULT 'especes',
  paid_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  reference     TEXT,
  created_by    BIGINT REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invoice_payments_invoice ON invoice_payments (invoice_id);
