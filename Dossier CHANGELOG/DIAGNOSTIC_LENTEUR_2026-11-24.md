# Diagnostic de lenteur au démarrage (2026-11-24)
- Constat : après la mise en parallèle des lectures de démarrage, l'utilisateur mesure encore 17 s (20 s avant). Les ressources statiques sont petites (bandeau 150 Ko) ; la cause réelle n'est pas mesurable depuis mon environnement (production injoignable).
- Changement : `public/app.js` enregistre la durée de chaque appel API (`window.__apiLog`, 40 derniers) ; `public/ext-loader.js` affiche, dans la fenêtre d'actualisation et seulement après 8 s, « Fichiers : X s · appel Y s… » (3 appels les plus longs, en attente ou terminés). `public/app.css`, `sw.js` régénéré, `test/qr-static.js` 28/28.
- Vérifié : Chrome (simulation, /dashboard retardé de 14 s) : le diagnostic nomme /dashboard (attente 10,1 s).
- À faire : demander à l'utilisateur la capture de cette ligne pendant une actualisation lente, puis corriger la route ou l'étape désignée.
- Branche : perf/mesure.
