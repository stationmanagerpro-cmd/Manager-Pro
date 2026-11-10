# Rapport d’étape 8 — Autorisations contractuelles et récupération des comptes

Date : 12 octobre 2026

## Périmètre réalisé

1. **Autorisations de modules des comptes clients**
   - Les formulaires Super Admin de création et de modification d’un client proposent maintenant des choix explicites pour Ventes, Stocks/Achats, Tickets/Reçus, Réconciliation des pompes, Clôture de période, Historique des prix et Alertes automatiques.
   - Les choix sont persistés dans `client_contracts.features.modules`, au lieu de forcer systématiquement Ventes et Stocks à `true` lors de la modification du contrat.
   - Le droit de personnalisation est synchronisé avec la clé `modules.personalization`.
   - Le catalogue des modules expose également les modules de paie AMO, INPS, ITS et charges patronales, la messagerie et les alertes automatiques.
   - Les alertes automatiques sont désactivées par défaut dans un nouveau contrat.

2. **Déblocage administratif sécurisé**
   - L’action `/users/:id/unlock` réinitialise maintenant `failed_logins` et `lockout_until` : elle retire donc réellement le verrouillage temporaire, au lieu de remettre seulement le compteur à zéro.
   - Le Super Admin ne peut déverrouiller que les comptes de plateforme (`is_global`).
   - Un administrateur client ne peut déverrouiller qu’un compte de son client ; pour les comptes historiques sans `client_id`, une station commune est exigée.
   - Les identifiants invalides, comptes inexistants et accès hors périmètre sont refusés.
   - L’opération est journalisée dans l’audit.

3. **Test ajouté**
   - `test/step8-contract-unlock-static.js`
   - Script npm : `npm run test:step8-static`

## Vérifications réellement exécutées

- `node --check` sur **93 fichiers JavaScript/CJS** : réussi.
- Contrôles statiques de l’étape 8 : **27/27** réussis.
- Verrouillage de connexion : **6/6** réussis.
- Garde-fous des modules contractuels : **8/8** réussis.
- Isolation client/station : **11/11** réussis.
- Pages de détail : **19/19** réussis.
- Sécurité des migrations : **7/7** réussis.
- Idempotence métier : **20/20** réussis.
- Idempotence achats/paiements fournisseur : **9/9** réussis.
- Sécurité de l’interface d’import : **7/7** réussis.
- Sécurité HTML dynamique : **6/6** réussis.
- Total des assertions statiques exécutées dans cette étape : **120/120** réussies.

## Limites et précautions

- Ce sont des contrôles statiques et des vérifications de syntaxe, **pas** des tests d’intégration contre PostgreSQL ni des tests de bout en bout dans un navigateur.
- Les nouvelles options de contrat déterminent les indicateurs de fonctionnalité ; il reste nécessaire de poursuivre l’audit endpoint par endpoint afin de confirmer que chaque nouvelle fonction est également contrôlée côté API, et que son interface est masquée lorsque le droit est désactivé.
- Le déblocage manuel suppose que la colonne `lockout_until` existe. Pour cette version, la migration `032_user_temporary_lockout.sql` doit être appliquée après une sauvegarde validée. La récupération automatique de 15 minutes dépend également de cette migration.
- Pour un compte réellement désactivé (`active=false`), un employé inactif ou un client suspendu/à licence expirée, le déblocage de tentatives ne réactive pas le compte et ne lève pas la suspension : ces états doivent rester des contrôles distincts.

## Suite recommandée

