-- Migration 048 : Lot 3 Fiscalité
-- - tax_rate sur lignes d'achat (TVA déductible plus précise)
-- - Pas de DROP destructif

BEGIN;

ALTER TABLE purchase_details
  ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0
    CHECK (tax_rate >= 0 AND tax_rate <= 100);

COMMENT ON COLUMN purchase_details.tax_rate IS 'Taux TVA de la ligne d''achat (0 = non soumis / non renseigné). Utilisé pour estimation TVA déductible.';

-- Index utile pour agrégations fiscales
CREATE INDEX IF NOT EXISTS purchase_details_tax_idx
  ON purchase_details (purchase_id)
  WHERE tax_rate > 0;

COMMIT;
