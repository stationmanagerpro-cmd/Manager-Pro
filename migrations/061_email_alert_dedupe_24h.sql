-- Anti-doublons e-mail persistants entre redémarrages et instances Render.
CREATE TABLE IF NOT EXISTS email_alert_dedupe (
  fingerprint TEXT PRIMARY KEY,
  last_sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_alert_dedupe_last_sent_idx
  ON email_alert_dedupe (last_sent_at);
-- Nettoyage opportuniste des empreintes anciennes : le service ne dépend pas
-- de ce nettoyage pour autoriser une nouvelle alerte après 24 heures.
