# Scan QR des pompes — Limites, anomalies restantes et actions non réalisées

## Non réalisé / non exécuté
1. **Test Android** sur appareil ou émulateur (permission caméra, WebView, reprise après fermeture) — Non exécuté.
2. **Impression papier réelle** et lecture de l'étiquette collée sur une pompe — Non exécuté.
3. **Test sur navigateurs et téléphones réels** (Chrome/Safari/Firefox mobiles, HTTPS de production) — Non exécuté ; seul Chromium headless + caméra simulée l'a été.
4. **`POST /sales/fuel` de bout en bout** (HTTP + zod + JWT + vraies dépendances) — Non exécuté (modules absents, réseau coupé). À rejouer avec `npm ci` puis `npm test` sur une base de test.
5. **Déploiement** GitHub/Render, vérification en production — **non réalisé** (aucune autorisation donnée). Aucun commit n'a été créé ; la version `package.json` (1.11.31) n'est pas incrémentée.
6. Logo de la station sur les étiquettes (cahier §7.2 « si disponible ») — non implémenté.
7. Génération groupée multi-stations pour Super Admin — non proposée (la génération reste limitée à la station courante).

## Choix à valider
* **QR par compteur** et non par pompe (pompe à deux produits sans ambiguïté).
* **Scan à usage unique, valable 15 min** (une vente = un scan).
* **Pompe sans aucune affectation sur le quart** : la règle existante de `/sales/fuel` l'autorise ; le scan la reproduit. Si vous voulez l'interdire, c'est une règle métier nouvelle à décider.
* **Compte sans fiche employé** (ex. administrateur) : pas de vente par scan.
* **PDF et QR sans bibliothèque externe** (écrivain PDF + encodeur/décodeur QR maison, vérifiés par outils indépendants). Une bibliothèque standard (pdfkit, jsQR…) reste possible si vous préférez.
* Le décodeur de repli n'a pas été mesuré sur de vrais téléphones (vitesse, faible lumière).

## Anomalies d'environnement (pas des défauts du livrable)
24 fichiers de test existants n'ont pas pu s'exécuter ici (`zod`, `jsdom`, `exceljs`, `dotenv` absents ; serveur et identifiants requis) : liste exacte dans `docs/qr-tests/logs/10-regression-suite-complete.log`. À relancer dans votre environnement.
