# Quart partagé : chaque employé rattaché à SA situation (2026-11-02)

Règle appliquée : quand 2 ou 3 personnes partagent un quart, chacune n'est responsable que de **ses pompes** (attribuées à l'ouverture), de **ses ventes saisies**, de **ses anomalies** et de **ses écarts**. Rien n'est jamais mis au hasard sur un collègue.

## Ce qui change
- **Pompes** : une pompe peut rester sans employé (manque de personnel). Dès qu'elle est attribuée à l'ouverture, l'employé est responsable de son compteur ; l'admin local, le gérant ou un autre utilisateur autorisé peut enregistrer des ventes en son nom. Les paiements non espèces d'une pompe sans employé se saisissent à part, et son éventuel écart reste « non attribué ».
- **Clôture** : pour chaque employé, saisie de ses espèces remises et des paiements non espèces (mobile money, carte, crédit) de SES pompes. Le serveur calcule par employé : carburant de ses pompes, ses ventes déclarées, son carburant non déclaré, ses espèces attendues, son écart.
  - Écart de caisse = espèces remises − espèces attendues, **par employé**. Ce qui ne peut être attribué à personne reste sans employé (jamais imputé à quelqu'un par défaut) et le gérant l'attribue ensuite.
  - Écart de stock : réparti selon les litres sortis des pompes de chacun (produit sans pompe : selon les quantités vendues par chacun). Plus d'attribution au « premier employé trouvé ».
  - Clôture refusée tant qu'un employé du quart n'a pas remis sa situation. L'aperçu fonctionne sans saisie.
  - Employé seul sur le quart : comportement inchangé (tout lui revient).
- **Anomalies** : chaque anomalie porte l'employé à l'origine (obligatoire en quart partagé). Une anomalie chiffrée crée un écart sur le profil de cet employé.
- **Alertes** : chaque employé est alerté de son propre écart ; le gérant n'est plus présenté comme « l'employé » de l'écart d'un quart partagé.
- **Rapports** : le rapport complet (clôturant, gérant) contient une « Situation par employé » et l'employé à l'origine de chaque anomalie. 
- **Envoi par e-mail / WhatsApp** : chaque employé reçoit un PDF et un message avec **uniquement sa situation** (aucune donnée de ses collègues, ni justification commune du quart). Le clôturant reçoit le rapport complet. Nouveau mode `employee` (un seul employé).
- **Profil et salaire** : les écarts (caisse, stock, anomalie) et les anomalies apparaissent dans le profil de l'employé concerné. La décision (accepter, créer la dette) peut être prise par l'admin local (`hr.gaps`) **ou** par le générateur de fiche de paie (`hr.payroll`). La retenue sur salaire reste une décision explicite à la génération du bulletin (déduction totale, partielle ou aucune, plafond des règles de paie). Aucune retenue automatique.

## Déploiement
1. Sauvegarde, puis `npm run migrate` (migration `088_attribution_par_employe.sql` : 2 colonnes ajoutées, contrainte de type d'écart élargie ; aucune donnée supprimée).
2. Redémarrer le serveur ; fermer/rouvrir l'application (cache PWA `smp-static-v90`).
3. Les quarts déjà clôturés gardent leur ancien rapport (rapport unique, sans situation par employé).

## Tests
`npm run test:shift-attribution` : 16 + 11 + 5 + 8 contrôles. Le vrai code de `shift_attribution.js`, de la route de clôture (`shifts.js`) et du partage (`finance.js`) est exécuté avec une base, un serveur et un e-mail simulés. Suite sans base existante : aucune régression (126 scripts réussis avant, mêmes résultats après, hors les 3 qui échouaient déjà).

## Non validé (à faire sur le PC serveur)
- Exécution sur PostgreSQL réel : les requêtes SQL nouvelles sont relues, pas exécutées. À tester avec un quart à 2 puis 3 employés.
- Envoi SMTP réel et liens WhatsApp sur téléphone.
- Écran de clôture par employé : syntaxe vérifiée, rendu non vérifié visuellement.

## Points à décider
- Les **dépenses** payées sur la caisse ne sont pas rattachées à un employé : un employé doit remettre ses espèces **avant** déduction des dépenses, sinon la différence apparaît en « non attribué ».
- Le **crédit client** d'un quart partagé reste sur un seul client par clôture.

---
# Lot 2 : dépenses de caisse réservées et rôle individuel par employé

## Dépenses de l'entreprise
- Le rôle commun **Caissier** n'a plus la saisie de dépenses (migration 089 + installation neuve). Administrateur local et gérant la gardent ; superviseur et comptable aussi (à retirer si vous le souhaitez).
- Un employé peut l'obtenir **à titre individuel** (ci-dessous). La route serveur `POST /expenses` reste protégée par `expense.create`.
- Les rôles personnalisés déjà créés par vos soins ne sont pas modifiés.

## Rôle individuel (fiche employé > « Accès & rôle »)
- L'administrateur local ou le gérant (droit `role.assign`) peut **donner ou ajuster un rôle individuel** : l'employé reçoit un rôle qui n'appartient qu'à lui, les autres employés du même poste ne changent pas. Sa **fonction (poste) reste inchangée** ; elle n'est jamais écrasée par le rôle, et le rôle individuel n'est jamais écrasé par un changement de fonction.
- Garde-fous : on ne donne jamais un droit qu'on ne possède pas soi-même ; les droits d'administration (utilisateurs, rôles) sont réservés à l'administrateur local ; on ne modifie ni son propre rôle ni celui d'un administrateur ; l'employé doit avoir un compte lié ; le contrat doit autoriser la gestion des utilisateurs.
- « Revenir à un rôle commun » supprime le rôle individuel. Les rôles individuels n'apparaissent pas dans la liste des rôles et ne comptent pas dans la limite de 30 rôles personnalisés.
- Un employé voit son propre accès en lecture seule.

Tests : `npm run test:employee-access` (8 + 5 contrôles, base simulée). Aucune régression sur la suite sans base (132 scripts réussis, mêmes 3 échecs qu'avant).
Non validé : exécution sur PostgreSQL réel ; rendu visuel de l'onglet.

---
# Lot 3 : historique des actions à son nom, messagerie, rejet · Lot 4 : dettes clients par employé

## Historique des actions (fiche employé > Activité > « Historique des actions », et « Mon espace » > « Historique de mes actions »)
- Chaque action faite **au nom d'un employé** est journalisée : vente enregistrée par quelqu'un d'autre, dette client, écart et anomalie de quart, décision sur un écart, dette employé créée, changement de droits.
- Si l'auteur n'est **pas** l'employé, celui-ci reçoit un message dans **sa messagerie** (qui, quoi, combien). Ses propres actions sont journalisées sans message.
- L'employé peut **rejeter** une action faite par un autre, avec un motif. **Rien n'est supprimé** : l'action reste, marquée « Rejetée » avec le motif ; le gérant, l'administrateur local et l'auteur sont prévenus ; le gérant répond dans l'historique et l'employé est prévenu de la réponse.
- Un rejet sur un écart en attente le passe à **« contesté »** (événement tracé) : l'écart ne peut plus devenir une dette ni une retenue tant que le gérant n'a pas décidé. Un rejet n'annule jamais une dette ou une retenue déjà décidée : il impose une réponse.
- Seul l'employé concerné peut rejeter (ni un collègue, ni le gérant à sa place) ; une action qu'il a faite lui-même ne se rejette pas.
- Les employés sans compte utilisateur sont journalisés mais ne peuvent pas être notifiés.

## Dettes clients par employé
- **Permission `sale.credit` (« Vendre à crédit »)** exigée côté serveur pour toute vente à crédit (produits et carburant). Accordée par défaut à l'administrateur, au gérant et au superviseur ; un employé l'obtient par rôle personnalisé ou **rôle individuel** (fiche employé > Accès & rôle). **Changement de comportement** : les caissiers et rôles personnalisés existants ne vendent plus à crédit tant que la permission n'est pas accordée.
- Le client doit exister (règle déjà en place) ; limite de crédit, client bloqué ou archivé restent contrôlés.
- Fiche employé > « Dettes clients » : ses ventes à crédit, avec montant, réglé, reste et statut (ouverte, partielle, soldée, annulée).
- Fiche client : chaque vente indique l'employé à l'origine et « vente à crédit (dette) ».
- Ces opérations peuvent être faites par l'administrateur local, le gérant ou toute personne autorisée au nom de l'employé ; l'employé en est informé dans sa messagerie.

## Déploiement
Migration `090_historique_actions_et_credit.sql` (nouvelle table, nouvelle permission, aucune donnée supprimée) puis redémarrage ; cache PWA `smp-static-v91`.

## Tests
`npm run test:employee-actions` (11 + 6 contrôles). Suite sans base complète : 134 scripts réussis ; les 3 échecs (`client-company-name-header`, `pdf-logo-columns`, `superadmin-sidebar-icons`) existaient avant ces changements.

## Limites connues
- Non exécuté sur PostgreSQL réel ; l'écran (onglets, boutons Rejeter / Répondre) n'est pas vérifié visuellement ; l'envoi dans la messagerie suppose le module messagerie actif pour l'organisation.
- Le statut d'une dette client ne tient compte que des règlements rattachés à la vente ; un règlement global du client apparaît dans la fiche du client.
- Les ids de rôles sont en `SMALLINT` (environ 32 000 au total) : un rôle individuel par employé consomme cette réserve ; à surveiller sur de très grandes plateformes.
