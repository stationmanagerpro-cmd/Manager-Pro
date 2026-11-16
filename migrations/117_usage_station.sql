-- Utilisation par station : un client peut avoir plusieurs stations (sous-stations) et un compte peut travailler dans plusieurs.
-- station_id = 0 : station non identifiée (battement sans en-tête valide).
ALTER TABLE usage_detail ADD COLUMN IF NOT EXISTS station_id BIGINT NOT NULL DEFAULT 0;
ALTER TABLE usage_detail DROP CONSTRAINT IF EXISTS usage_detail_pkey;
ALTER TABLE usage_detail ADD CONSTRAINT usage_detail_pkey PRIMARY KEY (day, hour, user_id, view, station_id);
CREATE INDEX IF NOT EXISTS usage_detail_client_station_idx ON usage_detail(client_id, station_id, day);
