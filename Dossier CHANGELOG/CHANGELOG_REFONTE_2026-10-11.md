# Station Manager Pro — Livraison refonte (11 oct. 2026)

## Contenu de cette livraison

### Sécurité & comptes
- Isolation SuperAdmin / Compte Client renforcée
- Lien **employé → compte utilisateur** (employé d'abord, accès optionnel)
- Octroi de compte avec rôle selon le poste + modules du rôle
- Suspension d'accès compte sans rendre l'employé inactif
- Statut **inactif** employé = suspension totale (compte + sessions)

### Paie Mali (AMO / INPS / ITS)
- Autorisation SuperAdmin des modules paie sur le contrat
- Activation client avec **formulaire de taux** (CLEISS / DGI, modifiables)
- Activation groupée possible

### Messagerie
- Messagerie interne (même client) — feature flags contrat
- Pièces jointes (bulletins, fichiers)
- Support **Client ↔ SuperAdmin**
- Menu Communication → Messagerie

### Portail employé
- **Mon espace** : fiche + bulletins de paie (PDF)

### Autres
- Import ventes Excel
- Exports avec noms produits + ligne de total
- Thème jour/nuit, bouton Retour, branding login / panneau pub
- Sauvegardes pg_dump multi-version

## Déploiement
1. Extraire l'archive
2. `npm install`
3. Configurer `.env` (voir `.env.example`)
4. Appliquer les migrations : `node src/migrate.js` (inclut `031_messaging_support_and_portal.sql`)
5. `npm start` ou Docker Compose

## Fichiers clés ajoutés / étendus
- `src/payroll_activation.js`
- `src/messaging.js` (support SA)
- `migrations/031_messaging_support_and_portal.sql`
- `public/ext-messaging.js`, `public/ext-roles.js`, `public/ext-core.js`, `public/ext-contracts.js`

## PWA (11 oct. 2026 — soir)
- Service Worker `public/sw.js` : cache assets statiques versionnés uniquement
- **Aucun cache** des routes `/api/**` (JWT / données métier protégés)
- `public/pwa.js` : enregistrement SW + événement `beforeinstallprompt`
- Bouton « Installer l’application » (écran login + barre top)
- Manifest mis à jour + icônes PNG 192/512 (`public/icons/`)
- Helmet : `worker-src` et `manifest-src` = `'self'`
- En-têtes `Service-Worker-Allowed` / no-cache pour `sw.js`
- **Non inclus** : SheetJS / jsPDF client (exports restent serveur)
