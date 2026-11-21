# SUIVI D'EXÉCUTION

## Fonctionnalité de scan QR Code -- Station Manager PRO

**Version du suivi :** 1.1\
**Dernière mise à jour :** 20 novembre 2026\
**Statut général :** Développé et testé en environnement local -- **non déployé** -- tests Android, impression papier et vente de bout en bout (`/sales/fuel` avec zod/HTTP) **non exécutés**\
**Référence :** `CAHIER_DES_CHARGES_SCAN_QR_STATION_MANAGER_PRO.md`

------------------------------------------------------------------------

## 1. Règles de mise à jour du suivi

Ce document est le registre de suivi officiel de cette fonctionnalité. L'agent doit le mettre à jour à chaque intervention et livraison. Il ne doit jamais : déclarer une tâche terminée sans réalisation et preuve vérifiables ; transformer un test prévu en test réussi ; masquer un blocage ou une anomalie ; supprimer l'historique des décisions ; annoncer un déploiement sans l'avoir réellement effectué et vérifié.

Statuts autorisés : À faire · En cours · Terminé -- vérifié · Bloqué · Non applicable. « Terminé -- vérifié » exige une preuve identifiable (fichier, journal de test, rapport). **Preuves : `docs/qr-tests/logs/NN-*.log`, `docs/qr-tests/RAPPORT_TESTS_SCAN_QR.md`.**

## 2. État initial validé (inchangé)

Besoin fonctionnel, identification par compte connecté, impression individuelle et groupée, contrôle du quart, contrôle de l'affectation, préremplissage du formulaire existant : décisions validées le 19/11/2026.

## 3. Tableau de suivi des tâches (état au 20/11/2026)

| ID | Tâche | Statut | Preuve / remarque |
|---|---|---|---|
| AUD-01 | Dépôt, branche, commit de référence | En cours | Archive `…refactor-en-tete_b30b373` ; **pas de `.git`**, GitHub/Render non consultés (réseau coupé) : commit non vérifié par Git |
| AUD-02 | Architecture frontend/backend | Terminé -- vérifié | `docs/SCAN_QR_POMPES_AUDIT.md` §1 |
| AUD-03 | Schéma PostgreSQL et migrations | Terminé -- vérifié | Audit §1 ; migrations 001→124 rejouées sur PG 16 (log 04) |
| AUD-04 | Pompes, compteurs, produits | Terminé -- vérifié | Audit §1-2 (un produit par compteur → QR par compteur) |
| AUD-05 | Comptes, rôles, permissions | Terminé -- vérifié | Audit §1 ; log 04 « Migration : permission » |
| AUD-06 | Affectations et quarts | Terminé -- vérifié | Audit §1 ; règles reprises de `/sales/fuel` ; log 01 |
| AUD-07 | Processus de vente | Terminé -- vérifié | Audit §1 ; `src/fuelsales.js` |
| AUD-08 | Android / caméra | Terminé -- vérifié (lecture de code) | `AndroidBridge.scan` + `__mpScanHandler` + CAMERA ; **non testé sur appareil** |
| AUD-09 | PDF et déploiement | En cours | PDF examiné ; **Render non consulté** |
| CON-01 | Plan d'intégration | Terminé -- vérifié | `docs/SCAN_QR_POMPES_AUDIT.md` §2-3 (rédigé avec le code, **non soumis à validation avant codage** : voir anomalies) |
| CON-02 | Ajouts base de données | Terminé -- vérifié | `migrations/124_qr_codes_scan_pompes.sql` ; rejeu ×2 et retour arrière sur copie (rapport §5) |
| CON-03 | Contrôles serveur et concurrence | Terminé -- vérifié | log 04 « 15 » (2 transactions concurrentes), verrous `FOR UPDATE/SHARE` |
| QR-01 | QR individuel | Terminé -- vérifié | log 04 scénarios 1, 2 |
| QR-02 | QR groupés par station | Terminé -- vérifié | log 04 scénarios 1, 3 |
| QR-03 | Révocation / régénération | Terminé -- vérifié | log 04 « 6/21 », « 21b » |
| QR-04 | PDF individuel | En cours | Structure + QR relu par OpenCV (log 07) ; **impression papier non essayée** |
| QR-05 | PDF groupé A4 | En cours | Idem (8/8 QR relus) ; **impression papier non essayée** ; logo non implémenté |
| SCN-01 | Scanner Web | En cours | Chromium headless, caméra simulée, 12/12 (log 08) ; **navigateurs/téléphones réels non testés** |
| SCN-02 | Scanner Android | En cours | Code branché sur le lecteur natif existant ; **aucun test appareil** |
| ID-01 | Employé = compte connecté | Terminé -- vérifié | log 04 « 14b », « 8b » |
| ID-02 | Pompe et produit non ambigus | Terminé -- vérifié | QR par compteur + index unique (log 04 « 2b ») |
| ID-03 | Affectation | Terminé -- vérifié | log 04 « 8 », « 16 » |
| ID-04 | Quart ouvert | Terminé -- vérifié | log 04 « 17/18 » |
| VEN-01 | Préremplissage sans vente automatique | En cours | log 08 sur page-test reprenant les ids du formulaire ; **formulaire réel de l'application non essayé** ; scan sans vente : log 04 « 4/7 » |
| VEN-02 | Contrôles refaits à la validation | En cours | Fonctions de validation exécutées sur base réelle (log 04 « 14 »,« 16 »,« 17/18 ») ; **gestionnaire `/sales/fuel` non exécuté de bout en bout** |
| VEN-03 | Doubles soumissions | Terminé -- vérifié (au niveau du scan) | log 04 « 15 » ; idempotence `client_ref` existante non rejouée |
| SEC-01 | Isolation entre stations | Terminé -- vérifié | log 04 « 13 », « 24 » |
| SEC-02 | Permissions d'administration | En cours | 8 routes refusées au pompiste (log 04 « 23 ») avec **doublure** de `need()` ; garde présent sur chaque route (log 03) ; HTTP réel non essayé |
| SEC-03 | QR révoqués / falsifiés | Terminé -- vérifié | log 04 « 5 », « 6/21 », « 14 » |
| LOG-01 | Journal des scans et refus | Terminé -- vérifié | log 04 « Journal » (ajout seul, sans jeton, par station) |
| TST-01 | Tests fonctionnels | En cours | 23 des 24 scénarios du cahier exécutés au moins partiellement ; détail dans le rapport |
| TST-02 | Tests de sécurité | En cours | voir SEC-01/02/03 |
| TST-03 | Tests Android/Web | En cours | Web simulé fait ; **Android non exécuté** |
| TST-04 | Non-régression | En cours | 216 fichiers OK, 24 en échec d'environnement (log 10) ; 4 régressions réelles trouvées et corrigées (rapport §4) |
| LIV-01 | Documentation | Terminé -- vérifié | `docs/SCAN_QR_POMPES_*.md` |
| LIV-02 | ZIP complet | Terminé -- vérifié | Voir registre des livraisons (contrôle `unzip -t`) |
| LIV-03 | Suivi actualisé | Terminé -- vérifié | Le présent fichier |
| LIV-04 | Déploiement contrôlé | À faire | **Aucune autorisation donnée ; rien déployé** |

## 4. Feuille de route par phase

* **Phase 1 Audit** : En cours (AUD-01 et AUD-09 partiels). · **Phase 2 Conception** : Terminé -- vérifié (arbitrages : §8). · **Phase 3 QR Codes** : En cours ([x] QR individuel, groupé, révocation, régénération, PDF A5, PDF A4 ; [ ] lisibilité après impression). · **Phase 4 Scanner et identification** : En cours ([x] employé, pompe, produit, station, affectation, quart ; [ ] Android réel ; [ ] navigateurs réels). · **Phase 5 Intégration aux ventes** : En cours ([x] pas de vente au scan, double soumission, changement après scan ; [ ] `/sales/fuel` de bout en bout, [ ] formulaire réel). · **Phase 6 Sécurité et tests** : En cours. · **Phase 7 Livraison** : En cours ([x] documentation, rapport de tests, ZIP, suivi ; [ ] déploiement : non autorisé).

## 5. Registre des tests (résultats réels du 20/11/2026)

| Test | Résultat | Environnement | Preuve |
|---|---|---|---|
| Génération QR individuelle | Réussi (base réelle, doublures HTTP/zod) | Node 22, PostgreSQL 16.15 local | log 04 |
| Génération groupée | Réussi | idem | log 04 |
| Impression PDF | Réussi sur écran (qpdf, rendu, OpenCV 8/8) ; **papier : Non exécuté** | poppler, OpenCV 5.0.0 | log 07, `docs/qr-tests/exemples/` |
| Scan QR valide | Réussi (route, base réelle) | idem | log 04 |
| QR inconnu/révoqué | Réussi | idem | log 04 |
| Employé autorisé | Réussi | idem | log 04 |
| Employé non affecté | Réussi | idem | log 04, 01 |
| Quart fermé | Réussi | idem | log 04, 01 |
| Produit ambigu | Réussi en logique pure ; **cas en base : Non exécuté** | Node | log 01 |
| Changement après scan | Réussi (fonctions de validation) | PG 16.15 | log 04 |
| Double soumission | Réussi (scan, 2 transactions concurrentes) | PG 16.15 | log 04 « 15 » |
| Isolation multi-stations | Réussi | PG 16.15 | log 04 |
| Caméra Web | Partiel : Chromium headless, caméra **simulée**, page-test | Playwright | log 08 |
| Caméra Android | **Non exécuté** | — | — |
| Non-régression ventes | Partiel : 216 OK / 24 échecs d'environnement ; `/sales/fuel` **non exécuté** | Node 22 | log 09, 10 |
| Perte de réseau | Partiel : vérifié par lecture (file hors ligne fermée, refus `offline_at`) ; coupure réelle **Non exécutée** | — | log 03 |

## 6. Registre des livraisons

| Version | Date | Contenu livré | Commit/référence | ZIP | Vérification |
|---|---|---|---|---|---|
| 1.0 | 19/11/2026 | Cahier des charges et suivi initial | Sans objet | Sans objet | Documents préparés |
| 1.1 | 20/11/2026 | Fonctionnalité complète (backend, migration 124, PDF, scanner, vue d'administration), tests, documentation | Aucun commit créé (pas de `.git`) ; version `package.json` non incrémentée (1.11.31) | `Station-Manager-PRO_scan-qr_2026-11-20.zip` | `unzip -t` à la livraison ; **non déployé** |

## 7. Registre des anomalies et blocages

| ID | Date | Anomalie ou blocage | Impact | Action proposée | Statut |
|---|---|---|---|---|---|
| ANO-01 | 20/11 | Réseau coupé : `express`, `zod`, `pg`, JWT absents | `/sales/fuel` et HTTP réel non exécutés ; 24 fichiers de test existants non exécutables | `npm ci` puis `npm test` et `npm run test:qr-*` sur base de test locale | Ouvert |
| ANO-02 | 20/11 | Pas de `.git`, GitHub/Render inaccessibles | AUD-01/AUD-09 partiels, pas de commit | Fournir le dépôt ou valider la livraison par ZIP | Ouvert |
| ANO-03 | 20/11 | Plan d'intégration rédigé en même temps que le code (instruction « appliquer intégralement ») : arbitrages non validés avant codage | Choix §8 à confirmer | Valider ou corriger les 5 choix du §8 | Ouvert |
| ANO-04 | 20/11 | Régressions provoquées par mon changement dans 4 tests d'intégration statique + `sw.js` | Corrigées avant livraison | Aucune | Corrigé (log 09) |
| ANO-05 | 20/11 | Le scanner effaçait le formulaire de vente (`modal()` à un seul emplacement) | Corrigé (surcouche dédiée), détecté par test navigateur | Aucune | Corrigé (log 08) |
| ANO-06 | 20/11 | Logo de station absent des étiquettes | Écart au cahier §7.2 (« si disponible ») | Demander l'ajout | Ouvert |
| ANO-07 | 20/11 | Écrivain PDF et QR maison (pas de bibliothèque standard) | Maintenance | Remplacer par une bibliothèque si souhaité | Ouvert |

## 8. Décisions et questions à arbitrer

| Sujet | Décision prise (à confirmer) |
|---|---|
| Pompe multiproduit | **Un QR par compteur** (pompe + compteur + produit), jamais par pompe |
| Affectations simultanées | Règles existantes de `/sales/fuel` reprises ; **pompe sans aucune affectation sur le quart : autorisée** comme aujourd'hui (à arbitrer) |
| Plusieurs quarts ouverts | Règle existante : un seul quart ouvert par station ; sinon `SHIFT_NOT_OPEN` |
| Vente hors ligne | Refus (fail closed), jamais en file |
| Durée du scan | Usage unique, 15 minutes (à confirmer) |
| Compte sans fiche employé | Pas de vente par scan (formulaire classique) |
| Déploiement production | **Non fait** ; seulement après tests complets et autorisation |

## 9. Bilan de la livraison 1.1

**Date :** 20/11/2026 · **Version livrée :** 1.1 (ZIP) · **Commit :** aucun

* **Réalisé et vérifié :** migration 124 (rejeu, retour arrière sur copie) ; génération/révocation/régénération ; scan et refus (base réelle) ; contrôles refaits à la validation (fonctions) ; double consommation ; isolation ; journal en ajout seul ; PDF A4/A5 relus par OpenCV ; scanner Chromium à caméra simulée.
* **Réalisé mais non encore vérifié :** intégration dans le gestionnaire `/sales/fuel` ; vue d'administration dans l'application complète ; chemin Android.
* **En cours / restant :** tests Android et navigateurs réels, impression papier, `npm test` complet, arbitrages §8, logo.
* **Bloqué :** réseau (dépendances), accès Git/Render.
* **Migrations :** `124_qr_codes_scan_pompes.sql`. **Risques :** voir `docs/SCAN_QR_POMPES_LIMITES.md`.
* **Prochaine étape :** installer les dépendances, lancer `npm test` + `npm run test:qr-db` sur une base de test, essai réel sur un téléphone Android avec une étiquette imprimée, puis autorisation de déploiement.

## 10. Règle de clôture

Le projet ne peut être marqué **Terminé -- vérifié** que lorsque tous les critères de réception du cahier sont satisfaits, que les tests critiques sont réussis, que les preuves sont disponibles et que les livrables sont remis. **Ce n'est pas le cas à ce jour.**

**Principe de suivi : aucun travail déclaré terminé sans preuve vérifiable.**
