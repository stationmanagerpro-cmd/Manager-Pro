-- Outils du gérant : objectifs de vente, résumé hebdomadaire, justificatifs photo des dépenses. Additif et idempotent.
CREATE TABLE IF NOT EXISTS sales_goals (
  id         BIGSERIAL PRIMARY KEY,
  station_id BIGINT NOT NULL REFERENCES stations(id),
  month      DATE   NOT NULL,                                   -- 1er jour du mois
  metric     TEXT   NOT NULL CHECK (metric IN ('liters','amount')),
  target     NUMERIC(16,3) NOT NULL CHECK (target > 0),
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (station_id, month, metric)
);
CREATE TABLE IF NOT EXISTS sales_goal_alerts (
  goal_id BIGINT NOT NULL REFERENCES sales_goals(id) ON DELETE CASCADE,
  state   TEXT   NOT NULL CHECK (state IN ('atteint','en_retard')),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (goal_id, state)
);
CREATE TABLE IF NOT EXISTS weekly_summaries_sent (
  station_id BIGINT NOT NULL REFERENCES stations(id),
  week_start DATE   NOT NULL,
  sent_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (station_id, week_start)
);
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
