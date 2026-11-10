-- 098 Photo de bandeau (en-tête) par station/client, distincte du logo (photo_path).
ALTER TABLE stations ADD COLUMN IF NOT EXISTS banner_path TEXT;
