# Déploiement — Module Fiscalité Station Manager Pro

**Date :** 14 octobre 2026  
**Périmètre :** Lots 1–15 + correctif rôles + lots optionnels 16–19

## Rôles

| Rôle | Clé | Fiscalité |
|------|-----|-----------|
| Superadmin | `is_global` | Autorisations sur le **contrat client** uniquement (`can_access_fiscal`, sous-modules, `fiscal_storage_mb`) |
| Compte client | `client_id` | Parcours ops (profil, périodes, estimations, pièces, exports) |

## Prérequis

1. PostgreSQL accessible (variable d’environnement habituelle du projet)
2. Node.js / `npm install` déjà OK
3. Migrations **046 → 050** (et suivantes si présentes) appliquées

```bash
# Exemple (adapter à votre script projet)
npm run migrate
# ou
node scripts/migrate.js
```

Fichiers migrations fiscaux typiques :

- `migrations/046_fiscalite.sql`
- `migrations/047_fiscal_rules_seed.sql`
- `migrations/048_fiscal_lot3.sql`
- `migrations/049_fiscal_cfe_tfp_seed.sql`
- (+ toute migration ultérieure du dépôt)

## Checklist de mise à jour sur le PC serveur

1. [ ] Sauvegarde PostgreSQL récente et vérifiée (`npm run backup`)
2. [ ] Fichiers copiés : `src/fiscal.js`, `public/ext-fiscal.js`, `public/ext-shell.js`, `public/ext-contracts.js`, `src/contracts.js`, migrations
3. [ ] Aucun `.env` ni secret dans l'archive copiée
4. [ ] Lancer les migrations : `npm run migrate`
5. [ ] Redémarrer le service Node
6. [ ] Smoke test :
   - Superadmin : ouvrir un **contrat client** → cases Fiscalité (OFF par défaut)
   - Activer `can_access_fiscal` + modules voulus
   - Compte client : menu Fiscalité visible
   - Créer profil → module → période → estimation → pièce → PDF
   - Vérifier qu’un Superadmin **ne** voit **pas** le parcours ops Fiscalité

## Points de vigilance

- Les taux seedés sont souvent en statut **`a_verifier`** : estimations **indicatives**.
- **Aucune** déclaration DGI n’est automatisée.
- Quota stockage : `features.fiscal_storage_mb` (défaut **100 Mo**, `0` = illimité).
- Fichier unitaire max technique : **2 Mo** (PDF/PNG/JPEG).

## Fichiers clés

| Fichier | Rôle |
|---------|------|
| `src/fiscal.js` | API + moteurs d’estimation |
| `public/ext-fiscal.js` | UI client |
| `public/ext-contracts.js` | Flags Superadmin |
| `src/contracts.js` | Défauts features |
| `migrations/046_*.sql` … | Schéma |

## Support

En cas d’anomalie : journal fiscal client (`/fiscal/audit`), logs serveur, et statut des migrations.
