-- ============================================================
-- 025 — Avertissements licence configurables + demandes de renouvellement
-- Migration ADDITIVE / non destructive
-- ============================================================

DO $$
DECLARE
    has_station_id BOOLEAN;
    valid_station_id BIGINT;
BEGIN
    -- Vérifier si station_id existe dans settings
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'settings' AND column_name = 'station_id'
    ) INTO has_station_id;

    IF has_station_id THEN
        -- Récupérer un station_id existant dans la table stations
        SELECT id INTO valid_station_id FROM stations LIMIT 1;

        IF valid_station_id IS NOT NULL THEN
            EXECUTE '
                INSERT INTO settings (station_id, key, value)
                SELECT $1, ''license_warning_thresholds'', ''"30,15,7,3,1"''
                WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = ''license_warning_thresholds'');

                INSERT INTO settings (station_id, key, value)
                SELECT $1, ''license_expired_message'', ''"La licence attribuée à votre compte est arrivée à expiration. L''''accès à cette application est actuellement suspendu. Veuillez contacter l''''administrateur principal afin de renouveler votre licence."''
                WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = ''license_expired_message'');

                INSERT INTO settings (station_id, key, value)
                SELECT $1, ''license_expiring_message'', ''"Votre licence arrive bientôt à expiration. Contactez l''''administrateur principal pour renouveler ou prolonger."''
                WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = ''license_expiring_message'');
            ' USING valid_station_id;
        END IF;
    ELSE
        INSERT INTO settings (key, value)
        SELECT 'license_warning_thresholds', '"30,15,7,3,1"'
        WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = 'license_warning_thresholds');

        INSERT INTO settings (key, value)
        SELECT 'license_expired_message', '"La licence attribuée à votre compte est arrivée à expiration. L''accès à cette application est actuellement suspendu. Veuillez contacter l''administrateur principal afin de renouveler votre licence."'
        WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = 'license_expired_message');

        INSERT INTO settings (key, value)
        SELECT 'license_expiring_message', '"Votre licence arrive bientôt à expiration. Contactez l''administrateur principal pour renouveler ou prolonger."'
        WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = 'license_expiring_message');
    END IF;
END $$;

-- IMPORTANT : cette migration est additive. Ne jamais supprimer les demandes existantes.
-- La migration 020 crée déjà cette table avec une première version du schéma.
CREATE TABLE IF NOT EXISTS license_renewal_requests (
  id BIGSERIAL PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  requested_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'pending',
  message TEXT,
  preferred_duration_unit TEXT,
  preferred_duration_value INT,
  processed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  processed_at TIMESTAMPTZ,
  process_note TEXT,
  handled_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  handled_at TIMESTAMPTZ,
  admin_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Mise à niveau sans perte du schéma créé par la migration 020.
ALTER TABLE license_renewal_requests ADD COLUMN IF NOT EXISTS requested_at TIMESTAMPTZ;
ALTER TABLE license_renewal_requests ADD COLUMN IF NOT EXISTS processed_by BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE license_renewal_requests ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;
ALTER TABLE license_renewal_requests ADD COLUMN IF NOT EXISTS process_note TEXT;
ALTER TABLE license_renewal_requests ADD COLUMN IF NOT EXISTS handled_by BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE license_renewal_requests ADD COLUMN IF NOT EXISTS handled_at TIMESTAMPTZ;
ALTER TABLE license_renewal_requests ADD COLUMN IF NOT EXISTS admin_note TEXT;
ALTER TABLE license_renewal_requests ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE license_renewal_requests ALTER COLUMN requested_at SET DEFAULT now();
UPDATE license_renewal_requests SET requested_at = COALESCE(requested_at, created_at, now()) WHERE requested_at IS NULL;
ALTER TABLE license_renewal_requests ALTER COLUMN requested_at SET NOT NULL;

-- Les versions précédentes n'utilisaient pas toutes les mêmes statuts/colonnes.
-- Retirer uniquement les CHECK qui portent sur status, puis installer une contrainte
-- compatible avec les deux routes encore présentes (accepted et approved).
DO $$
DECLARE constraint_row RECORD;
BEGIN
  FOR constraint_row IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'license_renewal_requests'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE license_renewal_requests DROP CONSTRAINT %I', constraint_row.conname);
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'license_renewal_requests'::regclass
      AND conname = 'license_renewal_requests_status_check'
  ) THEN
    ALTER TABLE license_renewal_requests
      ADD CONSTRAINT license_renewal_requests_status_check
      CHECK (status IN ('pending', 'accepted', 'approved', 'rejected', 'cancelled'));
  END IF;
END $$;

ALTER TABLE license_renewal_requests
  ALTER COLUMN preferred_duration_unit DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_renewal_req_client
ON license_renewal_requests (client_id, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_renewal_req_status
ON license_renewal_requests (status)
WHERE status = 'pending';

COMMENT ON TABLE license_renewal_requests IS
  'Demandes de renouvellement formulées par le client. Historique conservé à travers les migrations.';

CREATE TABLE IF NOT EXISTS license_warning_log (
  id BIGSERIAL PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  threshold_days INT NOT NULL,
  warned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  channel TEXT DEFAULT 'ui',
  UNIQUE (client_id, threshold_days, channel)
);

COMMENT ON TABLE license_warning_log IS
  'Trace des avertissements déjà émis (30/15/7/3/1 j) pour ne pas répéter inutilement.';
