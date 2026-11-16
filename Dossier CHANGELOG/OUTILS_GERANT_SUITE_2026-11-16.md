# Outils du gérant — suite (résumé hebdo, justificatifs, bandeau hors-ligne) — 2026-11-16

Base : origin/main f34bfd7 (« Ma journée » déjà en place : synthèse, objectif mensuel, classement). Le WIP local de la branche précédente (ad3468d) est abandonné : doublon avec « Ma journée ».

## Réalisé
- **Point 8 — Résumé hebdomadaire** : chaque lundi, une notification « résumé hebdomadaire » par station pour la semaine écoulée (ventes carburant + produits, litres, quarts clôturés, écart de caisse cumulé, meilleur vendeur, évolution vs semaine précédente). Une seule fois par station et semaine (table weekly_summaries_sent). Lecture à la demande : GET /reports/weekly-summary.
- **Point 9 — Justificatif photo** : après la saisie d'une dépense, l'auteur peut joindre une photo (JPEG/PNG/WebP/PDF, 1,5 Mo, 4 max). Contenu vérifié (signature du fichier). Seul l'auteur peut joindre. Table expense_receipts (migration 113). API : POST/GET /expenses/:id/receipts.
- **Point 10 — File hors-ligne visible** : le compteur existait mais était en bas à droite, sous le bouton ⚡. Il est maintenant un bandeau en haut, indique « Hors connexion » et « N en attente d'envoi », et « refusée(s) : à vérifier » en rouge.
- **Point 11 — Sauvegarde restaurable** : déjà présent (copies isolées par client : /admin/clients/:id/isolated-backups et isolated-restore, avec mot de passe Superadmin). Rien de nouveau construit.

## Fichiers
migrations/113_expense_receipts_weekly.sql ; src/manager_extras.js (nouveau) ; src/server.js ; public/ext-manager-extras.js (nouveau) ; public/app.js (prompt après dépense) ; public/index.html ; public/pwa.js ; public/app.css ; test/manager-extras-unit.js (nouveau, 7 contrôles) ; test/links-audit-static.js (3 routes API seules documentées) ; sw.js.

## Tests
- manager-extras-unit : 7/7.
- Suites statiques/unitaires : résultats identiques à origin/main (7 échecs pré-existants).
- build sw --check OK ; node --check OK.

## NON vérifié / limites
- Migration 113 et requêtes SQL non exécutées sur PostgreSQL réel.
- Écrans non vus (bandeau, prompt justificatif). Le prompt ne s'affiche qu'après une dépense créée avec succès.
- Consultation des justificatifs : API seule, pas d'écran (documenté dans links-audit). Le résumé hebdo n'a pas d'écran dédié (notification).
- Numérotation : 113 libre sur main à ce jour ; à surveiller si un autre intervenant pousse une 113.
