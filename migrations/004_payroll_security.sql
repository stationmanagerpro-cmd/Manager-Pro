-- 004 : Sécurisation du moteur de paie (Phase 2)
-- Non destructif. Aucune cotisation AMO/INPS/ITS activée.
-- Objectifs : net >= 0, mode sécurité, dry-run, snapshot enrichi, feature flags OFF par défaut.

-- ---------- Enrichissement des bulletins ----------
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS engine_version TEXT;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS calculation_mode TEXT DEFAULT 'reel';
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS security_mode TEXT;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS warnings JSONB DEFAULT '[]'::jsonb;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS gross_detail JSONB;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS deduction_detail JSONB;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS employer_cost NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT FALSE;

-- Verrouiller les bulletins déjà validés ou payés
UPDATE payslips SET is_locked = TRUE
 WHERE status IN ('valide', 'paye') AND (is_locked IS NULL OR is_locked = FALSE);

-- Contraintes douces (compatibles données existantes)
ALTER TABLE payslips DROP CONSTRAINT IF EXISTS payslips_calculation_mode_check;
ALTER TABLE payslips ADD CONSTRAINT payslips_calculation_mode_check
  CHECK (calculation_mode IS NULL OR calculation_mode IN ('simulation', 'reel'));

ALTER TABLE payslips DROP CONSTRAINT IF EXISTS payslips_security_mode_check;
ALTER TABLE payslips ADD CONSTRAINT payslips_security_mode_check
  CHECK (security_mode IS NULL OR security_mode IN ('strict', 'avertissement', 'simulation'));

-- ---------- Index utiles ----------
CREATE INDEX IF NOT EXISTS payslips_station_month_status
  ON payslips(station_id, month, status);

CREATE INDEX IF NOT EXISTS payslips_employee_month
  ON payslips(employee_id, month);

-- ---------- Commentaires de documentation ----------
COMMENT ON COLUMN payslips.engine_version IS 'Version du moteur de calcul au moment du calcul (ex: 2.0.0)';
COMMENT ON COLUMN payslips.calculation_mode IS 'simulation = aucun effet financier ; reel = paie réelle';
COMMENT ON COLUMN payslips.security_mode IS 'Mode sécurité appliqué : strict | avertissement | simulation';
COMMENT ON COLUMN payslips.warnings IS 'Alertes générées lors du calcul (règles, plafonds, etc.)';
COMMENT ON COLUMN payslips.is_locked IS 'TRUE après validation/paiement : interdiction de modification directe';
COMMENT ON COLUMN payslips.employer_cost IS 'Coût total employeur (brut + charges patronales). 0 tant que charges désactivées';
