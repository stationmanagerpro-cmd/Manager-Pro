# Rapport — Étape 13 : raccordement des alertes aux événements métier

Date : 12 octobre 2026

## Objectif

Étendre le moteur de l’étape 12 à plusieurs événements métier concrets, tout en conservant la séparation entre l’utilisateur qui déclenche l’événement et l’employé concerné par celui-ci.

## Modifications réalisées

- `src/messaging.js` : séparation entre `actorUserId` (compte dont on vérifie le contrat) et `employeeUserId` (employé éventuellement destinataire). Ajout du type `purchase_variance` aux règles avec seuil. Pour ce type, l’unité est XOF ou pourcentage.
- `src/shifts.js` : les incohérences de compteur détectées à l’ouverture d’un quart déclenchent une alerte `counter_anomaly` avec seuil en litres ; les notes d’incident ajoutées depuis l’interface du quart déclenchent une alerte `incident_note` ; le déclencheur d’écart de caisse de l’étape 12 reste en place.
- `src/hr_v2.js` : lors de l’enregistrement d’une absence ou d’un retard, l’alerte correspondante est déclenchée. Les corrections qui font passer une présence à absent/retard peuvent aussi déclencher une alerte. La fiche employé est vérifiée dans la station active avant l’enregistrement.
- `src/purchases.js` : une différence entre le montant attendu d’une commande reçue et le total de la facture fournisseur déclenche une alerte `purchase_variance` selon le seuil configuré. Les propriétés internes utilisées pour le calcul sont retirées de la réponse API afin de préserver son contrat public.
- `public/ext-messaging.js` : ajout du type « Écart sur facture fournisseur » et unités correspondantes dans le formulaire de configuration.
- Ajout du test statique `test/step13-alert-event-triggers-static.js` et du script `npm run test:step13-alert-events-static`.

Les alertes sont envoyées après validation de l’opération métier lorsque c’est nécessaire. Un échec d’envoi est journalisé côté serveur mais n’annule pas une clôture, une présence ou une facture déjà enregistrée.

## Tests effectivement exécutés

- `node --check` sur 98 fichiers JavaScript/CJS : **98/98 valides**.
- `test/step12-alert-config-static.js` : **12/12**.
- `test/step13-alert-event-triggers-static.js` : **9/9**.
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

Total des assertions statiques de cette passe : **170/170 réussies**. L’archive ZIP a également été testée avec `unzip -t`.

## Limites restantes

- Il s’agit de tests statiques, pas d’une validation de bout en bout sur PostgreSQL ou dans un navigateur.
- La migration `033_alert_threshold_rules.sql` de l’étape 12 reste à appliquer sur une base de test avant toute production.
- Les alertes de jaugeage sont déclenchées lorsqu’un écart d’index est détecté à l’ouverture du quart. Les anomalies de jaugeage et compteurs détectées à d’autres moments nécessitent encore leurs propres raccordements.
- Les notes d’incident ajoutées depuis le quart, les absences/retards enregistrés en RH, les écarts de caisse à la fermeture et les écarts de factures fournisseurs sont raccordés. La détection automatique des absences sans pointage, de l’inactivité des comptes, des anomalies de paie, des écarts de stock, de l’expiration des licences et des sauvegardes reste à implémenter.
- Le système utilise la messagerie interne pour les notifications. Les canaux e-mail, SMS et WhatsApp ne sont pas implémentés ici.
