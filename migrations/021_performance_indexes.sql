-- 021 Performance indexes — non destructive
-- Accélère listes RH, paie, ventes, quarts, audit, caisse

-- Employés
CREATE INDEX IF NOT EXISTS employees_station_status
ON employees (station_id, status)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS employees_station_name
ON employees (station_id, last_name, first_name)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS employees_matricule
ON employees (station_id, matricule)
WHERE deleted_at IS NULL;

-- Bulletins de paie
CREATE INDEX IF NOT EXISTS payroll_slips_emp_month
ON payslips (employee_id, month);

CREATE INDEX IF NOT EXISTS payroll_slips_station_month
ON payslips (station_id, month);

CREATE INDEX IF NOT EXISTS payroll_slips_status
ON payslips (station_id, status);

-- Dettes / avances
CREATE INDEX IF NOT EXISTS employee_debts_emp_status
ON employee_debts (employee_id, status);

CREATE INDEX IF NOT EXISTS employee_advances_emp
ON salary_advances (employee_id, advance_date DESC);

-- Écarts
CREATE INDEX IF NOT EXISTS gaps_station_status
ON employee_gaps (station_id, status)
WHERE status IN ('en_attente', 'attribue');

CREATE INDEX IF NOT EXISTS gaps_employee
ON employee_gaps (employee_id)
WHERE employee_id IS NOT NULL;

-- Ventes / opérations
CREATE INDEX IF NOT EXISTS sales_station_sold_at
ON sales (station_id, sold_at DESC);

CREATE INDEX IF NOT EXISTS sales_shift
ON sales (shift_id);

-- Quarts
CREATE INDEX IF NOT EXISTS shifts_station_status
ON shifts (station_id, status);

CREATE INDEX IF NOT EXISTS shifts_station_opened
ON shifts (station_id, opened_at DESC);

-- Caisse
CREATE INDEX IF NOT EXISTS cash_movements_register_created
ON cash_movements (cash_register_id, created_at DESC);

CREATE INDEX IF NOT EXISTS cash_movements_shift
ON cash_movements (shift_id)
WHERE shift_id IS NOT NULL;

-- Stock
CREATE INDEX IF NOT EXISTS stock_movements_station_created
ON stock_movements (station_id, created_at DESC);

CREATE INDEX IF NOT EXISTS stock_station_product
ON stock (station_id, product_id);

-- Sessions / auth
CREATE INDEX IF NOT EXISTS user_sessions_user_active
ON user_sessions (user_id)
WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS users_login
ON users (login)
WHERE deleted_at IS NULL;

-- Audit (complément)
CREATE INDEX IF NOT EXISTS audit_logs_station_created
ON audit_logs (station_id, created_at DESC);

-- Clients / fournisseurs
CREATE INDEX IF NOT EXISTS customers_station_name
ON customers (station_id, name)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS suppliers_station_name
ON suppliers (station_id, name)
WHERE deleted_at IS NULL;