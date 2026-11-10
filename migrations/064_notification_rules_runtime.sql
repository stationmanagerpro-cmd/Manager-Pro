-- Suivi d'exécution des règles de notification : dernière erreur et dernier résultat visibles dans l'interface.
ALTER TABLE notification_rules ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE notification_rules ADD COLUMN IF NOT EXISTS last_result JSONB;
