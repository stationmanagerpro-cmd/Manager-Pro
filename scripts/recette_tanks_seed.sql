-- Jeu d'essai cuves (à charger après recette_fleet_seed.sql). Attendu sur [2026-11-01 06:00 ; 2026-11-02 06:00], Gasoil :
-- ouverture 10000 + réceptions 5000 − perte 20 − pompé 3000 (quart clos ; le quart ouvert est exclu) = théorique 11980 ; jauge 11900 ; écart −80 L (critique, tolérance 15 L).
SET session_replication_role = replica;
INSERT INTO tanks(id,station_id,product_id,name,capacity_liters,alert_threshold) VALUES (1,1,7,'Cuve G1',20000,1000),(2,1,8,'Cuve S1',10000,500);
INSERT INTO tank_measurements(tank_id,station_id,measured_at,quantity) VALUES (1,1,'2026-11-01 06:00+00',10000),(1,1,'2026-11-02 06:00+00',11900),(2,1,'2026-11-01 06:00+00',5000);
INSERT INTO stock_movements(station_id,product_id,kind,quantity,created_at) VALUES (1,7,'achat',5000,'2026-11-01 12:00+00'),(1,7,'perte',-20,'2026-11-01 13:00+00');
INSERT INTO shifts(id,station_id,number,shift_date,kind,manager_id,cash_register_id,status,closed_at) VALUES (1,1,1,'2026-11-01','jour',1,1,'ferme','2026-11-01 18:00+00'),(2,1,2,'2026-11-01','nuit',1,1,'ouvert',NULL);
INSERT INTO meter_readings(shift_id,counter_id,pump_id,product_id,index_start,index_end) VALUES (1,1,1,7,100,3100),(2,2,1,7,3100,3600);
