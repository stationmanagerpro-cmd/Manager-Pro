-- Migration 047 : Règles fiscales de démonstration (statut a_verifier)
-- Ne jamais présenter ces taux comme officiels tant que verification_status != 'verifiee'.
-- L'Administrateur Principal doit vérifier et confirmer les textes maliens applicables.

BEGIN;

INSERT INTO fiscal_rules (
  tax_code, rule_key, rule_value, conditions, regime,
  effective_from, legal_source, legal_reference, version, verification_status, notes
) VALUES
(
  'tva', 'standard_rate',
  '{"rate": 18, "label": "Taux standard indicatif"}'::jsonb,
  '{}'::jsonb, NULL,
  '2020-01-01',
  'À vérifier — Code général des impôts / textes maliens en vigueur',
  NULL, 1, 'a_verifier',
  'Taux placeholder. Ne pas utiliser pour une estimation « fiable » tant que non vérifié.'
),
(
  'ibic', 'rate',
  '{"rate": 30, "label": "Taux indicatif IBIC"}'::jsonb,
  '{}'::jsonb, 'reel',
  '2020-01-01',
  'À vérifier — textes maliens IBIC',
  NULL, 1, 'a_verifier',
  'Placeholder. Confirmer le taux et les conditions avant usage.'
),
(
  'is', 'rate',
  '{"rate": 30, "label": "Taux indicatif IS"}'::jsonb,
  '{}'::jsonb, 'IS',
  '2020-01-01',
  'À vérifier — textes maliens IS',
  NULL, 1, 'a_verifier',
  'Placeholder. Confirmer le taux et les conditions avant usage.'
),
(
  'synthetique', 'rate_or_amount',
  '{"rate": 3, "label": "Taux indicatif synthétique"}'::jsonb,
  '{}'::jsonb, 'synthetique',
  '2020-01-01',
  'À vérifier — régime de l’impôt synthétique',
  NULL, 1, 'a_verifier',
  'Placeholder. Le barème réel peut être forfaitaire ou progressif selon le texte.'
)
ON CONFLICT (tax_code, rule_key, version) DO NOTHING;

COMMIT;
