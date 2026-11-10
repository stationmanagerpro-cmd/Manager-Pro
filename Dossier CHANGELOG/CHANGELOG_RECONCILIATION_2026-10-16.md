# Réconciliation des cahiers des charges (2026-10-16)
Détails et statuts : docs/RECONCILIATION_CAHIERS_DES_CHARGES_2026-10-16.md
Ajouts : migrations/053_access_keys_home_page.sql, src/access_keys.js, src/access_keys_logic.js, src/home_page.js, src/report_totals.js, public/ext-home.js, test/access-keys-unit.js, test/report-totals-unit.js, test/access-keys.js (intégration).
Modifiés : src/server.js (montage), src/auth.js (clé d'accès exigée si activée), src/platform.js et src/exports.js (totaux), public/app.js, ext-shell.js, ext-design.js, ext-platform.js, design-v2.css, index.html, sw.js (cache v6).
Mise à jour : `npm run migrate` (sauvegarde automatique avant migration), puis redémarrer le serveur. La clé d'accès est DÉSACTIVÉE par défaut.

## Mise à jour complémentaire
Ajouts : migrations/054_role_separation_client_roles.sql, src/roles_scope.js, src/fk_order.js, public/ext-teamroles.js, test/fk-order-unit.js, test/roles-messaging-static.js.
Modifiés : src/core.js, auth.js, admin.js, catalog.js, setup.js, maintenance.js, tenant-backups.js, server.js, public/app.js, ext-detail-pages.js, ext-billing.js, ext-messaging.js, ext-shell.js, scripts/windows/start-pc-server.ps1.
