# RH V2 — Extension professionnelle (Station Manager Pro)

## Principe

Extension **non destructive** du module RH/paie existant. Aucune réécriture parallèle. Aucun abonnement payant obligatoire.

## Migration

`migrations/012_rh_v2.sql`

## Nouveaux modules (niveau 1 — sans risque financier)

| Module | Tables | Routes préfixe |
|--------|--------|----------------|
| Contrats | `hr_contracts` | `/hr/v2/contracts` |
| Documents | `hr_documents` | `/hr/v2/documents` |
| Équipes / Planning | `hr_teams`, `hr_schedules` | `/hr/v2/teams`, `/hr/v2/schedules` |
| Présence | `hr_attendance` | `/hr/v2/attendance` |
| Congés | `hr_leave_types`, `hr_leave_requests` | `/hr/v2/leaves` |
| Compétences | `hr_skills`, `hr_employee_skills` | `/hr/v2/skills` |
| Formations | `hr_trainings`, `hr_training_participants` | `/hr/v2/trainings` |
| Évaluations | `hr_evaluation_*` | `/hr/v2/evaluations` |
| Sanctions/Récompenses | `hr_disciplinary` | `/hr/v2/disciplinary` |
| Alertes | `hr_alerts` | `/hr/v2/alerts` |
| Tableau de bord | — | `/hr/v2/dashboard` |
| Contrôle de paie | — | `/hr/v2/payroll-control` |
| E-mail bulletin | `payslip_email_log` | `POST /hr/payroll/:id/email` |
| Portail | — | `/hr/v2/me/summary` |

## Permissions granulaires

Ajoutées en base (admin les reçoit toutes). Anciennes `hr.view` / `hr.manage` / `hr.payroll` restent valides.

## Modules activables

`GET/PUT /hr/v2/modules` — clé settings `hr_modules`. Local, sans SaaS.

## Sécurité financière

- Formation `cost_info` : **informatif uniquement**
- Sanctions / évaluations : **aucun impact paie auto**
- Contrôle de paie : lecture seule
- E-mail bulletin : SMTP local (`.env`) ou `MAIL_MODE=json` ; sinon message « non configuré » + téléchargement PDF

## SMTP

```env
SMTP_HOST=smtp.entreprise.ml
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
MAIL_FROM=RH <rh@entreprise.ml>
# Tests : MAIL_MODE=json
```

## UI

Menus : Tableau RH · Contrôle paie · Alertes RH · Congés · Présences  
Bulletin : bouton **✉ E-mail**

## Fichiers

- `src/hr_v2.js` (nouveau)
- `src/hr.js` (EMP_COLS + patch dossier enrichi)
- `src/server.js` (montage route)
- `public/ext-hr-v2.js`
- `migrations/012_rh_v2.sql`
'''

## Suite finale

### Clôture de période (`014_payroll_periods.sql`)
- `GET /hr/v2/periods`
- `POST /hr/v2/periods/close` { month, notes }
- `POST /hr/v2/periods/reopen` { month, reason } (exception + audit)
- Création de bulletin refusée si mois clôturé

### Modèle e-mail
- `GET/PUT /hr/v2/email-template`
- Variables : `{{periode}}` `{{prenom}}` `{{nom}}` `{{entreprise}}` `{{service_rh}}`

### HS en simulation
- Dry-run affiche `overtime_simulation` (heures / estimation) **sans** les injecter dans le net réel
