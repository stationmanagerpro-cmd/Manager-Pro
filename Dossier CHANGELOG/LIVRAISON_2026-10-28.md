# Livraison Station Manager Pro v21 — 28/10/2026

Archive corrigée après audit et évolutions demandées.

## Contenu des correctifs

### Quarts datés (passés)
- Ouverture avec date + heure (pas de futur)
- Clôture avec date + heure (≥ ouverture, pas de futur)
- Badge « passé », confirmations UI
- Ventes / dépenses / paiements alignés sur la date du quart si antérieur
- Audit enrichi (flag `backdated`)

### Isolation branding Manager Pro ↔ clients
- Logo site (SuperAdmin) ne s’affiche plus en repli sur les comptes clients
- Menu et bandeau client = identité station/client uniquement
- PDF : logo station seul (plus de logo plateforme en secours)
- Photo profil utilisateur reste personnelle (`/me/photo`)

### Qualité / exploitation
- `.env.example` standard + version package `21.0.0`
- `npm run doctor` — diagnostic environnement
- `GET /api/health` enrichi (version, DB, migrations)
- `docs/MIGRATIONS_INDEX.md`
- Tests : `npm run test:shift-open-past` (27) · `npm run test:branding-tenant-isolation` (10)

## Mise en service

```bash
cp .env.example .env   # ou .env.pc.example sur PC Windows
# renseigner DATABASE_URL + JWT_SECRET (≥ 32 car.)
npm install
npm run migrate
npm run doctor
npm start
```

Journal détaillé : `CHANGELOG_AMELIORATIONS_POST_AUDIT_2026-10-28.md`
