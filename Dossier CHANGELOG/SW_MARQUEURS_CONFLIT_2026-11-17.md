# Service worker : marqueurs de conflit Git retirés — 17 novembre 2026

## Problème (critique)
`public/sw.js` contenait des marqueurs de conflit Git (`<<<<<<< HEAD`, `=======`, `>>>>>>>`). Le fichier n'était donc pas du JavaScript valide : le service worker ne pouvait ni s'installer ni se mettre à jour, et le cache hors ligne ne fonctionnait plus.
- Le marqueur est entré dans le commit `d8ac8dc` (regroupement du menu client), puis a été repris lors de mes rebases des commits `f3bc08a`, `39c522a` et `880d500`.
- Le test `sw-coherence-static` ne voyait pas le problème : il contrôle la valeur `CACHE`, pas la syntaxe du fichier.

## Correction
- `public/sw.js` restauré depuis le commit `bb34603` (version propre), puis régénéré avec `npm run build:sw`.
- Résultat : `node --check` OK, 0 marqueur, `CACHE = 'smp-static-bbb3f99e008'`, précache identique (65 entrées JS, dont `ext-sa-rules.js` et `ext-shell.js`).
- Recherche de marqueurs dans tout le dépôt suivi : aucun autre fichier touché.

## À faire pour éviter la récidive
- Ajouter au test `sw-coherence-static` un contrôle de syntaxe (`node --check`) et une recherche de marqueurs de conflit.

## Non vérifié
- Installation du service worker dans le navigateur après déploiement.
