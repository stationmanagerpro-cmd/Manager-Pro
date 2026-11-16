# Utilisation des comptes clients et score d'accrochage — 16/11/2026

## Ce qui est ajouté (Superadmin)
- **Onglet « Utilisation »** dans la fiche client : score d'accrochage (0–100) avec niveau Fort / Moyen / Faible / Dormant, temps d'utilisation, comptes actifs, connexions, écrans utilisés.
- **Rythme journalier** (courbe du temps cumulé), **rythme hebdomadaire** (jour × heure, heure de Bamako), **heures de connexion**.
- **Modules et écrans** : temps par écran, part du total, nombre de comptes utilisateurs.
- **Comptes** : temps, connexions, jours actifs, dernière activité, score par compte, écrans principaux. Un administrateur local ouvre son profil au clic. Export CSV.
- **Carte « Utilisation de ce compte »** sur le profil d'un compte administrateur (30 derniers jours).
- Période au choix : 7, 30 ou 90 jours. Tendance par rapport à la période précédente.
- Le détail du calcul du score est affiché dans la fiche.

## Méthode du score d'accrochage
- Client : régularité 30 % (jours actifs), adoption 25 % (comptes actifs / comptes), profondeur 20 % (écrans distincts, cible 15), intensité 25 % (minutes par compte et jour actif, cible 60).
- Compte : régularité 40 %, intensité 35 %, profondeur 25 % (cible 8 écrans).

## Données
- Nouvelle table `usage_detail` (migration **116**) : minutes par jour, heure, client, compte et écran. Alimentée par le battement existant (`POST /api/usage/ping`).
- Rétention : 400 jours (purge dans le planificateur existant).
- **L'historique ne commence qu'à la mise en service** : les heures et les écrans ne sont mesurés qu'à partir de ce déploiement. Le temps cumulé par jour existe depuis la migration 108.

## Correctif
- Le battement envoyait `window.__smpView` tel quel. Après l'écran carte, cette variable est un objet : la vue était alors ignorée. Le serveur ne retient désormais qu'une chaîne simple.

## Fichiers
- `migrations/116_usage_detail.sql` (nouveau)
- `src/usage_client.js` (nouveau) : agrégats et score, route `GET /api/admin/clients/:id/usage` (Superadmin)
- `src/usage.js` : suivi par client, compte, heure et écran
- `src/platform_insights.js` : purge de `usage_detail`
- `src/server.js` : montage du routeur
- `public/ext-client-usage.js` (nouveau) : rendu SVG, sans bibliothèque externe
- `public/ext-detail-pages.js` : onglet et carte
- `public/index.html` : chargement du script
- `public/sw.js` : régénéré
- `test/client-usage-unit.js` (nouveau), script `test:client-usage`

## Vérifications
- Tests unitaires du score, de la garde Superadmin, du suivi par écran et des codes 400/404 : 7/7.
- Requêtes exécutées sur PostgreSQL 16 avec la migration 116 et des données de test : totaux cohérents (heatmap = heures = 1 908 min), client vide → « Aucune donnée ».
- Tests statiques existants (détail, links-audit, erreurs silencieuses, rapport d'utilisation, Ma journée) : OK.
- Rendu contrôlé sur captures avec données simulées (Playwright).

## Non vérifié
- Déploiement sur Render et migration sur la base réelle.
- Affichage sur téléphone et en mode sombre.
- Fiche client complète avec les vraies données (les captures ont été faites avec des réponses de test).

## Point à arbitrer
- Le tableau des comptes affiche **tous les comptes du client** (gérant, comptable, caissier, pompiste), alors que la fiche utilisateurs ne montre que les administrateurs locaux. Confirmer ce choix au regard de la règle de séparation des rôles.

## Mise à jour 2 — stations et lisibilité
- **Stations** : migration 117 (`usage_detail.station_id`). Le battement lit l'en-tête `X-Station-Id`, retenu seulement si la station est affectée au compte et rattachée au même client ; sinon « Activité sans station identifiée ».
- **Stations du client** : tableau par station (temps, comptes actifs / rattachés, jours, écrans, score). Filtre « Vue » pour le panneau entier.
- **Comptes** : tous les comptes du client, avec stations rattachées et temps par station. En filtre station, temps et score de cette station uniquement.
- **Textes** : titre « Accrochage à la plateforme · <client> » ; états explicites (connexions sans temps, aucune activité, score non calculé) au lieu de « Dormant » trompeur.
- **Sources** : bloc « D’où viennent ces chiffres » avec tables utilisées, nombre d’enregistrements lus et heure du calcul (heure de Bamako).
- Vérification E2E : le vrai gestionnaire de battement écrit dans PostgreSQL, le vrai calcul relit (somme des stations = total du client).
