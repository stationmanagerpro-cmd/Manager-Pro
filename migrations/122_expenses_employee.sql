-- Dépenses : employé responsable (nullable). NULL = dépense hors employé, au nom de son auteur (justification obligatoire).
-- Additif et idempotent.
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS employee_id BIGINT REFERENCES employees(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS expenses_shift_employee_idx ON expenses (shift_id, employee_id);
