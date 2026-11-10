-- =====================================================================
-- STATION MANAGER PRO : schéma de base de données (PostgreSQL 14+)
-- Multi-station : chaque table métier porte station_id.
-- Montants : NUMERIC(14,2)  |  Quantités carburant : NUMERIC(14,3)
-- Suppression : logique (deleted_at), jamais physique sur les données sensibles.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------- 1. Stations, rôles, permissions, utilisateurs ----------
CREATE TABLE stations (
  id            BIGSERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  address       TEXT,
  phone         TEXT,
  email         TEXT,
  currency      CHAR(4) NOT NULL DEFAULT 'FCFA',
  tax_id        TEXT,
  logo_url      TEXT,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE roles (
  id    SMALLSERIAL PRIMARY KEY,
  code  TEXT NOT NULL UNIQUE,            -- ADMIN, GERANT, CAISSIER, ...
  label TEXT NOT NULL
);

CREATE TABLE permissions (
  id    SMALLSERIAL PRIMARY KEY,
  code  TEXT NOT NULL UNIQUE,            -- ex: shift.close, price.edit, sale.delete
  label TEXT NOT NULL
);

CREATE TABLE role_permissions (
  role_id       SMALLINT NOT NULL REFERENCES roles(id),
  permission_id SMALLINT NOT NULL REFERENCES permissions(id),
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE users (
  id            BIGSERIAL PRIMARY KEY,
  login         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,           -- argon2/bcrypt calculé côté application
  role_id       SMALLINT NOT NULL REFERENCES roles(id),
  is_global     BOOLEAN NOT NULL DEFAULT FALSE,  -- administrateur multi-station
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  failed_logins SMALLINT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);

-- Accès d'un utilisateur à une ou plusieurs stations
CREATE TABLE user_stations (
  user_id    BIGINT NOT NULL REFERENCES users(id),
  station_id BIGINT NOT NULL REFERENCES stations(id),
  PRIMARY KEY (user_id, station_id)
);

CREATE TABLE user_sessions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    BIGINT NOT NULL REFERENCES users(id),
  ip_address INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);

CREATE TABLE employees (
  id          BIGSERIAL PRIMARY KEY,
  station_id  BIGINT NOT NULL REFERENCES stations(id),
  user_id     BIGINT UNIQUE REFERENCES users(id),
  matricule   TEXT NOT NULL,
  last_name   TEXT NOT NULL,
  first_name  TEXT NOT NULL,
  phone       TEXT,
  position    TEXT NOT NULL,             -- pompiste, caissier, gérant...
  hired_on    DATE,
  photo_url   TEXT,
  status      TEXT NOT NULL DEFAULT 'actif' CHECK (status IN ('actif','inactif')),
  deleted_at  TIMESTAMPTZ,
  UNIQUE (station_id, matricule)
);

-- ---------- 2. Produits et stocks ----------
CREATE TABLE categories (
  id         SMALLSERIAL PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,       -- CARBURANT, LUBRIFIANT, HUILE, ACCESSOIRES, BOUTIQUE, AUTRES
  label      TEXT NOT NULL,
  has_meter  BOOLEAN NOT NULL DEFAULT FALSE  -- TRUE pour CARBURANT : affiche les index compteurs
);

CREATE TABLE suppliers (
  id            BIGSERIAL PRIMARY KEY,
  station_id    BIGINT NOT NULL REFERENCES stations(id),
  name          TEXT NOT NULL,
  company       TEXT,
  phone         TEXT,
  email         TEXT,
  address       TEXT,
  contact       TEXT,
  tax_id        TEXT,
  balance_due   NUMERIC(14,2) NOT NULL DEFAULT 0,   -- dette courante
  deleted_at    TIMESTAMPTZ
);

CREATE TABLE products (
  id                   BIGSERIAL PRIMARY KEY,
  station_id           BIGINT NOT NULL REFERENCES stations(id),
  category_id          SMALLINT NOT NULL REFERENCES categories(id),
  name                 TEXT NOT NULL,
  unit                 TEXT NOT NULL DEFAULT 'L',
  buy_price            NUMERIC(14,2) NOT NULL CHECK (buy_price >= 0),
  sell_price           NUMERIC(14,2) NOT NULL CHECK (sell_price >= 0),
  tax_rate             NUMERIC(5,2) NOT NULL DEFAULT 0,
  min_stock            NUMERIC(14,3) NOT NULL DEFAULT 0,
  main_supplier_id     BIGINT REFERENCES suppliers(id),
  active               BOOLEAN NOT NULL DEFAULT TRUE,
  deleted_at           TIMESTAMPTZ,
  UNIQUE (station_id, name)
);

-- Stock courant (une ligne par produit et par station), tenu à jour par les mouvements
CREATE TABLE stock (
  product_id  BIGINT PRIMARY KEY REFERENCES products(id),
  station_id  BIGINT NOT NULL REFERENCES stations(id),
  quantity    NUMERIC(14,3) NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- 3. Pompes et compteurs (association compteur → produit configurable) ----------
CREATE TABLE pumps (
  id          BIGSERIAL PRIMARY KEY,
  station_id  BIGINT NOT NULL REFERENCES stations(id),
  number      SMALLINT NOT NULL,
  name        TEXT NOT NULL,
  location    TEXT,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','maintenance')),
  deleted_at  TIMESTAMPTZ,
  UNIQUE (station_id, number)
);

CREATE TABLE pump_counters (
  id             BIGSERIAL PRIMARY KEY,
  pump_id        BIGINT NOT NULL REFERENCES pumps(id),
  counter_number SMALLINT NOT NULL,
  product_id     BIGINT NOT NULL REFERENCES products(id),   -- aucun produit codé en dur
  current_index  NUMERIC(14,3) NOT NULL DEFAULT 0,
  UNIQUE (pump_id, counter_number)
);

-- Historique des changements d'association compteur → produit
CREATE TABLE pump_counter_history (
  id          BIGSERIAL PRIMARY KEY,
  counter_id  BIGINT NOT NULL REFERENCES pump_counters(id),
  product_id  BIGINT NOT NULL REFERENCES products(id),
  valid_from  TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by  BIGINT REFERENCES users(id)
);

-- ---------- 4. Caisses ----------
CREATE TABLE cash_registers (
  id          BIGSERIAL PRIMARY KEY,
  station_id  BIGINT NOT NULL REFERENCES stations(id),
  name        TEXT NOT NULL,
  balance     NUMERIC(14,2) NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT TRUE
);

-- ---------- 5. Quarts de service ----------
CREATE TABLE shifts (
  id                BIGSERIAL PRIMARY KEY,
  station_id        BIGINT NOT NULL REFERENCES stations(id),
  number            INTEGER NOT NULL,                       -- N° 000125
  shift_date        DATE NOT NULL,
  kind              TEXT NOT NULL,                          -- Matin, Après-midi, Nuit, Personnalisé
  planned_start     TIMESTAMPTZ,
  planned_end       TIMESTAMPTZ,
  opened_at         TIMESTAMPTZ,
  closed_at         TIMESTAMPTZ,
  manager_id        BIGINT NOT NULL REFERENCES users(id),
  cash_register_id  BIGINT NOT NULL REFERENCES cash_registers(id),
  opening_cash      NUMERIC(14,2) NOT NULL DEFAULT 0,
  theoretical_cash  NUMERIC(14,2),
  counted_cash      NUMERIC(14,2),
  cash_gap          NUMERIC(14,2),
  gap_justification TEXT,
  status            TEXT NOT NULL DEFAULT 'planifie'
                    CHECK (status IN ('planifie','ouvert','ferme','annule')),
  closed_by         BIGINT REFERENCES users(id),
  observations      TEXT,
  UNIQUE (station_id, number)
);
-- Un seul quart ouvert à la fois par station
CREATE UNIQUE INDEX one_open_shift_per_station ON shifts(station_id) WHERE status = 'ouvert';

CREATE TABLE shift_employees (
  shift_id    BIGINT NOT NULL REFERENCES shifts(id),
  employee_id BIGINT NOT NULL REFERENCES employees(id),
  PRIMARY KEY (shift_id, employee_id)
);

CREATE TABLE shift_anomalies (
  id          BIGSERIAL PRIMARY KEY,
  shift_id    BIGINT NOT NULL REFERENCES shifts(id),
  kind        TEXT NOT NULL,             -- ecart_caisse, ecart_stock, ecart_compteur, autre
  description TEXT NOT NULL,
  amount      NUMERIC(14,2),
  created_by  BIGINT REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Lectures de compteurs : début et fin de quart
CREATE TABLE meter_readings (
  id           BIGSERIAL PRIMARY KEY,
  shift_id     BIGINT NOT NULL REFERENCES shifts(id),
  counter_id   BIGINT NOT NULL REFERENCES pump_counters(id),
  pump_id      BIGINT NOT NULL REFERENCES pumps(id),
  product_id   BIGINT NOT NULL REFERENCES products(id),     -- produit figé au moment du quart
  index_start  NUMERIC(14,3) NOT NULL,
  index_end    NUMERIC(14,3),
  unit_price   NUMERIC(14,2),
  liters       NUMERIC(14,3) GENERATED ALWAYS AS (index_end - index_start) STORED,
  amount       NUMERIC(14,2),
  read_by      BIGINT REFERENCES users(id),
  read_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (index_end IS NULL OR index_end >= index_start),
  UNIQUE (shift_id, counter_id)
);

-- Inventaire physique à la clôture
CREATE TABLE shift_stock_counts (
  shift_id        BIGINT NOT NULL REFERENCES shifts(id),
  product_id      BIGINT NOT NULL REFERENCES products(id),
  opening_stock   NUMERIC(14,3) NOT NULL,
  theoretical     NUMERIC(14,3),
  physical        NUMERIC(14,3),
  gap             NUMERIC(14,3),
  PRIMARY KEY (shift_id, product_id)
);

-- ---------- 6. Clients ----------
CREATE TABLE customers (
  id            BIGSERIAL PRIMARY KEY,
  station_id    BIGINT NOT NULL REFERENCES stations(id),
  kind          TEXT NOT NULL CHECK (kind IN ('particulier','entreprise','professionnel','credit')),
  name          TEXT NOT NULL,
  phone         TEXT,
  address       TEXT,
  company       TEXT,
  tax_id        TEXT,
  credit_limit  NUMERIC(14,2) NOT NULL DEFAULT 0,
  balance       NUMERIC(14,2) NOT NULL DEFAULT 0,           -- montant dû
  deleted_at    TIMESTAMPTZ
);

-- ---------- 7. Ventes et paiements ----------
CREATE TABLE sales (
  id           BIGSERIAL PRIMARY KEY,
  station_id   BIGINT NOT NULL REFERENCES stations(id),
  shift_id     BIGINT NOT NULL REFERENCES shifts(id),       -- règle 1
  employee_id  BIGINT NOT NULL REFERENCES employees(id),    -- règle 2
  pump_id      BIGINT REFERENCES pumps(id),                 -- règle 3
  customer_id  BIGINT REFERENCES customers(id),
  invoice_no   TEXT,
  sold_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  total        NUMERIC(14,2) NOT NULL CHECK (total >= 0),
  status       TEXT NOT NULL DEFAULT 'valide' CHECK (status IN ('valide','annule')),
  cancelled_by BIGINT REFERENCES users(id),
  cancel_reason TEXT,
  UNIQUE (station_id, invoice_no)
);

CREATE TABLE sale_details (
  id          BIGSERIAL PRIMARY KEY,
  sale_id     BIGINT NOT NULL REFERENCES sales(id),
  product_id  BIGINT NOT NULL REFERENCES products(id),
  quantity    NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  unit_price  NUMERIC(14,2) NOT NULL,
  unit_cost   NUMERIC(14,2) NOT NULL DEFAULT 0,             -- pour la marge
  tax_rate    NUMERIC(5,2) NOT NULL DEFAULT 0,
  amount      NUMERIC(14,2) NOT NULL
);

CREATE TABLE payments (
  id          BIGSERIAL PRIMARY KEY,
  station_id  BIGINT NOT NULL REFERENCES stations(id),
  sale_id     BIGINT REFERENCES sales(id),
  shift_id    BIGINT REFERENCES shifts(id),
  method      TEXT NOT NULL CHECK (method IN ('especes','carte','mobile_money','credit','autre')),
  amount      NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  reference   TEXT,
  paid_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  BIGINT REFERENCES users(id)
);

CREATE TABLE customer_payments (
  id           BIGSERIAL PRIMARY KEY,
  customer_id  BIGINT NOT NULL REFERENCES customers(id),
  sale_id      BIGINT REFERENCES sales(id),
  amount       NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  method       TEXT NOT NULL,
  due_date     DATE,
  paid_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   BIGINT REFERENCES users(id)
);

-- ---------- 8. Achats et fournisseurs ----------
CREATE TABLE purchases (
  id            BIGSERIAL PRIMARY KEY,
  station_id    BIGINT NOT NULL REFERENCES stations(id),
  supplier_id   BIGINT NOT NULL REFERENCES suppliers(id),
  order_no      TEXT,
  invoice_no    TEXT,
  status        TEXT NOT NULL DEFAULT 'commande'
                CHECK (status IN ('commande','partiel','recu','facture','paye','archive','annule')),
  ordered_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  received_at   TIMESTAMPTZ,
  total         NUMERIC(14,2) NOT NULL DEFAULT 0,      -- total commandé
  invoice_date  DATE,
  due_date      DATE,
  invoice_total NUMERIC(14,2),                         -- montant facturé (dette du fournisseur)
  paid          NUMERIC(14,2) NOT NULL DEFAULT 0,
  archived_at   TIMESTAMPTZ,
  cancel_reason TEXT,
  created_by    BIGINT REFERENCES users(id)
);

CREATE TABLE purchase_details (
  id           BIGSERIAL PRIMARY KEY,
  purchase_id  BIGINT NOT NULL REFERENCES purchases(id),
  product_id   BIGINT NOT NULL REFERENCES products(id),
  qty_ordered  NUMERIC(14,3) NOT NULL CHECK (qty_ordered > 0),
  qty_received NUMERIC(14,3) NOT NULL DEFAULT 0,
  unit_cost    NUMERIC(14,2) NOT NULL
);

CREATE TABLE supplier_payments (
  id           BIGSERIAL PRIMARY KEY,
  supplier_id  BIGINT NOT NULL REFERENCES suppliers(id),
  purchase_id  BIGINT REFERENCES purchases(id),
  amount       NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  method       TEXT NOT NULL,
  paid_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   BIGINT REFERENCES users(id)
);

-- ---------- 9. Mouvements de stock ----------
CREATE TABLE stock_movements (
  id          BIGSERIAL PRIMARY KEY,
  station_id  BIGINT NOT NULL REFERENCES stations(id),
  product_id  BIGINT NOT NULL REFERENCES products(id),
  kind        TEXT NOT NULL CHECK (kind IN ('entree','sortie','vente','achat','retour','perte','casse','correction','transfert')),
  quantity    NUMERIC(14,3) NOT NULL,            -- signée : + entrée, − sortie
  shift_id    BIGINT REFERENCES shifts(id),
  ref_table   TEXT,                              -- table source (sales, purchases, meter_readings...)
  ref_id      BIGINT,
  comment     TEXT,
  created_by  BIGINT REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- 10. Dépenses et mouvements de caisse ----------
CREATE TABLE expenses (
  id            BIGSERIAL PRIMARY KEY,
  station_id    BIGINT NOT NULL REFERENCES stations(id),
  shift_id      BIGINT REFERENCES shifts(id),
  spent_on      DATE NOT NULL DEFAULT CURRENT_DATE,
  category      TEXT NOT NULL,
  amount        NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  method        TEXT NOT NULL,
  beneficiary   TEXT,
  receipt_url   TEXT,
  comment       TEXT,
  created_by    BIGINT REFERENCES users(id),
  deleted_at    TIMESTAMPTZ
);

CREATE TABLE cash_movements (
  id                BIGSERIAL PRIMARY KEY,
  cash_register_id  BIGINT NOT NULL REFERENCES cash_registers(id),
  shift_id          BIGINT REFERENCES shifts(id),
  kind              TEXT NOT NULL CHECK (kind IN ('ouverture','encaissement','decaissement','depot_bancaire','retrait','transfert','ecart_cloture')),
  amount            NUMERIC(14,2) NOT NULL,      -- signé
  label             TEXT,
  ref_table         TEXT,
  ref_id            BIGINT,
  created_by        BIGINT REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- 11. Rapports, audit, paramètres, notifications ----------
CREATE TABLE reports (
  id          BIGSERIAL PRIMARY KEY,
  station_id  BIGINT NOT NULL REFERENCES stations(id),
  shift_id    BIGINT REFERENCES shifts(id),
  kind        TEXT NOT NULL,                     -- quart, journalier, ventes, stock...
  params      JSONB,
  content     JSONB,                             -- instantané des chiffres au moment de la clôture
  file_url    TEXT,
  generated_by BIGINT REFERENCES users(id),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id          BIGSERIAL PRIMARY KEY,
  station_id  BIGINT REFERENCES stations(id),
  user_id     BIGINT REFERENCES users(id),
  module      TEXT NOT NULL,
  action      TEXT NOT NULL,
  table_name  TEXT,
  record_id   BIGINT,
  old_value   JSONB,
  new_value   JSONB,
  ip_address  INET,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE settings (
  station_id  BIGINT NOT NULL REFERENCES stations(id),
  key         TEXT NOT NULL,                     -- ex: tolerance_fuel_liters, payment_methods
  value       JSONB NOT NULL,
  PRIMARY KEY (station_id, key)
);

CREATE TABLE notifications (
  id          BIGSERIAL PRIMARY KEY,
  station_id  BIGINT NOT NULL REFERENCES stations(id),
  level       TEXT NOT NULL CHECK (level IN ('info','warning','critical')),
  kind        TEXT NOT NULL,                     -- stock_critique, ecart_caisse, quart_non_cloture...
  message     TEXT NOT NULL,
  ref_table   TEXT,
  ref_id      BIGINT,
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- 12. Index utiles ----------
CREATE INDEX ON sales (station_id, sold_at);
CREATE INDEX ON sales (shift_id);
CREATE INDEX ON stock_movements (product_id, created_at);
CREATE INDEX ON cash_movements (cash_register_id, created_at);
CREATE INDEX ON meter_readings (shift_id);
CREATE INDEX ON audit_logs (created_at);
CREATE INDEX ON notifications (station_id) WHERE read_at IS NULL;

-- ---------- 13. Règles d'intégrité (triggers) ----------
-- Un quart clôturé ne peut plus recevoir ni modifier ventes, lectures ou stocks de quart.
CREATE OR REPLACE FUNCTION forbid_change_on_closed_shift() RETURNS trigger AS $$
DECLARE s TEXT; sid BIGINT;
BEGIN
  sid := COALESCE(NEW.shift_id, OLD.shift_id);
  SELECT status INTO s FROM shifts WHERE id = sid;
  IF s = 'ferme' THEN
    RAISE EXCEPTION 'Quart % clôturé : modification interdite (correction via procédure auditée)', sid;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$ LANGUAGE plpgsql;

CREATE TRIGGER sales_lock BEFORE INSERT OR UPDATE OR DELETE ON sales
  FOR EACH ROW EXECUTE FUNCTION forbid_change_on_closed_shift();
CREATE TRIGGER readings_lock BEFORE INSERT OR UPDATE OR DELETE ON meter_readings
  FOR EACH ROW EXECUTE FUNCTION forbid_change_on_closed_shift();

-- Le journal d'audit est en ajout seul.
CREATE OR REPLACE FUNCTION audit_append_only() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'audit_logs est en ajout seul'; END $$ LANGUAGE plpgsql;
CREATE TRIGGER audit_no_update BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_append_only();

-- Mise à jour automatique du stock courant à chaque mouvement.
CREATE OR REPLACE FUNCTION apply_stock_movement() RETURNS trigger AS $$
BEGIN
  INSERT INTO stock (product_id, station_id, quantity) VALUES (NEW.product_id, NEW.station_id, NEW.quantity)
  ON CONFLICT (product_id) DO UPDATE SET quantity = stock.quantity + NEW.quantity, updated_at = now();
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER stock_apply AFTER INSERT ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION apply_stock_movement();

-- ---------- 14. Données de base ----------
INSERT INTO roles (code, label) VALUES
 ('ADMIN','Administrateur'),('GERANT','Gérant'),('CAISSIER','Caissier'),('POMPISTE','Pompiste'),
 ('MAGASINIER','Magasinier'),('COMPTABLE','Comptable'),('SUPERVISEUR','Superviseur');

INSERT INTO categories (code, label, has_meter) VALUES
 ('CARBURANT','Carburant',TRUE),('LUBRIFIANT','Lubrifiant',FALSE),('HUILE','Huile',FALSE),
 ('ACCESSOIRES','Accessoires',FALSE),('BOUTIQUE','Boutique',FALSE),('AUTRES','Autres',FALSE);

INSERT INTO permissions (code, label) VALUES
 ('shift.open','Ouvrir un quart'),('shift.close','Clôturer un quart'),('sale.create','Enregistrer une vente'),
 ('sale.delete','Annuler une vente'),('price.edit','Modifier les prix'),('stock.adjust','Ajuster le stock'),
 ('expense.create','Saisir une dépense'),('cash.manage','Gérer la caisse'),('report.view','Consulter les rapports'),
 ('finance.view','Consulter les finances'),('audit.view','Consulter le journal d''audit'),('user.manage','Gérer les utilisateurs'),
 ('settings.edit','Modifier les paramètres'),
 ('purchase.manage','Gérer les achats (commande, réception, facture)'),('purchase.pay','Payer les fournisseurs');

-- Exemple : le pompiste peut seulement saisir des ventes.
INSERT INTO role_permissions
SELECT r.id, p.id FROM roles r, permissions p WHERE r.code = 'POMPISTE' AND p.code = 'sale.create';
-- L'administrateur reçoit toutes les permissions.
INSERT INTO role_permissions
SELECT r.id, p.id FROM roles r, permissions p WHERE r.code = 'ADMIN';
