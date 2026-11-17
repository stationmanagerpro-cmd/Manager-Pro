# Moyens de paiement : liste des comptes limitée aux comptes liés — 17 novembre 2026

## Problème
Dans Finance › Moyens de paiement, la colonne « Compte rattaché » listait tous les comptes de la station, y compris les comptes inactifs et les comptes d'une autre nature (un moyen « Carte bancaire » pouvait se voir proposer un compte Mobile Money).

## Correction (`public/ext-fin.js`)
- Le menu n'affiche plus que les comptes **actifs** de la nature compatible avec le moyen :
  - Virement / banque et Carte bancaire → comptes bancaires ;
  - Mobile Money, Orange Money, Wave → comptes Mobile Money ;
  - Autre → tous les comptes actifs.
- Le compte déjà rattaché reste affiché même s'il ne correspond plus, pour ne jamais changer la valeur affichée sans action de l'utilisateur.
- « Aucun (non suivi) » reste disponible pour détacher un moyen.

## Non modifié
- Le menu « Mode » du formulaire Dépense n'a pas été changé : la demande concernait la section Moyens de paiement.
- Le serveur n'a pas été modifié : la règle de rattachement (`POST /money/methods`) existe déjà.

## Tests
- `test/finance-liaisons-static.js` : OK.
- `test/money-match-unit.js` : 9/9.
- `test/station-scope-sales-finance-static.js` : 5/5.
- `test/sw-coherence-static.js` : 7/7 (service worker régénéré).

## Non vérifié
- Affichage réel dans le navigateur (menus déroulants avec comptes actifs et inactifs).
