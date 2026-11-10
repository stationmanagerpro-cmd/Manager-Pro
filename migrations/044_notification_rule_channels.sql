-- Canaux d'envoi pour les règles de notification
ALTER TABLE notification_rules
  ADD COLUMN IF NOT EXISTS delivery_channels TEXT[] NOT NULL DEFAULT ARRAY['app']::TEXT[];

COMMENT ON COLUMN notification_rules.delivery_channels IS 'Canaux choisis : app, email, sms, whatsapp (sms/whatsapp non branchés = indisponibles)';
