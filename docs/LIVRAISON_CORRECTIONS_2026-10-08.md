# Livraison de corrections — Station Manager Pro (8 octobre 2026)

## Corrections intégrées

- Conservation de session par `localStorage` (jeton et station sélectionnée) et nettoyage lors d'une erreur 401.
- Navigation silencieuse vers une vue autorisée au lieu d'afficher une page interdite.
- Liaison de `VM.settings_hub` à la fonction de paramètres existante pour éviter l'erreur `VM[k] is not a function`.
- Préférences de thème personnel, protégées par les autorisations, et migration `028_personal_theme_and_visibility.sql`.
- Formulaire d'ouverture de quart enrichi : participation, rôle dans le quart (dont chef de quart), affectation aux pompes et index initiaux.
- Export du journal d'audit filtré : CSV compatible Excel et impression/enregistrement PDF via le navigateur.
- Libellés d'interface nettoyés pour ne plus exposer certains repères internes de développement.
- Rappel d'abonnement : « Pensez à réabonner votre station avant la fin de votre abonnement. »
- Infobulles ajoutées aux boutons qui n'en avaient pas.
- Séparation de sécurité conservée : l'Administrateur Principal gère la plateforme, les licences et les contrats, sans accès aux données métier privées des stations.

## Vérifications exécutées

- `node --check` sur les fichiers JavaScript des répertoires `src`, `public` et `test` : réussi.
- `npm test` : non exécuté jusqu'au bout, car les dépendances ne sont pas installées dans cet environnement (`Cannot find module 'dotenv'`). La tentative d'installation des dépendances a expiré. Aucun test d'intégration PostgreSQL n'est donc déclaré réussi.

## Installation

1. Décompresser l'archive dans un nouveau dossier.
2. Copier `.env.example` vers `.env` et renseigner `DATABASE_URL`, `JWT_SECRET` et, si nécessaire, les paramètres SMTP.
3. Installer les dépendances avec `npm ci`.
4. Appliquer les migrations SQL dans l'ordre, y compris `028_personal_theme_and_visibility.sql`, à la base PostgreSQL cible.
5. Lancer `npm test`, puis `npm start`.
6. Tester avec des comptes séparés (Administrateur Principal, Gérant, employé) et vérifier les autorisations sur la base de recette avant déploiement en production.

## Limites importantes

Cette archive est une version de correction du code existant, pas une preuve de validation complète en production. Les envois SMTP nécessitent des identifiants réels; les migrations et tests d'intégration doivent être exécutés sur une base de recette. Les règles de paie maliennes doivent être validées par un spécialiste local avant usage officiel.
