-- Profil personnel : journal de traçabilité de TOUTES les actions d'écriture faites par un utilisateur connecté.
-- Complète audit_logs (qui ne couvre que les modules qui l'appellent explicitement) : chaque POST / PUT / PATCH / DELETE réussi
-- est enregistré avec le nom, le matricule et le rôle de l'utilisateur AU MOMENT de l'action (instantané : un changement
-- ultérieur de poste ou de nom ne réécrit jamais l'historique). Jamais de corps de requête (ni mot de passe, ni données saisies).
-- Pas de clés étrangères : l'historique survit à la suppression d'un compte, à une restauration ou à une réinitialisation.
CREATE TABLE IF NOT EXISTS user_activity_log (
  id          BIGSERIAL PRIMARY KEY,
  station_id  BIGINT,
  user_id     BIGINT NOT NULL,
  user_login  TEXT,
  user_name   TEXT,
  matricule   TEXT,
  role_code   TEXT,
  method      TEXT NOT NULL,
  route       TEXT NOT NULL,          -- chemin normalisé, ex. /sales/:id/cancel
  module      TEXT NOT NULL,          -- ex. Ventes, Quarts, Caisse
  label       TEXT NOT NULL,          -- ex. Annulation · Ventes
  record_id   BIGINT,
  status_code SMALLINT,
  ip_address  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ual_user ON user_activity_log (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ual_station ON user_activity_log (station_id, created_at DESC);

-- Ajout seul, comme audit_logs : aucune modification ni suppression possible.
CREATE OR REPLACE FUNCTION user_activity_append_only() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'user_activity_log est en ajout seul'; END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS user_activity_no_change ON user_activity_log;
CREATE TRIGGER user_activity_no_change BEFORE UPDATE OR DELETE ON user_activity_log
  FOR EACH ROW EXECUTE FUNCTION user_activity_append_only();
