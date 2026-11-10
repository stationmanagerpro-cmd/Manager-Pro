-- 077 : photo de profil du produit + date de mise en inactif (archivage des produits, comme clients/fournisseurs)
ALTER TABLE products ADD COLUMN IF NOT EXISTS photo_path TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;
UPDATE products SET deactivated_at = COALESCE(deactivated_at, now()) WHERE active = FALSE AND deactivated_at IS NULL;
