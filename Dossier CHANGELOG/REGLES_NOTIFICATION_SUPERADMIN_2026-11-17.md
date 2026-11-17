# Règle des notification (Superadmin) — 2026-11-17

## Ce qui change

1. **Nouvel onglet « Règle des notification »** dans le Centre de contrôle administrateur, groupe **Pilotage** (à côté de « Santé des clients » et « Erreurs »). Visible uniquement par l'Administrateur Principal ; le serveur refuse l'accès aux autres comptes (`needPrincipal`).
2. **Rapport mensuel automatique déplacé** : la carte quitte le tableau de bord « Utilisation de la plateforme » et apparaît dans le nouvel onglet. Comportement inchangé (activation, jour, heure, e-mail, enregistrer, envoyer maintenant, archive avec PDF). Le tableau de bord ne garde que les statistiques d'utilisation.
3. **Règles d'alerte propres au Superadmin**, dans une table séparée `platform_alert_rules` (les règles client restent dans `alert_notify_config`, liées à un `client_id`). Six types :

| Type | Déclenchement | Seuil |
|---|---|---|
| Relances de licence envoyées | événement (nouvelles relances depuis la dernière vérification) | aucun |
| Licence client bientôt expirée | situation, rappel au plus une fois par 24 h | jours avant échéance (1 à 90, défaut 15) |
| Erreurs serveur 500 | situation, rappel au plus une fois par 24 h | nombre sur 24 h (1 à 10 000, défaut 10) |
| Sauvegarde en échec | événement | aucun |
| Station sans client | situation, rappel au plus une fois par 24 h | aucun |
| Nouveau client créé | événement | aucun |

   Types écartés : « état du système » (aucune définition d'alerte fiable n'existe dans le code, à préciser avec le propriétaire).
4. **Vérification périodique** toutes les 15 min, sous verrou PostgreSQL (`TASK_LOCKS.PLATFORM_ALERTS = 74120323`), donc une seule instance évalue les règles. Désactivée si `ALERTS_AUTO=0`. Bouton « Lancer la vérification maintenant » pour un essai.
5. **Envoi par e-mail uniquement** (SMTP). Un échec d'envoi n'avance pas la fenêtre d'événements : il sera renvoyé à la vérification suivante, et l'erreur est affichée sur la carte.

## Fichiers

- `migrations/118_platform_alert_rules.sql` : nouvelle table (CHECK sur les six types).
- `src/platform_alerts.js` : nouveau. Types, évaluation, anti-doublon, routes `GET/PUT /admin/platform/alert-rules[/:kind]`, `POST /admin/platform/alert-rules/run`, planificateur. Lecture d'agrégats uniquement.
- `src/task_lock.js` : identifiant de verrou `PLATFORM_ALERTS`.
- `src/server.js` : montage du routeur et démarrage du planificateur (2 lignes).
- `public/ext-sa-rules.js` : nouveau. Rendu de l'onglet, rapport mensuel déplacé, enregistrement et lancement des règles.
- `public/ext-sa-dash.js` : suppression de la carte du rapport, de `repLoad` et des fonctions `sadRep*` (déplacées).
- `public/ext-p12.js` : entrée `['rules', 'Règle des notification']` dans `AGROUPS.pilotage`, masquage pour les comptes non globaux, aiguillage du rendu.
- `public/index.html` : chargement de `ext-sa-rules.js`.
- `public/sw.js` : régénéré (`npm run build:sw`, cache `smp-static-b71b8d58269`).
- `test/platform-alerts-unit.js` : nouveau test (10 contrôles).

## Vérifications

- `node --check` sur tous les fichiers JS modifiés ou créés : OK.
- `node test/platform-alerts-unit.js` : 10/10 (évaluation des six types, anti-doublon 24 h, échec d'envoi, seuils, garde Superadmin, validation à l'enregistrement, séparation avec `alert_notify_config`).
- Tests existants relancés, tous OK : `platform-insights-unit`, `usage-report-static`, `scheduler-locks-static`, `repo-hygiene-static`, `dynamic-html-security-static`, `step14-alerts-scheduler-static`, `confort-static`, `tanks-ui-alerts-static`, `step12-alert-config-static`, `notify-channels-unit`, `a5-platform-scope-audit-static`, `step21-button-actions-static`, `step11-alert-center-isolation-static`.
- Rendu de l'onglet exécuté dans un contexte JS isolé avec des données factices (six cartes, rapport, seuils, avertissement SMTP) : OK.
- `npm run build:sw` puis `node scripts/build-sw.js --check` : à jour.

## Non testé

- **Pas de test dans un navigateur** : l'affichage, les boutons et les toasts n'ont pas été vus à l'écran.
- **Pas de test sur une base PostgreSQL réelle** : la migration 118 et les requêtes SQL (notamment `backup_logs`, `error_log`, `license_reminders`) n'ont été ni exécutées ni vérifiées contre le schéma en place. Les colonnes utilisées ont été lues dans les migrations et dans le code existant.
- **Pas d'envoi d'e-mail réel** (SMTP non testé ; les tests simulent l'envoi).
- Le test `platform-alerts-unit.js` n'est pas ajouté à `test/all.js` ; il se lance seul.

## Points à confirmer par le propriétaire

- Choix des six types ; « état du système » volontairement écarté.
- Cadence (15 min pour la vérification, 24 h de rappel pour les situations) et fenêtre de 24 h pour les erreurs 500.
- Un e-mail par règle (pas de liste de destinataires).

## Attention au working tree

Plusieurs fichiers contenaient déjà des modifications non commitées d'autres personnes au moment de ce travail (suppression de l'onglet « Comparaison » dans `ext-p12.js`, `ext-platform-insights.js`, `src/platform_insights.js`, `ext-push.js`, `src/admin.js`, et la fonction `saAssignStations` dans `ext-sa-dash.js`). Ces modifications ont été conservées telles quelles ; mes changements s'y ajoutent. Aucun commit ni push n'a été fait.
