-- Étape 16 : rapports/alertes opérationnels programmés par les comptes clients.
-- La configuration est cloisonnée par client et protégée par le contrat auto_alerts.
CREATE TABLE IF NOT EXISTS alert_report_schedules (
  id BIGSERIAL PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  station_id BIGINT REFERENCES stations(id) ON DELETE CASCADE,
  created_by BIGINT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 2 AND 120),
  frequency TEXT NOT NULL CHECK (frequency IN ('once','weekly','monthly')),
  scheduled_date DATE,
  day_of_week SMALLINT CHECK (day_of_week BETWEEN 0 AND 6),
  day_of_month SMALLINT CHECK (day_of_month BETWEEN 1 AND 28),
  send_mode TEXT NOT NULL DEFAULT 'fixed' CHECK (send_mode IN ('fixed','random')),
  send_time TIME,
  random_start TIME,
  random_end TIME,
  recipient_user_ids BIGINT[] NOT NULL,
  categories TEXT[] NOT NULL DEFAULT ARRAY['operations','cash','stock','staff','payroll']::TEXT[],
  active BOOLEAN NOT NULL DEFAULT TRUE,
  next_run_at TIMESTAMPTZ NOT NULL,
  last_sent_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT alert_report_schedule_recipients_nonempty CHECK (cardinality(recipient_user_ids) > 0),
  CONSTRAINT alert_report_schedule_mode_time CHECK (
    (send_mode = 'fixed' AND send_time IS NOT NULL AND random_start IS NULL AND random_end IS NULL)
    OR (send_mode = 'random' AND random_start IS NOT NULL AND random_end IS NOT NULL AND random_start < random_end AND send_time IS NULL)
  ),
  CONSTRAINT alert_report_schedule_frequency_fields CHECK (
    (frequency = 'once' AND scheduled_date IS NOT NULL AND day_of_week IS NULL AND day_of_month IS NULL)
    OR (frequency = 'weekly' AND scheduled_date IS NULL AND day_of_week IS NOT NULL AND day_of_month IS NULL)
    OR (frequency = 'monthly' AND scheduled_date IS NULL AND day_of_week IS NULL AND day_of_month IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS alert_report_schedules_due ON alert_report_schedules(next_run_at) WHERE active = TRUE;
CREATE INDEX IF NOT EXISTS alert_report_schedules_client ON alert_report_schedules(client_id, active, next_run_at);
COMMENT ON TABLE alert_report_schedules IS 'Programmation de rapports opérationnels avec destinataires explicites, sous autorisation contractuelle auto_alerts.';
