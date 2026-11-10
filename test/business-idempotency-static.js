// Contrôles statiques : reprise réseau sans doubler ventes, ventes carburant ou dépenses.
const fs = require('fs');
const assert = require('assert');
const migration = fs.readFileSync('migrations/002_exports_transfers_offline.sql', 'utf8');
const operations = fs.readFileSync('src/operations.js', 'utf8');
const fuel = fs.readFileSync('src/fuelsales.js', 'utf8');

assert(/sales_client_ref ON sales\(station_id, client_ref\) WHERE client_ref IS NOT NULL/i.test(migration), 'Index unique idempotent des ventes absent');
assert(/expenses_client_ref ON expenses\(station_id, client_ref\) WHERE client_ref IS NOT NULL/i.test(migration), 'Index unique idempotent des dépenses absent');
assert(/client_ref:\s*z\.string\(\)\.trim\(\)\.min\(1\)\.max\(128\)/.test(operations), 'La route ventes doit accepter une clé client bornée');
assert(/client_ref:\s*z\.string\(\)\.trim\(\)\.min\(1\)\.max\(128\)/.test(fuel), 'La route ventes carburant doit accepter une clé client bornée');
assert(/client_ref:\s*z\.string\(\)\.trim\(\)\.min\(1\)\.max\(128\)/.test(operations.slice(operations.indexOf("r.post('/expenses'"))), 'La route dépenses doit accepter une clé client bornée');
assert(/pg_advisory_xact_lock\(hashtext\(\$1\), hashtext\(\$2\)\)/.test(operations), 'Verrou transactionnel absent pour ventes/dépenses');
assert(/pg_advisory_xact_lock\(hashtext\(\$1\), hashtext\(\$2\)\)/.test(fuel), 'Verrou transactionnel absent pour ventes carburant');
assert(/SELECT \* FROM sales WHERE station_id = \$1 AND client_ref = \$2/.test(operations), 'La route vente doit rechercher une opération déjà enregistrée');
assert(/SELECT \* FROM sales WHERE station_id = \$1 AND client_ref = \$2/.test(fuel), 'La route vente carburant doit rechercher une opération déjà enregistrée');
assert(/SELECT \* FROM expenses WHERE station_id = \$1 AND client_ref = \$2/.test(operations), 'La route dépense doit rechercher une opération déjà enregistrée');
assert(/INSERT INTO sales\([^`]*client_ref/i.test(operations), 'La vente de produits doit persister sa clé client');
assert(/INSERT INTO sales\([^`]*client_ref/i.test(fuel), 'La vente carburant doit persister sa clé client');
assert(/INSERT INTO expenses\([^`]*client_ref/i.test(operations), 'La dépense doit persister sa clé client');
assert(/res\.status\(replay \? 200 : 201\)/.test(operations), 'Les routes de ventes/dépenses doivent signaler les reprises sans recréer une ressource');
assert(/res\.status\(replay \? 200 : 201\)/.test(fuel), 'La route carburant doit signaler les reprises sans recréer une ressource');
assert(/Cette référence de requête est déjà utilisée pour une autre vente/.test(operations), 'Une clé de vente réutilisée avec un contenu différent doit être refusée');
assert(/Cette référence de requête est déjà utilisée pour une autre dépense/.test(operations), 'Une clé de dépense réutilisée avec un contenu différent doit être refusée');
assert(/Cette référence de requête est déjà utilisée pour une autre vente carburant/.test(fuel), 'Une clé carburant réutilisée avec un contenu différent doit être refusée');
assert(/sameItems\(detailRows, b\.items\)/.test(operations), 'Le contenu des articles de vente doit être comparé à la reprise');
assert(/samePayments\(paymentRows, b\.payments\)/.test(operations), 'Les paiements de vente doivent être comparés à la reprise');
assert(/samePayments\(paymentRows, requestedPayments\)/.test(fuel), 'Les paiements carburant doivent être comparés à la reprise');
console.log('✔ Contrôles statiques d’idempotence métier : 20/20');
