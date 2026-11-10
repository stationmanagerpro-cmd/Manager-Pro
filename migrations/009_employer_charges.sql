-- 009 : Charges patronales « autres » (hors parts employeur INPS / AMO)
-- Non destructif. Feature flag payroll_employer_charges_enabled = OFF par défaut.
-- Aucune charge n'est activée automatiquement.
--
-- IMPORTANT :
--   - Les parts employeur INPS et AMO restent gérées par les moteurs 007 et 008.
--   - Cette table couvre les contributions purement patronales configurables :
--     ANPE, CFCE, taxes forfaitaires, autres contributions légales.
--   - Les branches PF / AT-MP déjà présentes dans inps_branches ne doivent PAS
--     être dupliquées ici avec des taux non nuls si le flag INPS est aussi ON
--     (risque de double comptage). Les seeds ci-dessous ont taux = 0.

-- ---------- Catalogue versionné des charges patronales ----------
CREATE TABLE IF NOT EXISTS employer_charges (
  id               BIGSERIAL PRIMARY KEY,
  station_id       BIGINT REFERENCES stations(id),          -- NULL = modèle global
  code             TEXT NOT NULL,                           -- ANPE, CFCE, AUTRE_...
  label            TEXT NOT NULL,
  version          INT NOT NULL DEFAULT 1,
  legal_status     TEXT NOT NULL DEFAULT 'a_confirmer'
                     CHECK (legal_status IN ('confirmee','a_confirmer','obsolete','en_attente')),
  technical_status TEXT NOT NULL DEFAULT 'desactivee'
                     CHECK (technical_status IN ('active','desactivee')),
  effective_from   DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to     DATE,
  -- Taux (%) ou montant fixe
  rate             NUMERIC(8,4) NOT NULL DEFAULT 0,         -- ex: 1.5 = 1,5 %
  fixed_amount     NUMERIC(14,2),                           -- si non null : montant fixe (prioritaire sur rate)
  -- Assiette : 'brut' | 'base_inps' | 'base_amo' | 'custom'
  base_kind        TEXT NOT NULL DEFAULT 'brut',
  ceiling          NUMERIC(14,2),
  floor_amount     NUMERIC(14,2),
  source_org       TEXT DEFAULT 'interne',
  source_ref       TEXT,
  source_url       TEXT,
  comment          TEXT,
  approved_by      BIGINT REFERENCES users(id),
  approved_at      TIMESTAMPTZ,
  approval_reason  TEXT,
  created_by       BIGINT REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT employer_charges_status_consistency
    CHECK (NOT (legal_status = 'a_confirmer' AND technical_status = 'active'))
);

CREATE UNIQUE INDEX IF NOT EXISTS employer_charges_code_station_uidx
  ON employer_charges (code, version, station_id) WHERE station_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS employer_charges_code_global_uidx
  ON employer_charges (code, version) WHERE station_id IS NULL;

CREATE INDEX IF NOT EXISTS employer_charges_active
  ON employer_charges (technical_status, legal_status, effective_from DESC);

-- ---------- Colonnes sur le bulletin ----------
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS employer_charges_total NUMERIC(14,2) DEFAULT 0;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS employer_charges_detail JSONB;

COMMENT ON COLUMN payslips.employer_charges_total IS 'Total charges patronales « autres » (hors INPS/AMO employeur). 0 si flag OFF. N''affecte JAMAIS le net salarié.';
COMMENT ON COLUMN payslips.employer_charges_detail IS 'Détail par charge (code, taux, assiette, montant, version)';

-- ---------- Seed structurel (désactivé, à confirmer, taux 0) ----------
INSERT INTO employer_charges (
  station_id, code, label, version, legal_status, technical_status,
  effective_from, rate, fixed_amount, base_kind, source_org, source_ref, comment
) VALUES
  (NULL, 'ANPE',  'Contribution ANPE', 1, 'a_confirmer', 'desactivee', CURRENT_DATE,
   0, NULL, 'brut', 'ANPE',
   'À renseigner selon réglementation en vigueur',
   'PLACEHOLDER. Ne pas activer sans confirmation juridique. Feature flag payroll_employer_charges_enabled requis.'),
  (NULL, 'CFCE',  'Contribution forfaitaire employeur (CFCE)', 1, 'a_confirmer', 'desactivee', CURRENT_DATE,
   0, NULL, 'brut', 'interne',
   'Ancienne rubrique bulletin — vérifier applicabilité',
   'PLACEHOLDER. Taux / montant à confirmer. Risque d''obsolescence.'),
  (NULL, 'AUTRE', 'Autre charge patronale', 1, 'a_confirmer', 'desactivee', CURRENT_DATE,
   0, NULL, 'brut', 'interne',
   NULL,
   'Branche générique configurable pour taxes ou contributions supplémentaires')
ON CONFLICT DO NOTHING;

COMMENT ON TABLE employer_charges IS 'Charges patronales versionnées (hors parts employeur INPS/AMO). Désactivées et à confirmer par défaut. Calcul uniquement si payroll_employer_charges_enabled=true ET charge Confirmée+Active. JAMAIS déduites du net salarié.';
