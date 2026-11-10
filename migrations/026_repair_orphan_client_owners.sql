-- 026 : rattrapage des comptes gérants « orphelins » (correctif B1 : « Aucune station trouvée »).
-- Additive et idempotente : ne supprime ni ne modifie aucune donnée existante.
--  * gérant dont le client possède déjà une station  -> lien user_stations ajouté ;
--  * gérant dont le client n'a aucune station        -> station par défaut créée (caisse, moyens de paiement, tolérance) puis liée.
-- Rejouable sans effet une fois les comptes réparés.
DO $$
DECLARE
  o RECORD;
  sid BIGINT;
BEGIN
  FOR o IN
    SELECT u.id AS user_id, u.client_id, c.name AS client_name
    FROM users u
    JOIN clients c ON c.id = u.client_id
    WHERE u.is_global = FALSE
      AND u.deleted_at IS NULL
      AND c.owner_user_id = u.id
      AND NOT EXISTS (SELECT 1 FROM user_stations us WHERE us.user_id = u.id)
  LOOP
    SELECT s.id INTO sid FROM stations s WHERE s.client_id = o.client_id ORDER BY s.id LIMIT 1;
    IF sid IS NULL THEN
      INSERT INTO stations(name, client_id) VALUES (o.client_name, o.client_id) RETURNING id INTO sid;
      INSERT INTO cash_registers(station_id, name) VALUES (sid, 'Caisse principale');
      INSERT INTO payment_methods(station_id, code, label, kind) VALUES
        (sid,'especes','Espèces','especes'),(sid,'mobile_money','Mobile Money','mobile_money'),
        (sid,'orange_money','Orange Money','mobile_money'),(sid,'wave','Wave','mobile_money'),
        (sid,'carte','Carte bancaire','carte'),(sid,'banque','Virement / banque','banque'),
        (sid,'credit','Crédit client','credit'),(sid,'autre','Autre','autre');
      INSERT INTO settings(station_id, key, value) VALUES (sid, 'tolerance_fuel_liters', '5') ON CONFLICT DO NOTHING;
    END IF;
    INSERT INTO user_stations(user_id, station_id) VALUES (o.user_id, sid) ON CONFLICT DO NOTHING;
    RAISE NOTICE '026 : gérant % (client %) rattaché à la station %', o.user_id, o.client_id, sid;
  END LOOP;
END $$;
