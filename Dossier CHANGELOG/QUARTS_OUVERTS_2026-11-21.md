# Quarts ouverts : compteur à l'état actuel

**Tâche** : « Quarts ouverts » affichait 0 alors qu'un quart était ouvert depuis le 18/11 (shift_date = 18/11, période affichée = 20/11).

**Cause** : le compteur était filtré par `shift_date` comme un flux de période. Un quart encore ouvert n'était compté dans aucune période postérieure à sa date d'ouverture.

**Changements** (branche `fix/quarts-ouverts-etat-courant`, depuis origin/main dae1f34) :
- `src/aggregates.js` : `shifts_open` est lu dans une requête « à ce jour » (`status = 'ouvert'`, sans filtre de date), ajoutée à `loadPoints`. Retiré de la requête `ops` de période.
- `src/aggregates.js` : catalogue — `shifts_open` passe en `flow: false` (pas de variation vs période précédente), formule et source mises à jour.
- `test/aggregates-mock.js` : doublure ajustée ; nouvelle assertion (requête sans filtre `shift_date`, `flow: false`).

**Tests** : `node --check src/aggregates.js` OK ; `test/aggregates-mock.js` 7/7 ; `test/aggregates-front-static.js` 1/1.

**Non vérifié** :
- Comportement réel sur la base (aucun accès depuis le bac à sable).
- Rendu du tableau de bord en production.

**Restant** :
- Date de quart calculée en UTC à l'ouverture (`src/shifts.js`, lignes 111 et 125) : à traiter séparément si le fuseau de la station n'est pas UTC.
- Incohérence entre quarts clos comptés par `shift_date` (ops) et carburant des quarts clos filtré par `closed_at` (fuel) : à arbitrer.
- Revue sémantique des domaines ventes, carburant et marge non faite.

**Déploiement** : aucun. Branche non poussée, pas de PR, pas de fusion.
