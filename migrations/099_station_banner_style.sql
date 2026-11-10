-- 099 Personnalisation du grand bandeau d'accueil par la station (client) :
-- titre affiché (par défaut le nom de la station), style du texte et résultat du contrôle de lisibilité.
ALTER TABLE stations ADD COLUMN IF NOT EXISTS banner_title TEXT;
ALTER TABLE stations ADD COLUMN IF NOT EXISTS banner_style JSONB;            -- {align, color, overlay, ratio}
ALTER TABLE stations ADD COLUMN IF NOT EXISTS banner_legibility TEXT;        -- 'ok' | 'warn' | NULL (non évalué)
ALTER TABLE stations ADD COLUMN IF NOT EXISTS banner_checked_at TIMESTAMPTZ;
