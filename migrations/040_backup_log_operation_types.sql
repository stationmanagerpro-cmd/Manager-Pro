-- 040 : enregistrer aussi les sauvegardes de sécurité précédant une restauration ou réinitialisation.
-- Migration additive : aucun historique existant n'est supprimé.
ALTER TABLE backup_logs DROP CONSTRAINT IF EXISTS backup_logs_kind_check;
ALTER TABLE backup_logs ADD CONSTRAINT backup_logs_kind_check
  CHECK (kind IN ('manual', 'auto', 'pre_migrate', 'pre-restore', 'pre-global-reset'));
