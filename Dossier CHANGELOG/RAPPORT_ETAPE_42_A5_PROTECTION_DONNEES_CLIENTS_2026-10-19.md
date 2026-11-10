# Étape 42 — A5 : protection des données opérationnelles clients

Date : 2026-10-19

## Référence obligatoire

Le cahier des charges `Station_Manager_Pro_Cahier_des_charges.docx`, fiche A5, précise : « La réinitialisation globale ne touche jamais aux données opérationnelles des clients (celles-ci relèvent de A4). »

## Problème découvert

L'ancienne route `POST /admin/maintenance/reset-global` construisait une liste de toutes les tables publiques à effacer, en ne conservant qu'une petite liste de tables. Cette logique incluait les ventes, stocks, employés, finances et autres données opérationnelles des clients. Le libellé de l'interface le confirmait en annonçant l'effacement des données de toutes les stations. Ce comportement contredisait directement A5 et présentait un risque de perte massive de données.

## Mesures prises

- Retrait de la logique générique qui effaçait toutes les tables non présentes dans une whitelist.
- La route reste protégée par le rôle Superadmin, le mot de passe et la phrase de confirmation exacte.
- La route répond maintenant avec HTTP 409 et un message explicite tant que le périmètre strictement plateforme n'est pas défini et testé.
- Le statut API indique `global_reset_enabled: false` même si `RESET_GLOBAL_ENABLED=1` est configuré ; la variable seule ne peut donc plus réactiver la route destructive.
- Les écrans Maintenance et Système expliquent la suspension et orientent la réinitialisation d'un client vers A4.
- Ajout du test `test/a5-global-reset-tenant-protection-static.js` et de la commande npm `test:a5-global-reset-tenant-protection`.
- Mise à jour de la matrice de suivi A1–D4.

## Vérifications exécutées

- Syntaxe Node.js : `src/maintenance.js` valide.
- Syntaxe JavaScript UI : `public/ext-fin.js` et `public/ext-p12.js` valides.
- Protection A5 : 8/8 assertions.
- Maintenance et permissions : test statique de l'étape 22 réussi.
- Sauvegarde/restauration : 19/19 contrôles statiques.
- Sauvegardes isolées : 16/16 contrôles statiques.
- Sauvegarde complète : 10/10 contrôles statiques.
- Sécurité `pg_dump` : 10 assertions.
- Sécurité `psql` : 12 assertions.
- Restauration : 6/6 contrôles statiques.

## État et limites

**A5 reste partielle.** La protection contre la suppression des données client est renforcée, mais la fonction de réinitialisation globale est temporairement indisponible. Il faut définir les tables strictement propres à la plateforme, démontrer qu'aucune donnée client n'est liée à ces tables, puis tester le cycle sauvegarde/restauration/réinitialisation sur une base PostgreSQL isolée. Aucun accès à une base de production n'a été effectué et aucun test réel PostgreSQL n'a été exécuté dans cette étape.
