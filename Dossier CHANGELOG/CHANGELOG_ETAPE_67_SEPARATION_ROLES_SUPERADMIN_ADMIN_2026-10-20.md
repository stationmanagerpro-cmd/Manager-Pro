# Étape 67 — Séparation stricte des rôles plateforme et client

## Changements
- Migration `063_role_identity_consistency.sql` : normalise les comptes `is_global=TRUE` vers le rôle `SUPERADMIN` et les comptes locaux portant par erreur `SUPERADMIN` vers `ADMIN`.
- Authentification : refuse une session si `is_global` et le rôle technique sont incohérents.
- Création de compte : un compte de plateforme doit utiliser `SUPERADMIN`; un compte local ne peut pas l'utiliser.
- Changement de rôle : empêche de rétrograder un compte de plateforme ou de promouvoir un compte local en Superadmin.
- Ajout du test statique `test/role-identity-consistency-static.js` et de la commande `npm run test:role-identity-static`.

## Sécurité et limites
- La migration est idempotente et ne supprime aucun utilisateur.
- Les comptes locaux historiques mal associés à `SUPERADMIN` sont normalisés en `ADMIN`; les permissions de rôle existantes ne sont pas supprimées.
- Les permissions ADMIN accordées au rôle de plateforme restent conservées pour compatibilité avec les routes existantes. Cette étape verrouille l'identité des rôles, mais ne constitue pas une réécriture complète de toutes les autorisations métier.
- Aucune base Neon/Render n'a été modifiée et aucun test de production n'a été effectué.

## Tests
- `node --check src/core.js` : OK
- `node --check src/auth.js` : OK
- `node test/role-identity-consistency-static.js` : 9/9 OK
- `node test/messaging-superadmin-contact-role-static.js` : 9/9 OK
- `node test/fiscal-admin-role-permission-static.js` : OK
- `node test/roles-messaging-static.js` : 9 contrôles passent, le dernier échoue sur son contrôle existant `planOrder` dans `src/tenant-backups.js` et `src/maintenance.js`; échec non attribué à cette étape et conservé comme point à examiner.
