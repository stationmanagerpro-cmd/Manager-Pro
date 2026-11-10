-- Étape 15 : suivi de cycle de vie des alertes (prise en charge / résolution).
-- Migration additive : aucune alerte ni aucun message n'est supprimé.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS alert_status TEXT NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS acknowledged_by BIGINT REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolved_by BIGINT REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolution_note TEXT;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_alert_status_valid') THEN
    ALTER TABLE messages ADD CONSTRAINT messages_alert_status_valid
      CHECK (alert_status IN ('open', 'acknowledged', 'resolved')) NOT VALID;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS messages_alert_status_client
  ON messages (client_id, alert_status, created_at DESC)
  WHERE is_system = TRUE AND deleted_at IS NULL;
COMMENT ON COLUMN messages.alert_status IS 'Cycle de vie des alertes système : open, acknowledged, resolved.';
