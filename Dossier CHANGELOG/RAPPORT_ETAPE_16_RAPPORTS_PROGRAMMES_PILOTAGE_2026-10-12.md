# Station Manager Pro — Étape 16
## Programmation des rapports opérationnels et préparation du centre de pilotage

Date : 12 octobre 2026

### Objectif

Permettre à un responsable client autorisé de programmer des synthèses opérationnelles hebdomadaires, mensuelles ou à une date choisie, avec destinataires et heure fixes ou aléatoires, tout en respectant les droits contractuels du Super Admin et l'isolation client.

### Modifications apportées

- Ajout de `migrations/036_scheduled_operational_reports.sql` : table additive `alert_report_schedules`, contraintes sur les fréquences, horaires, destinataires et index des prochaines exécutions.
- Ajout de `src/scheduled_reports.js` : API pour lister, créer, suspendre/activer et supprimer les programmations ; validation du contrat `can_use_auto_alerts`/`module:auto_alerts` ; validation que les destinataires sont actifs et appartiennent au même client ; validation de la station ; génération de la prochaine date d'exécution.
- Ajout du planificateur exécuté chaque minute. Un verrou consultatif PostgreSQL évite le traitement simultané par plusieurs instances. Les rapports uniques sont désactivés après envoi ; les programmations récurrentes calculent leur prochaine exécution.
- Ajout d'une synthèse des alertes système sur la période depuis le dernier envoi, avec catégories sélectionnées et filtre par station lorsque les références d'événement permettent une association fiable.
- Ajout de l'interface « Rapports programmés » depuis la configuration des alertes : fréquence hebdomadaire/mensuelle/date unique, heure fixe ou plage aléatoire, rubriques, destinataires, suspension et suppression.
- Ajout du garde contractuel correspondant dans `src/server.js`. La programmation reste accessible même si la messagerie générale n'est pas incluse, mais seulement si les alertes automatiques sont autorisées.
- Ajout du test `test/step16-scheduled-reports-static.js` et de la commande `npm run test:step16-scheduled-reports-static`.

### Livraison et exécution

- Les rapports sont actuellement distribués dans la messagerie/boîte de notifications interne de Station Manager Pro, uniquement aux destinataires sélectionnés.
- Les canaux e-mail, SMS et WhatsApp ne sont pas activés par cette étape ; ils nécessiteront une configuration fournisseur et des tests distincts.
- Le fuseau horaire retenu est `Africa/Bamako` (UTC+0). L'heure aléatoire est choisie à l'intérieur de la plage puis persistée pour la prochaine occurrence.
- Les seuils d'écart restent configurés séparément dans les règles d'alertes ; cette étape programme des synthèses et n'invente pas de seuil financier.

### Vérifications réellement exécutées

- `node --check` : 94 fichiers JavaScript/CJS sous `src`, `public` et `test`, aucune erreur de syntaxe.
- 18 fichiers de tests statiques exécutés : 18/18 réussis, incluant les contrôles précédents et les 15 nouveaux contrôles de programmation.
- ZIP contrôlé avec `unzip -t`.

### Limites et précautions

- Aucun test d'intégration PostgreSQL n'a été exécuté : aucune connexion de production n'a été utilisée.
- Les rapports programmés résument les alertes système disponibles ; ils ne constituent pas encore un tableau financier consolidé complet de bénéfices, marges, ventes, pertes et objectifs. Le centre de pilotage global devra être développé et validé séparément.

### Procédure recommandée avant production

2. Application de la migration sur une base de test isolée.
3. Tests d'intégration avec au moins deux clients, plusieurs stations et des destinataires appartenant à des clients différents pour vérifier le refus d'accès croisé.
4. Vérification d'un envoi unique, hebdomadaire et mensuel, y compris une plage horaire aléatoire, la suspension et la suppression.
5. Vérification des journaux, des erreurs et de la reprise après redémarrage.
6. Autorisation explicite avant toute migration ou déploiement de production.
