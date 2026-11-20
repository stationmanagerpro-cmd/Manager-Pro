# Suivi d'exécution — Station Manager Pro

Date de mise à jour : 2026-11-20. Une tâche n'est « terminée » que si elle est vérifiée (test exécuté ou contrôle visuel noté). Les tests non exécutés sont indiqués comme tels.

## Terminé et vérifié
| Date | Tâche | Commit | Preuve |
|---|---|---|---|
| 2026-11-18 | Migrations 045–050, 086 : suppression des `BEGIN/COMMIT` internes (le runner gère déjà la transaction) | voir `Dossier CHANGELOG/MIGRATIONS_TRANSACTIONS_2026-11-18.md` | schéma identique à HEAD (173 tables), test d'erreur injectée : annulation complète |
| 2026-11-19 | Bandeau : photo limitée à 5 s ; repli CSS après 10 s | 182eb8c | `test/banner-static.js` 15/15 ; simulation |
| 2026-11-19 | Bandeau : photo par défaut chargée avant pose | 62a5ab8, f2ff919 | simulation 390×844 |
| 2026-11-19 | Logo centré (annulé par demande) | 46b4be7 puis a8df845 (retour) | simulation |
| 2026-11-19 | En-tête masqué jusqu'à la pose du bandeau | c4c893f | enregistrement image par image |
| 2026-11-19 | Photo par défaut entière, centrée, nouvelle image | 9a8c5c4, 06f5e2e | simulation 390×844 et 1280×800 |
| 2026-11-19 | Menu latéral : pas d'animation au chargement | cef27ae | enregistrement image par image, 1280 et 390 |
| 2026-11-20 | Photo enregistrée posée directement à l'actualisation | cde25f3 | enregistrement de rechargement : un seul état |
| 2026-11-20 | Une seule version du bandeau, après la vue de démarrage ; nom du compte client | 0406ec4 | `test/banner-static.js` 15/15 ; à confirmer sur appareil |
| 2026-11-20 | Bouton « Besoin d'aide » dans la bannière, sans saut d'en-tête | 485c128 | enregistrement : un seul état d'en-tête (108 px) |
| 2026-11-20 | Documentation de référence (ce fichier et les trois autres) | ce commit | `test/repo-hygiene-static.js` 7/7 |

## En cours
- Rien.

## Bloqué
- Tests serveur (express, pg…) : dépendances absentes dans l'environnement de développement.

## Restant (non commencé ou non vérifié)
- Vérifier sur appareil réel (téléphone Android, navigateur) : bandeau, menu, bouton d'aide.
- Vérifier le bouton « Modifier » des cartes d'aide pour le superadmin après déploiement.
- Règle de comptoir des produits à appliquer côté serveur (`src/catalog.js`) : aujourd'hui seule l'interface la restreint à la catégorie CARBURANT.
- Doublons de préfixe de migrations (voir `docs/MIGRATIONS_INDEX.md`).
- Mettre à jour l'URL du dépôt distant local (le dépôt a été déplacé vers `stationmanagerpro-cmd/Manager-Pro`) : à confirmer avec l'utilisateur avant modification.
- Projet Android : compilation non vérifiée.
