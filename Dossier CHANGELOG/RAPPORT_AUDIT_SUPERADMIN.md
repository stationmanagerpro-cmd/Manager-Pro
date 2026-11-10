# Rapport d'audit et de correction — compte Superadmin (Station Manager Pro)

Date : 10/10/2026. Périmètre : Superadmin uniquement (les comptes clients/Gérants relèvent de la phase 2).

## A. Résumé exécutif
**État initial.** Après connexion, le Superadmin voyait une barre vide (cloche, Focus, recherche) et un message rouge « données métier interdites » ; les menus n'apparaissaient qu'après un clic sur la cloche.

**Cause réelle (confirmée dans le code).** `boot()` (`public/app.js`) appelait `applyAppearance()` → `GET /appearance`, route **propre à une station**. Le serveur refuse correctement ce type de route au Superadmin (`src/server.js`, barrière `is_global`) → erreur 403 → `boot()` s'interrompait avant `go()`/`renderNav()` : le menu n'était donc jamais dessiné. Cliquer sur la cloche appelait `go('alert')`, qui dessinait enfin le menu : d'où le symptôme 2.2. Le backend était correct ; la confusion se trouvait dans le frontend, qui traitait le Superadmin comme un Gérant (menus, recherche, raccourcis vente/caisse, cloche, bouton Focus).

**État final.** Le Superadmin a un périmètre d'interface dédié, les menus s'affichent dès la connexion, le profil est complet, les sous-menus ne se chevauchent plus, et une finance de plateforme distincte a été ajoutée. Tests d'interface : réussis (47 contrôles). Tests nécessitant PostgreSQL : **non exécutés** (voir F).

## B. Tableau des anomalies
| ID | Symptôme | Cause confirmée | Correction | Fichiers | Test | Statut |
|---|---|---|---|---|---|---|
| A1 | Message « données métier interdites » | `boot()` appelle `/appearance` (route de station) pour le Superadmin | Pas d'appel station pour `is_global` ; échecs secondaires tolérés (`soft`) | `public/app.js` | UI : aucun toast, 0 requête interdite | Corrigé (UI) |
| A2 | Menus visibles seulement après clic sur la cloche | `boot()` interrompu avant `go()` ; la cloche appelait `go('alert')` | A1 + cloche dédiée : ouvre uniquement les notifications de la plateforme | `app.js`, `ext-shell.js`, `index.html` | UI : menus présents, cloche n'a pas changé de page | Corrigé (UI) |
| A3 | Profil incomplet | Rôle générique, raccourcis de Gérant | Nom réel, « Superadmin · Administrateur principal », avatar (initiales/photo), date/heure, mot de passe, déconnexion ; pas de bouton Focus ni raccourcis vente/caisse | `ext-shell.js` | UI | Corrigé (UI) |
| A4 | Sous-menus qui se chevauchent | (1) `#nav` sticky sans `z-index` : ses sous-menus flottants passaient **sous** le contenu (le test d'origine plantait déjà : clic intercepté par la page) ; (2) sous-menu ancré 14 px à l'intérieur du menu | `z-index: 80` sur `#nav` ; ancrage au bord droit du menu/sous-menu parent | `ext-shell.css`, `ext-shell.js` | UI : desktop, tablette, mobile sans débordement ; sous-menu non superposé | Corrigé (UI) |
| A5 | Navigation = celle d'un Gérant | Arbre unique, droits du rôle ADMIN trop larges côté interface | Arbre Superadmin : Tableau de bord, Exploitation (comptes clients & licences, offres), Finance & rapports, Administration. RH, ventes, caisse, stock, exports, alertes, messagerie de station retirés **de la navigation** (non supprimés de l'application) | `app.js` (`SUPERADMIN_VIEWS`, `canView`), `ext-shell.js` | UI + accès direct redirigé | Corrigé (UI) |
| A6 | Appels métier cachés | Hub admin lisait `/settings` ; recherche globale interrogeait produits/clients/employés | Gardes `is_global` | `ext-p12.js`, `app.js` | UI : 0 appel interdit sur 9 vues/onglets | Corrigé (UI) |
| A7 | Finance du Superadmin absente | Aucune table/route de finance de plateforme | Migration 030, `src/platform.js`, vue « Finance plateforme » (synthèse, factures, dépenses, 7 rapports + export CSV) | voir D | Unitaires OK ; intégration non exécutée | **Non vérifié sur base réelle** |
| A8 | `.env.example` contenait un mot de passe et un `JWT_SECRET` d'apparence réelle | — | Remplacés par des valeurs factices (le serveur refuse `CHANGEZ_MOI`) | `.env.example` | — | Corrigé |

## C. Rôles et permissions
- **Superadmin (`is_global`)** : routes `/admin`, `/users`, `/roles`, `/auth`, `/me`, `/contracts`, `/branding` + nouvelle `/admin/platform/*`. Toute autre route renvoie 403 (barrière inchangée, `src/server.js`). Aucune station ; vues métier absentes de l'interface.
- **Gérant et autres rôles** : inchangés. Le Gérant reçoit 403 sur `/admin/platform/*` (contrôle `is_global` côté serveur, indépendant de l'interface).
- **Contradiction détectée et résolue** : le rôle ADMIN détient les permissions métier ; l'interface les utilisait pour dessiner des menus que le serveur refusait. Le périmètre est désormais décidé par `is_global`.
- Consultation exceptionnelle de données de station par le Superadmin : **non prévue** dans le code, non ajoutée.
- Messagerie : hors du périmètre Superadmin (route de station refusée par le serveur) → absente de son interface. Aucune modification pour les autres rôles (phase 2).

## D. Modifications réalisées
Modifiés : `public/app.js`, `public/ext-shell.js`, `public/ext-shell.css`, `public/ext-p12.js`, `public/index.html`, `src/server.js` (montage de la route), `.env.example`, `package.json` (scripts de test), `test/all.js`, `test/ui-shell/ui-shell.test.js`.
Ajoutés : `migrations/030_platform_finance.sql` (4 tables `platform_*`, non destructif), `src/platform.js`, `src/platform_utils.js`, `public/ext-platform.js`, `test/platform-unit.js`, `test/superadmin.js`.

**Finance plateforme (périmètre strict)** : recettes = factures de licences/abonnements/mise en service avec encaissements (facturé ≠ encaissé) ; dépenses = hébergement, base de données, stockage, domaine, licences logicielles, API/paiement, maintenance, développement, support, communication (date, catégorie, montant, description, statut, référence) ; créances = factures non soldées ; dettes = dépenses non réglées ; règlements partiels ; trésorerie = encaissements − paiements ; deux résultats distincts (engagement / trésorerie), méthode affichée. Aucune lecture de table de station. Aucune donnée fictive créée.

**Numérotation** : la migration est `030`. Votre mise à jour fonctionnelle prévoit aussi une migration 030 (gap_status…) dans une autre branche : si les deux doivent coexister, renumérotez l'une des deux **avant** application en production.

## E. Problèmes non résolus / à surveiller
1. **Migration 030 et routes `/admin/platform/*` jamais exécutées sur PostgreSQL** (pas de base dans l'environnement d'inspection). Risque : erreur SQL à corriger. À faire : migration sur une base de test, puis `node test/superadmin.js <login> <mot_de_passe>`.
2. **Suites existantes non exécutées** (`npm test`, `test:security`, `test:restore`…) : `npm ci` impossible (réseau désactivé) et pas de base. Aucune régression backend constatée par lecture : seule modification de `src/server.js` = montage d'une route.
3. **Fichiers résiduels** que le précédent rapport disait supprimés : `src/contracts.js.backup-before-42P08`, `public/app.js.backup-permissions`, `public/app.js.before-vparam-fix` (ce dernier dossier est **servi publiquement** par Express), `test/*.bak*`, `test/contracts.js.backup`. Non supprimés (aucune action destructive sans votre accord).
4. **Création d'un client** (`/admin/clients`), renouvellements et vue « Offres » : fonctionnent d'après le code mais n'ont pas été testés ici ; seule leur absence d'appels interdits est vérifiée.
6. Le test d'interface d'origine simulait un Superadmin avec des droits de Gérant et **ne pouvait pas détecter** l'anomalie ; il a été réécrit avec la barrière serveur reproduite fidèlement. Sur l'archive d'origine, il échouait (clic intercepté par la page).

## F. État de préparation au déploiement
| Vérification | Résultat |
|---|---|
| Syntaxe de tous les fichiers JS (`node --check`, src/public/test) | Réussi |
| Tests d'interface Chromium (Superadmin, Gérant, Caissier, 4 tailles d'écran) | **Réussi : 47 contrôles, 0 échec** |
| Tests unitaires finance plateforme (`test/platform-unit.js`) | **Réussi : 11/11** |
| Migrations / tests d'intégration (`test/superadmin.js`, `npm test`) | **BLOQUÉ : PostgreSQL et `npm ci` indisponibles** |

Conclusion : **prêt pour revue et test sur une base de test locale, pas déclaré « prêt au déploiement en production »** tant que les tests d'intégration ne sont pas passés.

## G. Instructions finales
1. Sauvegarde PostgreSQL vérifiée avant toute migration (`npm run backup`).
2. Sur une base de test locale (valeurs dans `.env`, jamais partagé) :
```bash
npm ci
npm run migrate        # applique 030 (sauvegarde automatique avant migration)
npm start              # puis, dans un autre terminal :
node test/superadmin.js <superadmin> <mot_de_passe>
node test/platform-unit.js
```
3. Si tout passe : appliquer `npm run migrate` sur la base du PC serveur **avant** de redémarrer le service avec le nouveau code.
4. Après déploiement : connexion Superadmin (menus dès l'arrivée, aucun message rouge), ouverture de « Finance plateforme », saisie d'une facture et d'une dépense réelles. Retour arrière : les tables `platform_*` sont indépendantes ; revenir au commit précédent suffit, aucune donnée existante n'est modifiée.
5. Si `JWT_SECRET` ou le mot de passe PostgreSQL de l'ancien `.env.example` ont servi ailleurs, remplacez-les (les sessions actuelles seront fermées).
