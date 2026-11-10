# Étape 36 — Test d'intégration multi-clients en lecture seule

## Objectif
Fournir un test exécutable qui vérifie, sur une instance locale de test, qu'un compte non global affecté à la station A ne peut pas lire les produits de la station B.

## Sécurité
- L'URL `API` est limitée à `localhost`, `127.0.0.1` ou `::1`.
- Le test n'insère, ne modifie et ne supprime aucune donnée métier.
- Les deux comptes doivent être non globaux et chacun doit être affecté à sa station respective.
- Le test échoue si le compte A obtient une réponse de succès sur `GET /products` en sélectionnant la station B.
- Utiliser uniquement une base locale de test et des comptes de test. Ne pas utiliser les comptes de production.

## Exécution
Démarrer l'application locale connectée à une base de test, puis exécuter depuis la racine du projet :

```powershell
$env:API = 'http://localhost:3000/api'
node test/tenant-isolation-integration.js 'login_client_A' 'mot_de_passe_A' 'ID_STATION_A' 'login_client_B' 'mot_de_passe_B' 'ID_STATION_B'
```

Remplacer les exemples par les identifiants de deux comptes non globaux et les identifiants de leurs stations de test. Les stations doivent être différentes. Éviter de placer des mots de passe réels dans l'historique du terminal.

## Vérification effectuée pendant la livraison
Le test statique valide les garde-fous du script, sans démarrer l'API et sans contacter PostgreSQL. Le test d'intégration lui-même n'a pas été exécuté ici faute d'une instance locale et de deux comptes de test fournis. Son résultat fonctionnel reste donc à confirmer dans l'environnement de test.
