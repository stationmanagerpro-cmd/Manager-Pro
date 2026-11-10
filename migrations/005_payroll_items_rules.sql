-- 005 : Catalogue de rubriques de paie + fondations de versionnement des règles
-- Non destructif. Aucune rubrique réglementaire activée automatiquement.
-- Les rubriques « historiques » (bulletin type Mali) sont créées en statut À CONFIRMER + DÉSACTIVÉES.

-- ---------- Catalogue central des rubriques ----------
CREATE TABLE IF NOT EXISTS payroll_items (
  id              BIGSERIAL PRIMARY KEY,
  station_id      BIGINT REFERENCES stations(id),          -- NULL = modèle global (partagé)
  code            TEXT NOT NULL,
  label           TEXT NOT NULL,
  item_type       TEXT NOT NULL CHECK (item_type IN ('gain','retenue','charge_patronale')),
  nature          TEXT,                                      -- prime, indemnite, cotisation, impot, avance, etc.
  formula         TEXT,                                      -- description textuelle de la formule
  default_amount  NUMERIC(14,2),
  default_rate    NUMERIC(8,4),                              -- ex: 3.06 pour 3,06 %
  rate_unit       TEXT DEFAULT 'percent' CHECK (rate_unit IS NULL OR rate_unit IN ('percent','fixed')),
  ceiling         NUMERIC(14,2),                             -- plafond d'assiette
  floor_amount    NUMERIC(14,2),
  base_kind       TEXT,                                      -- brut, base_inps, base_amo, base_its, custom...
  sort_order      INT NOT NULL DEFAULT 100,
  active          BOOLEAN NOT NULL DEFAULT FALSE,            -- DÉSACTIVÉ par défaut
  imposable_its   BOOLEAN NOT NULL DEFAULT FALSE,
  soumis_inps     BOOLEAN NOT NULL DEFAULT FALSE,
  soumis_amo      BOOLEAN NOT NULL DEFAULT FALSE,
  charge_employeur BOOLEAN NOT NULL DEFAULT FALSE,
  deductible      BOOLEAN NOT NULL DEFAULT FALSE,
  exonerated      BOOLEAN NOT NULL DEFAULT FALSE,
  legal_status    TEXT NOT NULL DEFAULT 'a_confirmer'
                    CHECK (legal_status IN ('confirmee','a_confirmer','obsolete','en_attente')),
  technical_status TEXT NOT NULL DEFAULT 'desactivee'
                    CHECK (technical_status IN ('active','desactivee')),
  effective_from  DATE,
  effective_to    DATE,
  source_org      TEXT,                                      -- DGI, INPS, CANAM, interne...
  source_ref      TEXT,
  source_url      TEXT,
  comment         TEXT,
  created_by      BIGINT REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Impossible : À confirmer + Active
  CONSTRAINT payroll_items_status_consistency
    CHECK (NOT (legal_status = 'a_confirmer' AND technical_status = 'active'))
);

-- Unicité du code : par station, ou global (station_id IS NULL)
CREATE UNIQUE INDEX IF NOT EXISTS payroll_items_code_station_uidx
  ON payroll_items (station_id, code) WHERE station_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS payroll_items_code_global_uidx
  ON payroll_items (code) WHERE station_id IS NULL;

CREATE INDEX IF NOT EXISTS payroll_items_station ON payroll_items(station_id, active, sort_order);
CREATE INDEX IF NOT EXISTS payroll_items_type ON payroll_items(item_type, technical_status);


-- ---------- Versions de règles (historique des taux / formules) ----------
CREATE TABLE IF NOT EXISTS payroll_rule_versions (
  id              BIGSERIAL PRIMARY KEY,
  item_id         BIGINT NOT NULL REFERENCES payroll_items(id) ON DELETE CASCADE,
  version         INT NOT NULL DEFAULT 1,
  rate            NUMERIC(8,4),
  amount          NUMERIC(14,2),
  ceiling         NUMERIC(14,2),
  floor_amount    NUMERIC(14,2),
  base_kind       TEXT,
  formula         TEXT,
  legal_status    TEXT NOT NULL DEFAULT 'a_confirmer'
                    CHECK (legal_status IN ('confirmee','a_confirmer','obsolete','en_attente')),
  technical_status TEXT NOT NULL DEFAULT 'desactivee'
                    CHECK (technical_status IN ('active','desactivee')),
  effective_from  DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to    DATE,
  source_org      TEXT,
  source_ref      TEXT,
  source_url      TEXT,
  comment         TEXT,
  approved_by     BIGINT REFERENCES users(id),
  approved_at     TIMESTAMPTZ,
  approval_reason TEXT,
  created_by      BIGINT REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT payroll_rule_versions_status_consistency
    CHECK (NOT (legal_status = 'a_confirmer' AND technical_status = 'active'))
);

CREATE INDEX IF NOT EXISTS payroll_rule_versions_item ON payroll_rule_versions(item_id, effective_from DESC);

-- ---------- Liaison optionnelle : lignes de bulletin ↔ rubrique catalogue ----------
ALTER TABLE payroll_adjustments
  ADD COLUMN IF NOT EXISTS item_id BIGINT REFERENCES payroll_items(id);

-- ---------- Seed : rubriques type bulletin Mali (toutes DÉSACTIVÉES + À CONFIRMER) ----------
-- station_id NULL = modèles globaux disponibles pour toutes les stations
INSERT INTO payroll_items (station_id, code, label, item_type, nature, sort_order, active, legal_status, technical_status, imposable_its, soumis_inps, soumis_amo, charge_employeur, source_org, comment)
VALUES
  -- Gains
  (NULL, 'BASE_CAT',     'Base catégorie',              'gain', 'salaire',     10, false, 'a_confirmer', 'desactivee', true,  true,  true,  false, 'interne', 'Salaire de base catégoriel — à confirmer selon convention'),
  (NULL, 'SURSALAIRE',   'Sursalaire',                  'gain', 'salaire',     20, false, 'a_confirmer', 'desactivee', true,  true,  true,  false, 'interne', NULL),
  (NULL, 'PRIME_LOG',    'Prime de logement',           'gain', 'prime',       30, false, 'a_confirmer', 'desactivee', true,  true,  true,  false, 'interne', 'Traitement fiscal/social à confirmer (DGI / INPS)'),
  (NULL, 'VOITURE_SVC',  'Voiture de service',          'gain', 'avantage',    40, false, 'a_confirmer', 'desactivee', true,  false, false, false, 'interne', 'Avantage en nature — règles DGI à confirmer'),
  (NULL, 'BLANCHISSAGE', 'Blanchissage',                'gain', 'indemnite',   50, false, 'a_confirmer', 'desactivee', false, false, false, false, 'interne', NULL),
  (NULL, 'SPECIALE',     'Prime spéciale',              'gain', 'prime',       60, false, 'a_confirmer', 'desactivee', true,  true,  true,  false, 'interne', NULL),
  (NULL, 'COIFFURE',     'Coiffure',                    'gain', 'indemnite',   70, false, 'a_confirmer', 'desactivee', false, false, false, false, 'interne', NULL),
  (NULL, 'PFA',          'PFA',                         'gain', 'prime',       80, false, 'a_confirmer', 'desactivee', true,  true,  true,  false, 'interne', NULL),
  (NULL, 'TRANSPORT',    'Indemnité de transport',      'gain', 'indemnite',   90, false, 'a_confirmer', 'desactivee', false, false, false, false, 'interne', 'Exonération éventuelle à confirmer auprès de la DGI'),
  (NULL, 'PANIER_JOUR',  'Panier jour',                 'gain', 'indemnite',  100, false, 'a_confirmer', 'desactivee', false, false, false, false, 'interne', NULL),
  (NULL, 'PANIER_NUIT',  'Panier nuit',                 'gain', 'indemnite',  110, false, 'a_confirmer', 'desactivee', false, false, false, false, 'interne', NULL),
  (NULL, 'IND_FERIE',    'Indemnité jour férié',        'gain', 'indemnite',  120, false, 'a_confirmer', 'desactivee', true,  true,  true,  false, 'interne', NULL),
  (NULL, 'UN_AGENT_TOIT','Un agent un toit',            'gain', 'prime',      130, false, 'a_confirmer', 'desactivee', true,  true,  true,  false, 'interne', NULL),
  (NULL, 'HS',           'Heures supplémentaires',      'gain', 'heure_sup',  140, false, 'a_confirmer', 'desactivee', true,  true,  true,  false, 'interne', 'Feature flag payroll_overtime_enabled requis'),
  -- Retenues salariales
  (NULL, 'AVANCE',       'Avance sur salaire',          'retenue', 'avance',   200, false, 'confirmee',   'desactivee', false, false, false, false, 'interne', 'Gérée par le module avances existant'),
  (NULL, 'DETTE',        'Retenue sur dette',           'retenue', 'dette',    210, false, 'confirmee',   'desactivee', false, false, false, false, 'interne', 'Gérée par le module dettes existant'),
  (NULL, 'AMO_SAL',      'AMO salarié',                'retenue', 'cotisation',220, false, 'a_confirmer', 'desactivee', false, false, true,  false, 'CANAM', 'Taux indicatif 3,06 % — à confirmer et versionner avant activation'),
  (NULL, 'INPS_SAL',     'INPS salarié',               'retenue', 'cotisation',230, false, 'a_confirmer', 'desactivee', false, true,  false, false, 'INPS',  'Taux et branches à confirmer'),
  (NULL, 'ITS',          'Impôt sur les traitements (ITS)','retenue', 'impot', 240, false, 'a_confirmer', 'desactivee', true,  false, false, false, 'DGI',   'Barème progressif à configurer — jamais en dur dans le code'),
  (NULL, 'IPM',          'Retenue IPM',                 'retenue', 'cotisation',250, false, 'a_confirmer', 'desactivee', false, false, false, false, 'interne', NULL),
  (NULL, 'RETRAITE_SAL', 'Retraite salarié',            'retenue', 'cotisation',260, false, 'a_confirmer', 'desactivee', false, true,  false, false, 'INPS',  NULL),
  (NULL, 'TRIMF',        'TRIMF',                       'retenue', 'impot',    270, false, 'a_confirmer', 'desactivee', false, false, false, false, 'interne', 'Ancienne rubrique — vérifier obsolecence'),
  (NULL, 'MUTUELLE',     'Mutuelle',                    'retenue', 'mutuelle', 280, false, 'a_confirmer', 'desactivee', false, false, false, false, 'interne', NULL),
  -- Charges patronales
  (NULL, 'AMO_PAT',      'AMO employeur',               'charge_patronale', 'cotisation', 300, false, 'a_confirmer', 'desactivee', false, false, true,  true, 'CANAM', 'Taux indicatif 3,50 % — à confirmer'),
  (NULL, 'INPS_PAT',     'INPS employeur',              'charge_patronale', 'cotisation', 310, false, 'a_confirmer', 'desactivee', false, true,  false, true, 'INPS',  'Branches et taux à confirmer'),
  (NULL, 'AT_MP',        'Accidents du travail / MP',   'charge_patronale', 'cotisation', 320, false, 'a_confirmer', 'desactivee', false, true,  false, true, 'INPS',  NULL),
  (NULL, 'PREST_FAM',    'Prestations familiales',      'charge_patronale', 'cotisation', 330, false, 'a_confirmer', 'desactivee', false, true,  false, true, 'INPS',  NULL),
  (NULL, 'CFCE',         'CFCE',                        'charge_patronale', 'taxe',       340, false, 'a_confirmer', 'desactivee', false, false, false, true, 'interne', 'Contribution forfaitaire — à vérifier'),
  (NULL, 'ANPE',         'Contribution ANPE',           'charge_patronale', 'contribution',350, false, 'a_confirmer', 'desactivee', false, false, false, true, 'interne', 'À confirmer selon réglementation en vigueur')
ON CONFLICT DO NOTHING;


-- Version initiale (v1) pour chaque rubrique seedée — toutes désactivées
INSERT INTO payroll_rule_versions (item_id, version, rate, legal_status, technical_status, effective_from, source_org, comment)
SELECT i.id, 1,
  CASE i.code
    WHEN 'AMO_SAL' THEN 3.06
    WHEN 'AMO_PAT' THEN 3.50
    ELSE NULL
  END,
  i.legal_status, 'desactivee', CURRENT_DATE, i.source_org,
  'Version initiale créée par migration 005 — non activée'
FROM payroll_items i
WHERE i.station_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM payroll_rule_versions v WHERE v.item_id = i.id)
ON CONFLICT DO NOTHING;

COMMENT ON TABLE payroll_items IS 'Catalogue des rubriques de paie. active=false et technical_status=desactivee par défaut. Aucune incidence financière tant que non confirmée et activée.';
COMMENT ON TABLE payroll_rule_versions IS 'Historique versionné des taux/formules. Une règle À confirmer ne peut pas être Active.';
