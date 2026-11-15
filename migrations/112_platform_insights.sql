-- Superadmin : journal des erreurs et relances automatiques de licence. Additif et idempotent.
CREATE TABLE IF NOT EXISTS error_log (
  id          BIGSERIAL PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source      TEXT NOT NULL CHECK (source IN ('server','client')),
  method      TEXT,
  path        TEXT,
  status      INTEGER,
  code        TEXT,
  message     TEXT NOT NULL,
  stack       TEXT,
  view        TEXT,
  user_id     BIGINT,
  client_id   BIGINT,
  user_agent  TEXT
);
CREATE INDEX IF NOT EXISTS error_log_time_idx ON error_log (occurred_at DESC);
CREATE INDEX IF NOT EXISTS error_log_client_idx ON error_log (client_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS license_reminders (
  id         BIGSERIAL PRIMARY KEY,
  client_id  BIGINT NOT NULL,
  expires_on DATE NOT NULL,
  band       INTEGER NOT NULL,
  sent_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  stations   INTEGER NOT NULL DEFAULT 0,
  UNIQUE (client_id, expires_on, band)
);
