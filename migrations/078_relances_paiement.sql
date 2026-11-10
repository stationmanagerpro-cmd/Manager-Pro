-- 078 : relances de paiement (suivi des rappels envoyés aux clients en retard)
CREATE TABLE IF NOT EXISTS payment_reminders (
  id          BIGSERIAL PRIMARY KEY,
  station_id  BIGINT NOT NULL REFERENCES stations(id),
  customer_id BIGINT NOT NULL REFERENCES customers(id),
  invoice_id  BIGINT REFERENCES invoices(id),
  channel     TEXT NOT NULL DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp','email','sms','appel','autre')),
  amount      NUMERIC(14,2),
  message     TEXT,
  created_by  BIGINT REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payment_reminders_cust ON payment_reminders (station_id, customer_id, created_at DESC);
