-- Temps passé sur la plateforme : un cumul par utilisateur et par jour (battement de cœur de l'application ouverte).
CREATE TABLE IF NOT EXISTS user_usage (
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day          DATE   NOT NULL DEFAULT CURRENT_DATE,
  seconds      INTEGER NOT NULL DEFAULT 0,
  pings        INTEGER NOT NULL DEFAULT 0,
  last_ping_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day)
);
CREATE INDEX IF NOT EXISTS user_usage_day_idx ON user_usage(day);
