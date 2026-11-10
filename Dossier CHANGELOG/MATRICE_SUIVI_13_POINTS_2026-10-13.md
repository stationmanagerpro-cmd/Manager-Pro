# Matrice de suivi — 13 points (étapes 30 parties 1–4)

Environnement de validation : **analyse de code + corrections appliquées**.  
Tests E2E runtime (PostgreSQL + sessions réelles) : **non exécutés dans le sandbox**.

| # | Préoccupation | État initial | Action | Résultat | Preuve code |
|---|---------------|--------------|--------|----------|-------------|
| 1 | Fiche complète quart | Présent | Toast + validation ID | **PARTIELLEMENT RÉSOLU** — logique OK, E2E à confirmer | `ext-p7.js`, `GET /shifts/:id/full` |
| 2 | Messagerie SA ↔ client | Présent, gated | Flags défaut ON + messages | **PARTIELLEMENT RÉSOLU** — activation contrat | `messaging.js`, contrat UI |
| 3 | Multistation client | Partiel | Vue Mes stations + quotas + create | **RÉSOLU ET TESTÉ (statique)** | `ext-multistation.js`, `POST /stations` |
| 4 | Alertes stock auto | Partiel | Scheduler + config existants | **DÉJÀ FONCTIONNEL — VÉRIFIÉ (code)** | `alerts_scheduler.js`, `sendSystemAlert` |
| 5 | Doublons Scanner | Défectueux | Dédup 24 h + toast skipped | **RÉSOLU (code)** — E2E à confirmer | `ops_plus.js`, `ext-ops.js` |
| 6 | UI notifications client | Présent conditionnel | Messages + alert-config | **PARTIELLEMENT RÉSOLU** | `ext-messaging.js` |
| 7 | Menus horizontaux | Absent | Mode `nav-horizontal` + bascule profil | **PARTIELLEMENT RÉSOLU** | `app.css`, `ext-shell.js` |
| 8 | PDF situation client SA | Absent | Route + bouton fiche client | **RÉSOLU (code)** | `contracts.js` situation.pdf |
| 9 | Photo / logo station | Présent fragile | Bouton logo admin + pickImage | **PARTIELLEMENT RÉSOLU** | `ext-p12.js`, `PUT /images/...` |
| 10 | Personnalisation login | Présent | Carte hub SA Identité | **DÉJÀ FONCTIONNEL — VÉRIFIÉ (code)** | `ext-brand-admin.js` |
| 11 | Octroi compte employé | Défectueux | addU(id) + scope client multi-station + SID fiche | **RÉSOLU (code)** | `ext-roles.js`, `catalog.js` unlinked |
| 12 | Cycle notifications | Partiel | Dédup scan + sendSystemAlert 24 h | **PARTIELLEMENT RÉSOLU** | `ops_plus.js`, `messaging.js` |
| 13 | UI multistation dédiée | Partiel | Vue consolidée + KPI overview | **RÉSOLU (code)** | `/stations/overview`, `ext-multistation.js` |

## Instructions hors liste
| Sujet | Statut |
|-------|--------|
| Autorisations toutes actives par défaut | Fait (`DEFAULT_FEATURES` + UI) |
| Renommer client après création | Fait (`PATCH /admin/clients/:id`) |
| Corriger index | Fait (bug HTML onclick) |
| Restore / reset | Super Admin uniquement, **non activés** (env) |

## Prochaines actions recommandées (runtime)
1. Appliquer migrations si besoin.
2. Tester Scanner 2× sur même stock bas → 1 alerte / 24 h.
3. Octroyer un compte depuis fiche employé existant.
4. Créer une 2ᵉ station sous quota et basculer.
5. Télécharger PDF situation depuis fiche client SA.
6. Basculer menu horizontal sur écran large.
