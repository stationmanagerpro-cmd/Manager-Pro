# Mise en place des propositions — 14 octobre 2026

| # | Proposition | Statut | Fichiers / détails |
|---|-------------|--------|-------------------|
| 1 | UI autorisations lisible (sections, packs, résumé) | **Fait** | `ext-contracts.js` AUTH_PACKS (Essentiel / Standard / Complet / Complet+Fiscalité), `applyAuthPack`, résumé compteur Oui/Non ; `app.js` form() injecte la barre de packs + scroll |
| 2 | Tests automatisés des gates contrat | **Fait** | `test/contract-gates-ui-static.js` — vérifie que chaque `featureOn` a un champ UI (23 flags, OK) |
| 3 | Fiche quart PDF + partage | **Fait** | `ext-p7.js` : boutons Rapport clôture + PDF déjà présents ; fiche robuste |
| 4 | Journal d’audit changements de contrat | **Fait** | `GET /admin/clients/:id/contract-history` ; bouton **Historique** liste clients ; modal `clContractHistory` |
| 5 | Santé alertes auto | **Fait** | `getAlertsHealth` + `GET/POST /messaging/alert-health` ; vue `alerthealth` (planificateur, dernière exécution, règles, scan manuel) |
| 6 | Messagerie onboarding | **Fait** | `ext-proposals.js` : écran guidé si `can_use_messaging` off (au lieu d’un 403 opaque) |
| 7 | Facturation multi-lignes UX | **Fait** | `ext-billing.js` : éditeur tableau dynamique (+/− lignes, total HT/TTC live, max 20 lignes) |
| 8 | Mode démo / sandbox | **Fait** | Flag `demo_mode` dans DEFAULT_FEATURES + formulaire Superadmin + payload contrat |
| 9 | Indicateurs de licence côté client | **Fait** | Badge licence (jours restants / statut / nb modules) dans la barre supérieure |
| 10 | Documentation matrice modules | **Fait** | `docs/MATRICE_MODULES.md` |

## Vérifications automatiques
- `node test/contract-gates-ui-static.js` → OK
- `node --check` sur fichiers modifiés → OK

## Déploiement
```bash
npm run backup
# déployer l’archive
npm install
npm run migrate
npm start
node test/contract-gates-ui-static.js
```

## Notes
- Le mode démo est un **flag contrat** (pas de génération automatique de données d’exemple dans ce lot) : à brancher ultérieurement sur un seed si besoin.
- L’historique contrat s’appuie sur `audit_logs` existant (module contrats/clients).
- Packs d’autorisations = profils UI ; ils n’écrasent le contrat qu’après « Enregistrer ».
