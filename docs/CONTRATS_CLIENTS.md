# Contrats clients — Administrateur Principal

## Principe

> **L'Administrateur Principal (`is_global`) définit les droits. Le Gérant les utilise. Le Gérant ne peut jamais s'en octroyer de nouveaux.**

## Tables

- `clients` — organisation
- `client_contracts` — limites + features JSONB
- `stations.client_id` / `users.client_id`

## API (Admin Principal uniquement)

| Route | Rôle |
|-------|------|
| `GET/POST /admin/clients` | Liste / créer |
| `GET/PUT /admin/clients/:id/contract` | Lire / modifier contrat |
| `POST .../assign-station` | Lier une station |
| `POST .../assign-user` | Lier un utilisateur |
| `GET /me/contract` | Contrat du compte connecté |

## Enforcement backend

- `POST /stations` — `can_create_station` + `max_stations`
- `POST /users` — `can_manage_users` + `max_users` + anti-élévation ADMIN
- `/api/hr*` — `can_access_hr` / `module:hr`
- Finance / rapports — features correspondantes
- Signature / footer — `can_customize_signature`
- Signature imposée via `forced_signature` dans les PDF

## UI

Menu **Contrats clients** (Administrateur Principal).
