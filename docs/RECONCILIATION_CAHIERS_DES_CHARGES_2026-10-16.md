# Réconciliation des cahiers des charges — 2026-10-16

Documents analysés : AUDIT_1.txt, AUDIT_2.txt, Prompt Audit Superadmin, Spécifications de mise à jour, Prompt Maître exclusif V1, rapport « plateforme-charges techniques ».
Règle appliquée quand deux documents se contredisent : **la solution la plus logique et la plus sûre pour un projet exploité sur un PC serveur local**, sans supprimer de fonction existante.

Légende : ✅ réalisé et testé · 🟡 réalisé, testé en simulation seulement (pas de PostgreSQL dans l'environnement de développement : à valider sur votre PC) · 📦 déjà présent dans le code avant cette mise à jour (non réexécuté) · ⏳ non traité (voir « Reste à faire »).

## 1. Contradictions tranchées
| Sujet | Documents en conflit | Décision |
|---|---|---|
| Hébergement | Audits et prompt Superadmin : déploiement sur des services cloud — décision utilisateur : PC serveur local | **PC local** (aucune dépendance cloud ; scripts Windows fournis) |
| Menu | Prompt Maître : « menu horizontal / sous-menus » — maquette : menu latéral sombre | **Menu latéral** de la maquette ; toutes les rubriques restent accessibles |
| Super Admin | Prompt Maître : « contrôle global » — Cahier/Audit : pas de données métier des stations | **Séparation stricte** conservée : Super Admin = plateforme, Gérant = exploitation |
| Clé d'accès | AUDIT_1 : 4 chiffres exactement — 10 000 combinaisons seulement | **4 chiffres conservés** + limitation d'essais progressive, journal, désactivée par défaut, mode secours |
| CSV plateforme | Cahier §13 : totaux dans tous les formats — l'export CSV plateforme avait été volontairement retiré | **CSV plateforme resté retiré** ; le CSV des exports généraux reçoit sa ligne de total |
| « Accès refusé » | Cahier §1 : rediriger plutôt qu'afficher une erreur | ⏳ à contrôler écran par écran (non modifié) |
| Statuts des commandes fournisseur | Cahier §8 (BROUILLON→…→DÉCAISSEMENT) — module Achats existant (réception, facturation, paiement) | **Module existant conservé** (déjà plus complet : archivage, annulation motivée, crédits) |
| Étapes de livraison (envoi vers un dépôt en ligne et un hébergeur) | Audits | Remplacées par la procédure PC (DEPLOIEMENT.txt) |

## 2. Réalisé dans cette mise à jour
| Exigence | Source | État | Où |
|---|---|---|---|
| **Clé d'accès à 4 chiffres** pour l'écran de connexion : génération provisoire → enregistrement → disponible ; révocation ; expiration optionnelle ; historique ; consultation protégée (journalisée) ; filtres | AUDIT_1 mod. 1 | 🟡 (+ ✅ logique pure) | `src/access_keys.js`, `migrations/053`, écran « Clé d'accès » |
| Une clé n'est utilisable **qu'une fois par appareil** (identifiant aléatoire émis par le serveur, cookie HttpOnly — non falsifiable par le navigateur) ; autre appareil accepté | AUDIT_1 | 🟡 (contrainte UNIQUE en base ; ✅ test navigateur du parcours) | `access_key_uses` UNIQUE (key_id, device_hash) |
| Contrôle **côté serveur** : sans laissez-passer signé, `POST /auth/login` renvoie 403 ; la clé ne remplace pas le mot de passe | AUDIT_1 | 🟡 | `requireGate` dans `auth.js` |
| Protection anti-force brute : délai croissant par appareil et par IP, limiteur de débit, événements journalisés | AUDIT_1 | ✅ (logique) / 🟡 | `access_keys_logic.js` (`Lockout`) |
| Désactivée par défaut ; refus d'activer sans clé disponible ; secours `ACCESS_KEY_DISABLE=1` | (sécurité : éviter le verrouillage) | 🟡 | `PUT /admin/access-keys/settings` |
| **Page d'accueil publique** administrable : titre, textes, services, contacts, liens, 7 images (PNG/JPEG contrôlées), couleur, thème, sections ; **brouillon → aperçu → publication** | AUDIT_1 mod. 2 | ✅ (rendu navigateur) / 🟡 (API) | `src/home_page.js`, `ext-home.js`, écran « Personnalisation de l'accueil » |
| « Se connecter » → clé (si activée) → connexion ; retour à l'accueil ; ancien écran de connexion conservé | AUDIT_1 | ✅ test navigateur (clé invalide, format, déjà utilisée, succès, retour) | `ext-home.js` |
| Menus **réservés au Super Admin** ; routes protégées côté serveur (`is_global`) | AUDIT_1/2, Superadmin | 🟡 | `ext-shell.js` (Administration), `principal` |
| **Totaux en bas des rapports** (règle universelle) : rapports plateforme (PDF, Excel, écran), CSV des exports généraux ; cas « aucune donnée » avec total à 0 ; montants alignés à droite | Cahier §13–14, AUDIT_1 mod. 4–5, rapport « charges techniques » (qui n'avait ni total ni message) | ✅ (tests unitaires + rendu) | `report_totals.js`, `platform.js`, `exports.js` |
| Nouveau design (menu sombre, tableau de bord, texte toujours lisible) | Maquette | ✅ audit automatique : 0 texte illisible | `design-v2.css`, `ext-design.js` |
| Retrait de tout lien avec les anciens services cloud ; scripts Windows recréés | Décision utilisateur | ✅ | `scripts/windows/` |

## 3. Déjà présent dans le code (📦, non réexécuté ici)
Messagerie interne (`messaging.js`) · règles de notification et rapports programmés (`notification_rules`, `scheduled_reports`) · import en lot (`imports.js`) · fiscalité (modules `fiscal*`, hub) · licences/contrats/packs (`contracts.js`) · finance plateforme (recettes, dépenses, créances, dettes, trésorerie) · achats (réception, facture, paiement, annulation) · factures clients multi-lignes (`billing.js`) · fiches client/fournisseur · RH, paie, sauvegarde/restauration, audit · thème personnel · panneau publicitaire · exports PDF/Excel avec totaux (`docs.js`).


## 6. Correctifs complémentaires (retours d'utilisation du 2026-10-16)
| Constat | Cause trouvée dans le code | Correction | État |
|---|---|---|---|
| Écran « Clé d'accès » : « Erreur interne » | Base non mise à jour (migration 053 non appliquée) : erreur SQL masquée en « Erreur interne » | Message explicite (« exécutez npm run migrate »), avertissement au démarrage du serveur, **migrations appliquées automatiquement par `start-pc-server.ps1`** (avec sauvegarde) | 🟡 à valider sur votre PC |
| Messagerie du Super Admin : « Fonctionnalité désactivée — données métier interdites » | Le filtre du Super Admin n'autorisait pas `/messaging` alors que le menu l'affichait | `/messaging` autorisé pour le Super Admin ; message d'erreur technique distinct de « désactivée » ; sections vides masquées | ✅ (accès) / 🟡 (échanges réels) |
| **Messagerie invisible pour les comptes clients** | `msg` était classée « Super Admin uniquement » dans l'interface (`GLOBAL_ONLY_VIEWS`) : le menu client ne l'affichait jamais | Vue **partagée** Super Admin + clients ; l'isolation par client reste appliquée par `messaging.js` | ✅ testé en navigateur (compte client) |
| **Confusion de rôles Super Admin / administrateur client** | Les deux utilisaient le **même rôle `ADMIN`** (mêmes permissions, mêmes libellés) : seul `is_global` les distinguait | Rôle dédié **`SUPERADMIN`** pour les comptes de plateforme (migration 054) ; `ADMIN` = administrateur d'un compte client ; le rôle SUPERADMIN est inattribuable à un compte client ; le Super Admin conserve au minimum les droits ADMIN | 🟡 |
| Restauration d'un client refusée : « dépendances cycliques détectées » | Le tri des tables refusait toute boucle de clés étrangères, même légitime (ex. A→B→A) | Boucles résolues en différant une colonne optionnelle (NULL puis mise à jour) ; boucle sans colonne optionnelle toujours refusée avec la liste des tables ; même correction pour la réinitialisation globale | ✅ logique (7 tests) / 🟡 sur votre base |
| Facture au nom d'un client absente de son profil | Le profil client n'affichait que les **ventes** ; les factures du module Facturation (`invoices.customer_id`) n'y figuraient pas ; historique limité à 50 lignes | Le profil affiche **toutes** les factures du client avec leur état (brouillon, émise, partiellement payée, payée, annulée), total/payé/reste, paiements de factures, bouton « Nouvelle facture » (client pré-sélectionné) ; limites relevées et nombre total affiché | ✅ testé en navigateur (données simulées) / 🟡 requête SQL |
| Achats ↔ fournisseur | `purchases.supplier_id` est **NOT NULL** en base : tout achat est forcément lié à un fournisseur | Historique relevé à 300 lignes avec nombre total | 📦 déjà garanti par la base |
| Le client doit pouvoir changer sa photo | Déjà possible : menu du profil « Changer ma photo », route `PUT /me/photo` sans restriction | Aucun changement | ✅ vérifié (menu) / 🟡 envoi |
| Le client doit pouvoir gérer les rôles de ses employés | Le client ne pouvait que choisir parmi des rôles communs ; aucun rôle propre | Écran **« Rôles de mon équipe »** : changer le rôle d'un employé, créer/modifier/supprimer ses **rôles personnalisés** (30 max), uniquement avec **ses propres permissions** (jamais plus), isolés par client | ✅ testé en navigateur / 🟡 règles serveur |

Remarque : une facture émise **sans client** reste possible (vente comptoir) ; l'interface demande confirmation, car elle n'apparaîtra dans aucun profil.

## 4. Reste à faire (⏳) — non réalisé, par priorité
1. **Postes personnalisés par client** (AUDIT_1 mod. 6) : table des postes, rattachement employé/utilisateur, gestion par le client.
2. **Cycle facture client** « BROUILLON → VALIDÉE → EXÉCUTÉE → RÈGLEMENT » avec vente comptabilisée seulement à l'exécution, et bouton « Nouvelle facture » depuis le profil client (Cahier §7) : vérifier l'état du module `billing.js` avant de le faire évoluer.
3. **Pièces justificatives** génériques (factures, bons, justificatifs de paiement) et **timeline** par opération (Cahier §10).
4. **Score de fidélité** configurable (Cahier §11).
5. **Sous-totaux** et alignement des colonnes dans *tous* les rapports opérationnels (les exports généraux totalisent déjà ; les sous-totaux par groupe ne sont pas implémentés).
6. **Permissions fines** proposées au Cahier §12 (`client.invoice.*`, `supplier.order.*`, `debt.*`, `documents.*`) : à comparer au catalogue existant avant d'ajouter.
7. Redirection (au lieu du message « Accès refusé ») pour les accès directs non autorisés.
8. Exécution des tests d'intégration sur PostgreSQL : `npm run migrate`, puis `node test/access-keys.js <login> <mot_de_passe>`.

## 5. Limites à connaître
- La clé à 4 chiffres n'offre que 10 000 combinaisons : elle **filtre l'accès à l'écran**, elle ne remplace pas le mot de passe (qui reste exigé et limité en essais).
- L'identification d'appareil repose sur un cookie : vider les données du navigateur ou changer de navigateur crée un « nouvel appareil ». Aucune empreinte matérielle n'est possible depuis un navigateur sans la fiabilité d'une application native.
- Le serveur limite les essais en mémoire : un redémarrage remet les compteurs à zéro (le journal en base est conservé).
