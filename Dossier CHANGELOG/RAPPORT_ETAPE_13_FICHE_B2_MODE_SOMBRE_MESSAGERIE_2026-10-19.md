# Étape 13 — Fiche B2 : mode sombre de la messagerie

Date : 2026-10-19

## Modifications
- Remplacement des styles en ligne des bulles de messages par des classes dédiées dans `public/ext-messaging.js`.
- Ajout dans `public/design-v2.css` de styles pilotés par les variables du thème (`--p`, `--on-p`, `--c`, `--t`, `--bd`) afin que les messages envoyés et reçus restent lisibles en thème clair comme sombre.
- Ajout de retours à la ligne et de règles de largeur pour limiter le débordement des messages et pièces jointes, notamment sur petit écran.
- Ajout du test statique `test/messaging-dark-mode-static.js` et de la commande `npm run test:messaging-dark-mode`.

## Vérifications exécutées
Les résultats précis sont consignés dans la réponse de livraison : vérification syntaxique JavaScript, test statique B2, test statique de sécurité des pièces jointes et validation JSON de `package.json`.

## Limites
Le test est statique : aucun navigateur n'a été lancé pour contrôler visuellement les contrastes. Les couleurs finales dépendent aussi de la configuration active du thème et des variables CSS chargées par l'application.
