# Étape 56 — Diagnostic sûr du schéma pour la fiche fournisseur

## Constat
La capture fournie affiche « Base de données non à jour » sur la fiche fournisseur. Le gestionnaire d'erreurs convertissait les erreurs PostgreSQL `42P01` (table absente) et `42703` (colonne absente) en une instruction directe de lancer les migrations. Cela ne permet pas de savoir quelle table/colonne manque et peut être dangereux si l'historique de migration ne correspond pas au schéma existant.

## Changement
- Le message invite maintenant à consulter les journaux du serveur pour identifier la requête concernée.
- Il exige une sauvegarde indépendante avant migration et la vérification de `schema_migrations`.
- Il indique de ne pas réinitialiser la base et de s'arrêter si l'historique est vide alors que des données existent.
- Aucun changement de schéma n'est appliqué automatiquement ; aucune base réelle n'a été modifiée.

## Vérifications
Test statique dédié : `node test/step56-schema-mismatch-message-static.js`.
Validation de syntaxe : `node --check src/core.js`.

## Limites
Cette étape sécurise le diagnostic, elle ne corrige pas à elle seule la migration manquante. La correction définitive dépend du nom exact de la table/colonne mentionné dans les journaux et de l'état réel de la base. Ne pas lancer de migration en production sans sauvegarde vérifiée et audit de `schema_migrations`.
