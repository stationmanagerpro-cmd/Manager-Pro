# Scan QR des pompes — intégration sur branche (21/11/2026)

**Branche :** `feature/scan-qr-pompes` (issue de `main` @ `0695263`). **Statut : prête à être fusionnée dans `main` après revue ; non déployée.**

## Contexte
Le prototype du scan QR (ZIP `Station-Manager-PRO_scan-qr_2026-11-20_1.zip`, testé séparément par le propriétaire) a été porté sur le dépôt réel. Le dépôt ayant avancé depuis le prototype, les fichiers n'ont **pas** été remplacés : seuls les ajouts QR ont été appliqués sur les versions actuelles.

## Réalisé
* **Fichiers nouveaux (copiés tels quels du prototype) :** `src/qr_codes.js`, `qr_db.js`, `qr_encoder.js`, `qr_logic.js`, `qr_pdf.js` ; `public/ext-qr-scan.js`, `public/qr-decoder.js` ; `migrations/124_qr_codes_scan_pompes.sql` ; tests `test/qr-*.js` + `test/helpers/qr-harness.js` ; scripts `scripts/dev/*qr*` ; documentation `docs/SCAN_QR_POMPES_*.md`, `docs/SUIVI_EXECUTION_SCAN_QR_STATION_MANAGER_PRO.md`, `docs/qr-tests/` (dont `rollback_124_qr_codes.sql`).
* **Ajouts ciblés dans l'existant :** `src/fuelsales.js` (`qr_scan_id` optionnel, re-contrôle dans la transaction, scan consommé une seule fois, journal), `src/server.js` (montage de `qr_codes`), `public/index.html` (2 scripts), `public/ext-shell.js` (entrée de menu `qrcodes` sous « Quarts & pompes »), `public/app.js` (visibilité de `qrcodes` liée au module pompes), `public/ext-offline-sales.js` (une vente par scan n'est jamais mise en file hors ligne), `package.json` (scripts `test:qr-*`, `test:pump-fuel` conservé), `docs/MIGRATIONS_INDEX.md`.
* **`public/sw.js` régénéré** par `node scripts/build-sw.js` (nouveau nom de cache `smp-static-bec67c3034b`, 130 fichiers) — jamais modifié à la main.
* Aucun fichier du dépôt n'a été remplacé par la version du prototype (les ~25 autres fichiers qui différaient entre le ZIP et le dépôt étaient de l'avancement du dépôt et ont été ignorés).

## Vérifications effectuées (21/11/2026, PostgreSQL 16 temporaire, base `ci_test`)
| Contrôle | Résultat |
|---|---|
| Les 124 migrations appliquées dans l'ordre sur base vide (dont 124) | OK, 0 échec |
| `test:qr-logic` | 25/25 |
| `test:qr-decoder` | 21/21 |
| `test:qr-static` | 18/18 |
| `test:qr-db` (33 scénarios : isolation stations, droits, révocation, affectation/quart après scan, double soumission, journal en ajout seul) | 33/33 |
| Retour arrière `docs/qr-tests/rollback_124_qr_codes.sql` puis réapplication de la 124 | OK (tables et permission `qr.manage` supprimées puis recréées) |
| `node --check` sur les 5 JS modifiés ; `package.json` valide ; `build-sw.js --check` | OK |

## Non vérifié / limites
* **Suite complète `npm test` : non exécutée** (`node_modules` absent, installation npm impossible dans cet environnement). Non-régression des ventes classiques non prouvée ici ; à confirmer par la CI et par le test réel sur le site.
* Le banc `test:qr-db` remplace Express/zod/JWT par des doublures : le HTTP réel de `POST /sales/fuel` avec `qr_scan_id` n'est pas testé de bout en bout.
* Tests Android (caméra WebView), impression papier et lecture caméra réelle : non exécutés dans cette intervention (le propriétaire a testé le prototype sur le ZIP).
* Détails encore à faire selon le propriétaire : voir `docs/SCAN_QR_POMPES_LIMITES.md`.

## Procédure de retour arrière (si le test réel échoue)
1. **Code :** `git revert -m 1 <commit de fusion>` sur `main` puis redéploiement (aucune réécriture d'historique).
2. **Base :** la migration 124 est additive ; elle peut rester sans effet (aucune vente existante n'en dépend). Retrait complet : `docs/qr-tests/rollback_124_qr_codes.sql` (testé).

## Fusion et déploiement (21/11/2026)
* Fusion `--no-ff` dans `main` : commit **`7ce4713`** (parents `0695263` et `061f34c`). Retour arrière code : `git revert -m 1 7ce4713`.
* Le workflow GitHub n'a rien déclenché (secret `RENDER_DEPLOY_HOOK` absent) : déploiement lancé via Render, deploy `dep-dc0utbd9fdbs7397du20`, commit `7ce4713`, statut **live** (19:20 UTC).
* Journaux Render : sauvegarde avant migration `smp-2026-11-21T19-19-42-102Z.sql.gz` (429 188 octets vérifiés) ; `✔ 124_qr_codes_scan_pompes.sql` ; « Base à jour » ; serveur démarré.
* **Non vérifié :** accès HTTP au site et fonctionnement réel du scan (Web, Android, impression, vente de bout en bout) — test réel à faire par le propriétaire.
