-- 007 : Module INPS (cotisations sociales) — Mali
-- Non destructif. Feature flag payroll_inps_enabled = OFF par défaut.
-- Aucune branche / aucun taux n'est activé automatiquement.

-- ---------- Branches INPS versionnées ----------
CREATE TABLE IF NOT EXISTS inps_branches (
  id               BIGSERIAL PRIMARY KEY,
  station_id       BIGINT REFERENCES stations(id),          -- NULL = modèle global
  code             TEXT NOT NULL,                           -- RETRAITE, PF, ATMP, ...
  label            TEXT NOT NULL,
  version          INT NOT NULL DEFAULT 1,
  legal_status     TEXT NOT NULL DEFAULT 'a_confirmer'
                     CHECK (legal_status IN ('confirmee','a_confirmer','obsolete','en_attente')),
  technical_status TEXT NOT NULL DEFAULT 'desactivee'
                     CHECK (technical_status IN ('active','desactivee')),
  effective_from   DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to     DATE,
  -- Taux en pourcentage (ex: 3.6 = 3,6 %)
  employee_rate    NUMERIC(8,4) NOT NULL DEFAULT 0,         -- part salarié
  employer_rate    NUMERIC(8,4) NOT NULL DEFAULT 0,         -- part employeur
  -- Assiette : 'brut' | 'base_inps' | 'custom'
  base_kind        TEXT NOT NULL DEFAULT 'brut',
  ceiling          NUMERIC(14,2),                           -- plafond d'assiette (NULL = pas de plafond)
  floor_amount     NUMERIC(14,2),
  source_org       TEXT DEFAULT 'INPS',
  source_ref       TEXT,
  source_url       TEXT,
  comment          TEXT,
  approved_by      BIGINT REFERENCES users(id),
  approved_at      TIMESTAMPTZ,
  approval_reason  TEXT,
  created_by       BIGINT REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT inps_branches_status_consistency
    CHECK (NOT (legal_status = 'a_confirmer' AND technical_status = 'active'))
);

CREATE UNIQUE INDEX IF NOT EXISTS inps_branches_code_station_uidx
  ON inps_branches (station_id, code, version) WHERE station_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS inps_branches_code_global_uidx
  ON inps_branches (code, version) WHERE station_id IS NULL;

CREATE INDEX IF NOT EXISTS inps_branches_active
  ON inps_branches (technical_status, legal_status, effective_from DESC);

-- ---------- Colonnes INPS sur le bulletin ----------
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS inps_base NUMERIC(14,2) DEFAULT 0;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS inps_employee NUMERIC(14,2) DEFAULT 0;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS inps_employer NUMERIC(14,2) DEFAULT 0;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS inps_detail JSONB;

COMMENT ON COLUMN payslips.inps_base IS 'Assiette INPS retenue pour ce bulletin';
COMMENT ON COLUMN payslips.inps_employee IS 'Total cotisations INPS salarié (0 si flag OFF)';
COMMENT ON COLUMN payslips.inps_employer IS 'Total cotisations INPS employeur (0 si flag OFF) — n''affecte pas le net';
COMMENT ON COLUMN payslips.inps_detail IS 'Détail par branche (taux, assiette, montants, version)';

-- ---------- Seed : branches structurelles (désactivées, à confirmer) ----------
-- Les taux ci-dessous sont des PLACEHOLDERS de structure, pas des taux officiels confirmés.
INSERT INTO inps_branches (
  station_id, code, label, version, legal_status, technical_status,
  effective_from, employee_rate, employer_rate, base_kind, source_org, source_ref, comment
) VALUES
  (NULL, 'RETRAITE', 'Retraite',              1, 'a_confirmer', 'desactivee', CURRENT_DATE, 0, 0, 'brut', 'INPS',
   'À renseigner selon barème INPS en vigueur', 'Taux salarié/employeur à confirmer avant activation'),
  (NULL, 'PF',       'Prestations familiales',1, 'a_confirmer', 'desactivee', CURRENT_DATE, 0, 0, 'brut', 'INPS',
   'À renseigner selon barème INPS en vigueur', 'Généralement à la charge exclusive de l''employeur — à confirmer'),
  (NULL, 'ATMP',     'Accidents du travail / Maladies professionnelles', 1, 'a_confirmer', 'desactivee', CURRENT_DATE, 0, 0, 'brut', 'INPS',
   'À renseigner selon barème INPS en vigueur', 'Taux variable selon risque — à confirmer'),
  (NULL, 'AUTRE',    'Autre branche INPS',    1, 'a_confirmer', 'desactivee', CURRENT_DATE, 0, 0, 'brut', 'INPS',
   NULL, 'Branche générique pour cotisations supplémentaires configurables')
ON CONFLICT DO NOTHING;

COMMENT ON TABLE inps_branches IS 'Branches INPS versionnées. Désactivées et à confirmer par défaut. Calcul uniquement si payroll_inps_enabled=true ET branche Confirmée+Active.';
