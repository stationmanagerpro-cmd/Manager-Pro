-- Permission de gestion des commissions + index période + colonne amount_remaining pour règlements partiels

INSERT INTO permissions (code, label) VALUES
  ('commission.manage', 'Gérer les commissions vendeurs (objectifs, primes, règlements)')
ON CONFLICT (code) DO NOTHING;

-- ADMIN : toutes les permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code = 'ADMIN' AND p.code = 'commission.manage'
ON CONFLICT DO NOTHING;

-- GERANT et SUPERVISEUR
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code IN ('GERANT', 'SUPERVISEUR') AND p.code = 'commission.manage'
ON CONFLICT DO NOTHING;

-- Solde restant sur une entrée (règlement partiel des primes / commissions figées)
ALTER TABLE seller_commission_entries
  ADD COLUMN IF NOT EXISTS amount_remaining NUMERIC(14,2);

-- Initialiser le solde restant pour les lignes « du » existantes
UPDATE seller_commission_entries
   SET amount_remaining = amount
 WHERE status = 'du' AND amount_remaining IS NULL;

UPDATE seller_commission_entries
   SET amount_remaining = 0
 WHERE status IN ('regle', 'annule') AND amount_remaining IS NULL;

-- Autoriser kind = commission (figée à la validation de période)
ALTER TABLE seller_commission_entries DROP CONSTRAINT IF EXISTS seller_commission_entries_kind_check;
ALTER TABLE seller_commission_entries ADD CONSTRAINT seller_commission_entries_kind_check
  CHECK (kind IN ('prime', 'reglement', 'ajustement', 'commission'));

CREATE INDEX IF NOT EXISTS idx_seller_comm_entries_period
  ON seller_commission_entries(station_id, employee_id, period_from, period_to);
