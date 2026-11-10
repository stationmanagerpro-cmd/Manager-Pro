-- 094 Canaux d'envoi des alertes (messagerie interne, e-mail, SMS, WhatsApp) — SMS et WhatsApp restent désactivés tant que .env ne les active pas.
-- Réversible : ALTER TABLE alert_notify_config DROP COLUMN IF EXISTS channels;
ALTER TABLE alert_notify_config ADD COLUMN IF NOT EXISTS channels TEXT[] NOT NULL DEFAULT '{app}';
