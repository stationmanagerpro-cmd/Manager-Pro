# Livraison — Module Fiscalité Lot 4
**Date :** 14 octobre 2026

## Contenu

| Fonction | Détail |
|----------|--------|
| **UI Superadmin règles** | Vue `fiscalrules` : liste, Confirmer / Retirer, nouvelle version de taux |
| **Nouvelle version de taux** | `POST /admin/fiscal/rules/new-version` — jamais d’écrasement rétroactif |
| **Export Excel multi-périodes** | `GET /fiscal/export.xlsx` (filtre module / from / to optionnels) |
| **Checklist pièces** | Table `fiscal_checklist_items` + API + UI par période |
| **Documents métadonnées** | CRUD léger `fiscal_documents` lié à la période |
| **Paramétrage CFE/TFP** | Via nouvelle version de règle + confirmation juridique |

## Fichiers

- `migrations/050_fiscal_checklist.sql`
- `src/fiscal.js` — checklist, documents, export xlsx, admin rules
- `public/ext-fiscal.js` — pièces, export Excel
- `public/ext-fiscal-admin.js` — **nouveau** UI Superadmin
- `public/index.html`, `ext-shell.js`, `app.js` — câblage menu
- `LIVRAISON_MODULE_FISCALITE_LOT4_2026-10-14.md`

## Déploiement

```bash
npm run backup
npm run migrate   # 050
npm start
```

### Superadmin — règles
Menu **Finance & rapports → Règles fiscales**  
1. Créer une nouvelle version de taux (CFE, TFP, TVA…)  
2. Après validation juridique : **Confirmer** (motif obligatoire)  
3. Les estimations utilisant une règle `verifiee` n’affichent plus le warning « non fiable »

### Client — checklist
Périodes → **Pièces** → cocher fourni / non applicable / à vérifier  
Export Excel : bouton sur la liste des périodes (nécessite `can_fiscal_exports`)

## Tests minimaux

1. Superadmin ouvre Règles fiscales, crée version TFP rate=2, confirme → status vérifiée.
2. Client avec export autorisé : Export Excel → fichier .xlsx avec périodes.
3. Ouvrir Pièces sur une période TVA → checklist préremplie → passer une pièce en « fourni ».
4. Isolation : client A ne voit pas checklist / documents de B.
5. Non-régression ventes / RH / fiscalité lots 1–3.

## Limites

- Upload binaire de fichiers non branché sur le stockage `files` (métadonnées + chemin optionnel seulement).
- Checklist = aide interne, pas une obligation légale automatisée.
- Les taux restent sous responsabilité de validation humaine / expert local.

## Bilan module Fiscalité (Lots 1–4)

| Lot | Thème |
|-----|--------|
| 1 | Fondation : profil, modules, permissions, dashboard |
| 2 | Estimations TVA / IBIC / IS / synthétique / ITS |
| 3 | PDF, TVA achats, CFE/TFP, confirm règles, alertes échéances |
| 4 | UI règles SA, Excel, checklist pièces, versions de taux |
