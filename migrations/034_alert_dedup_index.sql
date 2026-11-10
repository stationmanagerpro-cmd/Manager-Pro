-- Étape 14 : accélère la déduplication des alertes système récurrentes.
CREATE INDEX IF NOT EXISTS messages_system_alert_dedup
  ON messages (client_id, system_kind, ref_table, ref_id, created_at DESC)
  WHERE is_system = TRUE AND deleted_at IS NULL;
