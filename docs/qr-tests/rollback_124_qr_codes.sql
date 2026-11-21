-- RETOUR ARRIÈRE de la migration 124 (scan QR des pompes). À exécuter MANUELLEMENT, jamais par le lanceur de migrations (fichier hors dossier migrations/).
-- Ne touche aucune table existante : seules les 3 tables et la permission ajoutées par 124 disparaissent. Les ventes déjà enregistrées ne sont pas modifiées
-- (aucune colonne n'a été ajoutée à `sales`). ATTENTION : le journal qr_events (audit) est perdu : l'exporter d'abord si nécessaire
--   \copy (SELECT * FROM qr_events) TO 'qr_events_sauvegarde.csv' CSV HEADER
BEGIN;
DROP TABLE IF EXISTS qr_events;
DROP TABLE IF EXISTS qr_scans;
DROP TABLE IF EXISTS qr_codes;
DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE code = 'qr.manage');
DELETE FROM permissions WHERE code = 'qr.manage';
DO $$ BEGIN IF to_regclass('public.schema_migrations') IS NOT NULL THEN DELETE FROM schema_migrations WHERE name IN ('124_qr_codes_scan_pompes.sql', '124_qr_codes_scan_pompes'); END IF; END $$;
COMMIT;
