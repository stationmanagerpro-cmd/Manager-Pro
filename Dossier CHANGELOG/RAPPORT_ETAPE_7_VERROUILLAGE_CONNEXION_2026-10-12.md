# Rapport — Étape 7 : verrouillage temporaire des comptes après échecs de connexion

Date : 2026-10-12

## Constat et correction

Le flux de connexion bloquait définitivement un compte dès que `failed_logins` atteignait le seuil de cinq échecs, car aucune échéance ni voie de déverrouillage automatique n'existait dans ce flux. Cela pouvait imposer une intervention manuelle et permettre un déni de service ciblé contre un utilisateur.

Corrections apportées :

- `src/auth.js` vérifie maintenant une échéance `lockout_until` plutôt que de traiter le compteur seul comme un verrou permanent.
- Après cinq échecs, le compte est verrouillé pour 15 minutes.
- Le compteur et l'échéance sont mis à jour atomiquement en SQL ; une tentative échouée après expiration repart à 1.
- Une connexion réussie remet à zéro le compteur et l'échéance.
- `migrations/032_user_temporary_lockout.sql` ajoute la colonne de manière additive et attribue une échéance de transition aux comptes déjà bloqués par l'ancien mécanisme.
- `test/auth-lockout-static.js` et le script `test:auth-lockout-static` vérifient statiquement ces propriétés.

## Vérifications exécutées

- Nouveau contrôle statique du verrouillage : **6/6**.
- Sécurité HTML dynamique : **6/6**.
- Sécurité de l'interface d'import : **7/7**.
- Sécurité des migrations : **7/7**.
- Isolation client/station : **11/11**.
- Garde-fous des modules contractuels : **8/8**.
- Idempotence des opérations métier : **20/20**.
- Idempotence des achats/paiements fournisseurs : **9/9**.
- Pages de détail et contrôles associés : **19/19**.
- Total des contrôles statiques exécutés : **93/93**.
- Vérification syntaxique Node.js de tous les fichiers `.js` et `.cjs` du projet : réussie ; `src/auth.js` a également été vérifié séparément.
- Intégrité de l'archive ZIP : vérifiée après création.

## Limites et précautions

- Les tests sont statiques : aucune simulation complète de tentatives de connexion avec base PostgreSQL n'a été réalisée.
- La suite `npm test` complète n'est pas certifiée dans cet environnement ; les dépendances d'exécution et une base de test ne sont pas garanties disponibles.
- La migration `032_user_temporary_lockout.sql` n'a été appliquée à aucune base. **Le nouveau code dépend de cette colonne** : sur un environnement de test, appliquer la migration avant de démarrer cette version. Ne pas déployer le code avant la migration correspondante.
- Selon le mécanisme de migration du projet, la sauvegarde préalable peut nécessiter `pg_dump`. Préparer et vérifier une sauvegarde indépendante avant toute migration.

## Prochaine vérification recommandée

Dans un environnement isolé : vérifier 4 échecs, le 5e échec, le refus pendant 15 minutes, le déverrouillage après expiration, le retour du compteur à zéro après connexion valide, ainsi que le comportement avec plusieurs requêtes simultanées. Ensuite poursuivre l'audit des permissions serveur et des frontières entre stations.
