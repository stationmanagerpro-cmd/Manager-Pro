# Livraison — Module Fiscalité (Lot 1 / Fondation)
**Date :** 14 octobre 2026  
**Principe :** Assistance à la conformité fiscale (Mali). Aucune transmission DGI. Aucune déclaration officielle.

## 1. Audit préalable (extrait)

| Composant existant | Réutilisation |
|--------------------|---------------|
| `client_contracts.features` (JSONB) | Autorisations Superadmin (`can_access_fiscal`, `modules.fiscal_*`) |
| Moteur ITS / INPS / AMO (hr.js + migrations 006–008) | ITS fiscal réutilise le moteur RH déjà versionné |
| Dashboard config (`/dashboard/config`) | Pattern de cartes dynamiques |
| Isolation multi-tenant (`client_id`) | Toutes les tables fiscales filtrées par `client_id` |
| Audit générique + `audit()` | + table `fiscal_audit_log` dédiée |
| Ventes / achats / dépenses / paie | Sources futures pour estimations (lot 2) |

## 2. Fichiers ajoutés / modifiés

### Nouveau
- `migrations/046_fiscalite.sql` — profil, activations, règles versionnées, périodes, échéances, documents, audit
- `src/fiscal.js` — API complète (profil, modules, périodes, dashboard, Superadmin)
- `public/ext-fiscal.js` — parcours guidé 4 étapes + tableau de bord
- `LIVRAISON_MODULE_FISCALITE_2026-10-14.md` (ce fichier)

### Modifié
- `src/contracts.js` — `DEFAULT_FEATURES` : flags fiscaux **désactivés par défaut**
- `src/server.js` — montage `/api` fiscal + garde de permission
- `public/index.html` — chargement `ext-fiscal.js`
- `public/ext-shell.js` — entrée menu « Finance & rapports »

## 3. Fonctionnalités livrées (Lot 1)

| Exigence cahier | État |
|-----------------|------|
| Superadmin autorise / interdit module + sous-modules | **Oui** (`PUT /admin/clients/:id/fiscal`) |
| Flags `can_fiscal_estimates/exports/prepare/deadlines` | **Oui** (schéma + API) |
| Onglet « Fiscalité » visible seulement si autorisé | **Oui** (feature + UI) |
| Étape 1 — Profil entreprise / régime | **Oui** |
| Étape 2 — Cartes modules + activation client | **Oui** |
| Étape 3 — Périodes (création brouillon) | **Oui** (calculs détaillés = lot 2) |
| Tableau de bord dynamique | **Oui** (cartes selon modules activés) |
| Règles versionnées (table) | **Oui** (écriture Superadmin = lot 2) |
| Disclaimer non-officiel partout | **Oui** |
| Isolation client + contrôle backend | **Oui** |
| Pas de données fictives | **Oui** |

## 4. Non livré dans ce lot (volontairement)

- Calculs détaillés TVA / IBIC / IS / synthétique (formules + admissibilité)
- Calendrier réglementaire pré-rempli (échéances à paramétrer)
- Exports PDF/Excel fiscaux
- Upload justificatifs lié à `files`
- UI Superadmin dédiée « Gestion des modules fiscaux » (API prête ; écran contrats à enrichir)
- Connexion DGI / dépôt en ligne → **jamais** dans le produit sans contrat officiel

## 5. Déploiement

```bash
# Sauvegarde obligatoire
npm run backup

# Migration
npm run migrate   # applique 046_fiscalite.sql

# Redémarrage
npm start
```

### Activation pour un client (Superadmin)
1. Ouvrir le contrat du client.
2. Appeler `PUT /api/admin/clients/:id/fiscal` avec :
   ```json
   {
     "can_access_fiscal": true,
     "can_fiscal_prepare": true,
     "can_fiscal_estimates": true,
     "modules": {
       "fiscal": true,
       "fiscal_tva": true,
       "fiscal_its": true
     }
   }
   ```
3. Le client voit l’onglet **Fiscalité** et peut activer les sous-modules autorisés.

## 6. Tests manuels minimaux (à exécuter sur votre instance)

1. Superadmin **interdit** → client ne voit pas l’onglet / API 403.
2. Superadmin **autorise** → onglet visible.
3. Client active TVA → carte dashboard TVA apparaît.
4. Client sans données → « À renseigner », pas de montant inventé.
5. Client A ne voit pas les données fiscales du client B.
6. Ventes / caisse / RH existants restent opérationnels (non-régression).

## 7. Prochain lot recommandé (Lot 2)

1. Moteur d’estimation TVA (collectée / déductible admissible / nette) à partir des ventes & achats existants.
2. Formulaires conditionnels IBIC / IS / synthétique.
3. Liaison ITS fiscal ↔ bulletins RH déjà calculés.
4. Échéances paramétrables + alertes.
5. Écran Superadmin dans `ext-contracts.js` pour cocher les modules fiscaux sans API manuelle.

## 8. Avertissement juridique (rappel)

Ce module est un **outil d’assistance**. Il ne remplace pas la Direction générale des Impôts, un expert-comptable ou un conseiller fiscal. Toute estimation doit être validée par un professionnel habilité avant dépôt ou paiement.
