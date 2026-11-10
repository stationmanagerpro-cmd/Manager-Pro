-- Règles de notification sur rapports (nom, déclencheur, modèle e-mail, rapports 1–5, priorité, périodicité)
CREATE TABLE IF NOT EXISTS notification_rules (
  id              BIGSERIAL PRIMARY KEY,
  client_id       BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  station_id      BIGINT REFERENCES stations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  trigger_event   TEXT NOT NULL
                  CHECK (trigger_event IN (
                    'on_report_create', 'on_report_update', 'on_report_approve', 'on_schedule'
                  )),
  email_mode      TEXT NOT NULL DEFAULT 'system_default'
                  CHECK (email_mode IN ('system_default', 'custom')),
  subject_default TEXT,
  body_default    TEXT,
  include_attachments BOOLEAN NOT NULL DEFAULT FALSE,
  report_keys     TEXT[] NOT NULL DEFAULT '{}',
  priority        TEXT NOT NULL DEFAULT 'important'
                  CHECK (priority IN ('faible', 'important', 'urgent')),
  frequency       TEXT
                  CHECK (frequency IS NULL OR frequency IN (
                    'daily', 'weekly', 'quarterly', 'semester', 'annual', 'once'
                  )),
  scheduled_date  DATE,
  send_time       TEXT DEFAULT '08:00',
  recipient_user_ids BIGINT[] NOT NULL DEFAULT '{}',
  email_recipients TEXT[] NOT NULL DEFAULT '{}',
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  next_run_at     TIMESTAMPTZ,
  last_sent_at    TIMESTAMPTZ,
  created_by      BIGINT REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notification_rules_client ON notification_rules (client_id);
CREATE INDEX IF NOT EXISTS notification_rules_active ON notification_rules (client_id, active);
CREATE INDEX IF NOT EXISTS notification_rules_next ON notification_rules (next_run_at) WHERE active = TRUE;

COMMENT ON TABLE notification_rules IS 'Règles de notification e-mail/app liées aux rapports — configuration utilisateur';
