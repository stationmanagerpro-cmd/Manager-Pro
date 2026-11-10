# Priorités et dépendances de développement — Station Manager Pro

> **Règle** : ne pas développer toutes les fonctionnalités simultanément.  
> Sécurité et intégrité financière avant l’apparence.

## État au 2026-10-03 (P0–P18 finalisés)

| Priorité | Thème | Statut | Notes |
|----------|--------|--------|-------|
| **P0** | Analyse + sauvegarde | **FAIT** | Architecture cartographiée ; `backup.js` / `restore.js` présents |
| **P1** | Rôles, permissions, contrats | **FAIT** | `roles`, `permissions`, `client_contracts`, quotas, UI Contrats / Rôles |
| **P2** | Isolation clients + sécurité API | **FAIT** | `client_id`, middleware contrat, anti-élévation, limites stations/users |
| **P3** | Modèle client / fournisseur | **FAIT** | Profils, historiques, avoirs, fiches UI (016) |
| **P4** | Moteur financier / mouvements | **FAIT** (socle) | `financial_events` + hooks settle (dépense, client, fournisseur) |
| **P5** | Caisse et dépenses | **FAIT** (socle) | Vue liquidités + créances/dettes + dépenses jour + journal |
| **P6** | Produits, stocks, pompes | **FAIT** | Vue stock, mouvements filtrés, statut pompes/compteurs |
| **P7** | Quarts de service | **FAIT** | Rapport consolidé `/shifts/:id/full` + fiche UI |
| **P8** | Alertes et audit | **FAIT** | Centre `/alerts/center` unifié (stock, caisse, dettes, RH, sauvegarde) + audit + scan |
| **P9** | Rapports / exports | **FAIT** | Hub `/exports/:kind` PDF/XLSX (clients, stock, ventes, caisse, quarts…) |
| **P10** | Nouveau dashboard | **FAIT** | Stats réelles, profil, activité, graphiques, raccourcis (`/dashboard` enrichi + `ext-p10.js`) |
| **P11** | Config dashboard par ADMIN | **FAIT** | `dashboard_config` (settings) + overrides par rôle + UI `dashcfg` (`ext-p11.js`) |
| **P12** | Paramètres administrateur | **FAIT** | Centre de contrôle unifié (`admin` + `ext-p12.js`) : users, rôles, contrats, station, settings, dashboard, backups, système |
| **P13** | Sauvegarde auto 24h | **FAIT** | `backup_logs`, `runBackup`, scheduler, e-mail échec/succès, UI journal |
| **P14** | Multilingue FR/EN | **FAIT** | `i18n.js` centralisé, bascule FR/EN, locale nombres/dates |
| **P15** | Améliorations visuelles | **FAIT** | Menu horizontal large, cartes, transitions, responsive, focus mode |
| **P16** | Tests complets + sécurité | **FAIT** | `test/security.js` isolation/anti-élévation ; suite `npm test` élargie ; alertes sauvegarde |
| **P17** | Licences multi-clients | **FAIT** | Module licences (019) : durées, statuts, historique, renew/extend/suspend, dashboard, blocage API |
| **P18** | Modules abonnement | **FAIT** | Packs Essentiel/Pro/RH+/Illimité ; réconciliation ; clôture période ; reçus ; historique prix ; demandes renouvellement — tout activable/désactivable |

## Ordre strict à respecter ensuite

```
P3 (clients/fournisseurs complets)
  → P4 (moteur financier normalisé)
  → P5 (caisse)
  → P6/P7 (ops déjà solides : renforts ciblés)
  → P8 (alertes unifiées)
  → P9 (exports)
  → P10–P12 (dashboard + admin)
  → P13 (backup auto)
  → P14–P15 (i18n + UI)
  → Tests complets
```

## Critère de réussite

L’Administrateur Principal contrôle **qui** accède à **quoi**, dans **quelle station**, avec **quelles limites**, selon **quel contrat**.

Le responsable de station doit voir rapidement : **liquidités, dettes, créances, ventes, anomalies, qui a fait quoi**.

## Point de restauration

Avant chaque lot important :

```bash
cd station-manager-api
npm run backup   # si script disponible
# ou
node -e "require('./src/backup').run && require('./src/backup').run()"
```

Conserver le ZIP projet + dump PostgreSQL.
