-- Étape 19 : livraison par email et sélection explicite des rapports.
ALTER TABLE alert_report_schedules
  ADD COLUMN IF NOT EXISTS report_types TEXT[] NOT NULL DEFAULT ARRAY['financial_summary']::TEXT[],
  ADD COLUMN IF NOT EXISTS delivery_channels TEXT[] NOT NULL DEFAULT ARRAY['app']::TEXT[],
  ADD COLUMN IF NOT EXISTS email_recipients TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE alert_report_schedules
  DROP CONSTRAINT IF EXISTS alert_report_schedule_channels_check;
ALTER TABLE alert_report_schedules
  ADD CONSTRAINT alert_report_schedule_channels_check CHECK (
    cardinality(delivery_channels) > 0 AND delivery_channels <@ ARRAY['app','email']::TEXT[]
  );
ALTER TABLE alert_report_schedules
  DROP CONSTRAINT IF EXISTS alert_report_schedule_report_types_check;
ALTER TABLE alert_report_schedules
  ADD CONSTRAINT alert_report_schedule_report_types_check CHECK (
    cardinality(report_types) > 0 AND report_types <@ ARRAY['financial_summary','operational_alerts','stock_summary','hr_summary']::TEXT[]
  );
CREATE INDEX IF NOT EXISTS alert_report_schedules_email_due ON alert_report_schedules(next_run_at) WHERE active = TRUE AND 'email' = ANY(delivery_channels);
