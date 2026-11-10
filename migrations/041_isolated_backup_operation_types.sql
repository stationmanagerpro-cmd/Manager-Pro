-- 041 : journaliser les sauvegardes/restaurations isolées par client et plateforme.
-- Migration additive, aucune suppression d'historique.
ALTER TABLE backup_logs DROP CONSTRAINT IF EXISTS backup_logs_kind_check;
ALTER TABLE backup_logs ADD CONSTRAINT backup_logs_kind_check
  CHECK (kind IN ('manual','auto','pre_migrate','pre-restore','pre-global-reset',
    'client-backup','client-restore','client-reset','platform-backup','platform-restore'));

-- Les métadonnées existantes restent intactes; scope/client_id sont conservés dans meta JSONB.
CREATE INDEX IF NOT EXISTS backup_logs_meta_scope ON backup_logs ((meta->>'scope'), (meta->>'client_id'), started_at DESC);
