# Rapport — Étape 6 : sécurisation de chaînes injectées dans les gestionnaires HTML

Date : 2026-10-12

## Objectif

Réduire le risque d’injection JavaScript dans quelques gestionnaires d’événements HTML qui incorporaient des chaînes issues de données métier ou de paramètres. Cette étape est additive et ne modifie ni le schéma PostgreSQL ni les règles métier côté serveur.

## Modifications

- `public/app.js` : ajout de `jsArg`, qui sérialise une valeur en littéral JavaScript, neutralise `<` et les séparateurs Unicode U+2028/U+2029, puis échappe le résultat pour son insertion dans un attribut HTML.
- `public/ext-fin.js` : le nom du fichier de sauvegarde est encodé comme segment de chemin et passé à `dlFile` via `jsArg`.
- `public/ext-core.js` : les références de reçus, numéros de bulletins et noms de fichiers d’export RH concernés sont sérialisés avant insertion dans les gestionnaires inline.
- `public/ext-p12.js` : les clés de paramètres sont sérialisées avant de passer à `editSettingKey` et `resetSettingKey`.
- `public/ext-p10.js` : les raccourcis du tableau de bord passent leur clé de vue via le sérialiseur.
- `test/dynamic-html-security-static.js` : ajout de six contrôles statiques.
- `package.json` : ajout du script `test:dynamic-html-security-static`.

## Vérifications réellement exécutées

- Vérification syntaxique Node.js : **84 fichiers JavaScript/CJS valides**.
- Sécurité HTML dynamique : **6/6** contrôles statiques.
- Sécurité de l’interface d’import : **7/7**.
- Sécurité des migrations : **7/7**.
- Isolation client/station : **11/11**.
- Garde-fous des modules contractuels : **8/8**.
- Idempotence des opérations métier : **20/20**.
- Idempotence des achats/paiements fournisseurs : **9/9**.
- Pages de détail et contrôles associés : **19/19**.
- Total des contrôles statiques exécutés dans cette étape : **87/87**.
- L’archive ZIP a été vérifiée après sa création.

## Limites importantes

- Ces contrôles sont statiques. Ils ne remplacent pas des tests navigateur ni des tests d’intrusion dynamiques.
- La suite d’intégration complète n’a pas été certifiée dans cet environnement ; les dépendances ne sont pas garanties installées.
- Aucune base PostgreSQL n’a été utilisée, aucune migration n’a été appliquée, et aucun test n’a été exécuté contre les données réelles.
- Cette étape couvre des occurrences identifiées, pas tous les gestionnaires inline de l’application. Un audit systématique complémentaire reste recommandé avant certification de production.

## Recommandation

Avant déploiement, installer les dépendances à partir du verrou (`npm ci`), exécuter la suite de tests complète dans un environnement de test isolé, puis effectuer une vérification navigateur avec des données adversariales dans les champs texte, les paramètres et les noms de fichiers. Ne pas appliquer les changements en production sans validation explicite et sauvegarde vérifiée.
