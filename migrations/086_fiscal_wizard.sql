-- 086 — Fiscalité : assistant d'activation individuelle par impôt (paramètres versionnés, confirmés, journalisés)
-- Un module ne calcule rien tant qu'il n'a pas été activé par l'assistant (voir src/fiscal_wizard.js).
BEGIN;

ALTER TABLE fiscal_module_activations
  ADD COLUMN IF NOT EXISTS effective_from       DATE,
  ADD COLUMN IF NOT EXISTS settings_version     INT,
  ADD COLUMN IF NOT EXISTS activation_reason    TEXT,
  ADD COLUMN IF NOT EXISTS deactivation_reason  TEXT;

-- Paramètres confirmés par l'administrateur du client, par module. Chaque modification crée une NOUVELLE version
-- (l'historique n'est jamais réécrit) ; `customized` liste les clés qui diffèrent du jeu de référence.
CREATE TABLE IF NOT EXISTS fiscal_module_settings (
  id              BIGSERIAL PRIMARY KEY,
  client_id       BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  module_code     TEXT   NOT NULL,
  version         INT    NOT NULL,
  params          JSONB  NOT NULL,
  customized      JSONB  NOT NULL DEFAULT '[]'::jsonb,
  zero_confirmed  JSONB  NOT NULL DEFAULT '[]'::jsonb,    -- taux nuls confirmés explicitement
  dataset_version TEXT   NOT NULL,                        -- version du jeu de référence au moment de la saisie
  effective_from  DATE   NOT NULL,
  reason          TEXT   NOT NULL,
  created_by      BIGINT REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, module_code, version)
);

CREATE INDEX IF NOT EXISTS fiscal_module_settings_lookup_idx
  ON fiscal_module_settings (client_id, module_code, effective_from DESC, version DESC);

-- Immuabilité : une version enregistrée ne se modifie pas (suppression possible uniquement avec le client).
CREATE OR REPLACE FUNCTION fiscal_module_settings_no_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'fiscal_module_settings : une version de paramètres ne peut pas être modifiée (créer une nouvelle version)';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS fiscal_module_settings_immutable ON fiscal_module_settings;
CREATE TRIGGER fiscal_module_settings_immutable BEFORE UPDATE ON fiscal_module_settings
  FOR EACH ROW EXECUTE FUNCTION fiscal_module_settings_no_update();

COMMIT;
