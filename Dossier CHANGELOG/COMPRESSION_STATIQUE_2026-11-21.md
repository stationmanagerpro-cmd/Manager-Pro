# Compression gzip des fichiers statiques — 2026-11-21

Décision du propriétaire (après avoir d'abord écarté la compression par précaution).

## Changement
- `src/static_gzip.js` (nouveau) : compresse en gzip les fichiers texte statiques (JS, CSS, HTML, JSON, SVG, TXT, manifeste). Module Node natif (`zlib`) : **aucune dépendance ajoutée**.
- `src/server.js` : deux middlewares branchés juste avant `express.static`.
- Comportement : `Vary: Accept-Encoding` sur ces fichiers ; sans gzip accepté, le fichier brut est servi comme avant ; ETag et 304 ; cache mémoire du résultat gzip, recalculé si le fichier change.
- Exclus volontairement : `sw.js` (garde ses en-têtes « no-cache »), les images et l'APK.
- `test/static-gzip-unit.js` : 9/9 contrôles (contenu décompressé identique, sans gzip, racine, sw.js, image, traversée de dossier, 304, HEAD, mise à jour du fichier).

## Gain attendu (mesuré avec la même méthode, sans Express)
- 4G simulée : 2,29 Mo → 0,72 Mo transférés ; chargement 5,8 s → 3,9 s.
- Détail : `docs/MESURE_PERFORMANCE_2026-11-21.md`.

## Vérification
- Syntaxe `server.js` et `static_gzip.js` : OK.
- Suite statique : aucun nouvel échec (26 préexistants inchangés).
- **Non vérifié** : le serveur Express réel avec ce middleware (dépendances non installées dans la session). À confirmer par `curl -H "Accept-Encoding: gzip" -I …/app.js` après déploiement.
