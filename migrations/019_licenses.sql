-- 019 Module licences clients — évolution non destructive de client_contracts
-- Conserve toutes les données et colonnes existantes.

-- Durée structurée + indéfinie + timestamps précis
ALTER TABLE client_contracts
  ADD COLUMN IF NOT EXISTS duration_value   INT,
  ADD COLUMN IF NOT EXISTS duration_unit    TEXT
    CHECK (duration_unit IS NULL OR duration_unit IN ('day','month','year','indefinite','custom')),
  ADD COLUMN IF NOT EXISTS starts_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expires_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_indefinite    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS last_renewed_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_renewed_by  BIGINT REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS suspended_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suspended_by     BIGINT REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS suspend_reason   TEXT;

-- Backfill depuis start_date / end_date existants
UPDATE client_contracts SET
  starts_at = COALESCE(starts_at, start_date::timestamptz),
  expires_at = COALESCE(expires_at, CASE WHEN end_date IS NOT NULL THEN (end_date::timestamp + interval '1 day' - interval '1 second') AT TIME ZONE 'UTC' END),
  is_indefinite = COALESCE(is_indefinite, (end_date IS NULL AND status = 'actif'))
WHERE starts_at IS NULL OR (end_date IS NOT NULL AND expires_at IS NULL);

-- Historique des opérations licence (immutable côté applicatif)
CREATE TABLE IF NOT EXISTS license_history (
  id              BIGSERIAL PRIMARY KEY,
  client_id       BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  contract_id     BIGINT REFERENCES client_contracts(id) ON DELETE SET NULL,
  operation       TEXT NOT NULL
    CHECK (operation IN (
      'creation','renewal','extension','suspension','reactivation',
      'modification','expiration','reduction'
    )),
  old_status      TEXT,
  new_status      TEXT,
  old_starts_at   TIMESTAMPTZ,
  old_expires_at  TIMESTAMPTZ,
  new_starts_at   TIMESTAMPTZ,
  new_expires_at  TIMESTAMPTZ,
  duration_value  INT,
  duration_unit   TEXT,
  is_indefinite   BOOLEAN,
  note            TEXT,
  performed_by    BIGINT REFERENCES users(id),
  performed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  meta            JSONB
);

CREATE INDEX IF NOT EXISTS license_history_client ON license_history (client_id, performed_at DESC);
CREATE INDEX IF NOT EXISTS license_history_op ON license_history (operation);

-- Seuils d'avertissement (jours avant expiration) — config globale
CREATE TABLE IF NOT EXISTS license_settings (
  key   TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO license_settings(key, value) VALUES
  ('warning_days', '[30,15,7,3,1]'::jsonb),
  ('contact_admin_email', '""'::jsonb),
  ('contact_admin_message', '"Veuillez contacter l''administrateur principal pour renouveler votre licence."'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Enrichir clients : responsable, login initial stocké en note seulement
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS manager_name TEXT,
  ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;

COMMENT ON TABLE license_history IS 'Historique licences P-licences. Non supprimable par utilisateurs ordinaires.';
COMMENT ON COLUMN client_contracts.is_indefinite IS 'TRUE = pas d''expiration (sauf suspension manuelle)';
COMMENT ON COLUMN client_contracts.expires_at IS 'Horodatage précis d''expiration ; NULL si indéfinie';
