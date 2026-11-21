# Rapport de tests — scan QR des pompes

Date d'exécution : 20/11/2026 · Environnement : conteneur Linux (noyau 6.18), Node v22.23.5, PostgreSQL 16.15 **local jetable** (base `sm_test`, schéma = migrations 001→124 rejouées), Chromium + Playwright, OpenCV 5.0.0, poppler, qpdf. Réseau coupé : `express`, `zod`, `pg`, JWT **non installés**.
Preuves : journaux horodatés dans `docs/qr-tests/logs/` ; PDF de test dans `docs/qr-tests/exemples/`.

## 1. Ce que les tests exécutent réellement — et ce qu'ils n'exécutent pas
* `test/qr-db-scenarios.js` exécute le **vrai code** de `qr_codes.js`, `qr_db.js`, `qr_logic.js`, `qr_pdf.js` sur une **vraie base PostgreSQL**. Le routeur Express, `core.js` (droits `need`, transactions, `HttpError`) et `zod` y sont remplacés par de petites doublures (`test/helpers/qr-harness.js`) : **pas de HTTP réel, pas de validation zod, pas de JWT, pas du vrai middleware de station**.
* **Le gestionnaire `POST /sales/fuel` n'a pas été exécuté de bout en bout** (dépend de zod/core/fleet…). Son intégration est vérifiée par lecture automatisée (`qr-static.js`) et par exécution des fonctions qu'il appelle (`checkScanForSale`, `consumeScan`, `saleRefusalLogger`) sur la base réelle.
* Le scanner a été essayé dans un **vrai Chromium avec une caméra simulée** (flux vidéo = image d'une étiquette PDF) sur une page-test qui reprend les identifiants du formulaire de vente — **pas dans l'application complète, pas sur un téléphone**.

## 2. Les 24 tests du cahier (§15)

| N° | Scénario | Résultat | Preuve / réserve |
|---|---|---|---|
| 1 | Générer le QR d'une pompe | **Réussi** (base réelle) | log 04 : scénarios 1, 1b, 2, 2b, 2c |
| 2 | Imprimer un QR individuellement | **Réussi sur écran** ; papier **Non exécuté** | log 07 (qpdf, rendu 200 dpi, décodage OpenCV) ; log 04 « 2d » |
| 3 | Imprimer tous les QR d'une station | **Réussi** | log 04 « 3 » (aucune étiquette de l'autre station) + log 07 (8/8 QR relus) |
| 4 | Scanner un QR valide | **Réussi** (route, base réelle) | log 04 « 4/7 », « 4b » |
| 5 | Scanner un QR inconnu | **Réussi** | log 04 « 5 » |
| 6 | Scanner un QR révoqué | **Réussi** | log 04 « 6/21 » |
| 7 | Employé affecté et quart ouvert | **Réussi** (route) ; formulaire réel **Non exécuté** | log 04 « 4/7 », log 08 (page-test) |
| 8 | Employé non affecté | **Réussi** | log 04 « 8 », « 8b » ; log 01 |
| 9 | Aucun quart ouvert | **Réussi** | log 04 « 17/18 » ; log 01 |
| 10 | Quart clôturé | **Réussi** (au scan et à la validation) | log 04 « 17/18 » ; log 01 |
| 11 | Pompe désactivée | **Réussi** | log 04 « 11 » |
| 12 | Produit absent ou ambigu | **Réussi en logique pure** ; cas en base **Non exécuté** | log 01 ; ambiguïté exclue par conception (QR par compteur + index unique) |
| 13 | QR d'une autre station | **Réussi** (aucune donnée d'équipement ; journal sans identité de l'autre station) | log 04 « 13 », « 24 » |
| 14 | Données modifiées côté navigateur | **Réussi** au niveau `checkScanForSale` ; `/sales/fuel` complet **Non exécuté** | log 04 « 14 », « 14b » ; log 01 |
| 15 | Double clic / double requête | **Réussi** (2 transactions concurrentes : une seule consomme le scan) ; idempotence `client_ref` existante non rejouée ici | log 04 « 15 » |
| 16 | Affectation modifiée après scan | **Réussi** | log 04 « 16 », « 16b » |
| 17 | Quart clôturé après scan | **Réussi** | log 04 « 17/18 » |
| 18 | Perte de réseau | **Partiel** : refus serveur de `offline_at`, file hors ligne fermée aux ventes par scan, message `NETWORK_ERROR` vérifiés par lecture ; **coupure réseau réelle Non exécutée** | log 03 |
| 19 | Scan Web | **Partiel** : Chromium headless Linux, caméra simulée, repli décodeur (pas de `BarcodeDetector`) ; navigateurs/téléphones réels **Non exécuté** | log 08 |
| 20 | Scan Android | **Non exécuté** (aucun appareil ni émulateur). Code relu : `AndroidBridge.scan` (ML Kit, tous formats) + `__mpScanHandler` + permission CAMERA | log 03 (lecture) |
| 21 | Révocation puis scan | **Réussi** (révoqué, remplacé, et refus à la validation) | log 04 « 6/21 », « 21b », « 21c » |
| 22 | Régression des ventes classiques | **Partiel** : 216 fichiers de test existants passent ; 24 échouent **pour cause d'environnement** (modules absents / serveur requis), dont ceux qui couvrent les ventes en intégration ; parcours classique sans `qr_scan_id` inchangé par lecture | log 09, log 10 |
| 23 | Droits d'un non-administrateur | **Réussi** (8 routes d'administration refusées à un pompiste ; matrice de permissions en base) | log 04 « 23 », « Migration : permission » |
| 24 | Deux stations clientes | **Réussi** (liste, révocation, régénération, étiquette, génération, historique) | log 04 « 24 », « Journal » |

## 3. Résultats chiffrés
| Test | Résultat |
|---|---|
| `qr-logic-unit.js` (logique pure) | 25/25 |
| `qr-decoder-unit.js` | 21/21 |
| `qr-static.js` (câblage) | 18/18 |
| `qr-db-scenarios.js` (PostgreSQL 16 réel) | 33/33 |
| Encodeur QR vs OpenCV | 30/30 décodés |
| Décodeur QR vs QR générés par OpenCV | 8/8 |
| PDF (qpdf, rendu, OpenCV) | 6/6 |
| Scanner Chromium, caméra simulée | 12/12 |
| Migration 124 : rejeu ×2, retour arrière sur copie, ré-application | OK (commandes dans la section 5 du présent rapport) |
| Suite existante | 216 OK, 24 en échec d'environnement (liste dans log 10) |

## 4. Anomalies trouvées et corrigées pendant les tests
* Le scanner ouvert via `modal()` **effaçait le formulaire de vente** (un seul emplacement) → surcouche dédiée (détecté par le test navigateur).
* Après modification : 4 tests existants d'intégration statique échouaient (structure de `fuelsales.js`, ordre du menu, audit des liens, erreurs avalées) + hash du `sw.js` → code adapté, tests repassés (log 09).
* Deux assertions erronées de mon propre test (jeton contenant un chiffre au hasard ; compteur d'impressions) → corrigées.

## 5. Migration 124 — commandes exécutées
Rejeu ×2 sur `sm_test` : « rejeu 1 OK / rejeu 2 OK ». Copie `sm_test_rb` : retour arrière `docs/qr-tests/rollback_124_qr_codes.sql` → `role_permissions` 294 → 292, tables `qr_*` 3 → 0, ventes/employés/pompes 6/12/12 → 6/12/12, entrée `schema_migrations` retirée ; ré-application → 3 tables. Copie supprimée ensuite.
