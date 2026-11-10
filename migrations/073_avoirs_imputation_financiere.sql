-- 073 Imputation financière des avoirs : le grand livre client accepte le type « avoir »
-- (un avoir client réduit la créance ; il est tracé dans customer_ledger pour rester cohérent avec customers.balance).
ALTER TABLE customer_ledger DROP CONSTRAINT IF EXISTS customer_ledger_kind_check;
ALTER TABLE customer_ledger ADD CONSTRAINT customer_ledger_kind_check
  CHECK (kind IN ('solde_initial','credit','paiement','annulation','avoir'));
COMMENT ON TABLE customer_credits IS 'Avoirs client. Imputés sur la créance (customers.balance + customer_ledger kind=avoir).';
COMMENT ON TABLE supplier_credits IS 'Avoirs fournisseur. Imputés sur les factures ouvertes via supplier_payments (method=avoir).';
