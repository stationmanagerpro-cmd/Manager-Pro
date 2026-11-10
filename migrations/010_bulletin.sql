-- 010 : Bulletin de paie modernisé (Phase 9)
-- Non destructif. Aucun impact sur les calculs financiers.
-- Ajoute : appréciation indépendante du calcul, mentions, personnalisation via settings.

-- Appréciation / performance (indépendante du moteur de calcul)
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS performance_rating TEXT;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS appreciation TEXT;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS hr_comment TEXT;

COMMENT ON COLUMN payslips.performance_rating IS 'Note / niveau de performance (facultatif, hors calcul financier)';
COMMENT ON COLUMN payslips.appreciation IS 'Appréciation qualitative (facultatif, hors calcul financier)';
COMMENT ON COLUMN payslips.hr_comment IS 'Commentaire RH libre (facultatif, hors calcul financier)';

-- Index utile pour listes mensuelles multi-station déjà partiellement couvert
CREATE INDEX IF NOT EXISTS payslips_station_status ON payslips(station_id, status);
