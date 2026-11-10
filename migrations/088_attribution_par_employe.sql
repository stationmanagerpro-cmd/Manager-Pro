-- Rattachement par employé (quart partagé par 2 ou 3 personnes) :
-- chaque anomalie déclarée et chaque écart appartient à l'employé qui en est à l'origine.

-- 1. Une anomalie peut être rattachée à un employé (NULL = anomalie commune à tout le quart)
ALTER TABLE shift_anomalies
  ADD COLUMN IF NOT EXISTS employee_id BIGINT REFERENCES employees(id);
CREATE INDEX IF NOT EXISTS idx_shift_anomalies_emp
  ON shift_anomalies(employee_id) WHERE employee_id IS NOT NULL;

-- 2. Un écart peut provenir d'une anomalie déclarée avec un montant (type 'anomalie')
ALTER TABLE employee_gaps
  ADD COLUMN IF NOT EXISTS anomaly_id BIGINT REFERENCES shift_anomalies(id);
ALTER TABLE employee_gaps DROP CONSTRAINT IF EXISTS employee_gaps_kind_check;
ALTER TABLE employee_gaps
  ADD CONSTRAINT employee_gaps_kind_check CHECK (kind IN ('caisse','stock','anomalie'));
CREATE INDEX IF NOT EXISTS idx_employee_gaps_anomaly
  ON employee_gaps(anomaly_id) WHERE anomaly_id IS NOT NULL;
