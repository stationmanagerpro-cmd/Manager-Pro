# Rapport — Étape 14 : surveillance périodique automatique

Date : 12 octobre 2026

## Objectif

Faire fonctionner certaines alertes sans action manuelle, avec un contrôle périodique, des règles par compte client et une protection contre les exécutions simultanées de plusieurs instances du serveur.

## Modifications réalisées

- Nouveau module `src/alerts_scheduler.js`, démarré depuis `src/server.js` après le démarrage de l’API.
- Scan périodique toutes les cinq minutes ; `ALERTS_AUTO=0` permet de désactiver le planificateur. `ALERTS_AUTO=1` est ajouté à `.env.example`.
- Verrou consultatif PostgreSQL (`pg_try_advisory_lock`) pour qu’une seule instance exécute le scan à la fois.
- Le scan ne traite que les stations actives liées à un compte client et choisit un utilisateur du compte pour vérifier le contrat via le moteur central.
- Détection automatique du stock sous son minimum positif (`stock_low`).
- Détection des comptes inactifs après le nombre de jours défini dans la règle `account_inactive`, en limitant les utilisateurs à la station ou au responsable de cette station.
- Détection des contrats clients qui arrivent à échéance dans le nombre de jours configuré (`license_expiring`).
- Détection des bulletins de paie encore en brouillon (`payroll_pending`).
- Le formulaire de configuration permet de définir les seuils en jours pour l’inactivité et l’échéance de contrat, et en minutes pour les retards.
- Les retards enregistrés sont maintenant soumis au seuil en minutes configuré.
- Les contrats suspendus/expirés ne déclenchent pas de notifications automatiques côté client.
- La déduplication des événements identiques est limitée à une fenêtre de 24 heures, afin de permettre des rappels quotidiens pour une situation qui persiste.
- Migration additive `migrations/034_alert_dedup_index.sql` pour accélérer la recherche de doublons d’alertes système.
- Test statique ajouté : `test/step14-alerts-scheduler-static.js` et script `npm run test:step14-alerts-scheduler-static`.

## Tests effectivement exécutés

- `node --check` sur 100 fichiers JavaScript/CJS : **100/100 valides**.
- `test/step12-alert-config-static.js` : **12/12**.
- `test/step13-alert-event-triggers-static.js` : **9/9**.
- `test/step14-alerts-scheduler-static.js` : **15/15**.
- `test/step11-alert-center-isolation-static.js` : **4/4**.
- `test/step10-ux-branding-static.js` : **12/12**.
- `test/step9-reset-password-static.js` : **13/13**.
- `test/step8-contract-unlock-static.js` : **27/27**.
- `test/contract-module-gates-static.js` : **8/8**.
- `test/tenant-isolation-static.js` : **11/11**.
- `test/business-idempotency-static.js` : **20/20**.
- `test/purchase-idempotency-static.js` : **9/9**.
- `test/detail-pages-static.js` : **19/19**.
- `test/migration-safety-static.js` : **7/7**.
- `test/import-ui-security-static.js` : **7/7**.
- `test/dynamic-html-security-static.js` : **6/6**.
- `test/auth-lockout-static.js` : **6/6**.

Total des assertions statiques exécutées dans cette passe : **185/185 réussies**. L’archive ZIP a été vérifiée avec `unzip -t`.

## Limites et précautions

- Les contrôles sont statiques. Aucun scan réel sur PostgreSQL, aucun test navigateur et aucun test de notification en conditions réelles n’ont été exécutés.
- Les migrations `033_alert_threshold_rules.sql` et `034_alert_dedup_index.sql` doivent être appliquées à une base de test avant de déployer cette version. La configuration de seuils de l’étape 12 dépend de la migration 033.
- Les notifications générées utilisent la messagerie interne. Les canaux e-mail, SMS et WhatsApp ne sont pas encore reliés au moteur d’alertes.
- La surveillance automatique couvre ici le stock bas, l’inactivité, les contrats proches de l’échéance et les bulletins en brouillon. La détection automatique des absences sans pointage, les anomalies de paie détaillées, les écarts de stock physiques, les incidents non enregistrés et les alertes de sauvegarde doivent encore être développés ou raccordés.
- Le planificateur est activé par défaut, mais ne produit des alertes que si le contrat autorise les alertes automatiques et qu’une règle active avec au moins un destinataire a été configurée. Il peut être désactivé avec `ALERTS_AUTO=0`.
