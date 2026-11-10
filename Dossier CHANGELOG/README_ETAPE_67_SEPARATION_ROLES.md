# Étape 67 — Séparation des rôles

Cette livraison renforce la séparation entre le Superadmin de plateforme (`is_global=true`, rôle `SUPERADMIN`) et l'administrateur local (`is_global=false`, rôle `ADMIN`).

## Déploiement
1. Faire une sauvegarde indépendante de la base.
2. Déployer le projet complet.
3. Exécuter `npm run migrate` pour appliquer `063_role_identity_consistency.sql`.
4. Vérifier que le compte Superadmin affiche « Super administrateur de plateforme » et que les comptes locaux conservent leurs rôles locaux.
5. Tester la connexion Superadmin, l'accès à la gestion des clients, puis l'accès local à une station et aux modules du contrat.

Ne pas marquer cette livraison comme validée en production avant ces essais sur une base de préproduction.
