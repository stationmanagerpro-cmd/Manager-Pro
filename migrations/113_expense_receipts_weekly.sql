-- Justificatifs photo des dépenses et résumé hebdomadaire envoyé au gérant. Additif et idempotent.
CREATE TABLE IF NOT EXISTS expense_receipts (
  id         BIGSERIAL PRIMARY KEY,
  station_id BIGINT NOT NULL REFERENCES stations(id),
  expense_id BIGINT NOT NULL REFERENCES expenses(id),
  filename   TEXT NOT NULL,
  mime       TEXT NOT NULL CHECK (mime IN ('image/jpeg','image/png','image/webp','application/pdf')),
  size       INTEGER NOT NULL CHECK (size > 0),
  data       BYTEA NOT NULL,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS expense_receipts_expense_idx ON expense_receipts(expense_id);

CREATE TABLE IF NOT EXISTS weekly_summaries_sent (
  station_id BIGINT NOT NULL REFERENCES stations(id),
  week_start DATE   NOT NULL,
  sent_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (station_id, week_start)
);
