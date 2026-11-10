# Rapport — Étape 35 : sécurité des accès directs

## But
Vérifier par assertions statiques les garde-fous qui protègent les appels API directs, même si un utilisateur contourne l’interface web.

## Contrôles ajoutés
- Authentification JWT avant les routes privées.
- Contrôle de session associée à l’utilisateur et session non révoquée.
- Vérification de l’affectation, de l’état actif et de l’appartenance client de la station.
- Barrière Super Admin pour les routes financières de plateforme.
- Séparation des routes publiques et privées et garde-fous des tests d’intégration destructifs.

## Vérifications à effectuer en environnement local de test
1. Créer deux clients de test A et B, chacun avec une station et un utilisateur standard.
2. Se connecter avec l’utilisateur A et relever l’identifiant de sa station.
3. Appeler directement une route métier autorisée avec l’identifiant de station A : l’appel doit suivre ses permissions normales.
4. Répéter l’appel avec l’identifiant de station B : l’API doit refuser l’accès (normalement HTTP 403).
5. Appeler `/api/me` sans jeton et avec un jeton invalide : l’API doit renvoyer HTTP 401.
6. Appeler une route `/api/admin/platform/...` avec un compte client : l’API doit renvoyer HTTP 403.
7. Vérifier que les données de A ne sont jamais renvoyées dans les réponses de B.

**Important :** utiliser uniquement une base jetable/sauvegardée de test. Ne pas exécuter `test/security.js` sur la production : il crée des comptes de test et peut modifier des données. Cette livraison n’a pas exécuté de tests HTTP réels ni de test PostgreSQL multi-client ; elle ne prétend donc pas certifier ces comportements en exécution.
