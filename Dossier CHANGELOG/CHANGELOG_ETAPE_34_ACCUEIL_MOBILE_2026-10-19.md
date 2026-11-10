# Étape 34 — Accueil public et clé d’accès sur mobile

Date : 19 octobre 2026
Base : archive de l’étape 33.

## Changements

- Ajout de règles CSS responsive pour la navigation publique sur écran étroit : centrage de la marque, retour à la ligne des liens et cibles tactiles d’au moins 44 px.
- Passage du contenu principal, des cartes de services et de la galerie à une colonne sur petits écrans.
- Ajustement des boutons d’appel à l’action pour éviter les éléments trop serrés.
- Dialogue de clé d’accès limité à la hauteur disponible, champ à largeur complète et boutons tactiles.
- Le flux de vérification serveur de la clé n’a pas été modifié.

## Tests statiques exécutés

- `test/homepage-mobile-static.js` : 8/8.
- `test/homepage-centering-static.js` : 6/6.
- `test/home-login-key-static.js` : 6/6.
- `test/kpi-icons-d1-static.js` : 8/8.
- `test/tenant-isolation-static.js` : 11/11.
- `node --check public/ext-home.js` et `node --check test/homepage-mobile-static.js` : réussis.

## Limites

Aucun navigateur mobile réel ni test d’API authentifié n’a été exécuté. Le rendu doit encore être vérifié sur Android/iOS et sur les largeurs d’écran représentatives. Aucun changement de base de données n’a été effectué.
