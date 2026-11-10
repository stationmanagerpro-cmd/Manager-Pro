# Sécurité — Station Manager Pro

## Principes
1. **Authentification** : JWT signé + session en base (révocable, expiration).
2. **Autorisation** : permissions par rôle (`need(...)`) ; `is_global` réservé à l'Administrateur Principal.
3. **Isolation** : chaque requête métier porte `X-Station-Id` ; non-admin limité à `user_stations`.
4. **Contrats clients** : modules et quotas appliqués côté API (middleware).
5. **Anti-élévation** : un Gérant ne peut pas créer `is_global` ni rôle `ADMIN`.
6. **Audit** : actions sensibles dans `audit_logs`.
7. **Sauvegardes** : `pg_dump` réel + `backup_logs` (jamais de succès simulé).

## Configuration recommandée
- `JWT_SECRET` ≥ 32 caractères aléatoires
- `BACKUP_AUTO=1` en production + `BACKUP_NOTIFY_EMAIL`
- SMTP pour digest alertes / échecs backup
- Ne jamais exposer le port PostgreSQL publiquement
- Lancer `npm test` uniquement sur une **base de test**

## Tests
```bash
npm test                 # suite complète (inclut security)
npm run test:security    # isolation + anti-élévation seuls
npm run test:contracts   # quotas / modules contrat
```
