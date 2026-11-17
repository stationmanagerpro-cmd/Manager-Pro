-- Superadmin : règles d'alerte propres à la plateforme. Stockage SÉPARÉ des règles client (alert_notify_config, liées à un client_id).
-- Une ligne par type d'alerte. Additif et idempotent.
CREATE TABLE IF NOT EXISTS platform_alert_rules (
  alert_kind      TEXT PRIMARY KEY CHECK (alert_kind IN ('licence_reminder_sent','client_licence_expiring','server_errors_500','backup_failed','station_without_client','client_created')),
  active          BOOLEAN NOT NULL DEFAULT FALSE,
  threshold_value INTEGER,
  email           TEXT NOT NULL DEFAULT '',
  last_checked_at TIMESTAMPTZ,
  last_fired_at   TIMESTAMPTZ,
  last_value      INTEGER,
  last_error      TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      BIGINT
);
