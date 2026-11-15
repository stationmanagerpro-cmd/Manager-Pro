-- Clés de chiffrement de l'appareil (RFC 8291) pour afficher le texte réel des notifications push.
ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS p256dh TEXT;
ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS auth_secret TEXT;
