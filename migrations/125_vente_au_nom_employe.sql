-- 125 : Vente au nom d'un employé par scan QR (Station Manager PRO).
-- Additive et idempotente : aucune donnée existante n'est modifiée ni supprimée.
--  * permissions : « sale.record_for_employee » (groupe « sale ») ; accordée par défaut au seul rôle ADMIN
--    (administrateur local du compte client). Il peut ensuite la donner ou la retirer à ses rôles d'employés.
--  * qr_scans : mémorise l'utilisateur qui a fait le scan lorsque la vente est faite au nom d'un autre employé.
INSERT INTO permissions (code, label)
SELECT 'sale.record_for_employee', 'Enregistrer une vente au nom d''un employé (scan QR)'
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'sale.record_for_employee');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'ADMIN' AND p.code = 'sale.record_for_employee'
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id);

ALTER TABLE qr_scans ADD COLUMN IF NOT EXISTS delegated_by_user_id BIGINT REFERENCES users(id);
