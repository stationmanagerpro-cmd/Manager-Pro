# État actuel — Station Manager Pro

Date : 2026-11-20. Commit de référence : `485c128` sur `main`.

## Dernière tâche effectuée
Bouton « Besoin d'aide » : placé dans la bannière dès sa pose ; plus de saut d'en-tête au chargement (`public/ext-help.js`).

## Principaux changements récents
- Bandeau : photo enregistrée posée directement ; photo par défaut entière et centrée en attendant ; une seule version après la vue de démarrage ; nom du compte client (superadmin : nom du site).
- Menu latéral : pas d'animation au chargement.
- En-tête : masqué jusqu'à la pose du bandeau, pour toutes les skins.

## Tests exécutés (dernière intervention)
- `node test/banner-static.js` : 15/15.
- `node test/sw-coherence-static.js` : 8/8.
- `node test/repo-hygiene-static.js` : 7/7.
- Enregistrements image par image dans un navigateur simulé, 390×844 et 1280×800 (bandeau, menu, en-tête).

## Problèmes non résolus
- Non vérifié sur appareil réel (Android).
- Bouton « Modifier » des cartes d'aide : invisible pour le superadmin dans un cas signalé ; cause non établie.
- Règle de comptoir côté serveur (`src/catalog.js`) : non appliquée.
- Doublons de préfixe de migrations.
- Tests serveur non exécutés ici (dépendances absentes).
- Une éventuelle différence de skin non « pro » n'a pas été vérifiée.

## Prochaine tâche précise
Confirmer sur téléphone : bandeau unique avec photo, menu sans mouvement, bouton « Besoin d'aide » dans la bannière. Si le problème persiste, noter la version du navigateur et la capture.

## Questions ouvertes pour l'utilisateur
1. Faut-il appliquer la règle de comptoir côté serveur (`src/catalog.js`) ?
2. Faut-il mettre à jour l'URL du dépôt distant local ?
3. La règle « Modifier » des cartes d'aide pour le superadmin doit-elle être vérifiée après déploiement ?
