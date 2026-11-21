# Vérification des suivis du dépôt — 2026-11-21

Objet : vérifier, point par point, les éléments de suivi ouverts dans les documents du dépôt. Aucun code modifié.
Légende : **VÉRIFIÉ** (confirmé par exécution ou lecture du code) · **PÉRIMÉ** (le suivi ne correspond plus au dépôt) · **ÉCHEC** (test en échec) · **NON VÉRIFIABLE** (raison donnée).

## 1. Tests cités par les suivis (29 fichiers)
Lancés ici sans serveur ni base :
- **25 PASSE** : dont `client-dashboard-config`, `home-login-key`, `kpi-icons-d1`, `messaging-*` (6 fichiers), `step18`, `step21`, `step23`, `step26`, `step41`, `a5-*`, `pdf-logo-columns`, `performance-motion`, `shifts-sales-pdf`, `sw-coherence`, `repo-hygiene`, `sidebar-pub`.
- **ÉCHEC `test/report-ui-harness.js`** : dépendances Playwright et zod absentes de `node_modules` (blocage d'installation, déjà signalé dans `SUIVI_EXPORT_PDF`).
- **NON VÉRIFIABLE `test/branding-permissions.js`** : exige un serveur, un compte et un mot de passe (usage : `<admin> <password>`). Ce n'est pas un bug du test.

## 2. Suivis par document

| Document | Point ouvert | Statut | Détail |
|---|---|---|---|
| `docs/ETAT_ACTUEL.md` | Registre npm bloqué | NON VÉRIFIABLE | Toujours bloqué : résolution DNS impossible (`ENOTFOUND`). |
| `docs/ETAT_ACTUEL.md` | P-06 reporté (décision 2026-11-20) | Inchangé | Décision métier, pas un défaut. |
| `docs/ETAT_ACTUEL.md` | P-09 : 322 fichiers de `Dossier CHANGELOG/` à traiter | PÉRIMÉ | Il y a aujourd'hui 329 fichiers. Aucun traitement n'a été validé. |
| `docs/REFERENCE.md` | `npm test` bloqué (`node_modules` incomplet) | VÉRIFIÉ | Confirmé : dépendances absentes, aucune installation possible. |
| `SUIVI_CAHIER_DES_CHARGES_18_FICHES` | Fiches « À valider en intégration » (A1, A3, A4, A5, B4, B5, D4…) | NON VÉRIFIABLE | Tests statiques verts ; parcours UI et base PostgreSQL restent à jouer. |
| `SUIVI_BANDEAU_LICENCE_DEFILANT` | Contrôle visuel sur Render, texte du bandeau | NON VÉRIFIABLE | Demande le site réel et une licence de test. |
| `SUIVI_BANDEAU_LICENCE_DEFILANT` | Anciens tests `offline-sales-unit` et `shift-attribution-static` « périmés » | VÉRIFIÉ | `offline-sales-unit` passe. `shift-attribution-static` absent du dépôt (non cité ici). |
| `SUIVI_EXPORT_PDF_QUARTS_VENTES` | Visuel PDF, SQL avec période non exécuté sur PostgreSQL | NON VÉRIFIABLE | Pas de serveur ni de base en marche. |
| `ACTIVATION_PROGRESSIVE` | Parcours de paie : endpoints, feature flags, audit | VÉRIFIÉ (code) | `POST /hr/payroll/impact`, confirmation juridique et flags présents, actions tracées. |
| `ACTIVATION_PROGRESSIVE` | Sources officielles, barèmes saisis, validation juridique, dry-run, audit RH | NON VÉRIFIABLE | Actions humaines ou données de production, hors du dépôt. |
| Suivi Excel « À propos » AP-001 à AP-003, AP-005 à AP-011 | Solutions affichées, badges | VÉRIFIÉ (suivi) | Tests de la page à jour (voir §3 : test navigateur en échec). |
| AP-012 | APK Android (ancien fichier, signé v2, 15 611 791 octets) | **PÉRIMÉ** | Le fichier ancien a été retiré (commit `eba9a92`, 17 nov.). Le fichier actuel est `public/downloads/Manager_Pro-debug-2026-11-17.apk` (15 614 535 octets). Son manifeste porte le paquet `com.managepro` (Manager PRO). Build de débogage, signature non confirmée (pas d'outil `apksigner` ici). Installation sur téléphone non testée. |
| AP-013 | iOS : lien App Store | Bloqué (inchangé) | Lien officiel toujours absent. |
| AP-014 | Responsive sur appareils réels | NON VÉRIFIABLE | Aucun appareil ; le suivi le dit déjà. |
| AP-015 | `npm test` complet, API contre vraie base | NON VÉRIFIABLE | Base PostgreSQL de test absente de la session. |
| AP-016 | Écriture de la page « À propos » sur PostgreSQL | NON VÉRIFIABLE | Idem. Le suivi le dit déjà (« terminé et non validé »). |

## 3. Échec à traiter
- **`test/about-page-ui.test.js` : ÉCHEC.** Le test attend `#app.ready` après connexion et expire (30 s). La classe est bien ajoutée par `public/app.js:1146` après le chargement du profil (`ME`). Le test a été modifié dans le commit `eba9a92` (17 nov.), en même temps que la suppression de l'ancien APK. Cause probable : l'API simulée du test ne fournit plus ce que l'application attend après connexion (station, devise, ou écran d'expiration de licence). **Non diagnostiqué jusqu'au bout** : il faut lancer ce test avec la console du navigateur. Le suivi AP-015 (« 74 contrôles navigateur verts ») ne correspond donc plus au dépôt actuel.

## 4. Suivis de cette session (mes propres points)
- **C-03** (correspondance clé `view_*` ↔ navigation) : **VÉRIFIÉ**. Les 30 clés ont une définition de navigation (`V.<clé>` ou `go('<clé>')`).
- **T-01** (test `step55`) : **VÉRIFIÉ**, corrigé, passe.
- **F-04** (requêtes SQL interpolées) : **VÉRIFIÉ**, aucune faille trouvée (voir rapport final, §8).
- **A-01 à A-04** (décisions d'accès) : appliquées, **NON VÉRIFIABLE** à l'exécution (pas de serveur).
- **M-01** (migration 070, `client_devices`) : **NON VÉRIFIABLE** (lecture seule en production requise).

## 5. Ce qui reste, et qui doit agir
1. **Suivi AP** : le propriétaire doit confirmer la signature de l'APK actuel (build de débogage) avant diffusion.
2. **Diagnostiquer `about-page-ui.test.js`** (console navigateur) : décide si c'est un test périmé ou une régression de l'application.
3. **Installer les dépendances** (ou autoriser npm) : débloque `report-ui-harness`, `npm test`, et toutes les vérifications d'exécution ci-dessus.
4. **Production** : lecture seule pour M-01 ; contrôle visuel Render (bandeau, PDF).

## 6. Mise à jour : retrait d'Ika Sô (2026-11-21)
- Retiré de `src/about_logic.js` (solution « IKA SÔ MANAGER PRO ») : la page affiche 9 solutions au lieu de 10.
- Tests mis à jour en conséquence : `test/about-page-static.js` (passe), `test/about-page-ui.test.js` (non exécuté).
- Retiré du classeur de suivi : ligne AP-004 ; les formules de synthèse pointent sur les lignes restantes.
- APK conservé : son manifeste est celui de Manager PRO.
- Conservés volontairement : les deux changelogs historiques qui décrivent l'ajout puis le retrait d'Ika Sô (à supprimer si vous le souhaitez).
