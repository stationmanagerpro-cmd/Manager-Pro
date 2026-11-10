# Station Manager Pro — Livraison finale intégrée (14 oct. 2026)

## Résumé exécutif

Ce package intègre les points restants du cahier de mise à niveau (PDF) et de l’image « Pas terminé au sens du PDF » :

| Point PDF / image | Action réalisée | État |
|-------------------|-----------------|------|
| Migration `045_tanks_barcode_counter_events.sql` | Créée et prête à appliquer | À exécuter sur la base (`npm run migrate`) |
| Saisie code-barres fiche produit | Champ UI + API (POST/PATCH) + colonne liste | **Terminé** |
| Widgets dashboard configurables admin | Déjà présents (`/dashboard/config`, vue `dashcfg`) | **Déjà opérationnel** |
| Mode hors-ligne | File IndexedDB + SW + badge + sync (chiffrement fort non ajouté — partiel comme avant) | **Partiel documenté** (pas déclaré « terminé ») |
| Conformité fiscale Mali | Non déclarée (conforme PDF §6) — paramètres devise/timezone/tax_rate déjà paramétrables | **Non déclarée** |
| SMS / WhatsApp / pompes connectées / paiements / IA | Restent dans onglet **À venir**, inactifs | **Inactifs** |
| Preuves restauration / isolation / calculs | Documentées dans tests statiques + scripts ; à rejouer sur votre PostgreSQL | **Documenté** |

## Changements de ce lot (fichiers modifiés / ajoutés)

### Nouveau
- `migrations/045_tanks_barcode_counter_events.sql`
  - Colonnes `products.barcode`, `products.sku`
  - Tables `tanks`, `tank_measurements`, `counter_events`, `dashboard_widget_prefs`
  - Index et commentaires métier

### Modifié
- `public/app.js` — formulaire et liste produits : champs Code-barres / SKU
- `src/catalog.js` — validation Zod + INSERT/PATCH acceptent `barcode` et `sku`

### Déjà présents (rappel)
- Config widgets dashboard : `public/ext-p10.js`, `ext-p11.js`, `src/reports.js` route `/dashboard/config`
- Onglet **À venir** : `public/ext-avenir.js`
- File hors-ligne : `public/ext-improvements.js`, `pwa.js`, `sw.js`
- Isolation multi-tenant, permissions backend, audit, sauvegardes : modules existants

## Déploiement (ordre recommandé)

1. **Sauvegarde**  
   ```bash
   npm run backup
   ```
   Vérifier le fichier généré.

2. **Installer dépendances** (si besoin)  
   ```bash
   npm install
   ```

3. **Configurer** `.env` à partir de `.env.example`  
   - `DATABASE_URL`  
   - SMTP optionnel  
   - Ne jamais committer de secrets

4. **Migrations**  
   ```bash
   npm run migrate
   ```
   La migration 045 s’applique après 044. En cas d’échec, restaurer la sauvegarde.

5. **Démarrer**  
   ```bash
   npm start
   ```

6. **Vérifications manuelles post-déploiement**
   - Connexion Super Admin / gérant / employé
   - Créer/modifier un produit avec code-barres
   - Dashboard → Configurer le dashboard (widgets)
   - Onglet « À venir » visible, sans appel externe
   - File hors-ligne (menu profil)
   - Isolation : compte station A ne voit pas station B
   - `npm run test:ci` (ou tests ciblés) si environnement de test disponible

## Points volontairement non déclarés « terminés »

- **Mode hors-ligne chiffré et testé E2E** : file locale IndexedDB + synchronisation idempotente existent ; chiffrement fort de la file et tests E2E sur votre poste PostgreSQL restent à valider avant annonce commerciale.
- **Conformité fiscale Mali** : l’application permet `tax_rate`, devise et formats ; aucune certification légale n’est revendiquée (exigence PDF).
- **Intégrations payantes** : SMS, WhatsApp, pompes connectées, passerelles de paiement, IA — listées dans « À venir », statut « Inactif — à activer ultérieurement ».
- **Preuves runtime** : tests d’isolation et de restauration sont documentés et partiellement automatisés (statique + scripts) ; rejeu sur votre instance PostgreSQL recommandé.

## Retour arrière

1. Restaurer la sauvegarde créée avant `npm run migrate`.
2. Si seule la 045 pose problème, les tables/colonnes ajoutées n’écrasent pas de données existantes (ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS).

## Principe respecté

Conserver les fonctions qui marchent, corriger les défauts identifiés, ajouter le manquant sans supprimer ni masquer les modules opérationnels.
