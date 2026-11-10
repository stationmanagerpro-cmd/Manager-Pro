# Correctif B3 — Recherche des destinataires sans accents

Date : 19 octobre 2026

- La recherche des destinataires compare maintenant les identifiants, noms et postes en ignorant la casse et les accents latins courants du français.
- Le comportement est réalisé avec `translate(lower(...))`, sans dépendre de l'extension PostgreSQL `unaccent`.
- Les garde-fous existants restent inchangés : utilisateurs actifs du même client, exclusion de l'utilisateur courant, résultat limité à 50, affichage client via `textContent`.
- Le test statique de B3 vérifie désormais explicitement le pliage de casse et d'accents.

Limite : la prise en charge des accents est limitée à la table de caractères explicitement indiquée dans la requête. Une validation navigateur et PostgreSQL reste nécessaire pour la recette fonctionnelle.
