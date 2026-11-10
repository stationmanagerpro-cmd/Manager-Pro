# Étape 29 — Fiche B3 : recherche de destinataires insensible aux accents

## Constat

L'API de recherche de messagerie utilisait `ILIKE`, ce qui traite la casse mais ne garantit pas une recherche insensible aux accents.

## Correction

La requête plie en minuscules et remplace les accents français usuels avant la comparaison sur login, nom complet et poste. Aucun ajout d'extension PostgreSQL n'est requis. Les restrictions d'isolation client, d'utilisateur actif, d'exclusion de l'utilisateur courant et de plafond de 50 résultats sont conservées.

## Vérifications exécutées

- `node --check src/messaging.js` : réussi.
- `node test/messaging-recipient-search-static.js` : 11/11.
- Tests statiques de messagerie (pièces jointes, mode sombre, recherche, notifications non lues, contact Superadmin, titre/support, rôles) : exécutés dans cette étape.

## Limites

Aucun test de navigateur ni requête d'intégration sur PostgreSQL n'a été exécuté. La recette doit confirmer des recherches avec et sans accents dans un compte de test, ainsi que l'isolement entre deux clients.
