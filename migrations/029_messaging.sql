-- 029 : Messagerie interne + pièces jointes + alertes liées
-- Non destructif. Toutes les tables sont scopées par client_id.
-- Feature flags (dans client_contracts.features) — tous OFF par défaut côté code :
--   can_use_messaging, messaging_attachments, messaging_groups, messaging_broadcast, can_use_auto_alerts

-- Conversations (individuelles ou groupe)
CREATE TABLE IF NOT EXISTS conversations (
  id            BIGSERIAL PRIMARY KEY,
  client_id     BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  title         TEXT,
  is_group      BOOLEAN NOT NULL DEFAULT FALSE,
  is_broadcast  BOOLEAN NOT NULL DEFAULT FALSE,
  created_by    BIGINT REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS conversations_client_id ON conversations(client_id) WHERE deleted_at IS NULL;

-- Participants d'une conversation
CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_read_at    TIMESTAMPTZ,
  muted           BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS conversation_members_user ON conversation_members(user_id);

-- Messages
CREATE TABLE IF NOT EXISTS messages (
  id              BIGSERIAL PRIMARY KEY,
  client_id       BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       BIGINT NOT NULL REFERENCES users(id),
  body            TEXT NOT NULL,
  is_system       BOOLEAN NOT NULL DEFAULT FALSE,   -- alertes auto, etc.
  system_kind     TEXT,                             -- cash_variance, stock_anomaly, ...
  ref_table       TEXT,
  ref_id          BIGINT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS messages_conversation ON messages(conversation_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS messages_client ON messages(client_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS messages_sender ON messages(sender_id);

-- État de lecture / archivage par destinataire
CREATE TABLE IF NOT EXISTS message_states (
  message_id    BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at       TIMESTAMPTZ,
  archived_at   TIMESTAMPTZ,
  deleted_at    TIMESTAMPTZ,
  PRIMARY KEY (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS message_states_user_unread
  ON message_states(user_id) WHERE read_at IS NULL AND deleted_at IS NULL;

-- Pièces jointes
CREATE TABLE IF NOT EXISTS message_attachments (
  id            BIGSERIAL PRIMARY KEY,
  message_id    BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  client_id     BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  file_path     TEXT NOT NULL,
  file_name     TEXT NOT NULL,
  mime_type     TEXT,
  size_bytes    INT,
  uploaded_by   BIGINT REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS message_attachments_message ON message_attachments(message_id);
CREATE INDEX IF NOT EXISTS message_attachments_client ON message_attachments(client_id);

-- Configuration des alertes automatiques (par client / station)
CREATE TABLE IF NOT EXISTS alert_notify_config (
  id            BIGSERIAL PRIMARY KEY,
  client_id     BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  station_id    BIGINT REFERENCES stations(id) ON DELETE CASCADE,  -- NULL = toutes stations du client
  alert_kind    TEXT NOT NULL,   -- cash_variance, stock_anomaly, counter_anomaly, shift_close, absence, ...
  notify_employee BOOLEAN NOT NULL DEFAULT TRUE,
  copy_user_ids BIGINT[] NOT NULL DEFAULT '{}',
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by    BIGINT REFERENCES users(id),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, station_id, alert_kind)
);

-- Rôles autorisés au broadcast (niveau admin local)
CREATE TABLE IF NOT EXISTS messaging_broadcast_roles (
  client_id     BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  role_code     TEXT NOT NULL,
  allowed       BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (client_id, role_code)
);

COMMENT ON TABLE conversations IS 'Messagerie interne — isolée par client_id';
COMMENT ON TABLE messages IS 'Messages texte + système (alertes) — isolés par client_id';
COMMENT ON TABLE message_attachments IS 'Pièces jointes — double flag can_use_messaging + messaging_attachments';
COMMENT ON TABLE alert_notify_config IS 'Config destinataires alertes auto — nécessite can_use_auto_alerts';
