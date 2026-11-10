-- ANO-04 / RG-05 : le verrouillage de connexion est lié à l'identifiant ET à l'adresse IP (et non plus au seul compte).
-- Un tiers qui multiplie les échecs ne bloque plus le vrai titulaire (Superadmin, administrateur local) depuis une autre adresse.
CREATE TABLE IF NOT EXISTS login_throttle (
  login         TEXT        NOT NULL,
  ip            TEXT        NOT NULL,
  failed_logins INTEGER     NOT NULL DEFAULT 0,
  lockout_until TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (login, ip)
);
CREATE INDEX IF NOT EXISTS idx_login_throttle_updated ON login_throttle (updated_at);
-- Les anciens verrous « par compte » ne sont plus appliqués : on les efface pour que l'écran des utilisateurs reste cohérent.
UPDATE users SET failed_logins = 0, lockout_until = NULL WHERE failed_logins > 0 OR lockout_until IS NOT NULL;
