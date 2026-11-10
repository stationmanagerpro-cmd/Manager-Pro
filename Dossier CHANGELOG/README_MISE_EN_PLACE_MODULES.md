# Mise en place — Alertes e-mail et module Fiscalité

Ce guide complète le README principal de Station Manager Pro. Il documente la configuration des alertes SMTP et le diagnostic de la Fiscalité qui reste invisible malgré l'autorisation du contrat.

## 1. Préparation sûre

1. Ouvrir un terminal dans le dossier du projet.
2. Vérifier que `.env` est ignoré par Git : `git check-ignore -v .env`.
3. Avant une migration, créer une sauvegarde vérifiable de PostgreSQL (pour Neon, créer une branche de secours) et confirmer que `DATABASE_URL` vise la bonne base.
4. Installer les dépendances avec `npm install` (Windows PowerShell : `npm.cmd install` si l'exécution de `npm.ps1` est bloquée).

Ne jamais publier `.env`, `DATABASE_URL`, `JWT_SECRET` ou `SMTP_PASS`.

## 2. Alertes e-mail

Le projet inclut déjà `nodemailer` dans `package.json`. Définir dans `.env` local et dans les variables du service Render :

```dotenv
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=adresse-expediteur@example.com
SMTP_PASS=jeton-ou-mot-de-passe-application
ADMIN_EMAIL=adresse-destinataire@example.com
```

Utiliser les paramètres SMTP fournis par votre fournisseur de messagerie. Pour Gmail, préférer un mot de passe d'application si le compte le permet; ne pas mettre le mot de passe normal du compte dans le dépôt. Le port 587 utilise généralement STARTTLS; le port 465 utilise généralement TLS implicite. Ne pas activer l'envoi en production avant un test avec un destinataire contrôlé.

Les variables seules ne garantissent pas l'envoi : vérifier que les règles d'alertes sont activées dans l'interface, que les destinataires sont renseignés, puis examiner les journaux serveur au déclenchement d'un événement. Vérifier également le dossier indésirable. Si aucun e-mail ne part, contrôler l'hôte/port, les identifiants SMTP et la connectivité sortante de l'hébergeur.

## 3. Pourquoi la Fiscalité peut rester invisible

L'affichage et les routes du module exigent plusieurs conditions distinctes :

- l'autorisation contractuelle du client (`can_access_fiscal` ou `modules.fiscal`, ou un sous-module fiscal autorisé);
- la permission du rôle client `fiscal.access`;
- un utilisateur lié à un client, et non le compte Superadmin de plateforme;
- les migrations fiscales et la permission présentes dans la base réellement utilisée.

Le défaut identifié dans le code est la migration `058_fiscalite_admin_platform_only.sql` : elle retirait `fiscal.access` au rôle `ADMIN`, qui est aussi le rôle d'administrateur des comptes clients. Le Superadmin est déjà séparé par le rôle `SUPERADMIN` et `users.is_global`. La migration additive `059_restore_client_admin_fiscal_permission.sql` rétablit donc `fiscal.access` au rôle client `ADMIN` tout en maintenant l'interdiction pour `SUPERADMIN`.

## 4. Appliquer la correction fiscale

1. Faire une sauvegarde ou une branche de secours de la base.
2. Vérifier que le projet contient `migrations/059_restore_client_admin_fiscal_permission.sql`.
3. Depuis le dossier du projet, exécuter `node src/migrate.js --no-backup` uniquement après avoir confirmé la bonne `DATABASE_URL` et la sauvegarde.
4. Vérifier dans l'interface des rôles que le compte client a la permission Fiscalité, puis vérifier dans la fiche contrat du client que le module Fiscalité et les sous-modules voulus sont autorisés.
5. Déconnecter/reconnecter l'utilisateur client (les permissions sont chargées lors de l'authentification), puis actualiser sans cache si nécessaire.
6. Tester `/api/fiscal/profile` et `/api/fiscal/modules` avec une session client autorisée. Ne pas tester avec le compte Superadmin : l'accès opérationnel doit lui être refusé.

Si le menu reste absent, lancer `npm run diagnose:fiscal` et consulter les journaux de démarrage de l'API. Vérifier notamment la présence de `schema_migrations`, `permissions` avec `fiscal.access`, et les tables `fiscal_profiles`, `fiscal_module_activations`, `fiscal_periods`, `fiscal_rules`, `fiscal_deadlines`, `fiscal_documents` et `fiscal_checklist_items`. Ne pas marquer manuellement une migration comme appliquée et ne pas supprimer/recréer les tables.

## 5. Vérifications automatisées

Exécuter :

```bash
npm run test:fiscal-access
npm run test:fiscal-frontend-access
npm run test:fiscal-access-c1
npm run test:fiscal-schema-readiness
npm run test:contract-module-gates
```

Ces tests statiques contrôlent des éléments du code, mais ne remplacent pas un test connecté à une base PostgreSQL réelle. Après déploiement, consulter les journaux Render, tester une session d'un compte client autorisé et confirmer que le Superadmin reste bloqué du parcours fiscal.

## 6. Déploiement

Envoyer le code sur GitHub sans `.env`, laisser Render redéployer, puis vérifier `/api/health`. Si une migration est incluse, l'appliquer d'abord à la base ciblée après sauvegarde, conformément au guide de déploiement du projet. Ne jamais utiliser une base de production pour des essais destructifs.
