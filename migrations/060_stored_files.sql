-- Stockage durable des photos, logos et pièces jointes dans PostgreSQL/Neon.
CREATE TABLE IF NOT EXISTS stored_files (id UUID PRIMARY KEY, storage_key TEXT NOT NULL UNIQUE, mime_type TEXT NOT NULL CHECK (mime_type IN ('image/png','image/jpeg','image/webp','application/pdf')), file_size INTEGER NOT NULL CHECK (file_size > 0 AND file_size <= 2097152), content BYTEA NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS stored_files_created_at_idx ON stored_files(created_at);
