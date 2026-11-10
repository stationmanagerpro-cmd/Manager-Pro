-- Facture libre : rattachement au quart / employé (ou commanditaire), pompe, vente(s) liée(s), part non portée par une vente.
-- Réversible : ALTER TABLE invoices DROP COLUMN IF EXISTS shift_id, employee_id, ordered_by, pump_id, fuel_sale_id, unlinked_amount, attribution;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS shift_id BIGINT REFERENCES shifts(id);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS employee_id BIGINT REFERENCES employees(id);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS ordered_by BIGINT REFERENCES users(id);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS pump_id BIGINT REFERENCES pumps(id);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS fuel_sale_id BIGINT REFERENCES sales(id);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS unlinked_amount NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS attribution TEXT;
COMMENT ON COLUMN invoices.unlinked_amount IS 'Part TTC d''une facture libre non portée par une vente (services, facture hors quart) : comptée au CA via la facture.';
COMMENT ON COLUMN invoices.attribution IS 'quart = rattachée au quart ouvert ; commanditaire = émise sans quart ouvert, attribuée à l''utilisateur qui l''a demandée.';
CREATE INDEX IF NOT EXISTS invoices_station_shift ON invoices (station_id, shift_id) WHERE shift_id IS NOT NULL;

-- Moyens de paiement mobile money / banque / carte : chacun doit avoir un compte actif pour apparaître à la vente
-- (sinon « Orange Money », « Wave »… sont masqués). On crée et rattache un compte par moyen qui n'en a pas encore.
DO $$
DECLARE r RECORD; aid BIGINT;
BEGIN
  FOR r IN SELECT station_id, code, label, kind FROM payment_methods WHERE account_id IS NULL AND active AND kind IN ('mobile_money', 'banque', 'carte') LOOP
    INSERT INTO money_accounts(station_id, kind, name, provider)
      VALUES (r.station_id, CASE WHEN r.kind = 'mobile_money' THEN 'mobile_money' ELSE 'banque' END, 'Compte ' || r.label, r.label)
      RETURNING id INTO aid;
    UPDATE payment_methods SET account_id = aid WHERE station_id = r.station_id AND code = r.code;
  END LOOP;
END $$;

-- Idem pour les moyens créés plus tard (nouvelle station, moyen ajouté sans compte) : le compte est créé et rattaché automatiquement.
CREATE OR REPLACE FUNCTION payment_method_autolink() RETURNS trigger AS $$
DECLARE aid BIGINT;
BEGIN
  IF NEW.account_id IS NULL AND NEW.active AND NEW.kind IN ('mobile_money', 'banque', 'carte') THEN
    INSERT INTO money_accounts(station_id, kind, name, provider)
      VALUES (NEW.station_id, CASE WHEN NEW.kind = 'mobile_money' THEN 'mobile_money' ELSE 'banque' END, 'Compte ' || NEW.label, NEW.label)
      RETURNING id INTO aid;
    NEW.account_id := aid;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS payment_method_autolink_trg ON payment_methods;
CREATE TRIGGER payment_method_autolink_trg BEFORE INSERT ON payment_methods FOR EACH ROW EXECUTE FUNCTION payment_method_autolink();
