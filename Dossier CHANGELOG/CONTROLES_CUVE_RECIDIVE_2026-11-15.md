# Contrôles de cuve et récidive d'écarts — 2026-11-15

Origine : rapprochement « fonctionnalités proposées / existant » validé par l'utilisateur (« Oui mettre tout en place »).

## Réalisé
1. **Tolérance de cuve par station** — réglage `tank_tolerance_pct` (défaut 0,5 %, 0,05–10). Utilisé par le rapprochement, l'alerte d'écart et la route /tanks/reconcile. Écran : Paramètres › Exploitation. Sans réglage : comportement inchangé.
2. **Blocage optionnel de la clôture** — réglage `tank_close_block` : `off` (DÉFAUT, aucun changement), `critical` ou `warning`. Si activé, la clôture exige une justification quand l'écart de cuve du quart est critique (ou à surveiller). Évalué seulement si une jauge a été prise PENDANT le quart (sinon « incomplet », jamais de blocage). Litres pompés = ceux du quart qui se clôture. Le résultat apparaît dans l'aperçu de clôture (`report.tank_check`).
3. **Jauge avant/après à la réception de carburant** — champ facultatif `tank_dips` sur POST /purchase-orders/:id/receive ; table `receipt_tank_dips` (migration 111) ; écart de livraison (mesuré − reçu) avec niveau ok/avertissement/critique, notification « ecart_livraison », jamais bloquant. Écran : fenêtre de réception.
4. **Récidive d'écarts par employé** — route GET /hr/gaps/recurrence (réglages `gap_recurrence_days` = 30, `gap_recurrence_min` = 3 quarts), bloc « Écarts répétés » dans l'écran RH. Signal à examiner, aucune retenue automatique.

## Fichiers
src/tank_logic.js, tanks.js, shifts.js, purchase_orders.js, hr.js, admin.js, gap_recurrence.js (nouveau), migrations/111_receipt_tank_dips.sql (nouveau), public/ext-fin.js, ext-purchase-orders.js, ext-core.js, sw.js régénéré, test/tank-controls-unit.js (nouveau).

## Tests
- test/tank-controls-unit.js : 13 contrôles OK (tolérance, modes de blocage, clôture critique/faible/incomplète/avec réception, livraison manque/excédent, récidive, registre, branchements). Base simulée.
- Suites statiques/unitaires : résultats identiques à origin/main (7 échecs pré-existants). migration-numbering OK après renumérotation 107 → 111 (107 déjà pris par push_payload_keys).

## NON vérifié
- Migration 111 et requêtes SQL (tankCloseCheck, réception, récidive) non exécutées sur une vraie base PostgreSQL : à contrôler après déploiement (journaux Render au démarrage).
- Écrans (réglages, réception, bloc RH) non testés visuellement.
- Message d'erreur de blocage affiché par le formulaire de clôture existant : à vérifier avec le réglage activé sur une station de test.
- L'alerte « écart de cuve » n'a pas encore de seuil dédié dans l'écran d'alertes (le réglage de station fait foi).

## Restant / retour arrière
Déploiement Render sur accord. Retour arrière : annuler le commit ; la table receipt_tank_dips est additive et peut rester.
