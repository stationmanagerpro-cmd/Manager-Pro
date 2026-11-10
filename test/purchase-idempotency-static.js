// Contrôles statiques des reprises de réceptions et paiements fournisseurs.
const fs = require('fs');
const assert = require('assert');
const migration = fs.readFileSync('migrations/027_purchase_operation_idempotency.sql', 'utf8');
const purchases = fs.readFileSync('src/purchases.js', 'utf8');
assert(/CREATE TABLE IF NOT EXISTS purchase_operation_requests/i.test(migration), 'Journal de reprises fournisseurs absent');
assert(/UNIQUE\s*\(station_id, operation, client_ref\)/i.test(migration), 'Unicité des références par station/opération absente');
assert(!/DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i.test(migration), 'La migration doit être strictement additive');
assert(/client_ref:\s*z\.string\(\)\.trim\(\)\.min\(1\)\.max\(128\)/.test(purchases.slice(purchases.indexOf("r.post('/purchases/:id/receive'"), purchases.indexOf('// 3. FACTURE'))), 'La réception doit accepter une référence idempotente');
assert(/client_ref:\s*z\.string\(\)\.trim\(\)\.min\(1\)\.max\(128\)/.test(purchases.slice(purchases.indexOf("r.post('/purchases/:id/pay'"), purchases.indexOf("r.post('/purchases/:id/archive'"))), 'Le paiement fournisseur doit accepter une référence idempotente');
assert(/pg_advisory_xact_lock/.test(purchases), 'Verrou transactionnel des reprises absent');
assert(/request_payload, result/.test(purchases), 'La requête et le résultat doivent être persistés dans le journal');
assert(/Une référence est déjà utilisée|Cette référence est déjà utilisée pour une autre opération fournisseur/.test(purchases), 'Le conflit de clé avec un contenu différent doit être refusé');
assert(/recordPurchaseOperation\(c, req, 'receive'/.test(purchases), 'La réception doit enregistrer sa clé après traitement');
assert(/recordPurchaseOperation\(c, req, 'pay'/.test(purchases), 'Le paiement doit enregistrer sa clé après traitement');
console.log('✔ Contrôles statiques des reprises fournisseur : 9/9');
