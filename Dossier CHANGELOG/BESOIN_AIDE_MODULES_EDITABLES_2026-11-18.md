# Besoin d'aide — modules ajoutables et noms modifiables

**Demande :** le Super Admin peut ajouter des modules et modifier le nom des modules, comme la procédure.

**Changements :**
- Migration `121_help_guides_modules.sql` : colonnes `label` (nom affiché, vide = nom par défaut) et `custom` (module ajouté). Le schéma est aussi créé à la demande dans `src/help_guides.js`.
- `GET /api/help-guides` : renvoie les modules intégrés et personnalisés (ordre : intégrés puis personnalisés).
- `POST /api/help-guides` (Super Admin) : crée un module personnalisé ; clé générée par le serveur (`c_` + 12 caractères hexadécimaux) ; nom obligatoire, 80 caractères maximum.
- `PUT /api/help-guides/:key` : accepte désormais `label`. Pour un module intégré, nom vide = nom par défaut. Pour un module personnalisé, nom obligatoire. Clé inconnue → 404.
- `public/ext-help.js` : champ « Nom du module » dans la fenêtre de modification, bouton « + Ajouter un module » (Super Admin), modules personnalisés visibles de tous les comptes connectés.
- `public/index.html` : `ext-help.js?v=2` (évite un cache obsolète du service worker) ; `public/sw.js` régénéré.
- `test/help-guides-unit.js` : 6 contrôles (création, refus client, renommage, nom obligatoire).
- `test/station-map-static.js` : assertion de la liste blanche Super Admin assouplie pour accepter `/help-guides` (ajouté par la PR #11, qui faisait échouer ce test sur `main`).

**Non fait :** suppression de module (non demandée).

**Tests :** `help-guides-unit` 6/6 ; `besoin-aide-static` 14/14 ; `station-map-static` 11/11. Boucle complète : échecs restants `demo-mode-static`, `employee-actions-unit`, `stock-movement-validation-unit` (déjà en échec sur `main` avant ce travail).

**Non vérifié :** comportement en production ; migration 121 non appliquée (le schéma se crée à la demande, donc la lecture ne dépend pas de la migration).

**Statut :** branche `feat/besoin-aide-modules-editables`, PR à ouvrir. Non fusionnée, non déployée.
