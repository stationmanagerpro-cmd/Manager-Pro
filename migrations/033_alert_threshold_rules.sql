-- Étape 12 : paramètres de seuils pour les alertes opérationnelles.
-- Migration additive : conserve toutes les règles existantes.
ALTER TABLE alert_notify_config
  ADD COLUMN IF NOT EXISTS threshold_value NUMERIC(14,3),
  ADD COLUMN IF NOT EXISTS threshold_unit TEXT,
  ADD COLUMN IF NOT EXISTS threshold_percent NUMERIC(7,3);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'alert_notify_config_threshold_positive') THEN
    ALTER TABLE alert_notify_config ADD CONSTRAINT alert_notify_config_threshold_positive
      CHECK (threshold_value IS NULL OR threshold_value > 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'alert_notify_config_threshold_percent_valid') THEN
    ALTER TABLE alert_notify_config ADD CONSTRAINT alert_notify_config_threshold_percent_valid
      CHECK (threshold_percent IS NULL OR (threshold_percent > 0 AND threshold_percent <= 1000)) NOT VALID;
  END IF;
END $$;

COMMENT ON COLUMN alert_notify_config.threshold_value IS 'Seuil obligatoire pour les alertes de type écart, unité définie par threshold_unit.';
COMMENT ON COLUMN alert_notify_config.threshold_unit IS 'Unité du seuil : XOF, percent, litres ou units.';
COMMENT ON COLUMN alert_notify_config.threshold_percent IS 'Seuil en pourcentage optionnel lorsque le type d’écart le permet.';
