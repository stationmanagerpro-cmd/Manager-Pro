-- 085 : comptes complémentaires du plan comptable modèle (prêts au personnel, prêts hors exploitation). Idempotent.
INSERT INTO acc_accounts (station_id, code, label)
SELECT NULL::bigint, v.code, v.label FROM (VALUES
  ('4252', 'Prêts et dettes à recouvrer sur le personnel'),
  ('271', 'Prêts et créances non commerciales (hors exploitation)')
) AS v(code, label)
WHERE NOT EXISTS (SELECT 1 FROM acc_accounts a WHERE a.station_id IS NULL AND a.code = v.code);
