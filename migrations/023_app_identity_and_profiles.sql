-- 023 Identité de l'application (nom, slogan, logo, favicon) administrable + profil utilisateur (nom complet, fonction, photo)
-- Non destructif : uniquement des ajouts avec valeurs par défaut. Les anciennes installations continuent à fonctionner.

CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by BIGINT REFERENCES users(id)
);

INSERT INTO app_settings (key, value) VALUES
  ('app_name',         to_jsonb('Station Manager Pro'::text)),
  ('app_tagline',      to_jsonb('Gestion intelligente de votre station-service'::text)),
  ('app_logo_path',    'null'::jsonb),
  ('app_favicon_path', 'null'::jsonb)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name  TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS job_title  TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS photo_path TEXT;
