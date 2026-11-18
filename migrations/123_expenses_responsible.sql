-- Dépenses : responsable désigné (compte utilisateur de la station), obligatoire pour toute nouvelle dépense côté application.
-- NULL = dépense enregistrée avant cette règle. Additif et idempotent.
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS responsible_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS expenses_station_responsible_idx ON expenses (station_id, responsible_user_id);
