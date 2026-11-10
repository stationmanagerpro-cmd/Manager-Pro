SET session_replication_role = replica;
INSERT INTO stations(id,name) VALUES (1,'S1'),(2,'S2');
INSERT INTO customers(id,station_id,kind,name,balance) VALUES (10,1,'entreprise','Transport ABC',45375+8500);
INSERT INTO products(id,station_id,category_id,name,buy_price,sell_price) VALUES (7,1,1,'Gasoil',600,750),(8,1,1,'Super',700,850);
INSERT INTO fleet_cards(id,station_id,customer_id,card_number,label) VALUES (1,1,10,'C1','AB-123'),(2,1,10,'C2','CD-456');
INSERT INTO sales(id,station_id,shift_id,employee_id,customer_id,sold_at,total,status) VALUES
 (101,1,1,1,10,'2026-10-10 08:00+00',30000,'valide'),(102,1,1,1,10,'2026-10-20 08:00+00',15375,'valide'),(103,1,1,1,10,'2026-10-31 23:30+00',8500,'valide'),(104,1,1,1,10,'2026-10-12 08:00+00',9000,'annule'),(105,1,1,1,10,'2026-11-02 08:00+00',7000,'valide');
INSERT INTO fleet_card_events(card_id,station_id,kind,sale_id,product_id,liters,amount,created_at) VALUES
 (1,1,'use',101,7,40,30000,'2026-10-10 08:00+00'),(1,1,'use',102,7,20.5,15375,'2026-10-20 08:00+00'),(1,1,'use',103,8,10,8500,'2026-10-31 23:30+00'),
 (2,1,'use',104,7,12,9000,'2026-10-12 08:00+00'),(2,1,'use',105,7,9.333,7000,'2026-11-02 08:00+00'),(1,1,'decline',NULL,7,10,7500,'2026-10-15 08:00+00');
