# Vérification module Fiscalité — 14 octobre 2026

## Méthode
- Contrôle syntaxe Node (`node --check`) sur `fiscal.js`, `contracts.js`, `ext-fiscal.js`, `ext-contracts.js`, `ext-shell.js`
- Inventaire des **66 routes** API
- Cohérence schéma migrations **046–050** vs INSERT/UPDATE
- Cohérence UI (handlers `window.*`, vues VM, `index.html`, montage `server.js`)
- Rôles Superadmin / client

## Correctifs appliqués lors de cette vérification

| Problème | Impact | Correction |
|----------|--------|------------|
| Clone période utilisait colonne `created_by` inexistante | Erreur SQL au clonage | → `prepared_by` |
| Export XLS sélection sans token (`AUTH_HDR` inexistant) | 401 / échec download | Headers `Authorization: Bearer TK` + `X-Station-Id` |
| Aperçu pièce via iframe sans auth | Aperçu vide / 401 | Fetch authentifié → blob URL (PDF/image) |

## Confirmations OK

| Point | Statut |
|-------|--------|
| Syntaxe JS | OK |
| Montage `app.use('/api', fiscal.r)` | OK |
| Script `ext-fiscal.js` dans `index.html` | OK |
| `requireFiscalAccess` bloque `is_global` | OK |
| `fiscalAllowed()` UI bloque Superadmin | OK |
| SA n’a pas les vues ops dans `SUPERADMIN_VIEWS` | OK |
| Autorisations SA via contrat (`/admin/clients/:id/fiscal` + `ext-contracts`) | OK |
| Migrations 046, 047, 048, 049, 050 présentes | OK |
| `docs.buildPdf` / `buildXlsx` / `csv` / `send` | OK |
| `files.save` / `read` / `typeOf` / `remove` | OK |
| Moteurs estimateTVA, IBIC/IS, synthétique, ITS, CFE/TFP, manuel | OK |
| Handlers UI principaux (prêt, valider, clone, notes, tags, pin, bulk, recalc, preview…) | OK |

## Limites (non-régression / hors tests runtime)

- **Pas de test E2E contre une vraie base** dans cet environnement (pas de PostgreSQL de prod branché ici).
- Les barèmes seed restent souvent en **`a_verifier`** : estimations **indicatives**.
- Routes backend SA `POST /fiscal/rules`, `GET /admin/fiscal/overview` existent encore pour paramétrage plateforme ; **l’UI Superadmin n’expose pas le parcours ops client**. La confirmation de règles reste un réglage global optionnel, distinct du parcours client.

## Smoke test recommandé après déploiement

1. Superadmin : contrat client → activer `can_access_fiscal` + modules + quota Mo  
2. Compte client : hub Fiscalité visible  
3. Profil → modules → période → estimation → pièces (upload + **Aperçu**) → PDF  
4. Clone période, export XLS sélection, score, vue annuelle  
5. Superadmin : menu Fiscalité ops **absent**

## Conclusion

**Le module est cohérent et opérationnel au niveau code** après les 3 correctifs ci-dessus.  
