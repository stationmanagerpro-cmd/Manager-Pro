-- 011 : Audit trail RH / paie avancé (Phase 14)
-- Non destructif. Améliore les index de lecture ; n'altère pas audit_logs (append-only).

CREATE INDEX IF NOT EXISTS audit_logs_station_module_created
  ON audit_logs (station_id, module, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_logs_table_record
  ON audit_logs (table_name, record_id)
  WHERE table_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS audit_logs_user_created
  ON audit_logs (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

COMMENT ON TABLE audit_logs IS 'Journal append-only. Modules RH/paie : rh, paie. Aucune modification ni suppression autorisée (trigger).';
