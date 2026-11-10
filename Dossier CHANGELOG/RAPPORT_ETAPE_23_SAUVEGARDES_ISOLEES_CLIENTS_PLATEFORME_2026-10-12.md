# Rapport technique — Étape 23
## Sauvegardes isolées par client et sauvegarde séparée du Super Admin

Date : 12 octobre 2026

## Objectif

Séparer les sauvegardes du compte client et celles de la plateforme administrée par le Super Admin, afin qu'une opération de sauvegarde/restauration d'un client ne remplace jamais les données des autres clients.

## Changements livrés

### 1. Archives isolées par client
- Nouveau module `src/tenant-backups.js`.
- Routes Super Admin pour créer, lister, télécharger et restaurer une archive par client.
- Archive logique JSON compressée (`.json.gz`), identifiée par le numéro du client.
- Le contenu est constitué des lignes directement rattachées à `client_id`/`station_id` et des lignes dépendantes reliées par clés étrangères.
- Les sessions de connexion et l'historique des sauvegardes ne sont pas inclus dans l'archive client.
- Les archives ne contiennent pas les autres clients. Une archive présentée pour un autre numéro de client est refusée.
- La restauration s'effectue dans une transaction SQL : une erreur annule les changements. Une sauvegarde isolée de l'état courant est créée avant la restauration.
- La réinitialisation client crée aussi une sauvegarde préalable puis efface uniquement les données opérationnelles détectées pour ce client. Elle conserve l'identité du client, ses stations, ses comptes utilisateurs et le contrat/licence gérés par la plateforme.
- Le mot de passe du Super Admin est vérifié côté serveur pour chaque opération sensible.

### 2. Sauvegarde séparée de la plateforme
- Nouvel écran dans **Paramètres → Maintenance de la plateforme**.
- Archive plateforme distincte comprenant le compte Super Admin, les rôles/permissions liés et les paramètres globaux `app_settings` compatibles.
- Aucune ligne de vente, stock, RH ou finance des clients n'est incluse dans cette archive.
- Une restauration plateforme ne touche pas les données métier clients; elle restaure uniquement les éléments de plateforme explicitement autorisés.
- Une copie de sécurité plateforme est créée avant une restauration plateforme.

### 3. Historique
- Migration additive `migrations/041_isolated_backup_operation_types.sql` autorisant les nouveaux types d'opérations dans `backup_logs` et ajoutant un index sur le périmètre journalisé.
- Historique des sauvegardes disponible dans la fiche du client, filtré par `scope` et `client_id`.
- Historique séparé des archives de plateforme dans les paramètres Super Admin.
- Les échecs de création de sauvegarde sont journalisés. L'historique des sauvegardes PostgreSQL globales existant est conservé.

### 4. Activation contrôlée
Les fonctionnalités sensibles restent désactivées par défaut :
- `CLIENT_RESTORE_ENABLED=0`
- `CLIENT_RESET_ENABLED=0`
- `PLATFORM_RESTORE_ENABLED=0`
- `RESTORE_ENABLED=0` (restauration globale existante)
- `RESET_GLOBAL_ENABLED=0` (réinitialisation globale existante)

Les nouveaux contrôles d'activation sont indépendants afin de ne pas activer la réinitialisation globale lorsqu'on souhaite tester uniquement la restauration d'un client.

## Vérifications exécutées

- 27 scripts de tests statiques exécutés : **27/27 réussis**.
- 105 fichiers JavaScript/CJS passés à `node --check` : **105/105 sans erreur de syntaxe**.
- 16 contrôles propres à l'étape 23 : **16/16 réussis**.
- Archive ZIP vérifiée après génération.

## Limites et précautions importantes

3. Le moteur d'export utilise les colonnes `client_id`/`station_id` et le graphe des clés étrangères pour déterminer le périmètre. Si une table métier personnalisée n'est ni directement rattachée à un client/station ni reliée par une clé étrangère aux lignes exportées, elle pourrait ne pas être incluse. Une revue de l'inventaire du schéma réel et un test de restauration sur une base de test sont obligatoires avant activation.
4. La restauration client vise un client existant dans un schéma compatible et portant le même identifiant. Ce n'est pas un installateur de base vide : elle ne recrée pas le schéma ni l'ensemble de la plateforme.
5. Les archives logiques client et plateforme sont différentes des dumps PostgreSQL complets `.sql.gz`. Conserver aussi un dump complet hors du PC pour la reprise complète d'une panne serveur/base.

## Procédure de validation recommandée

1. Faire un dump PostgreSQL complet et confirmer que le fichier est téléchargeable et lisible.
2. Appliquer la migration 041 sur une base de test clonée, jamais d'abord en production.
3. Créer des données fictives dans deux clients différents; générer l'archive de chaque client et vérifier qu'aucune valeur de l'autre client n'y apparaît.
4. Restaurer une archive dans son client de test et confirmer que les ventes/stocks/rapports correspondent à la sauvegarde.
5. Tenter de restaurer l'archive du client A dans le client B : l'API doit refuser l'opération.
6. Tester le reset client et confirmer que les données du second client, le contrat et les comptes de connexion sont conservés.
7. Créer/restaurer l'archive plateforme et vérifier que les données clients n'ont pas changé.
8. Garder les variables d'activation à `0` tant que tous ces tests ne sont pas réussis.
