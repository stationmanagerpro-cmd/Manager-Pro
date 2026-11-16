-- Auteur de création des sous-comptes et des stations : seul l'administrateur local qui les a créés peut les gérer
-- (suspension, archivage, désactivation). NULL = historique (géré par tout administrateur local du même client). Additif et idempotent.
ALTER TABLE users    ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES users(id);
ALTER TABLE stations ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES users(id);
