-- 012 RH V2 — Extension professionnelle (sans risque financier par défaut)
-- Non destructif : enrichit employees, ajoute modules optionnels, permissions granulaires.

-- ---------- Enrichissement dossier salarié ----------
ALTER TABLE employees ADD COLUMN IF NOT EXISTS gender TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS birth_date DATE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS birth_place TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency_contact TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency_phone TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS department TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS team TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS manager_id BIGINT REFERENCES employees(id);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS payment_method TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS notes TEXT;

-- ---------- Contrats ----------
CREATE TABLE IF NOT EXISTS hr_contracts (
  id BIGSERIAL PRIMARY KEY,
  station_id BIGINT NOT NULL REFERENCES stations(id),
  employee_id BIGINT NOT NULL REFERENCES employees(id),
  contract_type TEXT NOT NULL DEFAULT 'CDI',
  position TEXT,
  start_date DATE NOT NULL,
  end_date DATE,
  trial_end DATE,
  salary NUMERIC(14,2),
  hours_per_week NUMERIC(6,2),
  status TEXT NOT NULL DEFAULT 'actif' CHECK (status IN ('actif','termine','resilie','brouillon')),
  document_path TEXT,
  notes TEXT,
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hr_contracts_emp ON hr_contracts (employee_id);
CREATE INDEX IF NOT EXISTS hr_contracts_end ON hr_contracts (station_id, end_date) WHERE status = 'actif';

-- ---------- Documents GED RH ----------
CREATE TABLE IF NOT EXISTS hr_documents (
  id BIGSERIAL PRIMARY KEY,
  station_id BIGINT NOT NULL REFERENCES stations(id),
  employee_id BIGINT NOT NULL REFERENCES employees(id),
  category TEXT NOT NULL DEFAULT 'autre',
  title TEXT NOT NULL,
  file_path TEXT,
  issued_on DATE,
  expires_on DATE,
  notes TEXT,
  uploaded_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hr_documents_emp ON hr_documents (employee_id);
CREATE INDEX IF NOT EXISTS hr_documents_exp ON hr_documents (station_id, expires_on);

-- ---------- Équipes / horaires types ----------
CREATE TABLE IF NOT EXISTS hr_teams (
  id BIGSERIAL PRIMARY KEY,
  station_id BIGINT NOT NULL REFERENCES stations(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  start_time TIME,
  end_time TIME,
  active BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (station_id, code)
);

-- ---------- Planning ----------
CREATE TABLE IF NOT EXISTS hr_schedules (
  id BIGSERIAL PRIMARY KEY,
  station_id BIGINT NOT NULL REFERENCES stations(id),
  employee_id BIGINT NOT NULL REFERENCES employees(id),
  team_id BIGINT REFERENCES hr_teams(id),
  work_date DATE NOT NULL,
  start_time TIME,
  end_time TIME,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'planifie' CHECK (status IN ('planifie','confirme','annule')),
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, work_date, start_time)
);
CREATE INDEX IF NOT EXISTS hr_schedules_date ON hr_schedules (station_id, work_date);

-- ---------- Présence / pointage ----------
CREATE TABLE IF NOT EXISTS hr_attendance (
  id BIGSERIAL PRIMARY KEY,
  station_id BIGINT NOT NULL REFERENCES stations(id),
  employee_id BIGINT NOT NULL REFERENCES employees(id),
  work_date DATE NOT NULL,
  time_in TIMESTAMPTZ,
  time_out TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'present'
    CHECK (status IN ('present','absent','retard','conge','maladie','mission','repos','autre')),
  late_minutes INT NOT NULL DEFAULT 0,
  notes TEXT,
  corrected_by BIGINT REFERENCES users(id),
  correction_reason TEXT,
  previous_values JSONB,
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, work_date)
);
CREATE INDEX IF NOT EXISTS hr_attendance_date ON hr_attendance (station_id, work_date);

-- ---------- Congés ----------
CREATE TABLE IF NOT EXISTS hr_leave_types (
  id BIGSERIAL PRIMARY KEY,
  station_id BIGINT REFERENCES stations(id), -- NULL = global
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  paid BOOLEAN NOT NULL DEFAULT true,
  annual_days NUMERIC(6,2) DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (station_id, code)
);

CREATE TABLE IF NOT EXISTS hr_leave_requests (
  id BIGSERIAL PRIMARY KEY,
  station_id BIGINT NOT NULL REFERENCES stations(id),
  employee_id BIGINT NOT NULL REFERENCES employees(id),
  leave_type_id BIGINT REFERENCES hr_leave_types(id),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  days NUMERIC(6,2) NOT NULL DEFAULT 1,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'demande'
    CHECK (status IN ('demande','approuve_responsable','approuve','refuse','annule')),
  decided_by BIGINT REFERENCES users(id),
  decided_at TIMESTAMPTZ,
  decision_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hr_leave_emp ON hr_leave_requests (employee_id, status);

-- ---------- Compétences ----------
CREATE TABLE IF NOT EXISTS hr_skills (
  id BIGSERIAL PRIMARY KEY,
  station_id BIGINT REFERENCES stations(id),
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (station_id, code)
);

CREATE TABLE IF NOT EXISTS hr_employee_skills (
  id BIGSERIAL PRIMARY KEY,
  station_id BIGINT NOT NULL REFERENCES stations(id),
  employee_id BIGINT NOT NULL REFERENCES employees(id),
  skill_id BIGINT NOT NULL REFERENCES hr_skills(id),
  level TEXT NOT NULL DEFAULT 'debutant'
    CHECK (level IN ('debutant','intermediaire','confirme','expert')),
  evaluated_on DATE,
  evaluator_id BIGINT REFERENCES users(id),
  comment TEXT,
  UNIQUE (employee_id, skill_id)
);

-- ---------- Formations ----------
CREATE TABLE IF NOT EXISTS hr_trainings (
  id BIGSERIAL PRIMARY KEY,
  station_id BIGINT NOT NULL REFERENCES stations(id),
  title TEXT NOT NULL,
  organism TEXT,
  trainer TEXT,
  start_date DATE,
  end_date DATE,
  duration_hours NUMERIC(8,2),
  cost_info NUMERIC(14,2), -- informatif uniquement, JAMAIS d'écriture financière auto
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hr_training_participants (
  id BIGSERIAL PRIMARY KEY,
  training_id BIGINT NOT NULL REFERENCES hr_trainings(id) ON DELETE CASCADE,
  employee_id BIGINT NOT NULL REFERENCES employees(id),
  result TEXT,
  certificate_path TEXT,
  expires_on DATE,
  UNIQUE (training_id, employee_id)
);

-- ---------- Évaluations ----------
CREATE TABLE IF NOT EXISTS hr_evaluation_templates (
  id BIGSERIAL PRIMARY KEY,
  station_id BIGINT REFERENCES stations(id),
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  criteria JSONB NOT NULL DEFAULT '[]', -- [{code,label,max}]
  active BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (station_id, code)
);

CREATE TABLE IF NOT EXISTS hr_evaluations (
  id BIGSERIAL PRIMARY KEY,
  station_id BIGINT NOT NULL REFERENCES stations(id),
  employee_id BIGINT NOT NULL REFERENCES employees(id),
  template_id BIGINT REFERENCES hr_evaluation_templates(id),
  period_label TEXT,
  scores JSONB NOT NULL DEFAULT '{}',
  overall_score NUMERIC(6,2),
  comment TEXT,
  status TEXT NOT NULL DEFAULT 'brouillon' CHECK (status IN ('brouillon','soumis','approuve')),
  evaluator_id BIGINT REFERENCES users(id),
  evaluated_on DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Sanctions / récompenses ----------
CREATE TABLE IF NOT EXISTS hr_disciplinary (
  id BIGSERIAL PRIMARY KEY,
  station_id BIGINT NOT NULL REFERENCES stations(id),
  employee_id BIGINT NOT NULL REFERENCES employees(id),
  kind TEXT NOT NULL CHECK (kind IN ('sanction','recompense')),
  type_label TEXT NOT NULL,
  occurred_on DATE NOT NULL DEFAULT CURRENT_DATE,
  description TEXT,
  -- JAMAIS de lien automatique paie
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Alertes RH ----------
CREATE TABLE IF NOT EXISTS hr_alerts (
  id BIGSERIAL PRIMARY KEY,
  station_id BIGINT NOT NULL REFERENCES stations(id),
  employee_id BIGINT REFERENCES employees(id),
  level TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info','warning','critical')),
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','dismissed')),
  due_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolved_by BIGINT REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS hr_alerts_open ON hr_alerts (station_id, status) WHERE status = 'open';

-- ---------- Historique envoi bulletins e-mail ----------
CREATE TABLE IF NOT EXISTS payslip_email_log (
  id BIGSERIAL PRIMARY KEY,
  station_id BIGINT NOT NULL REFERENCES stations(id),
  payslip_id BIGINT NOT NULL REFERENCES payslips(id),
  employee_id BIGINT NOT NULL REFERENCES employees(id),
  recipient TEXT NOT NULL,
  subject TEXT,
  status TEXT NOT NULL CHECK (status IN ('sent','failed','simulated')),
  error_message TEXT,
  sent_by BIGINT REFERENCES users(id),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Modules RH activables (local, pas d'abonnement) ----------
-- Clé settings: hr_modules (JSONB). Defaults injectés côté app si absent.

-- ---------- Permissions granulaires RH V2 ----------
INSERT INTO permissions (code, label) VALUES
  ('hr.employee.view', 'Voir dossiers salariés'),
  ('hr.employee.create', 'Créer salariés'),
  ('hr.employee.edit', 'Modifier salariés'),
  ('hr.employee.documents', 'Documents RH'),
  ('hr.schedule.view', 'Voir planning'),
  ('hr.schedule.manage', 'Gérer planning'),
  ('hr.attendance.view', 'Voir présences'),
  ('hr.attendance.manage', 'Saisir présences'),
  ('hr.attendance.correct', 'Corriger présences'),
  ('hr.leave.view', 'Voir congés'),
  ('hr.leave.request', 'Demander congé'),
  ('hr.leave.approve', 'Approuver congés'),
  ('hr.leave.manage', 'Gérer types de congés'),
  ('hr.skills.view', 'Voir compétences'),
  ('hr.skills.manage', 'Gérer compétences'),
  ('hr.training.view', 'Voir formations'),
  ('hr.training.manage', 'Gérer formations'),
  ('hr.evaluation.view', 'Voir évaluations'),
  ('hr.evaluation.manage', 'Gérer évaluations'),
  ('hr.documents.view', 'Voir documents RH'),
  ('hr.documents.upload', 'Uploader documents RH'),
  ('hr.payroll.email', 'Envoyer bulletins par e-mail'),
  ('hr.payroll.control', 'Contrôle de paie'),
  ('hr.settings', 'Paramètres RH')
ON CONFLICT (code) DO NOTHING;

-- Admin reçoit toutes les nouvelles permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'ADMIN' AND p.code LIKE 'hr.%'
ON CONFLICT DO NOTHING;

-- Gérant : lecture + planning/présence/congés/contrôle (pas paramètres)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'GERANT' AND p.code IN (
  'hr.employee.view','hr.employee.edit','hr.employee.documents',
  'hr.schedule.view','hr.schedule.manage',
  'hr.attendance.view','hr.attendance.manage','hr.attendance.correct',
  'hr.leave.view','hr.leave.approve','hr.leave.manage',
  'hr.skills.view','hr.training.view','hr.evaluation.view',
  'hr.documents.view','hr.documents.upload',
  'hr.payroll.email','hr.payroll.control'
)
ON CONFLICT DO NOTHING;

-- Types de congés par défaut (global)
INSERT INTO hr_leave_types (station_id, code, label, paid, annual_days)
SELECT NULL, x.code, x.label, x.paid, x.days FROM (VALUES
  ('CP', 'Congés payés', true, 30),
  ('MAL', 'Maladie', true, 0),
  ('SANS', 'Sans solde', false, 0),
  ('MAT', 'Maternité', true, 0),
  ('AUTRE', 'Autre', false, 0)
) AS x(code, label, paid, days)
WHERE NOT EXISTS (SELECT 1 FROM hr_leave_types t WHERE t.station_id IS NULL AND t.code = x.code);

-- Compétences types
INSERT INTO hr_skills (station_id, code, label)
SELECT NULL, x.code, x.label FROM (VALUES
  ('CAISSE', 'Caisse'),
  ('CARBURANT', 'Gestion carburant'),
  ('SECURITE', 'Sécurité'),
  ('STOCK', 'Gestion stock'),
  ('ACCUEIL', 'Accueil client'),
  ('SUPERVISION', 'Supervision'),
  ('MAINTENANCE', 'Maintenance'),
  ('SECOURS', 'Premiers secours')
) AS x(code, label)
WHERE NOT EXISTS (SELECT 1 FROM hr_skills s WHERE s.station_id IS NULL AND s.code = x.code);

-- Template évaluation annuelle
INSERT INTO hr_evaluation_templates (station_id, code, label, criteria)
SELECT NULL, 'ANNUELLE', 'Évaluation annuelle',
  '[{"code":"ponctualite","label":"Ponctualité","max":5},{"code":"presence","label":"Présence","max":5},{"code":"qualite","label":"Qualité du travail","max":5},{"code":"securite","label":"Sécurité","max":5},{"code":"client","label":"Relation client","max":5},{"code":"equipe","label":"Esprit d''équipe","max":5}]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM hr_evaluation_templates WHERE station_id IS NULL AND code = 'ANNUELLE');
