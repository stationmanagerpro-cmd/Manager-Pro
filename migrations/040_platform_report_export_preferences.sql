-- Préférences de couleurs des exports de la plateforme Super Admin.
-- Séparées des préférences client pour éviter tout mélange inter-tenant.
CREATE TABLE IF NOT EXISTS platform_report_preferences (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton = TRUE),
  colors JSONB NOT NULL DEFAULT '{"primary":"#0A6B5C","secondary":"#E8F3F0","text":"#111827"}'::jsonb,
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT platform_report_preferences_colors_object CHECK (jsonb_typeof(colors) = 'object')
);
