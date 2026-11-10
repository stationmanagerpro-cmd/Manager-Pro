# Rapport — Étape 21 : sauvegarde, restauration et personnalisation des exports

Date : 12 octobre 2026

## Livrables fonctionnels

### 1. Sauvegarde et notifications email
- Réutilisation de la sauvegarde PostgreSQL réelle par `pg_dump` et du journal `backup_logs` existants.
- L'email de notification reste une confirmation de succès/échec réel, et non une simple confirmation d'action UI.
- Ajout de l'option facultative `BACKUP_EMAIL_ATTACH=1` pour joindre le fichier `.sql.gz` au message de confirmation. Taille maximale configurable via `BACKUP_EMAIL_ATTACH_MAX_MB` (1–20 Mo, défaut 10). Au-dessus de la limite, le message précise que le fichier n'a pas été joint.
- Les emails exigent un SMTP configuré et des destinataires dans `BACKUP_NOTIFY_EMAIL`, les paramètres déjà pris en charge ou les variables secondaires existantes.

### 2. Restauration d'une sauvegarde
- Route `POST /api/admin/maintenance/restore`, réservée au Super Admin.
- Upload binaire `.sql.gz`, limite configurée par `RESTORE_MAX_MB` (défaut 100 Mo, bornée entre 1 et 200 Mo), contrôle de l'en-tête gzip et vérification de la décompression avant de toucher à la base.
- Sauvegarde de sécurité obligatoire avant restauration.
- Restauration par `psql --single-transaction` : en cas d'erreur SQL, la transaction est annulée.
- Les sessions sont révoquées après restauration pour imposer une nouvelle connexion.
- `RESTORE_ENABLED=0` par défaut. L'activation doit être temporaire et la première restauration doit se faire sur une base de test dédiée.

### 3. Réinitialisation globale
- Route `POST /api/admin/maintenance/reset-global`, réservée au Super Admin.
- `RESET_GLOBAL_ENABLED=0` par défaut et phrase exacte `SUPPRIMER TOUTES LES DONNEES` exigée.
- Une sauvegarde réelle est créée avant l'opération.
- Suppression transactionnelle des données métier dans l'ordre des dépendances. Préservation du compte Super Admin, des rôles/permissions, de l'historique des migrations et des paramètres globaux d'application. Les comptes locaux et les sessions sont supprimés.
- Si une dépendance cyclique empêche un effacement ordonné, l'opération est annulée au lieu de forcer une suppression risquée.

### 4. Couleurs globales des rapports clients
- Nouvelle migration additive `migrations/038_client_report_export_preferences.sql`.
- Préférence `client_report_preferences` partagée par toutes les stations d'un client.
- Couleurs validées en `#RRGGBB`; contrôle backend par permission (`appearance.manage` ou `settings.edit`) et activation explicite par le Super Admin dans `client_contracts.features.can_customize_report_exports` ou `features.modules.report_colors`.
- L'interface client propose un panneau de couleurs lorsque l'utilisateur a la permission; les couleurs sont appliquées aux exports PDF/Excel utilisant le moteur de documents commun.
- Valeurs par défaut utilisées tant que le module contractuel n'est pas autorisé.

### 5. Rapports Super Admin en PDF
- Les rapports de plateforme gardent l'affichage et disposent maintenant d'un export PDF.
- Le bouton CSV est retiré de l'interface de rapports Super Admin.
- Les rapports restent limités aux données de plateforme (licences, factures et dépenses du service), distinctes des données opérationnelles des stations.

### 6. Audit des actions UI
- L'inventaire statique a parcouru 29 fichiers JavaScript publics, 388 gestionnaires d'événements inline et 219 noms de fonctions invoqués. L'analyse brute a remonté 14 noms qui correspondent à des utilitaires JavaScript/DOM ou à des fonctions partagées (par ex. `Math.max`, `document.getElementById`, `Po`, `fl`), pas à des actions métier manquantes après vérification.
- L'analyse a révélé des actions appelées mais non définies dans la fiche fournisseur (`editFour`, `payFour`) et les boutons support de messagerie (`msgSupportOpen`, `msgSupportToAdmin`). Ces fonctions ont été ajoutées et contrôlent les permissions avant l'action.
- Les boutons de restauration/réinitialisation indiquent maintenant l'état de désactivation défini par le serveur.
- Cette vérification est statique : elle ne constitue pas un clic manuel de chaque bouton en navigateur avec une base réelle. Les actions liées aux données doivent être validées dans une base de test isolée avant production.

## Résultats de vérification

- Syntaxe JavaScript : 102 fichiers vérifiés sans erreur.
- Tests statiques : 25 scripts exécutés, 282/282 contrôles réussis.
- Contrôles propres à l'étape : 19/19 sauvegarde/restauration, 14/14 couleurs/PDF/Excel plateforme, 8/8 actions UI.

## Configuration ajoutée dans `.env.example`

```env
BACKUP_EMAIL_ATTACH=0
BACKUP_EMAIL_ATTACH_MAX_MB=10
RESTORE_MAX_MB=100
RESTORE_ENABLED=0
RESET_GLOBAL_ENABLED=0
```

## Recommandations critiques

1. Télécharger et conserver une copie chiffrée hors du PC.
2. Vérifier la réception d'emails SMTP et tester les pièces jointes sur une sauvegarde de taille modeste.
4. Ne jamais activer le reset global sur la base active simplement pour tester un bouton.
5. Garder `RESTORE_ENABLED=0` et `RESET_GLOBAL_ENABLED=0` en dehors d'une fenêtre d'intervention contrôlée.
