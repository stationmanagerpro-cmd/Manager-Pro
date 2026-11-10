-- Slogan propre à la station (distinct du slogan du site, géré par le SuperAdmin)
ALTER TABLE stations ADD COLUMN IF NOT EXISTS tagline TEXT;
