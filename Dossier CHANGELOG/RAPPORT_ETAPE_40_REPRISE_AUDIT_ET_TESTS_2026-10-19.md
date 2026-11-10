# Étape 40 — Reprise et correction de l'audit du cahier des charges

Date : 19 octobre 2026

## Objectif
Poursuivre le suivi des 18 fiches A1 à D4 et vérifier les conclusions de l'étape 39 avant d'engager une correction métier.

## Correction importante
L'audit précédent affirmait que `public/performance-motion.css` désactivait les animations. Cette conclusion était incorrecte : la feuille contient trois modes (`off`, `subtle`, `full`). Les modes actifs définissent des transitions et des effets au survol ; `prefers-reduced-motion: reduce` et le mode `off` désactivent les mouvements. Le test statique dédié confirme 12/12 contrôles. D2 est donc notée « contrôle statique réussi — intégration à vérifier », et non « non conforme ». Une vérification visuelle dans le navigateur reste nécessaire.

## Tests statiques relancés
Les 18 tests ciblés suivants ont été exécutés avec Node.js ; ils ont tous terminé avec succès : paie, configuration dashboard, réinitialisation client/quarts clôturés, sauvegarde globale, PDF, pièces jointes, mode sombre de la messagerie, recherche des destinataires, notifications non lues, droits de contact Superadmin, titre support, accès Fiscalité, abonnement expiré, icônes KPI, mouvements, centrage accueil, clé d'accès et accueil mobile.

Résultats détaillés observés dans la sortie :
- Dashboard client : 7/7
- Réinitialisation client : 8/8
- Sauvegarde globale : 10/10
- PDF : 8/8
- Pièces jointes : 7/7
- Mode sombre messagerie : 9/9
- Recherche destinataires : 11/11
- Notifications non lues : 13/13
- Droits contact Superadmin : 9/9
- Titre support : 10/10
- Fiscalité : 11 assertions
- Abonnement expiré : 13/13
- Icônes KPI : 8/8
- Mouvements : 12/12
- Centrage accueil : 6/6
- Clé d'accès : 6/6
- Accueil mobile : 8/8
- Paie : test `payroll-zero-amount-guidance-static` terminé avec `OK`

Le test A1 `test/branding-permissions.js` n'a pas été lancé car il exige un compte et un mot de passe. Aucun test navigateur complet et aucun test PostgreSQL d'intégration n'ont été exécutés. La base de production n'a pas été contactée.

## État prudent
Les tests statiques réussis prouvent uniquement la présence des conditions de code vérifiées. Ils ne prouvent pas l'intégration réelle, les permissions en HTTP, les parcours utilisateur, les calculs de paie avec données réelles, ni la restauration transactionnelle sur une base de test. A4/A5 et B5/C1 restent prioritaires pour des essais d'intégration isolés.
