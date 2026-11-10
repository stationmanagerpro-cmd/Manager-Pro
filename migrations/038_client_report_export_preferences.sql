-- Préférences globales de présentation des exports PDF/Excel par client.
-- L'activation fonctionnelle reste soumise à client_contracts.features.can_customize_report_exports.
CREATE TABLE IF NOT EXISTS client_report_preferences (
  client_id BIGINT PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  colors JSONB NOT NULL DEFAULT '{"primary":"#0A6B5C","secondary":"#E8F3F0","text":"#111827"}'::jsonb,
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT client_report_preferences_colors_object CHECK (jsonb_typeof(colors) = 'object')
);
