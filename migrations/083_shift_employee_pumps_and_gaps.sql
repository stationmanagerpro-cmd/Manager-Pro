-- Multi-pompes par employé sur un quart + écarts rattachés à l'employé

CREATE TABLE IF NOT EXISTS shift_employee_pumps (
  shift_id    BIGINT NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  employee_id BIGINT NOT NULL REFERENCES employees(id),
  pump_id     BIGINT NOT NULL REFERENCES pumps(id),
  PRIMARY KEY (shift_id, employee_id, pump_id)
);

CREATE INDEX IF NOT EXISTS idx_sep_shift ON shift_employee_pumps(shift_id);
CREATE INDEX IF NOT EXISTS idx_sep_emp ON shift_employee_pumps(employee_id);

-- Reprise des affectations mono-pompe existantes
INSERT INTO shift_employee_pumps (shift_id, employee_id, pump_id)
SELECT se.shift_id, se.employee_id, se.pump_id
  FROM shift_employees se
 WHERE se.pump_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Écarts par employé
ALTER TABLE employee_gaps
  ADD COLUMN IF NOT EXISTS employee_id BIGINT REFERENCES employees(id);

CREATE INDEX IF NOT EXISTS idx_employee_gaps_emp
  ON employee_gaps(employee_id) WHERE employee_id IS NOT NULL;
