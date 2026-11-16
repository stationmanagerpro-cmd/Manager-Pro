-- Suspension de l'accès d'une station (arrêt de travail décidé par le gérant). Additif et idempotent :
-- les comptes ne sont pas modifiés ; NULL = station accessible.
ALTER TABLE stations ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ;
