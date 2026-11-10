-- 006 : Moteur ITS (Impôt sur les Traitements et Salaires) — Mali
-- Non destructif. Feature flag payroll_its_enabled = OFF par défaut.
-- Aucun barème n'est activé automatiquement. Les tranches seedées sont « à confirmer ».

-- ---------- Champs fiscaux sur la fiche employé ----------
ALTER TABLE employees ADD COLUMN IF NOT EXISTS family_status TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS dependents INT NOT NULL DEFAULT 0;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS tax_id TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS inps_number TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS amo_number TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS retirement_number TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS bank_name TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS bank_account TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS payment_method_pref TEXT;

COMMENT ON COLUMN employees.family_status IS 'Situation familiale (ex: celibataire, marie, veuf...) — utilisée pour réductions ITS si configurées';
COMMENT ON COLUMN employees.dependents IS 'Nombre de personnes à charge (réduction ITS si règle confirmée)';

-- ---------- Barème ITS versionné (par station ou global) ----------
CREATE TABLE IF NOT EXISTS its_brackets (
  id              BIGSERIAL PRIMARY KEY,
  station_id      BIGINT REFERENCES stations(id),          -- NULL = modèle global
  version         INT NOT NULL DEFAULT 1,
  label           TEXT NOT NULL DEFAULT 'Barème ITS',
  legal_status    TEXT NOT NULL DEFAULT 'a_confirmer'
                    CHECK (legal_status IN ('confirmee','a_confirmer','obsolete','en_attente')),
  technical_status TEXT NOT NULL DEFAULT 'desactivee'
                    CHECK (technical_status IN ('active','desactivee')),
  effective_from  DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to    DATE,
  currency        TEXT NOT NULL DEFAULT 'FCFA',
  -- Tranches : [{ "from": 0, "to": 50000, "rate": 0 }, { "from": 50001, "to": 150000, "rate": 5 }, ...]
  -- rate en pourcentage (ex: 5 = 5 %)
  brackets        JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Réductions / abattements paramétrables (JSON libre, documenté)
  -- ex: { "per_dependent": 0, "family_reductions": {}, "min_taxable": 0 }
  deductions      JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_org      TEXT DEFAULT 'DGI',
  source_ref      TEXT,
  source_url      TEXT,
  comment         TEXT,
  approved_by     BIGINT REFERENCES users(id),
  approved_at     TIMESTAMPTZ,
  approval_reason TEXT,
  created_by      BIGINT REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT its_brackets_status_consistency
    CHECK (NOT (legal_status = 'a_confirmer' AND technical_status = 'active'))
);

CREATE INDEX IF NOT EXISTS its_brackets_station ON its_brackets(station_id, technical_status, effective_from DESC);

-- Colonnes ITS sur le bulletin (nullable, 0 par défaut)
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS its_base NUMERIC(14,2) DEFAULT 0;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS its_amount NUMERIC(14,2) DEFAULT 0;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS its_detail JSONB;

COMMENT ON COLUMN payslips.its_base IS 'Base imposable ITS retenue pour ce bulletin (0 si ITS non calculé)';
COMMENT ON COLUMN payslips.its_amount IS 'Montant ITS retenu (0 si flag OFF ou règle inactive)';
COMMENT ON COLUMN payslips.its_detail IS 'Détail du calcul ITS (tranches, réductions, version barème)';

-- ---------- Seed : structure de barème EXEMPLE (non officiel, à confirmer) ----------
-- Ces montants sont purement structurels pour tester le moteur.
-- Ils NE DOIVENT PAS être considérés comme le barème légal malien.
INSERT INTO its_brackets (
  station_id, version, label, legal_status, technical_status,
  effective_from, brackets, deductions, source_org, source_ref, comment
) VALUES (
  NULL, 1, 'Barème ITS — STRUCTURE EXEMPLE (non activé)',
  'a_confirmer', 'desactivee', CURRENT_DATE,
  '[
    {"from": 0, "to": 50000, "rate": 0},
    {"from": 50001, "to": 150000, "rate": 5},
    {"from": 150001, "to": 300000, "rate": 10},
    {"from": 300001, "to": 500000, "rate": 15},
    {"from": 500001, "to": null, "rate": 20}
  ]'::jsonb,
  '{"per_dependent": 0, "min_taxable": 0, "note": "Réductions à configurer selon textes DGI en vigueur"}'::jsonb,
  'DGI',
  'À remplacer par le barème officiel publié par la DGI Mali',
  'STRUCTURE DE TEST UNIQUEMENT. Ne pas activer sans avoir saisi le barème officiel confirmé. Feature flag payroll_its_enabled doit aussi être ON.'
) ON CONFLICT DO NOTHING;

COMMENT ON TABLE its_brackets IS 'Barèmes ITS versionnés. technical_status=desactivee et legal_status=a_confirmer par défaut. Le moteur n''utilise un barème que s''il est Confirmé + Active ET que payroll_its_enabled=true.';
