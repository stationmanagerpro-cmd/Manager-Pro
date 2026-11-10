-- 053 — Clés d'accès à l'écran de connexion + historique + événements de sécurité.
-- Additif et idempotent : aucune donnée existante n'est modifiée. La page d'accueil publique utilise app_settings (déjà présent).
CREATE TABLE IF NOT EXISTS access_keys (
  id           BIGSERIAL PRIMARY KEY,
  key_hash     TEXT NOT NULL,                         -- HMAC-SHA256 de la clé (jamais la clé en clair)
  key_enc      TEXT NOT NULL,                         -- clé chiffrée (AES-256-GCM) : permet au Super Admin de la consulter pour la transmettre
  key_hint     TEXT NOT NULL,                         -- affichage masqué (ex. ••31)
  status       TEXT NOT NULL DEFAULT 'provisoire' CHECK (status IN ('provisoire', 'disponible', 'revoquee')),
  created_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  confirmed_at TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ,
  revoked_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  revoked_at   TIMESTAMPTZ,
  note         TEXT
);
-- Une même clé ne peut exister qu'une fois parmi les clés encore utilisables (les clés révoquées restent dans l'historique).
CREATE UNIQUE INDEX IF NOT EXISTS uq_access_keys_live_hash ON access_keys (key_hash) WHERE status IN ('provisoire', 'disponible');
CREATE INDEX IF NOT EXISTS idx_access_keys_status_created ON access_keys (status, created_at DESC);

CREATE TABLE IF NOT EXISTS access_key_uses (
  id          BIGSERIAL PRIMARY KEY,
  key_id      BIGINT NOT NULL REFERENCES access_keys(id),
  device_hash TEXT NOT NULL,                          -- HMAC de l'identifiant d'appareil émis par le serveur (cookie HttpOnly)
  used_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip          TEXT,
  user_agent  TEXT,
  UNIQUE (key_id, device_hash)                        -- une seule utilisation d'une clé par appareil, garantie par la base (atomique)
);

CREATE TABLE IF NOT EXISTS access_key_events (
  id          BIGSERIAL PRIMARY KEY,
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind        TEXT NOT NULL,                          -- generate, confirm, revoke, reveal, success, fail, locked, policy
  key_id      BIGINT REFERENCES access_keys(id),
  device_hash TEXT,
  ip          TEXT,
  user_id     BIGINT,
  detail      TEXT
);
CREATE INDEX IF NOT EXISTS idx_access_key_events_at ON access_key_events (at DESC);
