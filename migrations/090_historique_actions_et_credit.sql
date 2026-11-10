-- Historique des actions faites AU NOM d'un employé (transparence) : l'employé les voit dans son profil, est prévenu dans sa
-- messagerie et peut les rejeter. Un rejet ne supprime rien : l'action reste, avec la mention du rejet et de son motif.
CREATE TABLE IF NOT EXISTS employee_actions (
  id            BIGSERIAL PRIMARY KEY,
  station_id    BIGINT NOT NULL REFERENCES stations(id),
  employee_id   BIGINT NOT NULL REFERENCES employees(id),
  kind          TEXT NOT NULL CHECK (kind IN ('vente','dette_client','ecart','anomalie','decision_ecart','dette_employe','role','autre')),
  description   TEXT NOT NULL,
  amount        NUMERIC(14,2),
  ref_table     TEXT,
  ref_id        BIGINT,
  performed_by  BIGINT REFERENCES users(id),
  self_made     BOOLEAN NOT NULL DEFAULT FALSE,      -- fait par l'employé lui-même (journalisé, non notifié, non rejetable)
  notified_at   TIMESTAMPTZ,
  status        TEXT NOT NULL DEFAULT 'actif' CHECK (status IN ('actif','rejete')),
  rejected_at   TIMESTAMPTZ,
  rejected_reason TEXT,
  review_note   TEXT,                                -- réponse du gérant / de l'administrateur à un rejet
  reviewed_by   BIGINT REFERENCES users(id),
  reviewed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_employee_actions_emp ON employee_actions (employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_employee_actions_rejected ON employee_actions (station_id) WHERE status = 'rejete';
-- une même vente / dette / écart / anomalie n'est journalisée qu'une fois pour un employé
CREATE UNIQUE INDEX IF NOT EXISTS uq_employee_actions_ref ON employee_actions (employee_id, kind, ref_table, ref_id)
  WHERE ref_id IS NOT NULL AND kind IN ('vente','dette_client','ecart','anomalie');

-- Dette client (vente à crédit) : réservée aux utilisateurs qui en ont la permission (administrateur local, gérant, superviseur,
-- et tout employé à qui elle est accordée par rôle personnalisé ou rôle individuel).
INSERT INTO permissions (code, label) VALUES ('sale.credit', 'Vendre à crédit (enregistrer une dette client)') ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM roles r, permissions p
   WHERE r.code IN ('ADMIN','GERANT','SUPERVISEUR') AND r.client_id IS NULL AND p.code = 'sale.credit'
ON CONFLICT DO NOTHING;
