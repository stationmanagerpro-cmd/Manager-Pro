-- Besoin d'aide : procédure et lien vidéo par module. Contenu GLOBAL (pas lié à une station).
-- Lecture : tout utilisateur connecté. Écriture : Super Admin uniquement (contrôlé par la route).
-- Additif et idempotent.
CREATE TABLE IF NOT EXISTS help_guides (
  module_key  TEXT PRIMARY KEY,
  procedure   TEXT NOT NULL DEFAULT '',
  video_url   TEXT NOT NULL DEFAULT '',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  BIGINT
);
