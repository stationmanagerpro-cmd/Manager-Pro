-- 003 : RH et paie, dettes/avances des employés, images, moyens de paiement, comptes bancaires et mobile money,
--       ventes carburant déclarées, grand livre clients, validations de rapports. Compatible avec les données existantes.

-- ---------- Employés : fiche enrichie, historique, affectation aux pompes ----------
ALTER TABLE employees ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS base_salary NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS contract_type TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS contract_start DATE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS contract_end DATE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS photo_path TEXT;
ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_status_check;
ALTER TABLE employees ADD CONSTRAINT employees_status_check CHECK (status IN ('actif','suspendu','inactif'));
ALTER TABLE stations  ADD COLUMN IF NOT EXISTS photo_path TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS photo_path TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS photo_path TEXT;
ALTER TABLE shift_employees ADD COLUMN IF NOT EXISTS pump_id BIGINT REFERENCES pumps(id);

CREATE TABLE IF NOT EXISTS employee_history (
  id BIGSERIAL PRIMARY KEY, employee_id BIGINT NOT NULL REFERENCES employees(id),
  field TEXT NOT NULL, old_value TEXT, new_value TEXT,
  changed_by BIGINT REFERENCES users(id), changed_at TIMESTAMPTZ NOT NULL DEFAULT now());

-- ---------- Écarts attribuables aux employés (jamais de retenue automatique) ----------
CREATE TABLE IF NOT EXISTS employee_gaps (
  id BIGSERIAL PRIMARY KEY, station_id BIGINT NOT NULL REFERENCES stations(id), shift_id BIGINT NOT NULL REFERENCES shifts(id),
  employee_id BIGINT REFERENCES employees(id),                       -- NULL tant que le gérant n'a pas attribué l'écart
  kind TEXT NOT NULL CHECK (kind IN ('caisse','stock')), product_id BIGINT REFERENCES products(id),
  amount NUMERIC(14,3) NOT NULL, employee_justification TEXT, manager_decision TEXT,
  status TEXT NOT NULL DEFAULT 'en_attente' CHECK (status IN ('en_attente','accepte','conteste','regularise','cloture')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS employee_gap_events (
  id BIGSERIAL PRIMARY KEY, gap_id BIGINT NOT NULL REFERENCES employee_gaps(id), action TEXT NOT NULL, note TEXT,
  from_status TEXT, to_status TEXT, user_id BIGINT REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now());

-- ---------- Dettes et avances des employés ----------
CREATE TABLE IF NOT EXISTS employee_debts (
  id BIGSERIAL PRIMARY KEY, station_id BIGINT NOT NULL REFERENCES stations(id), employee_id BIGINT NOT NULL REFERENCES employees(id),
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0), debt_date DATE NOT NULL DEFAULT CURRENT_DATE, reason TEXT NOT NULL,
  method TEXT, cash_out BOOLEAN NOT NULL DEFAULT FALSE,              -- TRUE : l'argent est sorti de la caisse (prêt)
  status TEXT NOT NULL DEFAULT 'en_cours' CHECK (status IN ('en_cours','solde','conteste','annule')),
  attachment_path TEXT, gap_id BIGINT REFERENCES employee_gaps(id), cancel_reason TEXT,
  created_by BIGINT REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS employee_debt_edits (
  id BIGSERIAL PRIMARY KEY, debt_id BIGINT NOT NULL REFERENCES employee_debts(id), reason TEXT NOT NULL,
  old_value JSONB, new_value JSONB, changed_by BIGINT REFERENCES users(id), changed_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS salary_advances (
  id BIGSERIAL PRIMARY KEY, station_id BIGINT NOT NULL REFERENCES stations(id), employee_id BIGINT NOT NULL REFERENCES employees(id),
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0), advance_date DATE NOT NULL DEFAULT CURRENT_DATE, method TEXT NOT NULL,
  pay_month DATE NOT NULL, reason TEXT, reference TEXT, deducted NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (deducted >= 0),
  status TEXT NOT NULL DEFAULT 'en_cours' CHECK (status IN ('en_cours','solde','annule')),
  created_by BIGINT REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now());

-- ---------- Paie ----------
CREATE TABLE IF NOT EXISTS payroll_adjustments (
  id BIGSERIAL PRIMARY KEY, station_id BIGINT NOT NULL REFERENCES stations(id), employee_id BIGINT NOT NULL REFERENCES employees(id),
  month DATE NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('prime','indemnite','autre_gain','retenue')), label TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0), created_by BIGINT REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS payslips (
  id BIGSERIAL PRIMARY KEY, station_id BIGINT NOT NULL REFERENCES stations(id), employee_id BIGINT NOT NULL REFERENCES employees(id),
  month DATE NOT NULL, number TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'brouillon' CHECK (status IN ('brouillon','valide','paye')),
  base_salary NUMERIC(14,2) NOT NULL DEFAULT 0, bonuses NUMERIC(14,2) NOT NULL DEFAULT 0, allowances NUMERIC(14,2) NOT NULL DEFAULT 0,
  gross NUMERIC(14,2) NOT NULL DEFAULT 0, other_deductions NUMERIC(14,2) NOT NULL DEFAULT 0, advances_deducted NUMERIC(14,2) NOT NULL DEFAULT 0,
  debts_deducted NUMERIC(14,2) NOT NULL DEFAULT 0, total_deductions NUMERIC(14,2) NOT NULL DEFAULT 0, net_pay NUMERIC(14,2) NOT NULL DEFAULT 0,
  debt_remaining NUMERIC(14,2) NOT NULL DEFAULT 0,
  debt_mode TEXT NOT NULL DEFAULT 'none' CHECK (debt_mode IN ('none','all','partial')), debt_requested NUMERIC(14,2),
  snapshot JSONB, rectifies_id BIGINT REFERENCES payslips(id), rectify_reason TEXT,
  validated_by BIGINT REFERENCES users(id), validated_at TIMESTAMPTZ, paid_by BIGINT REFERENCES users(id), paid_at TIMESTAMPTZ, paid_method TEXT,
  created_by BIGINT REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now());
-- Un seul bulletin actif par employé et par mois (les rectifications sont des bulletins complémentaires)
CREATE UNIQUE INDEX IF NOT EXISTS payslip_active ON payslips(employee_id, month) WHERE rectifies_id IS NULL;
CREATE TABLE IF NOT EXISTS employee_debt_payments (
  id BIGSERIAL PRIMARY KEY, debt_id BIGINT NOT NULL REFERENCES employee_debts(id), amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'direct' CHECK (source IN ('direct','salaire')),
  payslip_id BIGINT REFERENCES payslips(id), receipt_no TEXT UNIQUE, note TEXT,
  paid_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by BIGINT REFERENCES users(id));
CREATE TABLE IF NOT EXISTS payslip_advance_lines (
  payslip_id BIGINT NOT NULL REFERENCES payslips(id), advance_id BIGINT NOT NULL REFERENCES salary_advances(id), amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  PRIMARY KEY (payslip_id, advance_id));

-- ---------- Moyens de paiement, comptes bancaires et mobile money ----------
CREATE TABLE IF NOT EXISTS money_accounts (
  id BIGSERIAL PRIMARY KEY, station_id BIGINT NOT NULL REFERENCES stations(id), kind TEXT NOT NULL CHECK (kind IN ('banque','mobile_money')),
  name TEXT NOT NULL, provider TEXT, account_ref TEXT, opening_balance NUMERIC(14,2) NOT NULL DEFAULT 0, opening_date DATE NOT NULL DEFAULT CURRENT_DATE,
  active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS payment_methods (
  station_id BIGINT NOT NULL REFERENCES stations(id), code TEXT NOT NULL, label TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('especes','banque','mobile_money','carte','credit','autre')),
  account_id BIGINT REFERENCES money_accounts(id), active BOOLEAN NOT NULL DEFAULT TRUE, PRIMARY KEY (station_id, code));
CREATE TABLE IF NOT EXISTS money_movements (
  id BIGSERIAL PRIMARY KEY, account_id BIGINT NOT NULL REFERENCES money_accounts(id), station_id BIGINT NOT NULL REFERENCES stations(id),
  kind TEXT NOT NULL CHECK (kind IN ('encaissement','depot','virement_recu','virement_emis','frais','retrait','remboursement','transfert_entrant','transfert_sortant','autre')),
  amount NUMERIC(14,2) NOT NULL, label TEXT, reference TEXT, moved_on DATE NOT NULL DEFAULT CURRENT_DATE,
  shift_id BIGINT REFERENCES shifts(id), ref_table TEXT, ref_id BIGINT, created_by BIGINT REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS money_mv_account ON money_movements(account_id, moved_on);
CREATE TABLE IF NOT EXISTS bank_statements (
  id BIGSERIAL PRIMARY KEY, account_id BIGINT NOT NULL REFERENCES money_accounts(id), statement_date DATE NOT NULL,
  balance NUMERIC(14,2) NOT NULL, note TEXT, created_by BIGINT REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now());
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_method_check;     -- les moyens de paiement sont désormais configurables
INSERT INTO payment_methods(station_id, code, label, kind)
  SELECT s.id, m.code, m.label, m.kind FROM stations s,
  (VALUES ('especes','Espèces','especes'),('mobile_money','Mobile Money','mobile_money'),('orange_money','Orange Money','mobile_money'),
          ('wave','Wave','mobile_money'),('carte','Carte bancaire','carte'),('banque','Virement / banque','banque'),
          ('credit','Crédit client','credit'),('autre','Autre','autre')) AS m(code, label, kind)
  ON CONFLICT DO NOTHING;

-- ---------- Grand livre clients (source de vérité de l'historique des créances) ----------
CREATE TABLE IF NOT EXISTS customer_ledger (
  id BIGSERIAL PRIMARY KEY, customer_id BIGINT NOT NULL REFERENCES customers(id), station_id BIGINT NOT NULL REFERENCES stations(id),
  kind TEXT NOT NULL CHECK (kind IN ('solde_initial','credit','paiement','annulation')), amount NUMERIC(14,2) NOT NULL,  -- + : le client doit davantage
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(), ref_table TEXT, ref_id BIGINT, created_by BIGINT REFERENCES users(id));
CREATE INDEX IF NOT EXISTS ledger_customer ON customer_ledger(customer_id, occurred_at);
INSERT INTO customer_ledger(customer_id, station_id, kind, amount, occurred_at)
  SELECT c.id, c.station_id, 'solde_initial', c.balance, now() FROM customers c
   WHERE c.balance <> 0 AND NOT EXISTS (SELECT 1 FROM customer_ledger l WHERE l.customer_id = c.id);

-- ---------- Ventes carburant déclarées (saisie par index, litres ou montant) ----------
ALTER TABLE sales ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'produits';
ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_kind_check;
ALTER TABLE sales ADD CONSTRAINT sales_kind_check CHECK (kind IN ('produits','carburant'));
ALTER TABLE sales ADD COLUMN IF NOT EXISTS input_mode TEXT;
ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_input_mode_check;
ALTER TABLE sales ADD CONSTRAINT sales_input_mode_check CHECK (input_mode IS NULL OR input_mode IN ('index','litres','montant'));
ALTER TABLE sale_details ADD COLUMN IF NOT EXISTS counter_id BIGINT REFERENCES pump_counters(id);
ALTER TABLE sale_details ADD COLUMN IF NOT EXISTS index_old NUMERIC(14,3);
ALTER TABLE sale_details ADD COLUMN IF NOT EXISTS index_new NUMERIC(14,3);
ALTER TABLE meter_readings ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(14,2);   -- coût d'achat figé à la clôture (marge)

-- ---------- Validations / signatures électroniques de rapports ----------
CREATE TABLE IF NOT EXISTS report_validations (
  id BIGSERIAL PRIMARY KEY, station_id BIGINT NOT NULL REFERENCES stations(id), report_key TEXT NOT NULL,
  period_from DATE, period_to DATE, role_label TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('prepare','verifie','approuve','conteste')), user_id BIGINT NOT NULL REFERENCES users(id),
  comment TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now());

-- ---------- Permissions ----------
INSERT INTO permissions (code, label) VALUES
 ('hr.view','Consulter les fiches RH'),('hr.manage','Administrer les fiches, salaires et règles RH'),
 ('hr.debts','Gérer dettes et avances des employés'),('hr.gaps','Attribuer et décider les écarts'),
 ('hr.payroll','Préparer, valider et payer la paie'),('finance.report','Rapports financiers et comptables'),
 ('money.manage','Gérer banques, mobile money et moyens de paiement'),
 ('appearance.manage','Thème, identité et pied de page'),('image.manage','Ajouter ou supprimer les photos')
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions SELECT r.id, p.id FROM roles r, permissions p
 WHERE r.code = 'ADMIN' AND p.code IN ('hr.view','hr.manage','hr.debts','hr.gaps','hr.payroll','finance.report','money.manage','appearance.manage','image.manage') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions SELECT r.id, p.id FROM roles r, permissions p
 WHERE r.code = 'GERANT' AND p.code IN ('hr.view','hr.debts','hr.gaps','hr.payroll','finance.report','money.manage') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions SELECT r.id, p.id FROM roles r, permissions p
 WHERE r.code = 'COMPTABLE' AND p.code IN ('finance.report') ON CONFLICT DO NOTHING;
