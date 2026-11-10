-- 014 Clôture de période de paie (gel des nouveaux bulletins pour un mois)
CREATE TABLE IF NOT EXISTS payroll_periods (
  id BIGSERIAL PRIMARY KEY,
  station_id BIGINT NOT NULL REFERENCES stations(id),
  month DATE NOT NULL, -- premier jour du mois
  status TEXT NOT NULL DEFAULT 'ouvert'
    CHECK (status IN ('ouvert','controle','cloture')),
  closed_by BIGINT REFERENCES users(id),
  closed_at TIMESTAMPTZ,
  reopen_reason TEXT,
  notes TEXT,
  snapshot JSONB, -- résumé au moment de la clôture
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (station_id, month)
);

INSERT INTO permissions (code, label) VALUES
  ('hr.payroll.close', 'Clôturer une période de paie'),
  ('hr.payroll.reopen', 'Rouvrir exceptionnellement une période')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'ADMIN' AND p.code IN ('hr.payroll.close', 'hr.payroll.reopen')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'GERANT' AND p.code = 'hr.payroll.close'
ON CONFLICT DO NOTHING;

COMMENT ON TABLE payroll_periods IS 'Clôture mensuelle : empêche de nouveaux bulletins. Ne recalcule jamais les bulletins existants.';
