-- 018 Sauvegarde automatique — journal des résultats (Priorité 13)
-- Enregistre chaque tentative (auto ou manuelle) : statut, taille, durée, erreur.
-- Ne simule jamais une réussite : le statut 'ok' n'est écrit qu'après dump réel réussi.

CREATE TABLE IF NOT EXISTS backup_logs (
  id            BIGSERIAL PRIMARY KEY,
  kind          TEXT NOT NULL DEFAULT 'manual'
                CHECK (kind IN ('manual', 'auto', 'pre_migrate')),
  status        TEXT NOT NULL CHECK (status IN ('ok', 'failed', 'running')),
  file_name     TEXT,
  file_size     BIGINT,
  duration_ms   INTEGER,
  error_message TEXT,
  email_sent    BOOLEAN NOT NULL DEFAULT FALSE,
  email_error   TEXT,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ,
  meta          JSONB
);

CREATE INDEX IF NOT EXISTS backup_logs_started ON backup_logs (started_at DESC);
CREATE INDEX IF NOT EXISTS backup_logs_status ON backup_logs (status);

COMMENT ON TABLE backup_logs IS 'Journal réel des sauvegardes P13. status=ok uniquement après pg_dump réussi.';
