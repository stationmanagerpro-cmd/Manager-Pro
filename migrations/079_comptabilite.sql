-- 079 : Comptabilité générale en partie double (plan OHADA / SYSCOHADA révisé)
-- Non destructif et idempotent. Les écritures automatiques (ventes, achats, règlements, dépenses, paie, trésorerie, stocks)
-- sont DÉRIVÉES des tables existantes : aucune de ces tables n'est modifiée. Ne sont stockés ici que :
--   le plan comptable, les exercices, les écritures MANUELLES (OD / à-nouveaux) et les immobilisations.
-- Module contractuel : features.modules.accounting (désactivé par défaut, autorisé par le Superadmin à la création/édition du contrat).

CREATE TABLE IF NOT EXISTS acc_accounts (
  id          BIGSERIAL PRIMARY KEY,
  station_id  BIGINT REFERENCES stations(id),            -- NULL = plan modèle OHADA partagé ; renseigné = compte propre au client
  code        TEXT NOT NULL CHECK (code ~ '^[0-9]{2,10}$'),
  label       TEXT NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  is_custom   BOOLEAN NOT NULL DEFAULT FALSE,
  created_by  BIGINT REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS acc_accounts_code_uq ON acc_accounts (COALESCE(station_id, 0), code);

CREATE TABLE IF NOT EXISTS acc_fiscal_years (
  id             BIGSERIAL PRIMARY KEY,
  station_id     BIGINT NOT NULL REFERENCES stations(id),
  label          TEXT NOT NULL,
  start_date     DATE NOT NULL,
  end_date       DATE NOT NULL,
  status         TEXT NOT NULL DEFAULT 'ouvert' CHECK (status IN ('ouvert','cloture')),
  closing_result NUMERIC(16,2),
  closed_at      TIMESTAMPTZ,
  closed_by      BIGINT REFERENCES users(id),
  created_by     BIGINT REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date),
  UNIQUE (station_id, label)
);

CREATE TABLE IF NOT EXISTS acc_entries (
  id            BIGSERIAL PRIMARY KEY,
  station_id    BIGINT NOT NULL REFERENCES stations(id),
  journal       TEXT NOT NULL CHECK (journal IN ('VE','HA','CA','BQ','MM','PA','IM','ST','AN','OD')),
  number        TEXT NOT NULL,
  entry_date    DATE NOT NULL,
  label         TEXT NOT NULL,
  reference     TEXT,
  status        TEXT NOT NULL DEFAULT 'valide' CHECK (status IN ('valide','annule')),
  cancel_reason TEXT,
  cancelled_by  BIGINT REFERENCES users(id),
  cancelled_at  TIMESTAMPTZ,
  created_by    BIGINT REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (station_id, number)
);
CREATE INDEX IF NOT EXISTS acc_entries_date ON acc_entries (station_id, entry_date);

CREATE TABLE IF NOT EXISTS acc_entry_lines (
  id          BIGSERIAL PRIMARY KEY,
  entry_id    BIGINT NOT NULL REFERENCES acc_entries(id) ON DELETE CASCADE,
  line_no     INT NOT NULL DEFAULT 1,
  account_code TEXT NOT NULL CHECK (account_code ~ '^[0-9]{2,10}$'),
  label       TEXT,
  debit       NUMERIC(16,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit      NUMERIC(16,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  party_type  TEXT CHECK (party_type IS NULL OR party_type IN ('client','fournisseur')),
  party_id    BIGINT,
  CHECK (NOT (debit > 0 AND credit > 0)),
  CHECK (debit > 0 OR credit > 0)
);
CREATE INDEX IF NOT EXISTS acc_entry_lines_entry ON acc_entry_lines (entry_id);
CREATE INDEX IF NOT EXISTS acc_entry_lines_account ON acc_entry_lines (account_code);

-- Garde-fou en base : une écriture ne peut jamais être enregistrée déséquilibrée (contrôle différé à la fin de la transaction).
CREATE OR REPLACE FUNCTION acc_check_entry_balance() RETURNS trigger AS $$
DECLARE d NUMERIC; c NUMERIC; eid BIGINT;
BEGIN
  eid := COALESCE(NEW.entry_id, OLD.entry_id);
  SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0) INTO d, c FROM acc_entry_lines WHERE entry_id = eid;
  IF d <> c THEN
    RAISE EXCEPTION 'Écriture comptable déséquilibrée : débit % ≠ crédit %', d, c USING ERRCODE = 'P0001';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS acc_entry_lines_balance ON acc_entry_lines;
CREATE CONSTRAINT TRIGGER acc_entry_lines_balance AFTER INSERT OR UPDATE OR DELETE ON acc_entry_lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION acc_check_entry_balance();

CREATE TABLE IF NOT EXISTS acc_assets (
  id              BIGSERIAL PRIMARY KEY,
  station_id      BIGINT NOT NULL REFERENCES stations(id),
  label           TEXT NOT NULL,
  category        TEXT NOT NULL CHECK (category ~ '^2[0-9]{1,9}$'),          -- compte d'immobilisation (ex. 2411, 245)
  acquired_on     DATE NOT NULL,
  cost            NUMERIC(16,2) NOT NULL CHECK (cost > 0),
  residual_value  NUMERIC(16,2) NOT NULL DEFAULT 0 CHECK (residual_value >= 0),
  life_years      NUMERIC(6,2) CHECK (life_years IS NULL OR life_years > 0),  -- NULL : non amortissable (terrain)
  method          TEXT NOT NULL DEFAULT 'lineaire' CHECK (method IN ('lineaire')),
  funding         TEXT NOT NULL DEFAULT 'apport' CHECK (funding IN ('apport','especes','banque','mobile_money','dette')),
  funding_method  TEXT,                                                       -- moyen de paiement utilisé (mouvement réel de trésorerie)
  supplier_name   TEXT,
  status          TEXT NOT NULL DEFAULT 'en_service' CHECK (status IN ('en_service','cede','rebut')),
  disposed_on     DATE,
  disposal_price  NUMERIC(16,2) NOT NULL DEFAULT 0 CHECK (disposal_price >= 0),
  disposal_method TEXT,
  notes           TEXT,
  created_by      BIGINT REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (residual_value <= cost)
);
CREATE INDEX IF NOT EXISTS acc_assets_station ON acc_assets (station_id, acquired_on);

-- Plan comptable modèle (une seule fois ; chaque client peut ajouter ses comptes dans acc_accounts)
INSERT INTO acc_accounts (station_id, code, label)
SELECT NULL::bigint, v.code, v.label FROM (VALUES
  ('10', 'Capital'),
  ('101', 'Capital social'),
  ('104', 'Primes liées au capital social'),
  ('109', 'Actionnaires, capital souscrit non appelé'),
  ('11', 'Réserves'),
  ('111', 'Réserve légale'),
  ('118', 'Autres réserves'),
  ('12', 'Report à nouveau'),
  ('121', 'Report à nouveau créditeur'),
  ('129', 'Report à nouveau débiteur'),
  ('13', 'Résultat net de l’exercice'),
  ('131', 'Résultat net : bénéfice'),
  ('139', 'Résultat net : perte'),
  ('14', 'Subventions d’investissement'),
  ('16', 'Emprunts et dettes assimilées'),
  ('162', 'Emprunts et dettes auprès des établissements de crédit'),
  ('168', 'Autres emprunts et dettes'),
  ('21', 'Immobilisations incorporelles'),
  ('212', 'Brevets, licences, logiciels'),
  ('22', 'Terrains'),
  ('221', 'Terrains agricoles et forestiers'),
  ('222', 'Terrains nus'),
  ('223', 'Terrains bâtis'),
  ('23', 'Bâtiments, installations techniques et agencements'),
  ('231', 'Bâtiments industriels, agricoles et commerciaux'),
  ('237', 'Bâtiments : installations techniques'),
  ('238', 'Aménagements et agencements'),
  ('24', 'Matériel, mobilier et actifs biologiques'),
  ('241', 'Matériel et outillage industriel et commercial'),
  ('2411', 'Pompes, cuves et équipements de distribution'),
  ('244', 'Matériel et mobilier de bureau'),
  ('245', 'Matériel de transport'),
  ('246', 'Matériel informatique'),
  ('248', 'Autres matériels'),
  ('27', 'Autres immobilisations financières'),
  ('275', 'Dépôts et cautionnements versés'),
  ('28', 'Amortissements'),
  ('281', 'Amortissements des immobilisations incorporelles'),
  ('283', 'Amortissements des bâtiments et agencements'),
  ('2841', 'Amortissements du matériel et outillage'),
  ('2844', 'Amortissements du matériel et mobilier de bureau'),
  ('2845', 'Amortissements du matériel de transport'),
  ('2846', 'Amortissements du matériel informatique'),
  ('2848', 'Amortissements des autres matériels'),
  ('31', 'Marchandises'),
  ('311', 'Marchandises (carburants, lubrifiants, boutique)'),
  ('39', 'Dépréciations des stocks'),
  ('40', 'Fournisseurs et comptes rattachés'),
  ('401', 'Fournisseurs'),
  ('408', 'Fournisseurs, factures non parvenues'),
  ('409', 'Fournisseurs débiteurs'),
  ('41', 'Clients et comptes rattachés'),
  ('411', 'Clients'),
  ('419', 'Clients créditeurs (avances reçues)'),
  ('42', 'Personnel'),
  ('422', 'Personnel, rémunérations dues'),
  ('425', 'Personnel, avances et acomptes'),
  ('4251', 'Avances et acomptes au personnel'),
  ('428', 'Personnel, charges à payer'),
  ('43', 'Organismes sociaux'),
  ('431', 'Sécurité sociale et organismes sociaux (INPS, AMO)'),
  ('44', 'État et collectivités publiques'),
  ('441', 'État, impôt sur les bénéfices'),
  ('4431', 'TVA facturée (collectée)'),
  ('4441', 'État, TVA due'),
  ('4452', 'TVA récupérable sur achats'),
  ('447', 'État, impôts retenus à la source (ITS)'),
  ('47', 'Débiteurs et créditeurs divers'),
  ('471', 'Compte d’attente à régulariser'),
  ('48', 'Créances et dettes HAO'),
  ('481', 'Fournisseurs d’investissements'),
  ('485', 'Créances sur cessions d’immobilisations'),
  ('52', 'Banques'),
  ('521', 'Banques locales'),
  ('55', 'Instruments de monnaie électronique'),
  ('551', 'Portefeuilles électroniques (Mobile Money)'),
  ('57', 'Caisse'),
  ('571', 'Caisse'),
  ('58', 'Régies d’avances et virements internes'),
  ('585', 'Virements de fonds'),
  ('60', 'Achats et variations de stocks'),
  ('601', 'Achats de marchandises'),
  ('6031', 'Variations des stocks de marchandises'),
  ('604', 'Achats de fournitures consommables'),
  ('609', 'Rabais, remises et ristournes obtenus'),
  ('605', 'Autres achats (eau, électricité, énergie)'),
  ('61', 'Transports'),
  ('616', 'Transports du personnel'),
  ('618', 'Autres frais de transport'),
  ('62', 'Services extérieurs A'),
  ('622', 'Locations et charges locatives'),
  ('624', 'Entretien, réparations et maintenance'),
  ('625', 'Primes d’assurance'),
  ('63', 'Services extérieurs B'),
  ('627', 'Publicité, publications'),
  ('628', 'Frais de télécommunications'),
  ('631', 'Frais bancaires'),
  ('632', 'Rémunérations d’intermédiaires et honoraires'),
  ('638', 'Autres charges externes'),
  ('64', 'Impôts et taxes'),
  ('641', 'Impôts et taxes directs (patente, CFE)'),
  ('646', 'Droits d’enregistrement'),
  ('647', 'Pénalités et amendes fiscales'),
  ('648', 'Autres impôts et taxes'),
  ('65', 'Autres charges'),
  ('658', 'Charges diverses (dont écarts de caisse)'),
  ('66', 'Charges de personnel'),
  ('661', 'Rémunérations directes versées au personnel'),
  ('664', 'Charges sociales'),
  ('67', 'Frais financiers et charges assimilées'),
  ('671', 'Intérêts des emprunts'),
  ('68', 'Dotations aux amortissements'),
  ('681', 'Dotations aux amortissements d’exploitation'),
  ('675', 'Valeurs comptables des cessions d’immobilisations'),
  ('69', 'Dotations aux provisions'),
  ('70', 'Ventes'),
  ('701', 'Ventes de marchandises'),
  ('7011', 'Ventes de carburants'),
  ('7012', 'Ventes de lubrifiants et huiles'),
  ('7013', 'Ventes boutique, accessoires et autres'),
  ('706', 'Services vendus'),
  ('707', 'Produits accessoires'),
  ('709', 'Rabais, remises et ristournes accordés (avoirs clients)'),
  ('75', 'Autres produits'),
  ('758', 'Produits divers (dont écarts de caisse)'),
  ('77', 'Revenus financiers'),
  ('771', 'Intérêts de prêts'),
  ('775', 'Produits des cessions d’immobilisations'),
  ('79', 'Reprises de provisions'),
  ('81', 'Valeurs comptables des cessions (HAO)'),
  ('82', 'Produits des cessions (HAO)'),
  ('83', 'Charges HAO'),
  ('84', 'Produits HAO'),
  ('89', 'Impôts sur le résultat'),
  ('891', 'Impôts sur les bénéfices')
) AS v(code, label)
WHERE NOT EXISTS (SELECT 1 FROM acc_accounts a WHERE a.station_id IS NULL AND a.code = v.code);

-- Permissions : consultation (comptable, gérant, administrateur) et saisie / administration (comptable, administrateur)
INSERT INTO permissions (code, label) VALUES
  ('accounting.view',   'Consulter la comptabilité (journaux, grand livre, balance, résultat, bilan, TVA)'),
  ('accounting.manage', 'Saisir des écritures, gérer immobilisations, plan comptable et exercices')
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
 WHERE r.code = 'ADMIN' AND p.code IN ('accounting.view','accounting.manage') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
 WHERE r.code = 'COMPTABLE' AND p.code IN ('accounting.view','accounting.manage') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
 WHERE r.code = 'GERANT' AND p.code IN ('accounting.view') ON CONFLICT DO NOTHING;
