# Suivi du cahier des charges — Station Manager Pro V1

Date de l'audit : 19 octobre 2026  
Référence : `Station_Manager_Pro_Cahier_des_charges.docx` (18 fiches A1 à D4).  
Base examinée : archive `Station_Manager_Pro_V1_MAJ_2026-10-19_etape38.zip`.

## Règle de lecture

- **Contrôle statique réussi** signifie que le test a vérifié des éléments du code ; cela ne prouve pas que le parcours fonctionne dans un navigateur ni que les requêtes fonctionnent avec PostgreSQL.
- **À valider en intégration** signifie qu'il reste à tester sur une instance locale de test avec des comptes/roles réels, en mode clair et sombre, et avec les autorisations prévues.
- Aucun test de ce rapport n'a contacté la base de production. Aucun compte ni secret n'a été utilisé.

## État fiche par fiche

| Fiche | Exigence du cahier | État après audit | Éléments vérifiés / reste à faire |
|---|---|---|---|
| A1 | Logo client impossible à changer | **À vérifier en intégration** | Le dépôt contient `src/branding.js` et des tests de permissions/logo. `test/branding-permissions.js` exige un compte et un mot de passe et n'a donc pas été exécuté. Vérifier remplacement/suppression du logo avec ADMIN client et refus avec un rôle non autorisé. |
| A2 | Cotisations et indemnités absentes du bulletin | **Partiel — contrôle statique** | `test/payroll-zero-amount-guidance-static.js` réussit. Ce test ne prouve pas le calcul ni l'affichage du bulletin avec des données de paie réelles. Vérifier plusieurs cas de cotisations/indemnités et les totaux du bulletin. |
| A3 | Configuration du Dashboard cassée et à déplacer | **Partiel — contrôle statique** | `test/client-dashboard-config-static.js` réussit (7/7). Reste à confirmer le parcours UI, l'enregistrement et la réinitialisation sous compte client, ainsi que le refus d'accès non autorisé. |
| A4 | Réinitialisation/restauration par client, Superadmin | **Partiel — garde-fous statiques contrôlés (étape 41)** | `test/step41-a4-reset-contract-static.js` 7/7; `test/client-reset-closed-shift-static.js` 8/8; sauvegardes isolées 16/16. Le code exige une activation explicite, le mot de passe, la phrase de confirmation, une sauvegarde préalable et un audit transactionnel. Migration 059 non appliquée ici; recette PostgreSQL, vérification des données conservées et restauration JSON/JSON.GZ toujours requises. |
| A5 | Sauvegarde/restauration/réinitialisation globale Superadmin | **Partiel — réinitialisation globale suspendue par sécurité** | Audit du cahier : l’ancienne route supprimait des tables opérationnelles clients, en contradiction avec A5. La route destructive est retirée et renvoie 409 tant que le périmètre strictement plateforme n’est pas défini. Sauvegarde/restauration gardent leurs contrôles statiques ; validation réelle sur base de test toujours requise. Tests : `test/a5-global-reset-tenant-protection-static.js` (8/8), `test/step21-backup-restore-static.js` (19/19), `test/step23-isolated-backups-static.js` (16/16), `test/step26-complete-backup-static.js` (10/10).
| A6 | Logos et alignement des colonnes PDF | **Contrôle statique réussi** | `test/pdf-logo-columns-static.js` réussit (8/8). À confirmer avec des PDF représentatifs et plusieurs formats de rapports dans l'application. |
| B1 | Pièces jointes dans la messagerie | **Partiel — contrôle statique** | `test/messaging-attachment-security-static.js` réussit (7/7). Le rapport de l'étape 12 signale que middleware multipart, taille et MIME doivent être validés sur l'environnement de déploiement. |
| B2 | Messages reçus illisibles en mode sombre | **Contrôle statique réussi** | `test/messaging-dark-mode-static.js` réussit (9/9). Vérifier visuellement dans le navigateur les deux thèmes et le contraste effectif. |
| B3 | Recherche des destinataires/participants par matricule/nom, sans accents | **Contrôle statique réussi** | `test/messaging-recipient-search-static.js` réussit (11/11). Vérifier les résultats sur une base d'essai avec plusieurs clients et employés actifs/inactifs. |
| B4 | Notifications de messages non lus, cloche, toast et ouverture | **Partiel — contrôle statique** | `test/messaging-unread-notifications-static.js` réussit (13/13). Vérifier le comportement réel de la cloche, l'intervalle de 5 minutes, l'ordre ancien→récent et l'ouverture de la conversation. |
| B5 | Seuls les administrateurs locaux peuvent écrire au Superadmin | **Partiel — contrôle statique** | `test/messaging-superadmin-contact-role-static.js` réussit (9/9). Confirmer par requêtes HTTP que les rôles non autorisés sont refusés côté serveur et que l'exception de renouvellement C2 reste limitée. |
| B6 | Remplacer « Demande de support » par le nom de l'expéditeur/client et garder la catégorie | **Contrôle statique réussi** | `test/messaging-support-title-static.js` réussit (10/10). À confirmer dans la liste et les notifications de support en environnement connecté. |
| C1 | Rubrique « La Fiscalité » et contrôle des accès | **Partiel — contrôle statique** | `test/fiscal-access-c1-static.js` réussit (11 assertions). Migration `058_fiscalite_admin_platform_only.sql` présente. Vérifier que l'ADMIN plateforme n'accède pas aux opérations fiscales et que les rôles client autorisés y accèdent après migration. |
| C2 | Écran d'abonnement expiré et formulaire de renouvellement | **Partiel — contrôle statique** | `test/step18-expired-subscription-screen-static.js` réussit (13/13). Vérifier l'affichage selon le rôle, l'envoi effectif, le numéro de contact et le blocage des autres routes métier. |
| D1 | Icônes modernes sur les cartes numériques du dashboard | **Contrôle statique réussi** | `test/kpi-icons-d1-static.js` réussit (8/8). Confirmer la couverture visuelle sur les tableaux de bord concernés. |
| D2 | Animations modernes et fluides dans la navigation | **Contrôle statique réussi — intégration à vérifier** | `public/performance-motion.css` définit trois modes (`off`, `subtle`, `full`), avec transitions courtes et effets au survol pour les modes actifs. Le réglage système `prefers-reduced-motion` coupe les effets si l’utilisateur demande une réduction des mouvements. `test/performance-motion-static.js` réussit (12/12). Vérifier visuellement la navigation et la préférence enregistrée dans le navigateur. |
| D3 | Titre d'accueil, centrage et suppression des doublons | **Contrôle statique réussi** | `test/homepage-centering-static.js` réussit (6/6). Le test mobile `test/homepage-mobile-static.js` est également présent ; vérifier l'affichage réel sur téléphone et ordinateur. |
| D4 | Bouton « Se connecter » et clé d'accès | **Contrôle statique réussi** | `test/home-login-key-static.js` réussit (6/6). Il reste à tester le parcours complet avec la clé activée/désactivée et un compte réel de test. |

## Résultats exécutés pendant cet audit

Tests statiques exécutés avec Node.js depuis cette archive :

- Paie — guide des montants à zéro : réussi.
- Dashboard client : 7/7.
- Réinitialisation client/quarts clôturés : 8/8.
- Sauvegarde globale — présence des protections : 10/10.
- PDF — logos/colonnes : 8/8.
- Pièces jointes messagerie : 7/7.
- Messagerie mode sombre : 9/9.
- Recherche destinataires : 11/11.
- Notifications non lus : 13/13.
- Règles de contact Superadmin : 9/9.
- Titre support : 10/10.
- Fiscalité : 11 assertions.
- Abonnement expiré : 13/13.
- Icônes KPI : 8/8.
- Mouvement/navigation : 12/12 — trois modes de mouvement présents dans le code ; validation visuelle encore requise.
- Accueil/centrage : 6/6.
- Clé d'accès : 6/6.

Le test `test/branding-permissions.js` n'a pas été exécuté : il exige des identifiants de compte (`node test/branding-permissions.js <admin> <password>`). Il n'est pas compté comme réussi ou échoué.

## Mise à jour étape 41

La fiche A4 a reçu un test statique supplémentaire de 7 assertions, sans modification de la logique métier et sans connexion à PostgreSQL. Son statut reste **Partiel** jusqu’à la recette d’intégration sur une base de test. Voir `RAPPORT_ETAPE_41_A4_REINITIALISATION_CLIENT_GARDE_FOUS_2026-10-19.md`.

## Ordre de suite recommandé

1. **Sécurité et données** : A4 et A5 sur base de test uniquement, puis B5 et C1 avec rôles plateforme/client distincts.
2. **Fonctions métier** : A1, A2, A3, B1, B3, B4, C2 par parcours navigateur/API, avec données d'essai.
3. **Rendu** : A6, B2, B6, D1, D3, D4 en clair/sombre et sur ordinateur/mobile.
4. **Rendu et accessibilité** : vérifier visuellement D2, y compris les modes `subtle`/`full` et la préférence système de réduction des mouvements.

## Conclusion

L'archive contient du code et des rapports pour les 18 fiches, mais cela ne permet pas de déclarer les 18 fiches terminées. Les résultats ci-dessus sont des contrôles ciblés du code, pas une recette complète. La prochaine livraison doit corriger les écarts prouvés et documenter les tests d'intégration réellement effectués, sans toucher à la base de production.


## Mise à jour étape 43 — fiche A5

A5 reste **Partiel — reset global suspendu**. L’audit statique confirme une liste limitée pour les archives logiques de plateforme, mais la restauration SQL complète (`DROP SCHEMA public CASCADE`) peut remplacer toutes les données. Garder `RESTORE_ENABLED=0` sur la base opérationnelle ; ne tester le dump complet que sur une base de reprise isolée. Test ajouté : `test/a5-platform-scope-audit-static.js` (9 assertions). Aucune validation réelle PostgreSQL effectuée.


## Mise à jour — étape 44 (2026-10-19)
- **A5 — Partiel / sécurité renforcée :** la restauration SQL complète exige désormais `RESTORE_ENABLED=1` et `RESTORE_TARGET_ISOLATED=1`. L’interface explique le risque de remplacement du schéma. La réinitialisation globale demeure suspendue. Validation réelle sur PostgreSQL isolé encore nécessaire.

## Étape 45 — A5 cohérence de configuration (2026-10-19)
- **Fait (renforcement documentaire/configuration)** : guides et préflight Windows alignés sur le double verrou de restauration SQL complète (`RESTORE_ENABLED=1` et `RESTORE_TARGET_ISOLATED=1`). Ajout d’un `.env.pc.example` sans secrets, avec les opérations destructives désactivées.
- **Tests** : double verrou 10/10 ; audit périmètre plateforme 9/9 ; reset global 8/8 ; sauvegarde/restauration étape 21 19/19 ; sauvegardes isolées 16/16 ; sauvegarde complète 10/10 ; sécurité pg_dump 10 assertions ; sécurité psql restore 12 assertions ; configuration PC 9 contrôles ; sécurité restauration statique exécutée.
- **Non fait** : aucun test de restauration PostgreSQL réel. `RESTORE_TARGET_ISOLATED=1` est une déclaration opérateur, pas une preuve technique d’isolement. Garder la restauration complète désactivée sur la production.


## Mise à jour — étape 46 (A5)
- Ajout d’un précontrôle Windows en lecture seule avant restauration SQL complète.
- Le précontrôle n’exécute pas de restauration et ne prouve pas que la base est réellement isolée.
- Validation PostgreSQL réelle toujours à effectuer dans un environnement de test distinct.
