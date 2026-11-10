-- Support SuperAdmin ↔ client + portail bulletins
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS is_support BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS conversations_support ON conversations(client_id) WHERE is_support AND deleted_at IS NULL;
