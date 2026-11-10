# Administration des comptes, permissions et licences

Évolution **non destructive** du module existant (`src/contracts.js`, migration 015/019/024 + **025**).

## Déjà présent dans v3 (conservé)

| Exigence | Implémentation |
|----------|----------------|
| Admin principal (`is_global`) | `needPrincipal` |
| Création client + gérant + licence | `POST /admin/clients` |
| Modules / features / max_users / max_stations | `client_contracts` + `features` JSONB |
| Durées day/month/year/custom/indefinite | `computeExpiry` |
| Statuts ACTIVE / EXPIRANT_BIENTOT / EXPIREE / SUSPENDUE / INDEFINIE | `licenseStatusOf` |
| Renouveler / prolonger / suspendre / réactiver | routes `/license/*` |
| Historique licences append-only | `license_history` |
| Dashboard licences | `GET /admin/licenses/dashboard` |
| Blocage API si expiré (sauf `/me`) | middleware `server.js` |
| Limite max utilisateurs à la création | `auth.js` + `countClientUsers` |
| Séparation multi-clients | `client_id` sur users/stations |
| Page LICENCE EXPIRÉE | `public/ext-contracts.js` |
| Permissions granulaires serveur | `need(...)`, migration 024 |

## Ajouts migration 025 + code

1. **Seuils d'avertissement configurables** (défaut 30,15,7,3,1)  
   - `GET/PUT /admin/licenses/warning-thresholds`  
   - UI : bouton « Seuils d'avertissement »

2. **Demandes de renouvellement côté client**  
   - `POST /me/license/renewal-request` (accessible même si licence expirée)  
   - `GET /admin/license-renewal-requests`  
   - `POST /admin/license-renewal-requests/:id/process` (approve+renew / reject)  
   - UI client : bouton « Demander un renouvellement »  
   - UI admin : liste des demandes en attente sur le dashboard

3. **Presets de durée** à la création : 1j, 2j, 3j, 10j, 1m, 3m, 6m, 1an, 2ans, indéfinie, personnalisée

4. **Archivage client** (soft) : `DELETE /admin/clients/:id` → status `archive`, **données métier conservées**

5. **Message licence** : `GET /me/license/status-message`

## Règles respectées

- Expiration **ne supprime jamais** les données  
- Contrôles **côté serveur** (pas seulement masquage UI)  
- Client ne peut pas modifier sa propre licence ni d’autres organisations  
- Prolongation **conserve les jours restants** (route `extend` existante)  
- Historique non effaçable par utilisateurs ordinaires  

## Après déploiement

```bash
npm run migrate   # applique 025_license_warnings_renewal_requests.sql
npm test
npm run test:licenses
```
