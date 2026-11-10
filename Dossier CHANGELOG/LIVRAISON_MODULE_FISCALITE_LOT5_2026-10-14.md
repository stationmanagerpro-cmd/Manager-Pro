# Livraison — Module Fiscalité Lot 5
**Date :** 14 octobre 2026

## Contenu

| Fonction | Détail |
|----------|--------|
| **Upload réel justificatifs** | `POST /fiscal/periods/:id/documents/upload` — PDF/PNG/JPEG via `files.save` (2 Mo), stockage disque isolé par client/période |
| **Téléchargement / suppression** | `GET /fiscal/documents/:id/file` · `DELETE /fiscal/documents/:id` |
| **Lien checklist ↔ fichier** | Upload optionnel avec `checklist_item_id` → statut « fourni » |
| **PDF avec checklist** | Tableau pièces + documents joints dans le PDF de préparation |
| **Dashboard Superadmin multi-clients** | `GET /admin/fiscal/overview` + vue `fiscaloverview` |

## Fichiers

- `src/fiscal.js` — upload, download, delete, overview, PDF enrichi
- `public/ext-fiscal.js` — UI dépôt / téléchargement / suppression
- `public/ext-fiscal-admin.js` — vue Pilotage fiscal multi-clients
- `public/ext-shell.js`, `app.js` — menu Superadmin
- `LIVRAISON_MODULE_FISCALITE_LOT5_2026-10-14.md`

Pas de nouvelle migration (réutilise `fiscal_documents.file_path` + checklist 050).

## Déploiement

```bash
npm run backup
# migrations 046→050 déjà appliquées si lots précédents déployés
npm start
```

Vérifier `UPLOAD_DIR` (défaut `./uploads`) accessible en écriture.

### Superadmin
Menu **Finance & rapports → Pilotage fiscal** : synthèse par client (autorisation, profil, modules, périodes, échéances, pièces).

### Client
Périodes → **Pièces** → **Joindre** ou **Déposer un fichier** → PDF inclut la checklist.

## Tests minimaux

1. Déposer un PDF < 2 Mo sur une période → apparaît dans la liste → téléchargement OK.
2. Joindre depuis une ligne checklist → statut passe à « fourni ».
3. Générer le PDF → section « Pièces justificatives » présente.
4. Superadmin : Pilotage fiscal affiche les clients avec fiscalité ON/OFF.
5. Client A ne peut ni lire ni supprimer un document du client B.
6. Fichier > 2 Mo ou format non supporté → erreur claire.

## Limites

- Taille max 2 Mo (contrainte `files.js` existante).
- Formats : PDF, PNG, JPEG uniquement.
- Pas de prévisualisation inline (téléchargement).
- Le dashboard SA est lecture seule (pas de modification de contrat depuis cette vue).

## Bilan module Fiscalité (Lots 1–5)

| Lot | Thème |
|-----|--------|
| 1 | Fondation (profil, modules, permissions, dashboard) |
| 2 | Estimations TVA / IBIC / IS / synthétique / ITS |
| 3 | PDF, TVA achats, CFE/TFP, alertes échéances |
| 4 | UI règles SA, Excel, checklist |
| 5 | Upload justificatifs, PDF checklist, pilotage multi-clients |

Le module reste un **outil d’assistance** à la préparation fiscale, sans dépôt DGI ni validation officielle automatique.
