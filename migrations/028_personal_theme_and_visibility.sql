-- 028 : thème personnel par utilisateur et permission dédiée. Additif/idempotent.
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by BIGINT REFERENCES users(id),
  PRIMARY KEY (user_id, key)
);

INSERT INTO permissions(code,label) VALUES
  ('appearance.self','Personnaliser mon thème personnel')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r,permissions p
WHERE r.code='GERANT' AND p.code='appearance.self'
ON CONFLICT DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_user_preferences_key ON user_preferences(key);

-- Activer la personnalisation pour les contrats historiques qui n'avaient pas encore cette clé.
-- Un choix explicitement défini à false reste inchangé.
UPDATE client_contracts
SET features = jsonb_set(
  jsonb_set(COALESCE(features, '{}'::jsonb), '{can_access_personalization}', 'true'::jsonb, true),
  '{modules,personalization}', 'true'::jsonb, true
)
WHERE NOT (COALESCE(features, '{}'::jsonb) ? 'can_access_personalization');
