-- 097 Rapprochement ligne à ligne : lignes de relevé opérateur (Mobile Money) / banque
-- face aux mouvements comptables (money_movements). Montant signé : + entrée, − sortie (comme money_movements).
CREATE TABLE IF NOT EXISTS money_statement_lines (
  id          BIGSERIAL PRIMARY KEY,
  station_id  BIGINT NOT NULL REFERENCES stations(id),
  account_id  BIGINT NOT NULL REFERENCES money_accounts(id),
  line_date   DATE NOT NULL,
  amount      NUMERIC(14,2) NOT NULL CHECK (amount <> 0),
  reference   TEXT,
  label       TEXT,
  line_hash   TEXT NOT NULL,                       -- empêche de réimporter deux fois la même ligne
  status      TEXT NOT NULL DEFAULT 'a_rapprocher' CHECK (status IN ('a_rapprocher','rapprochee_auto','rapprochee_manuelle','ignoree')),
  movement_id BIGINT REFERENCES money_movements(id),
  note        TEXT,
  created_by  BIGINT REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT msl_matched_has_movement CHECK ((status IN ('rapprochee_auto','rapprochee_manuelle')) = (movement_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS msl_hash_uq ON money_statement_lines (account_id, line_hash);
CREATE UNIQUE INDEX IF NOT EXISTS msl_movement_uq ON money_statement_lines (movement_id) WHERE movement_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS msl_account_date ON money_statement_lines (account_id, line_date DESC);
