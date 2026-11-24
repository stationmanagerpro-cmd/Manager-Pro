# Démarrage plus rapide à l'actualisation (2026-11-24)
- Plainte : ~20 s d'attente à l'actualisation.
- Cause constatée dans le code : au démarrage, `boot()` enchaînait une par une : /me → licence → apparence → thème → couleurs du menu → mouvement (≈ 6 allers-retours réseau en série) avant d'afficher la première vue.
- Changement : `public/app.js` — après /me, ces lectures partent ensemble (`prefetchBoot`) ; chaque fonction d'origine les consomme une fois, dans le même ordre (l'ordre d'application des thèmes est inchangé). La station est choisie un peu plus tôt, avec la même règle. `sw.js` régénéré ; `test/qr-static.js` 26/26.
- Mesuré (Chrome, API simulée, 400 ms par appel) : page prête en 3,7 s avant → 2,2 s après (3 allers-retours économisés). Gain réel proportionnel à la latence réseau.
- Non vérifié : durée réelle en production ; je n'ai pas pu mesurer les 20 s. Pistes restantes non traitées : démarrage à froid / redémarrage après déploiement, 105 scripts au premier chargement sans cache, attente de l'image du bandeau (jusqu'à 5 s), requêtes en double (/dashboard, /messaging/unread).
- Tests : 30 tests statiques touchant app.js relancés, tous OK.
- Branche : perf/demarrage.
