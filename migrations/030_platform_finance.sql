-- 030 Finance de la PLATEFORME (Superadmin) — strictement séparée de la finance des stations.
-- Non destructif : uniquement de nouvelles tables préfixées « platform_ ». Aucune donnée existante n'est modifiée.
-- Recettes : factures de licences / abonnements émises aux clients + encaissements.
-- Dépenses : coûts du projet (hébergement, base de données, stockage, domaine, outils, services...) + règlements.
-- Créances = factures non soldées ; dettes = dépenses non réglées ; trésorerie = encaissements - décaissements.

CREATE TABLE IF NOT EXISTS platform_invoices (
  id            BIGSERIAL PRIMARY KEY,
  client_id     BIGINT REFERENCES clients(id) ON DELETE SET NULL,
  kind          TEXT NOT NULL DEFAULT 'licence'
                CHECK (kind IN ('licence','abonnement','mise_en_service','autre')),
  label         TEXT NOT NULL,
  amount        NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  currency      TEXT NOT NULL DEFAULT 'FCFA',
  issued_on     DATE NOT NULL DEFAULT CURRENT_DATE,
  due_on        DATE,
  period_start  DATE,
  period_end    DATE,
  reference     TEXT,
  notes         TEXT,
  status        TEXT NOT NULL DEFAULT 'emise' CHECK (status IN ('emise','annulee')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    BIGINT REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS platform_invoices_client ON platform_invoices (client_id);
CREATE INDEX IF NOT EXISTS platform_invoices_issued ON platform_invoices (issued_on);

CREATE TABLE IF NOT EXISTS platform_invoice_payments (
  id          BIGSERIAL PRIMARY KEY,
  invoice_id  BIGINT NOT NULL REFERENCES platform_invoices(id) ON DELETE CASCADE,
  amount      NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  paid_on     DATE NOT NULL DEFAULT CURRENT_DATE,
  method      TEXT,
  reference   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  BIGINT REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS platform_invoice_payments_inv ON platform_invoice_payments (invoice_id);
CREATE INDEX IF NOT EXISTS platform_invoice_payments_date ON platform_invoice_payments (paid_on);

CREATE TABLE IF NOT EXISTS platform_expenses (
  id            BIGSERIAL PRIMARY KEY,
  category      TEXT NOT NULL
                CHECK (category IN ('hebergement','base_de_donnees','stockage','domaine','licences_logicielles','api_paiement','maintenance','developpement','support','communication','autre')),
  label         TEXT NOT NULL,
  supplier      TEXT,
  amount        NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  currency      TEXT NOT NULL DEFAULT 'FCFA',
  expense_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  due_on        DATE,
  reference     TEXT,
  notes         TEXT,
  status        TEXT NOT NULL DEFAULT 'engagee' CHECK (status IN ('engagee','annulee')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    BIGINT REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS platform_expenses_date ON platform_expenses (expense_date);
CREATE INDEX IF NOT EXISTS platform_expenses_cat ON platform_expenses (category);

CREATE TABLE IF NOT EXISTS platform_expense_payments (
  id          BIGSERIAL PRIMARY KEY,
  expense_id  BIGINT NOT NULL REFERENCES platform_expenses(id) ON DELETE CASCADE,
  amount      NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  paid_on     DATE NOT NULL DEFAULT CURRENT_DATE,
  method      TEXT,
  reference   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  BIGINT REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS platform_expense_payments_exp ON platform_expense_payments (expense_id);
CREATE INDEX IF NOT EXISTS platform_expense_payments_date ON platform_expense_payments (paid_on);
