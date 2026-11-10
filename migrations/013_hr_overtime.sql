-- 013 Heures supplémentaires — workflow sécurisé (JAMAIS d'impact paie automatique)
CREATE TABLE IF NOT EXISTS hr_overtime (
  id BIGSERIAL PRIMARY KEY,
  station_id BIGINT NOT NULL REFERENCES stations(id),
  employee_id BIGINT NOT NULL REFERENCES employees(id),
  work_date DATE NOT NULL,
  hours NUMERIC(6,2) NOT NULL CHECK (hours > 0 AND hours <= 24),
  rate_multiplier NUMERIC(4,2) NOT NULL DEFAULT 1.5, -- informatif / simulation
  amount_estimate NUMERIC(14,2), -- estimation hors paie réelle
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'propose'
    CHECK (status IN ('propose','valide_responsable','approuve_rh','refuse','annule')),
  proposed_by BIGINT REFERENCES users(id),
  validated_by BIGINT REFERENCES users(id),
  validated_at TIMESTAMPTZ,
  approved_by BIGINT REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  decision_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hr_overtime_emp ON hr_overtime (employee_id, work_date);
CREATE INDEX IF NOT EXISTS hr_overtime_status ON hr_overtime (station_id, status);

INSERT INTO permissions (code, label) VALUES
  ('hr.overtime.view', 'Voir heures supplémentaires'),
  ('hr.overtime.propose', 'Proposer heures supplémentaires'),
  ('hr.overtime.validate', 'Valider heures (responsable)'),
  ('hr.overtime.approve', 'Approuver heures (RH)')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'ADMIN' AND p.code LIKE 'hr.overtime.%'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'GERANT' AND p.code IN ('hr.overtime.view','hr.overtime.propose','hr.overtime.validate')
ON CONFLICT DO NOTHING;

COMMENT ON TABLE hr_overtime IS 'HS : propose → valide_responsable → approuve_rh. Disponible en SIMULATION de paie uniquement. Jamais d écriture financière automatique.';
