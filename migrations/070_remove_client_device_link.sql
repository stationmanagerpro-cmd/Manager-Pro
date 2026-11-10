-- Suppression du « lien client » et de sa clé d'identification d'appareil.
-- Seule la clé d'accès Superadmin (access_keys / access_key_uses) est conservée.
DROP TABLE IF EXISTS client_devices;
DROP TABLE IF EXISTS client_device_keys;
