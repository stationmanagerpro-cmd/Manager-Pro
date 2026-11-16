-- Utilisation par client : minutes par jour, heure (fuseau Bamako), compte et écran.
-- Alimentée par le battement de l'application (POST /api/usage/ping). Sert aux heures d'utilisation,
-- au rythme hebdomadaire, aux écrans par client et au score d'accrochage (Superadmin).
CREATE TABLE IF NOT EXISTS usage_detail (
  day       DATE     NOT NULL,
  hour      SMALLINT NOT NULL CHECK (hour BETWEEN 0 AND 23),
  client_id BIGINT,
  user_id   BIGINT   NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  view      TEXT     NOT NULL DEFAULT '',
  minutes   INTEGER  NOT NULL DEFAULT 0,
  PRIMARY KEY (day, hour, user_id, view)
);
CREATE INDEX IF NOT EXISTS usage_detail_client_day_idx ON usage_detail(client_id, day);
