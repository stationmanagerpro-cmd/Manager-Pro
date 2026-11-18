# Besoin d'aide — lecture refusée au Super Admin (403)

**Tâche :** le Super Admin voyait « Contenu non chargé » sur la vue « Besoin d'aide » (bouton Modifier présent, contenu absent).

**Cause :** dans `src/server.js`, le filtre des comptes `is_global` n'autorise que une liste de préfixes `/api`. `/help-guides` n'y figurait pas → `GET /api/help-guides` renvoyait 403 « données métier interdites ».

**Changement :** ajout de `/help-guides` à la liste blanche Super Admin (1 ligne). L'écriture (`PUT`) reste réservée au Super Admin par la route elle-même (`req.user.is_global`).

**Fichiers :** `src/server.js`.

**Tests :**
- `node --check src/server.js` : OK.
- `test/help-guides-unit.js` : 4/4.
- `test/besoin-aide-static.js` : 14/14.
- Non couvert : le filtre de `server.js` n'est pas exercé par ces tests (lancement de l'application complète impossible dans le bac à sable).

**Non vérifié :** le comportement réel en production avec un compte superadmin (à confirmer après déploiement).

**Statut :** branche `fix/besoin-aide-superadmin-route`, commit et PR à suivre. Pas encore fusionné ni déployé.
