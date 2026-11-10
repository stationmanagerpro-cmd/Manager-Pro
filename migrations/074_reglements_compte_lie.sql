-- Liaison règlement ↔ compte : chaque règlement (facture, dette client) mémorise le compte (banque / mobile money) crédité.
-- NULL = espèces (caisse). Colonnes nullables : aucun impact sur l'historique existant.
ALTER TABLE invoice_payments  ADD COLUMN IF NOT EXISTS account_id BIGINT REFERENCES money_accounts(id);
ALTER TABLE customer_payments ADD COLUMN IF NOT EXISTS account_id BIGINT REFERENCES money_accounts(id);
CREATE INDEX IF NOT EXISTS invoice_payments_account_idx  ON invoice_payments(account_id)  WHERE account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS customer_payments_account_idx ON customer_payments(account_id) WHERE account_id IS NOT NULL;
