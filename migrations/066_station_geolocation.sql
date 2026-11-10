-- 066 Géolocalisation des stations (carte Mapbox)
-- Non destructif : colonnes facultatives, renseignées par l'administrateur local de chaque compte client.
ALTER TABLE stations ADD COLUMN IF NOT EXISTS latitude  NUMERIC(9,6);
ALTER TABLE stations ADD COLUMN IF NOT EXISTS longitude NUMERIC(9,6);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stations_latitude_range') THEN
    ALTER TABLE stations ADD CONSTRAINT stations_latitude_range CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stations_longitude_range') THEN
    ALTER TABLE stations ADD CONSTRAINT stations_longitude_range CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stations_geo_pair') THEN
    ALTER TABLE stations ADD CONSTRAINT stations_geo_pair CHECK ((latitude IS NULL) = (longitude IS NULL));
  END IF;
END $$;
