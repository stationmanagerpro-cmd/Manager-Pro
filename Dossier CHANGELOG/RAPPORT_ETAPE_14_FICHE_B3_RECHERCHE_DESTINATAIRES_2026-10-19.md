# Étape 14 — Fiche B3 : recherche des destinataires de la messagerie

Date : 2026-10-19

## Changements
- Remplacement du champ demandant un ID employé par une recherche par nom, identifiant ou poste.
- Affichage des résultats dans une liste sélectionnable, avec nom, identifiant et fonction/rôle.
- Utilisation de `textContent` pour injecter les données utilisateur dans les résultats, afin d'éviter de traiter les noms comme du HTML.
- Ajout d'états de chargement, de résultat vide et d'erreur de recherche.
- Désactivation du bouton d'ouverture tant qu'aucun destinataire n'est sélectionné.
- Le serveur continue à limiter les résultats aux utilisateurs actifs du même client et plafonne la liste à 50 entrées. L'API de création de conversation conserve la validation d'un ID positif et le contrôle du client côté serveur.
- Ajout du test statique `test/messaging-recipient-search-static.js` et de la commande `npm run test:messaging-recipient-search`.

## Vérifications exécutées
- `node --check public/ext-messaging.js` : réussi.
- `node --check src/messaging.js` : réussi.
- `node test/messaging-recipient-search-static.js` : 10/10.
- `node test/messaging-dark-mode-static.js` : 9/9.
- `node test/messaging-attachment-security-static.js` : 7/7.
- `node test/roles-messaging-static.js` : 10/10.

## Limites
Les tests ci-dessus sont des contrôles statiques et syntaxiques. La recherche n'a pas été vérifiée dans un navigateur réel et aucune intégration avec une base PostgreSQL n'a été exécutée dans cette étape.
