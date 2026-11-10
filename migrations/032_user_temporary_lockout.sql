-- Verrouillage temporaire après échecs de connexion ; déverrouillage automatique.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS lockout_until TIMESTAMPTZ;

-- Les comptes déjà bloqués par l'ancien compteur permanent reçoivent une fenêtre
-- de transition de 15 minutes, au lieu de rester bloqués indéfiniment.
UPDATE users
   SET lockout_until = now() + interval '15 minutes'
 WHERE failed_logins >= 5
   AND lockout_until IS NULL;
