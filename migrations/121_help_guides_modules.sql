-- Besoin d'aide : nom modifiable par module et modules personnalisés ajoutés par le Super Admin.
-- Contenu GLOBAL. Additif et idempotent (même schéma que src/help_guides.js).
ALTER TABLE help_guides ADD COLUMN IF NOT EXISTS label  TEXT NOT NULL DEFAULT '';
ALTER TABLE help_guides ADD COLUMN IF NOT EXISTS custom BOOLEAN NOT NULL DEFAULT false;
