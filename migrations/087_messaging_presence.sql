-- 087 : présence « En ligne » / « Vu à… » de la messagerie. Additif et idempotent.
-- « En ligne » = flux temps réel ouvert (en mémoire côté serveur). Cette table ne garde que la dernière activité,
-- pour afficher « Vu aujourd'hui à 14:32 » quand la personne est hors ligne.
CREATE TABLE IF NOT EXISTS user_presence (
  user_id      BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
