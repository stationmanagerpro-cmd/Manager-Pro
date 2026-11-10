-- Seed CFE / TFP (placeholders a_verifier)
BEGIN;
INSERT INTO fiscal_rules (
  tax_code, rule_key, rule_value, conditions, regime,
  effective_from, legal_source, version, verification_status, notes
) VALUES
(
  'cfe', 'rate',
  '{"rate": 0, "label": "Taux CFE à confirmer"}'::jsonb,
  '{}'::jsonb, NULL, '2020-01-01',
  'À vérifier — Contribution forfaitaire employeurs (textes maliens)',
  1, 'a_verifier',
  'Placeholder. Confirmer le barème légal avant usage.'
),
(
  'tfp', 'rate',
  '{"rate": 0, "label": "Taux TFP à confirmer"}'::jsonb,
  '{}'::jsonb, NULL, '2020-01-01',
  'À vérifier — Taxe de formation professionnelle (textes maliens)',
  1, 'a_verifier',
  'Placeholder. Confirmer le barème légal avant usage.'
)
ON CONFLICT (tax_code, rule_key, version) DO NOTHING;
COMMIT;
