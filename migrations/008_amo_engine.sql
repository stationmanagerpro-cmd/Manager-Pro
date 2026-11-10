-- 008 : Module AMO (Assurance Maladie Obligatoire) — Mali / CANAM
-- Non destructif. Feature flag payroll_amo_enabled = OFF par défaut.
-- Aucune cotisation / aucun taux n'est activé automatiquement.
--
-- Référence indicative (à confirmer avant activation) :
--   CANAM — secteur privé : 3,06 % salarié + 3,50 % employeur
-- Les taux seedés ci-dessous sont des PLACEHOLDERS de structure, pas des taux officiels confirmés.

-- ---------- Branches AMO versionnées (même modèle que inps_branches) ----------
CREATE TABLE IF NOT EXISTS amo_branches (
  id               BIGSERIAL PRIMARY KEY,
  station_id       BIGINT REFERENCES stations(id),          -- NULL = modèle global
  code             TEXT NOT NULL,                           -- AMO_SALARIE, AMO_EMPLOYEUR, ou code unique
  label            TEXT NOT NULL,
  version          INT NOT NULL DEFAULT 1,
  legal_status     TEXT NOT NULL DEFAULT 'a_confirmer'
                     CHECK (legal_status IN ('confirmee','a_confirmer','obsolete','en_attente')),
  technical_status TEXT NOT NULL DEFAULT 'desactivee'
                     CHECK (technical_status IN ('active','desactivee')),
  effective_from   DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to     DATE,
  -- Taux en pourcentage (ex: 3.06 = 3,06 %)
  employee_rate    NUMERIC(8,4) NOT NULL DEFAULT 0,         -- part salarié
  employer_rate    NUMERIC(8,4) NOT NULL DEFAULT 0,         -- part employeur
  -- Assiette : 'brut' | 'base_amo' | 'custom'
  base_kind        TEXT NOT NULL DEFAULT 'brut',
  ceiling          NUMERIC(14,2),                           -- plafond d'assiette (NULL = pas de plafond)
  floor_amount     NUMERIC(14,2),
  source_org       TEXT DEFAULT 'CANAM',
  source_ref       TEXT,
  source_url       TEXT,
  comment          TEXT,
  approved_by      BIGINT REFERENCES users(id),
  approved_at      TIMESTAMPTZ,
  approval_reason  TEXT,
  created_by       BIGINT REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT amo_branches_status_consistency
    CHECK (NOT (legal_status = 'a_confirmer' AND technical_status = 'active'))
);

-- Unicité code+version par station (ou global)
CREATE UNIQUE INDEX IF NOT EXISTS amo_branches_code_station_uidx
  ON amo_branches (code, version, station_id) WHERE station_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS amo_branches_code_global_uidx
  ON amo_branches (code, version) WHERE station_id IS NULL;

CREATE INDEX IF NOT EXISTS amo_branches_active
  ON amo_branches (technical_status, legal_status, effective_from DESC);

-- ---------- Colonnes AMO sur le bulletin ----------
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS amo_base NUMERIC(14,2) DEFAULT 0;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS amo_employee NUMERIC(14,2) DEFAULT 0;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS amo_employer NUMERIC(14,2) DEFAULT 0;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS amo_detail JSONB;

COMMENT ON COLUMN payslips.amo_base IS 'Assiette AMO retenue pour ce bulletin';
COMMENT ON COLUMN payslips.amo_employee IS 'Total cotisations AMO salarié (0 si flag OFF) — déduit du net';
COMMENT ON COLUMN payslips.amo_employer IS 'Total cotisations AMO employeur (0 si flag OFF) — n''affecte pas le net';
COMMENT ON COLUMN payslips.amo_detail IS 'Détail par branche (taux, assiette, montants, version)';

-- ---------- Seed : branche structurelle unique (désactivée, à confirmer) ----------
-- Les taux 3,06 / 3,50 sont des valeurs INDICATIVES issues de la documentation CANAM
-- pour le secteur privé. Ils DOIVENT être confirmés juridiquement avant activation.
INSERT INTO amo_branches (
  station_id, code, label, version, legal_status, technical_status,
  effective_from, employee_rate, employer_rate, base_kind, source_org, source_ref, comment
) VALUES
  (NULL, 'AMO', 'Assurance Maladie Obligatoire (CANAM)', 1, 'a_confirmer', 'desactivee', CURRENT_DATE,
   3.06, 3.50, 'brut', 'CANAM',
   'Taux indicatifs secteur privé — à confirmer avant activation',
   'PLACEHOLDER. Assiette = rémunérations, indemnités et primes selon CANAM. Ne pas activer sans validation juridique. Feature flag payroll_amo_enabled requis.')
ON CONFLICT DO NOTHING;

COMMENT ON TABLE amo_branches IS 'Branches AMO versionnées. Désactivées et à confirmer par défaut. Calcul uniquement si payroll_amo_enabled=true ET branche Confirmée+Active.';
