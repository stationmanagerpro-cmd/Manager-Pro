-- 059 : autoriser la suppression de données d'un client pendant une réinitialisation
-- explicitement auditée et limitée à la transaction dédiée du Super Admin.
-- Les INSERT/UPDATE sur un quart clôturé restent interdits, et les DELETE restent
-- interdits hors de cette procédure.
CREATE OR REPLACE FUNCTION forbid_change_on_closed_shift() RETURNS trigger AS $$
DECLARE s TEXT; sid BIGINT;
BEGIN
  sid := COALESCE(NEW.shift_id, OLD.shift_id);
  SELECT status INTO s FROM shifts WHERE id = sid;
  IF s = 'ferme' THEN
    IF TG_OP = 'DELETE'
       AND current_setting('station_manager.audited_client_reset', true) = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Quart % clôturé : modification interdite (correction via procédure auditée)', sid;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$ LANGUAGE plpgsql;
