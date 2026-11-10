# Rapport — Étape 11 : poursuite de l'audit et isolation du centre d'alertes

Date : 12 octobre 2026
Base de travail : archive complète de l'étape 10.

## Correctif réalisé

Le centre d'alertes (`GET /alerts/center`) agrégeait les échecs de sauvegarde depuis `backup_logs`. Or cette table est globale à la plateforme et ne contient pas de `station_id` ni de `client_id`. Elle ne doit donc pas être interrogée et présentée dans le centre d'alertes d'un compte client.

Le bloc des échecs de sauvegarde est désormais exécuté uniquement lorsque `req.user.is_global` est vrai. Les autres sources consultées par le centre d'alertes continuent à appliquer leurs filtres de station.

Un test statique `test/step11-alert-center-isolation-static.js` vérifie ces protections.

## Vérifications exécutées

- Syntaxe JavaScript/CJS : **95/95 fichiers valides** (hors dépendances/vendor exclus).
- Assertions statiques étape 10 : **12/12**.
- Assertions statiques étape 9 : **13/13**.
- Assertions statiques étape 8 : **27/27**.
- Isolation client/station : **11/11**.
- Modules contractuels : **8/8**.
- Verrouillage temporaire : **6/6**.
- Sécurité HTML dynamique : **6/6**.
- Sécurité des imports : **7/7**.
- Sécurité des migrations : **7/7**.
- Idempotence des opérations métier : **20/20**.
- Idempotence achats/paiements fournisseurs : **9/9**.
- Pages de détail : **19/19**.
- Isolation du centre d'alertes : **4/4**.
- Total des assertions statiques exécutées : **149/149**.
- Archive ZIP : test d'intégrité exécuté séparément.

Ces contrôles sont statiques et syntaxiques. Ils ne remplacent pas les tests de bout en bout sur une base de test.

## Constats à traiter avant de construire le système d'alertes complet

1. **L'infrastructure d'alertes existe partiellement** : `alert_notify_config`, les options contractuelles `can_use_auto_alerts` / `module:auto_alerts`, la configuration des destinataires et la fonction `sendSystemAlert` sont déjà présentes.
2. **Aucun appel direct à `sendSystemAlert` n'a été trouvé dans les sources `src/`** pendant cet audit. Il faut donc vérifier et relier explicitement les événements métier (clôture de quart, écarts, compteurs/jaugeage, absences/retards, paie, incidents et inactivité) au moteur d'alertes, plutôt que supposer que toutes les alertes se déclenchent déjà.
3. **Le déclenchement périodique n'est pas démontré** : la route `/notifications/scan` effectue un scan à la demande. Aucun ordonnanceur fiable de contrôle continu n'a été validé ici.
4. **Les alertes actuelles sont fragmentées** entre `notifications`, `hr_alerts`, `employee_gaps`, stock, créances et autres sources. Un centre unifié doit conserver les liens vers les dossiers source, dédupliquer les événements et gérer un cycle de vie de l'incident.
5. **Destinataires et stations** : la configuration doit valider non seulement l'appartenance des destinataires au client, mais aussi que toute station ciblée appartient à ce même client. Les rôles ne doivent recevoir que les catégories d'alertes autorisées.
6. **Canaux externes** : la route de digest e-mail accepte actuellement une adresse `to` fournie dans la requête. Avant de l'utiliser pour des alertes financières/RH, il faut encadrer les destinataires autorisés, journaliser les envois et éviter de transmettre des données sensibles en clair par e-mail.
7. **Données RH/paie** : les alertes externes doivent contenir un résumé minimal et un lien authentifié vers le dossier, jamais un bulletin de paie complet ou des données personnelles sensibles.
8. **Seuils d'écart** : il faut confirmer les règles métier (montants XOF/FCFA et/ou pourcentage de l'activité) avec le client avant de coder les niveaux faible, moyen, élevé et critique.

## Hors périmètre de cette étape

- Aucun système d'alertes nouveau n'a été implémenté : la conception est à confirmer par l'utilisateur avant modification.
- Aucune migration n'a été appliquée.
- Aucun test d'intégration PostgreSQL ou de navigateur réel n'a été exécuté.

## Fichiers principaux modifiés

- `src/ops_plus.js`
- `test/step11-alert-center-isolation-static.js`
- `package.json`
