-- A3 — Configuration Dashboard isolée par compte client.
-- Une configuration est partagée entre les stations d'un même client, jamais entre clients.
CREATE TABLE IF NOT EXISTS client_dashboard_configs (
  client_id BIGINT PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  config JSONB NOT NULL,
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
