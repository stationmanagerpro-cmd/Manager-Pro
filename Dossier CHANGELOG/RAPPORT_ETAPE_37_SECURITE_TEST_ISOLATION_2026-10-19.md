# Rapport — Étape 37 : test d'isolation plus sûr

## Changements
Le test multi-clients ne reçoit plus les mots de passe en arguments de commande. Il lit les six paramètres depuis `ISO_TEST_LOGIN_A`, `ISO_TEST_PASSWORD_A`, `ISO_TEST_STATION_A`, `ISO_TEST_LOGIN_B`, `ISO_TEST_PASSWORD_B` et `ISO_TEST_STATION_B`.

Le test vérifie aussi que `GET /me` retourne HTTP 401 sans jeton et avec un jeton invalide, avant de connecter les deux comptes et de tester l'accès croisé à `/products`.

## Précautions importantes
- Utiliser uniquement une instance locale reliée à une base de test et deux comptes de test.
- Le script refuse les hôtes qui ne sont pas `localhost`, `127.0.0.1` ou `::1`.
- Les données métier ne sont pas insérées, modifiées ou supprimées. Toutefois, les connexions valides créent des sessions et des journaux d'audit ; une connexion invalide peut incrémenter le compteur d'échecs. Le test n'est donc pas strictement sans effet sur la base.
- Le test HTTP réel et le test PostgreSQL multi-client n'ont pas été exécutés lors de cette livraison. Seuls les contrôles statiques et la syntaxe du script ont été vérifiés.

## Exécution PowerShell
Configurer les variables d'environnement dans la session PowerShell, puis lancer :

```powershell
$env:API = 'http://localhost:3000/api'
$env:ISO_TEST_LOGIN_A = 'compte_test_A'
$env:ISO_TEST_PASSWORD_A = 'mot_de_passe_test_A'
$env:ISO_TEST_STATION_A = 'ID_NUMERIQUE_A'
$env:ISO_TEST_LOGIN_B = 'compte_test_B'
$env:ISO_TEST_PASSWORD_B = 'mot_de_passe_test_B'
$env:ISO_TEST_STATION_B = 'ID_NUMERIQUE_B'
node test/tenant-isolation-integration.js
```

Ne pas inscrire de mots de passe de production dans ces variables et supprimer les variables de la session après le test avec `Remove-Item Env:ISO_TEST_*`.
