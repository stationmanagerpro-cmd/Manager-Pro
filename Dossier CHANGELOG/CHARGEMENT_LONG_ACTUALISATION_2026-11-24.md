# Chargement long à l'actualisation (2026-11-24)
- Constat (capture utilisateur) : à l'actualisation, grand bloc gris (squelette) sans menu ni contenu ; le service a redémarré à 02:54. L'utilisateur confirme que la page finit par s'afficher (attente du serveur).
- Changement : `public/app.js` (`skeleton()` ajoute `.sk-wait`) et `public/app.css` : après 6 s de squelette, message « Chargement en cours… » + bouton « Recharger la page » (CSS seul, disparaît avec le squelette). `sw.js` régénéré ; `test/qr-static.js` 24/24.
- Vérifié : Chrome, opacité 0 à 2 s, 1 à 7,5 s.
- Non vérifié : cause de la lenteur serveur (redémarrage Render / démarrage à froid) ; production. Non modifié : l'emplacement réservé du bandeau (`#hero-slot`, travail d'un autre intervenant).
- Branche : fix/chargement-attente.
