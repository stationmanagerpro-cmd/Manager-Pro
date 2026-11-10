# Rapport — Étape 38

## Objectif
Rendre le script de test d’isolation entre stations plus prudent et réduire les faux positifs.

## Modifications
1. Validation stricte du protocole et des composants de l’URL de l’API.
2. Redirections HTTP désactivées dans les requêtes du test.
3. Délai maximal de 10 secondes par requête.
4. Contrôle positif : la lecture de `/products` sur la station A doit réussir avant le contrôle croisé vers la station B.

## Vérifications locales
- `node --check test/tenant-isolation-integration.js` : réussi.
- `node --check test/step36-tenant-isolation-integration-static.js` : réussi.
- `node test/step36-tenant-isolation-integration-static.js` : 16/16.
- `node test/tenant-isolation-static.js` : 11/11.
- `node test/step35-direct-access-security-static.js` : 11/11.
- `node test/contract-module-gates-static.js` : 8/8.
- `node test/homepage-mobile-static.js` : 8/8.

## Limites
Ces résultats ne démontrent pas le comportement du serveur en conditions réelles. Le test d’intégration `test/tenant-isolation-integration.js` n’a pas été exécuté contre l’API et aucune base de données n’a été contactée. Son exécution doit se faire uniquement sur une instance locale de test avec deux comptes et deux stations distincts.
