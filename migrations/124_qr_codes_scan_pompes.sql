-- 124 : Scan QR des pompes (Station Manager PRO / Manage Pro).
-- Additive et idempotente : aucune donnée existante n'est modifiée ni supprimée.
--  * qr_codes   : un QR Code par compteur (= point de distribution : pompe + produit), jeton opaque, statut actif / révoqué / remplacé.
--  * qr_scans   : « scan » validé côté serveur (compte, employé, quart, compteur) ; il PRÉPARE une vente, expire et ne sert qu'une fois.
--  * qr_events  : journal des générations, révocations, impressions, scans, refus et ventes ; ajout seul (trigger).
--  * permission qr.manage : générer, imprimer, révoquer, régénérer et consulter l'historique (administrateur local et gérant).
-- Le scan lui-même exige la permission existante sale.create.

CREATE TABLE IF NOT EXISTS qr_codes (
  id              BIGSERIAL PRIMARY KEY,
  station_id      BIGINT NOT NULL REFERENCES stations(id),
  pump_id         BIGINT NOT NULL REFERENCES pumps(id),
  counter_id      BIGINT NOT NULL REFERENCES pump_counters(id),
  token           TEXT NOT NULL UNIQUE CHECK (token ~ '^[A-Za-z0-9_-]{32}$'),
  short_ref       TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked','replaced')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      BIGINT REFERENCES users(id),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at      TIMESTAMPTZ,
  revoked_by      BIGINT REFERENCES users(id),
  revoke_reason   TEXT,
  replaced_by     BIGINT REFERENCES qr_codes(id),
  print_count     INTEGER NOT NULL DEFAULT 0,
  last_printed_at TIMESTAMPTZ
);
-- Un seul QR actif par compteur : la régénération révoque l'ancien dans la même transaction.
CREATE UNIQUE INDEX IF NOT EXISTS uq_qr_codes_active_counter ON qr_codes(counter_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_qr_codes_station ON qr_codes(station_id, status);

CREATE TABLE IF NOT EXISTS qr_scans (
  id               BIGSERIAL PRIMARY KEY,
  qr_code_id       BIGINT NOT NULL REFERENCES qr_codes(id),
  station_id       BIGINT NOT NULL REFERENCES stations(id),
  user_id          BIGINT NOT NULL REFERENCES users(id),
  employee_id      BIGINT NOT NULL REFERENCES employees(id),
  shift_id         BIGINT NOT NULL REFERENCES shifts(id),
  pump_id          BIGINT NOT NULL REFERENCES pumps(id),
  counter_id       BIGINT NOT NULL REFERENCES pump_counters(id),
  product_id       BIGINT NOT NULL REFERENCES products(id),
  scanned_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at       TIMESTAMPTZ NOT NULL,
  consumed_sale_id BIGINT REFERENCES sales(id),
  consumed_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_qr_scans_user ON qr_scans(user_id, scanned_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_qr_scans_sale ON qr_scans(consumed_sale_id) WHERE consumed_sale_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS qr_events (
  id          BIGSERIAL PRIMARY KEY,
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  station_id  BIGINT REFERENCES stations(id),
  user_id     BIGINT REFERENCES users(id),
  event       TEXT NOT NULL CHECK (event IN ('generate','regenerate','revoke','print','scan_ok','scan_refused','sale_ok','sale_refused')),
  result      TEXT NOT NULL CHECK (result IN ('ok','refused')),
  reason_code TEXT,
  qr_code_id  BIGINT,
  short_ref   TEXT,           -- empreinte courte : jamais le jeton complet
  pump_id     BIGINT,
  counter_id  BIGINT,
  product_id  BIGINT,
  shift_id    BIGINT,
  employee_id BIGINT,
  scan_id     BIGINT,
  sale_id     BIGINT,
  detail      JSONB,
  ip_address  TEXT
);
CREATE INDEX IF NOT EXISTS idx_qr_events_station_at ON qr_events(station_id, at DESC);

CREATE OR REPLACE FUNCTION qr_events_append_only() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'qr_events est en ajout seul'; END $$ LANGUAGE plpgsql;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'qr_events_no_update') THEN
    CREATE TRIGGER qr_events_no_update BEFORE UPDATE OR DELETE ON qr_events FOR EACH ROW EXECUTE FUNCTION qr_events_append_only();
  END IF;
END $$;

COMMENT ON TABLE qr_codes  IS 'QR Codes des compteurs de pompes (jeton opaque, un seul actif par compteur).';
COMMENT ON TABLE qr_scans  IS 'Scans validés côté serveur : préparent une vente (une seule), expirent.';
COMMENT ON TABLE qr_events IS 'Journal du scan QR. Ajout seul (trigger) ; ne contient jamais le jeton complet.';

INSERT INTO permissions (code, label) VALUES ('qr.manage', 'Gérer les QR Codes des pompes (générer, imprimer, révoquer, historique)')
  ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM roles r, permissions p
   WHERE r.code IN ('ADMIN','GERANT') AND r.client_id IS NULL AND p.code = 'qr.manage'
ON CONFLICT DO NOTHING;
