# Scan QR des pompes — Documentation technique

## Principe (règle d'or du cahier)
Le QR identifie l'équipement (compteur). Le compte connecté identifie l'employé. Affectations et quart décident. Le serveur vérifie et autorise. Rien de ce que le navigateur affiche n'est repris comme décision.

## Flux
1. **Administration** (`qr.manage`) : « Gestion des QR Codes » (menu Exploitation › Quarts & pompes) → génération (un QR actif par compteur), planche A4, étiquette A5, révocation, régénération, historique.
2. **Scan** : bouton « 📷 Scanner une pompe » du formulaire de vente carburant. Web : `getUserMedia` + `BarcodeDetector` si présent, sinon décodeur intégré `public/qr-decoder.js`. Android : `AndroidBridge.scan()` + `window.__mpScanHandler`. Secours : saisie de la référence courte.
3. `POST /sales/scan-pump` (`sale.create`) → `evaluateCheckpoint` (ordre : QR_INVALID → STATION_MISMATCH → QR_REVOKED → PUMP_DISABLED → PRODUCT_NOT_FOUND → SHIFT_NOT_OPEN/SHIFT_CLOSED → EMPLOYEE_NOT_FOUND → EMPLOYEE_NOT_ON_SHIFT → COUNTER_NOT_READ → EMPLOYEE_NOT_ASSIGNED). Succès : ligne `qr_scans` (15 min, usage unique) + réponse minimale (pas de jeton).
4. **Préremplissage** : pompe/compteur/employé affichés et verrouillés ; index, litres, montant, paiement restent saisis comme avant. Aucune vente créée.
5. **Validation** : `POST /sales/fuel` avec `qr_scan_id` + `client_ref` obligatoire. Dans la transaction : `checkScanForSale` (scan `FOR UPDATE`, QR `FOR SHARE`, quart `FOR SHARE`, tout rechargé en base), l'employé est **remplacé** par celui du scan, valeurs incohérentes → `SCAN_MISMATCH`, `INSERT INTO sales`, `consumeScan` (échec → `SCAN_USED`, annulation), événement `sale_ok` dans la même transaction. Refus tracé `sale_refused` hors transaction (intergiciel d'erreur `qrc.saleRefusalLogger`).

## Données (migration 124)
`qr_codes` (station, pompe, compteur, `token` 32 car. base64url, `short_ref`, statut active/revoked/replaced, `replaced_by`, dates, auteur, compteur d'impressions ; **index unique partiel : un QR actif par compteur**), `qr_scans` (session de scan, `consumed_sale_id` unique), `qr_events` (journal ; déclencheur `qr_events_no_update` interdit UPDATE/DELETE). Contenu du QR : `SMP1:` + jeton (192 bits aléatoires) — aucune donnée personnelle ni autorisation.

## Codes d'erreur
Ceux du cahier (`QR_INVALID`, `QR_REVOKED`, `PUMP_DISABLED`, `EMPLOYEE_NOT_ASSIGNED`, `SHIFT_NOT_OPEN`, `SHIFT_CLOSED`, `PRODUCT_NOT_FOUND`, `STATION_MISMATCH`, `CAMERA_DENIED`, `NETWORK_ERROR`) + `EMPLOYEE_NOT_FOUND`, `EMPLOYEE_NOT_ON_SHIFT`, `COUNTER_NOT_READ`, `SCAN_INVALID/EXPIRED/USED/MISMATCH`, `CLIENT_REF_REQUIRED`. Dans la réponse : `{ error: message, details: { code } }`. Source unique : `src/qr_logic.js` (`ERRORS`).

## Modules
`src/qr_logic.js` (règles pures) · `src/qr_db.js` (SQL) · `src/qr_codes.js` (routes) · `src/qr_encoder.js` (QR ISO 18004) · `src/qr_pdf.js` (PDF A4/A5) · `public/qr-decoder.js` (décodeur de repli) · `public/ext-qr-scan.js` (scanner, préremplissage, vue d'administration).

## Exploitation
* Mise en service (non effectuée) : sauvegarder la base → `npm run migrate` (applique 124) → déployer → « Générer les QR Codes manquants » → imprimer la planche → coller les étiquettes → essai réel avec un pompiste.
* Retour arrière : `docs/qr-tests/rollback_124_qr_codes.sql` (manuel). Essayé sur une copie de base : tables et permission retirées, ventes/employés/pompes inchangés, ré-application possible.
* Hors ligne : une vente par scan n'est jamais mise en file ; message `NETWORK_ERROR`.
* Régénérer = ancien QR « remplacé » immédiatement inutilisable ; il faut réimprimer l'étiquette.

## Tests
`npm run test:qr-logic | test:qr-decoder | test:qr-static | test:qr-db | test:qr-scanner-browser | test:qr-pdf`. `test:qr-db` exige une base **locale** dont le nom contient `test` ou `ci` (sinon SKIP explicite). Résultats : `docs/qr-tests/RAPPORT_TESTS_SCAN_QR.md`.
