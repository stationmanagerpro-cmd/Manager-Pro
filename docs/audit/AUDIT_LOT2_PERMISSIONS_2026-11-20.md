# Audit technique — Lot 2 : permissions détaillées (2026-11-20)

Suite du lot 1 (`AUDIT_LOT1_ROUTES_2026-11-20.md`). Lecture seule : aucun code, migration, donnée ni route modifiés.
Limite inchangée : serveur non démarrable dans la session, donc aucune route exécutée. Tous les constats sont des lectures de code, marqués « à confirmer en exécution » quand c'est nécessaire.

## 1. Périmètre traité

- Les 77 routes sans garde nommée visible identifiées au lot 1.
- Lecture de chaque gestionnaire pour chercher un contrôle interne (permission, `is_global`, refus 403, appartenance, portée).
- Résultat : 38 routes ont un contrôle dans le gestionnaire ; 39 n'en ont pas, et ont été classées une à une (inventaire : `permissions_lot2_77_routes.csv`).

## 2. Anomalies de permission

| ID | Gravité | Constat | Fichier | Statut |
|---|---|---|---|---|
| **P-01** | **Élevée** (à confirmer en exécution) | `GET /api/sales` renvoie les ventes de la station (1 000 lignes max, ou plage de dates) : totaux, client, vendeur, numéro de facture. Aucun contrôle de permission, et aucune permission de lecture des ventes n'existe dans le code (seules `sale.create`, `sale.credit`, `sale.delete`). L'écran Ventes est masqué dans l'interface, mais l'API reste ouverte à tout utilisateur de la station. | operations.js:223–240 | Confirmé par lecture de code |
| **P-04** | Moyenne | Le centre d'alertes (`GET /api/alerts/center`) n'applique aucun filtre de permission. Il expose les alertes RH (message, nom de l'employé, identifiant de l'employé : congés en attente, documents qui expirent, contrats qui expirent), le statut de paie du mois et les dettes clients. | ops_plus.js:365–510, hr_v2.js:174–178, 365, 558 | Confirmé par lecture de code |
| **P-05** | Moyenne | `POST /api/alerts/center/:source/:id/ack` marque une alerte RH « traitée » (`hr_alerts.status = 'done'`) sans permission RH, seulement avec l'appartenance à la station. Un employé sans droit RH peut donc fermer les alertes RH de sa station, ce qui fausse le suivi. | ops_plus.js:536–545 | Confirmé par lecture de code |
| **P-06** | Faible à valider métier | `GET /api/notifications` renvoie toutes les notifications de la station, sans distinction de rôle ni d'utilisateur (la table n'a pas de `user_id`). Elles incluent des écarts de caisse (`ecart_caisse`), des anomalies et des échéances de licence. Choix de conception à confirmer. | reports.js:595–602 ; schéma `001_initial.sql` | À valider métier |
| **P-07** | Faible | `POST /api/notifications/:id/read` ne vérifie que la station, pas le destinataire. Sans `user_id` dans la table, c'est cohérent avec P-06. | reports.js:604–611 | À valider avec P-06 |

### Vérifications réussies (pas d'anomalie)

- **Ventes → produits, stock** : `GET /api/products`, `/categories`, `/pumps` ne renvoient pas `buy_price` sans `cost.view` (fonction `maskCost`, RG-03). Le même principe est appliqué au stock bas, aux exports et à la fiche produit. Pas d'anomalie.
- **Messagerie** (`/messaging/*`) : `requireMessaging`, appartenance à la conversation (`isMember`), portée client (`clientIdOf`), photos limitées à la même station ou aux pairs. Les routes SuperAdmin sont réservées à `is_global`. Pas d'anomalie (P-03 du lot 1 levé).
- **Postes** (`/shifts/`, `/shifts/current`) : tout le monde ne voit que ses propres postes, sauf `shift.open`, `shift.close`, `report.view` (vue large) ; sans permission de consultation, 403. Pas d'anomalie.
- **Commissions vendeurs** : toutes les routes passent par `requireView` ou `requireManage`, qui vérifient la permission, le contrat et le module. Pas d'anomalie.
- **Paie** (`GET /hr/payroll`) : sans droit de gestion, seuls les bulletins du propre employé (`e.user_id = req.user.id`) sont renvoyés. Pas d'anomalie.
- **Administration** : paramètres (`/settings/:key`), bandeau de station, permissions de station (`permission-caps`), identité d'application (`canEdit`), configuration Dashboard client : contrôles présents (`appearance.manage`, `is_global`). Pas d'anomalie.
- **Documents** (`POST /docs/render*`), pièces jointes RH (`/hr/debts/:id/attachment`), actions RH (`/hr/employees/:id/actions`, `customer-debts`) : droits ou propriétaire vérifiés. Pas d'anomalie.
- **Forfaits** (`/packs`) : lecture publique voulue (comparaison pour le client). Pas d'anomalie.
- **Sauvegardes en échec** (centre d'alertes) : visibles uniquement pour `is_global`. Pas d'anomalie.

### Routes publiques ou limitées à l'utilisateur connecté (pas d'anomalie)

- Publiques par conception : `/public/access/*`, `/public/portal/:token` (jeton + limiteur), `/public/home`, `/branding/` et ses assets (logo, favicon, fond de connexion, manifest), `/appearance`, `/config/map` (jeton public), `/help-guides` (lecture).
- Limitées à l'utilisateur de la session : `/me/*` (préférences, photo, activité, licence), `/hr/me`, `/hr/me/payslips`, `/dashboard/my-prefs`, `/exports/:kind/preferences`, `/push/*`, `/auth/logout`.

## 3. Points à trancher (décisions métier)

1. **P-01** : faut-il une permission de lecture des ventes (par exemple `sale.view`) et l'appliquer à `GET /sales` ? Qui doit voir les ventes des autres vendeurs ?
2. **P-04 et P-05** : qui doit voir les alertes RH (congés, documents, contrats) et qui peut les fermer ? Proposition : `hr.view` pour la lecture et `hr.manage` pour l'acquittement.
3. **P-06** : les notifications de station (écarts de caisse, licences) doivent-elles rester visibles à tous les profils de la station ?

## 4. Corrections proposées (non appliquées, en attente d'approbation)

| Correction | Fichier | Risque | Test à faire |
|---|---|---|---|
| Ajouter une garde de lecture sur `GET /sales` (permission à définir) | operations.js:223 | Casse l'écran Ventes pour les profils qui n'ont pas la permission si elle est mal attribuée | Test avec deux profils (avec et sans permission) |
| Filtrer les sources RH et paie du centre d'alertes selon `hr.view` / `hr.payroll` | ops_plus.js | Alertes RH invisibles pour certains profils (voulu) | Vérifier l'affichage par profil |
| Exiger `hr.manage` (ou équivalent) pour l'acquittement des alertes RH | ops_plus.js:536 | Acquittement refusé à des profils qui le faisaient | Tester l'acquittement par profil |

## 5. Ce qui reste non vérifié

- Aucune de ces anomalies n'a été exécutée (pas de serveur). Il faut un test avec un compte sans permission pour confirmer P-01, P-04 et P-05.
- Isolation entre deux clients : non testée (nécessite une exécution).
- Relecture complète des handlers de la messagerie et des commissions : faite par échantillonnage du code, pas ligne à ligne.

## 6. Prochaine étape

Lot 3 (chaînes fonctionnelles par module) ou lot 4 (migrations), selon votre choix. Aucune correction avant votre validation.
