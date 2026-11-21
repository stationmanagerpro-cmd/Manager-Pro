# Vente au nom d'un employé par scan QR — 2026-11-21

## Demande
Le scan QR doit pouvoir être utilisé par l'administrateur local d'un compte client (et tout rôle à qui il accorde la permission) pour enregistrer une vente. La vente est attribuée à l'employé affecté à la pompe, avec mention dans l'audit et alerte de cet employé.

## Règles retenues
- **Employé visé** : détecté automatiquement sur le scan, parmi le responsable unique affecté à la pompe sur le quart en cours (`shift_employees` / `shift_employee_pumps`). Aucun identifiant d'employé n'est lu dans la requête.
- **Permission** : `sale.record_for_employee` (« Enregistrer une vente au nom d'un employé (scan QR) »), groupe `sale`. Accordée par défaut au seul rôle ADMIN (administrateur local). Elle apparaît dans la gestion des rôles du super administrateur (groupe « sale ») et dans la gestion des rôles de l'administrateur local, qui peut la donner ou la retirer à ses rôles d'employés.
- **Utilisateur qui n'est pas responsable de la pompe** : seul cas de délégation. Un responsable de la pompe scanne comme avant (vente à son nom).
- **Pompe partagée** par plusieurs responsables : refus `DELEGATE_OWNER_UNCLEAR` (choix explicite non implémenté).
- **Employé sans compte utilisateur lié** : vente autorisée (décision du 2026-11-21). Pas de message interne ; l'e-mail part si l'adresse est sur la fiche et que SMTP est configuré. La vente reste tracée dans l'audit.
- **Super administrateur de la plateforme** : aucun accès aux données de station (inchangé). La mention « superadmin » de la demande désigne l'administrateur local des comptes clients.

## Traçabilité
- `qr_scans.delegated_by_user_id` : utilisateur qui a fait le scan lorsqu'il vend au nom d'un autre employé.
- `qr_events` : événements `scan_ok` et `sale_ok` portent `delegated_by_user_id` / `vente_au_nom_de_employe_id` / `enregistree_par_user_id`.
- Audit de la vente (`ventes`) : `vendue_au_nom_de_employe_id` et `enregistree_par_user_id`.
- Alerte après validation (hors transaction, un échec est journalisé sans annuler la vente) : message interne à l'employé (`kind = vente_au_nom`) et e-mail si SMTP est configuré et si l'employé a une adresse.

## Fichiers
- `migrations/125_vente_au_nom_employe.sql` (permission, rôle ADMIN, colonne `qr_scans.delegated_by_user_id`) — additive et idempotente.
- `src/qr_logic.js` : `delegateTarget`, contrôle au moment de la vente (`DELEGATE_NOT_ALLOWED`), 2 codes d'erreur.
- `src/qr_db.js` : `loadEmployee`, `openScan(delegated)`, `checkScanForSale` (employé du scan, permission).
- `src/qr_codes.js` : route `POST /sales/scan-pump` (désignation, refus, réponse `delegated`).
- `src/fuelsales.js` : permission transmise, audit, événement `sale_ok`, alerte après validation.
- `src/qr_delegate.js` (nouveau) : alerte de l'employé.
- `public/ext-qr-scan.js` : libellé « vente au nom de cet employé ».
- `public/sw.js` : régénéré (`npm run build:sw`).
- `test/qr-delegate-unit.js` (nouveau) : 16/16.

## Vérifications
- `test/qr-delegate-unit.js` 16/16 ; `test/qr-logic-unit.js` 25/25 ; `test/qr-decoder-unit.js` 21/21 ; `test/qr-static.js` 19/19.
- Syntaxe `node --check` de tous les fichiers modifiés.

## Limites
- Exécution réelle non testée ici : dépendances non installables dans cette session (aucune base ni serveur lancés). À vérifier après déploiement : scan par un administrateur local sur une pompe affectée, vente, présence de l'alerte, refus sans compte.
- La migration 125 doit être appliquée (automatique au démarrage via `src/migrate.js`).
