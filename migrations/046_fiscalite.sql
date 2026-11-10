-- Migration 046 : Module Fiscalité (assistance à la conformité — Mali)
-- Non destructif. Réutilise clients, client_contracts, sales, purchases, expenses, HR.
-- Les calculs sont des ESTIMATIONS. Aucune transmission DGI. Aucune déclaration officielle.
-- Règles versionnées : les historiques conservent la version applicable à leur période.

BEGIN;

-- 1. Profil fiscal du client (une ligne par client)
CREATE TABLE IF NOT EXISTS fiscal_profiles (
  id                    BIGSERIAL PRIMARY KEY,
  client_id             BIGINT NOT NULL UNIQUE REFERENCES clients(id) ON DELETE CASCADE,
  -- Identification
  legal_name            TEXT,
  trade_name            TEXT,
  legal_form            TEXT,                    -- SA, SARL, EI, GIE, etc.
  nif                   TEXT,                    -- Numéro d'identification fiscale
  activity_sector       TEXT,
  main_activity         TEXT,
  secondary_activities  TEXT,
  address               TEXT,
  city                  TEXT,
  tax_center            TEXT,                    -- Centre des impôts de rattachement
  activity_start_date   DATE,
  fiscal_year_start     SMALLINT DEFAULT 1,      -- mois de début d'exercice (1=janvier)
  registration_status   TEXT DEFAULT 'a_completer'
    CHECK (registration_status IN ('a_completer','en_cours','valide','a_verifier')),
  -- Économique (déclaratif, non calculé automatiquement depuis ventes sauf si demandé)
  estimated_annual_ca   NUMERIC(18,2),
  current_year_ca       NUMERIC(18,2),
  has_employees         BOOLEAN DEFAULT FALSE,
  employee_count        INT,
  has_other_establishments BOOLEAN DEFAULT FALSE,
  has_exemption         BOOLEAN DEFAULT FALSE,
  exemption_details     TEXT,
  -- Régime déclaré par le client (à vérifier)
  declared_regime       TEXT,                    -- synthesique, reel_simplifie, reel_normal, IS, etc.
  regime_validated      BOOLEAN DEFAULT FALSE,
  regime_validated_at   TIMESTAMPTZ,
  regime_validated_by   BIGINT REFERENCES users(id),
  -- Meta
  notes                 TEXT,
  last_updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_updated_by       BIGINT REFERENCES users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fiscal_profiles_client_idx ON fiscal_profiles (client_id);

-- 2. Activation des sous-modules fiscaux par client (après autorisation Superadmin)
CREATE TABLE IF NOT EXISTS fiscal_module_activations (
  id              BIGSERIAL PRIMARY KEY,
  client_id       BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  module_code     TEXT NOT NULL,                 -- tva, synthesique, ibic, is, its, cfe, tfp, logement, retenues, autres
  activated       BOOLEAN NOT NULL DEFAULT FALSE,
  activated_at    TIMESTAMPTZ,
  activated_by    BIGINT REFERENCES users(id),
  deactivated_at  TIMESTAMPTZ,
  notes           TEXT,
  UNIQUE (client_id, module_code)
);

CREATE INDEX IF NOT EXISTS fiscal_module_activations_client_idx ON fiscal_module_activations (client_id);

-- 3. Règles fiscales versionnées (paramétrage centralisé)
CREATE TABLE IF NOT EXISTS fiscal_rules (
  id                BIGSERIAL PRIMARY KEY,
  tax_code          TEXT NOT NULL,               -- tva, synthesique, ibic, is, its, cfe, tfp, ...
  rule_key          TEXT NOT NULL,               -- rate, threshold, formula, eligibility, ...
  rule_value        JSONB NOT NULL DEFAULT '{}'::jsonb,
  conditions        JSONB DEFAULT '{}'::jsonb,
  regime            TEXT,                        -- applicable regime(s)
  effective_from    DATE NOT NULL,
  effective_to      DATE,
  legal_source      TEXT,                        -- référence texte officiel
  legal_reference   TEXT,
  version           INT NOT NULL DEFAULT 1,
  verification_status TEXT NOT NULL DEFAULT 'a_verifier'
    CHECK (verification_status IN ('a_verifier','en_cours','verifiee','obsolete')),
  verified_at       TIMESTAMPTZ,
  verified_by       BIGINT REFERENCES users(id),
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        BIGINT REFERENCES users(id),
  UNIQUE (tax_code, rule_key, version)
);

CREATE INDEX IF NOT EXISTS fiscal_rules_tax_idx ON fiscal_rules (tax_code, effective_from DESC);
CREATE INDEX IF NOT EXISTS fiscal_rules_status_idx ON fiscal_rules (verification_status);

-- 4. Périodes fiscales renseignées (déclarations préparées, non déposées)
CREATE TABLE IF NOT EXISTS fiscal_periods (
  id              BIGSERIAL PRIMARY KEY,
  client_id       BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  station_id      BIGINT REFERENCES stations(id),  -- optionnel : multi-station
  module_code     TEXT NOT NULL,
  period_type     TEXT NOT NULL CHECK (period_type IN ('month','quarter','year','custom')),
  period_start    DATE NOT NULL,
  period_end      DATE NOT NULL,
  status          TEXT NOT NULL DEFAULT 'brouillon'
    CHECK (status IN ('brouillon','a_completer','pret','valide_interne','archive')),
  data            JSONB NOT NULL DEFAULT '{}'::jsonb,  -- données saisies
  estimates       JSONB NOT NULL DEFAULT '{}'::jsonb,  -- résultats estimés
  rule_versions   JSONB NOT NULL DEFAULT '{}'::jsonb,  -- versions de règles utilisées
  prepared_by     BIGINT REFERENCES users(id),
  validated_by    BIGINT REFERENCES users(id),
  validated_at    TIMESTAMPTZ,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, module_code, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS fiscal_periods_client_idx ON fiscal_periods (client_id, module_code, period_start DESC);

-- 5. Historique / audit des actions fiscales
CREATE TABLE IF NOT EXISTS fiscal_audit_log (
  id              BIGSERIAL PRIMARY KEY,
  client_id       BIGINT NOT NULL REFERENCES clients(id),
  user_id         BIGINT REFERENCES users(id),
  action          TEXT NOT NULL,
  entity_type     TEXT,
  entity_id       BIGINT,
  old_data        JSONB,
  new_data        JSONB,
  ip              TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fiscal_audit_client_idx ON fiscal_audit_log (client_id, created_at DESC);

-- 6. Échéances fiscales (calendrier)
CREATE TABLE IF NOT EXISTS fiscal_deadlines (
  id              BIGSERIAL PRIMARY KEY,
  client_id       BIGINT REFERENCES clients(id),   -- NULL = modèle global
  module_code     TEXT NOT NULL,
  title           TEXT NOT NULL,
  due_date        DATE NOT NULL,
  period_label    TEXT,
  source          TEXT,                            -- 'reglementaire' | 'interne' | 'parametre'
  legal_reference TEXT,
  status          TEXT NOT NULL DEFAULT 'a_venir'
    CHECK (status IN ('a_venir','en_cours','depasse','termine','annule')),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fiscal_deadlines_client_idx ON fiscal_deadlines (client_id, due_date);

-- 7. Justificatifs fiscaux (métadonnées ; fichiers via table files existante si possible)
CREATE TABLE IF NOT EXISTS fiscal_documents (
  id              BIGSERIAL PRIMARY KEY,
  client_id       BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  period_id       BIGINT REFERENCES fiscal_periods(id),
  module_code     TEXT,
  doc_type        TEXT NOT NULL,                   -- attestation, facture, quittance, etc.
  title           TEXT NOT NULL,
  file_id         BIGINT,                          -- référence éventuelle table files
  file_path       TEXT,
  uploaded_by     BIGINT REFERENCES users(id),
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes           TEXT
);

CREATE INDEX IF NOT EXISTS fiscal_documents_client_idx ON fiscal_documents (client_id);

COMMENT ON TABLE fiscal_profiles IS 'Profil fiscal déclaratif du client — assistance uniquement, non officiel';
COMMENT ON TABLE fiscal_rules IS 'Règles fiscales versionnées. Ne jamais réécrire rétroactivement les calculs historiques.';
COMMENT ON TABLE fiscal_periods IS 'Périodes préparées. Statut « pret » = prêt pour revue humaine, PAS déposé à la DGI.';
COMMENT ON COLUMN fiscal_periods.estimates IS 'Estimations indicatives. Toujours accompagnées d''un avertissement de non-officialité.';

COMMIT;
