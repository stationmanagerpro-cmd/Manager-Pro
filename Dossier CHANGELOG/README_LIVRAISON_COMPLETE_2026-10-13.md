# Station Manager Pro — Livraison consolidée (13 octobre 2026)

## Contenu de ce pack

### Correctifs audit étape 30 (parties 1–6)
- Autorisations contrat toutes actives par défaut (Super Admin décoche au besoin)
- Déduplication Scanner alertes 24 h
- Octroi compte employé (préselection + multi-station scope client)
- Corriger index (bug HTML onclick)
- Fiche complète quart (validation)
- Vue Mes stations + API overview consolidée
- PDF situation client (Super Admin)
- Menu horizontal (bascule profil)
- Restore / reset : Super Admin uniquement, variables d'environnement
- Messagerie / flags contrat documentés

### Modernisation phases A–D
| Phase | Fonctions |
|-------|-----------|
| A | Premiers pas (5 étapes), Pilotage direction, Fin de journée UI, empty states, tableaux mobile |
| B | Bannière PWA install, file hors-ligne, badge sync, SW v3 |
| C | Digest e-mail KPI, fréquence daily, preset 20h, boutons direction |
| D | Export CSV compta, payments/eod_lines, PDF serveur fin de journée |

## Démarrage rapide
1. Décompresser, `npm install`
2. Configurer PostgreSQL + migrations
3. Variables utiles : `DATABASE_URL`, SMTP (`SMTP_HOST` / `MAIL_MODE`), restauration SQL complète désactivée par défaut ; en environnement isolé seulement, `RESTORE_ENABLED=1` et `RESTORE_TARGET_ISOLATED=1` sont requis simultanément. La réinitialisation globale reste suspendue.
4. `npm start` (ou commande du projet)

## Points d’entrée UI importants
- **Premiers pas** — onboarding
- **Pilotage direction** — KPI + multi-stations + digests
- **Fin de journée** — synthèse + exports
- **Mes stations** — quotas contrat + bascule
- **File hors-ligne** — menu profil
- **Installer l’application** — menu profil (PWA)

## API utiles
- `GET /stations/overview`
- `GET /reports/eod.pdf?date=YYYY-MM-DD`
- `GET /exports/:kind?format=csv|xlsx|pdf&from=&to=`
- `POST /notifications/email-digest`
- `POST /messaging/report-schedules/preset-direction`

## Documents inclus
- `MATRICE_SUIVI_13_POINTS_2026-10-13.md`
- `PROCEDURE_EXPLOITATION_ETAPE_30.md`
- `CHANGELOG_*` (étape 30 + modernisation)

## Non inclus (volontairement)
- Notifications push natives (FCM/VAPID) — phase E optionnelle, dépendances externes
- Refonte React / réécriture front
