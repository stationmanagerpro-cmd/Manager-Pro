# Étape 55 — Diagramme de performance employé

## Modification
- Ajout d'un diagramme horizontal du chiffre d'affaires attribué par produit dans l'onglet **Performance** du profil RH.
- Le graphique reprend les résultats déjà fournis par `/hr/employees/:id/performance` et respecte donc la période sélectionnée.
- Le tableau détaillé par produit et la ventilation du carburant par pompe restent présents.
- Un état vide est affiché lorsqu'aucune donnée produit n'est disponible. Si Chart.js n'est pas chargé, la fiche et ses tableaux restent utilisables.
- Les montants du graphique sont affichés en FCFA dans l'infobulle.

## Vérifications exécutées
- `node --check public/ext-core.js` : réussi.
- `node test/step55-employee-performance-chart-static.js` : 5/5 contrôles réussis.
- `node test/b1-messaging-attachments-direct-static.js` : 13/13.
- `node test/step51-client-ad-popup-static.js` : 8/8.
- `node test/client-company-name-header-static.js` : 10/10.
- `node test/access-keys-unit.js` : 8/8.
- `node test/messaging-attachment-security-static.js` : 7/7.

## Limites
Vérifications statiques et syntaxiques uniquement. Aucun test navigateur réel ni test de connexion à PostgreSQL n'a été exécuté pour cette étape. Le diagramme dépend des données de performance renvoyées par l'API et de la disponibilité de Chart.js.
