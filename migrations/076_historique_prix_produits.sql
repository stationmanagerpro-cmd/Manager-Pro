-- Historique complet des prix produits : prix de vente ET prix d'achat, ancien prix, auteur et note.
-- La table price_history existe déjà (migration 020) ; on la complète sans rien supprimer.
ALTER TABLE price_history ADD COLUMN IF NOT EXISTS price_type TEXT NOT NULL DEFAULT 'sell';
ALTER TABLE price_history ADD COLUMN IF NOT EXISTS old_price NUMERIC(14,2);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'price_history_type_check') THEN
    ALTER TABLE price_history ADD CONSTRAINT price_history_type_check CHECK (price_type IN ('sell', 'buy'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS price_history_product_type ON price_history (station_id, product_id, price_type, effective_from DESC);

-- 1) Reprise des changements de prix déjà tracés dans le journal d'audit (modifications de produit passées).
INSERT INTO price_history (station_id, product_id, price_type, price, old_price, effective_from, created_by, note)
SELECT a.station_id, a.record_id, t.price_type, (a.new_value ->> t.col)::numeric, (a.old_value ->> t.col)::numeric,
       a.created_at, a.user_id, 'Repris du journal d''audit'
FROM audit_logs a
CROSS JOIN (VALUES ('sell', 'sell_price'), ('buy', 'buy_price')) AS t(price_type, col)
WHERE a.table_name = 'products' AND a.module = 'produits' AND a.record_id IS NOT NULL AND a.station_id IS NOT NULL
  AND a.new_value ? t.col AND a.old_value ? t.col
  AND (a.new_value ->> t.col) ~ '^[0-9]+(\.[0-9]+)?$' AND (a.old_value ->> t.col) ~ '^[0-9]+(\.[0-9]+)?$'
  AND (a.new_value ->> t.col)::numeric IS DISTINCT FROM (a.old_value ->> t.col)::numeric
  AND EXISTS (SELECT 1 FROM products p WHERE p.id = a.record_id AND p.station_id = a.station_id);

-- 2) Ligne de départ : le prix actuel de chaque produit n'ayant encore aucun historique de ce type.
INSERT INTO price_history (station_id, product_id, price_type, price, effective_from, note)
SELECT p.station_id, p.id, t.price_type, CASE t.price_type WHEN 'sell' THEN p.sell_price ELSE p.buy_price END, now(),
       'Prix à la mise en service de l''historique'
FROM products p CROSS JOIN (VALUES ('sell'), ('buy')) AS t(price_type)
WHERE NOT EXISTS (SELECT 1 FROM price_history h WHERE h.product_id = p.id AND h.price_type = t.price_type);

-- 3) Chaînage des périodes de validité (effective_to = début du prix suivant).
UPDATE price_history h SET effective_to = n.next_from
FROM (SELECT id, LEAD(effective_from) OVER (PARTITION BY station_id, product_id, price_type ORDER BY effective_from, id) AS next_from FROM price_history) n
WHERE n.id = h.id AND h.effective_to IS NULL AND n.next_from IS NOT NULL;
