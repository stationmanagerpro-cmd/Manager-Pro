# Correctifs issus de l'audit du 2026-11-18

- Branche : `audit/corrections-2026-11-18` (depuis `origin/main` 4ebd745). **Non poussée, aucune PR, aucune fusion, aucun déploiement.**
- Rapport d'audit et registre : `ANO-001` à `ANO-019` (tableur de suivi hors dépôt).

## Corrigé
- **ANO-007** — `src/help_guides.js` : le contrôle Super Admin précède désormais la validation du corps sur `POST /help-guides` et `PUT /help-guides/:key`. Un compte client reçoit 403, et non plus 400 pour un corps invalide. Le contrôle dans le handler reste en place.
- **ANO-008** — `GET /help-guides` renvoie `help_keys` (liste des modules intégrés). `public/ext-help.js` l'utilise, avec repli sur sa liste locale si la réponse ne la contient pas.
- `public/index.html` : `ext-help.js?v=4`. `public/sw.js` régénéré (`smp-static-b1ee3cb8c22`, contrôle `--check` à jour).
- `test/help-guides-unit.js` : deux contrôles ajoutés (ordre de la garde, liste serveur). 8/8.

## Vérifié
- `test/help-guides-unit.js` : 8/8.
- Suite statique et unitaire complète : 200 réussis, 3 échecs. Le même résultat qu'avant les modifications.

## Non corrigé (et pourquoi)
- **ANO-003** : reclassé. Les trois `UPDATE` dynamiques sont protégés par des schémas `.strict()`. Aucune modification.
- **ANO-001** (CSP) : retirer `'unsafe-inline'` casserait les handlers `onclick` existants. Chantier à planifier.
- **ANO-002** (jeton Mapbox de repli) : à retirer seulement après confirmation que `MAPBOX_TOKEN` est défini sur Render.
- **ANO-004** (`innerHTML`) : revue ligne à ligne non réalisée.
- **ANO-009** (MutationObserver) : non modifié, risque de régression sur la persistance du bouton « Besoin d'aide ».
- **ANO-010** : `stock-movement-validation-unit.js` échoue à cause d'un `zod` factice (`stubs/zod`, contraintes ignorées), pas à cause du code. Les deux autres échecs (`demo-mode-static.js`, `employee-actions-unit.js`) n'ont pas été analysés.
- **ANO-011 à 013** : aucune route supprimée ni renommée, sans preuve et sans autorisation.
- **ANO-005, 006** : migrations déjà appliquées, non modifiées.
- **ANO-014** : APK à recompiler (Android Studio), impossible ici.
- **ANO-015** : déploiement, uniquement sur demande explicite.
- **ANO-016, 017** : décisions métier, à valider par le propriétaire.
- **ANO-018, 019** : `npm audit` et tests avec PostgreSQL impossibles dans cet environnement.

## Tests non effectués
- Site de production, navigateur, base de données réelle.

## Suite
- Revue de la branche, puis PR et fusion sur votre mot. Déploiement après « déploie ».
