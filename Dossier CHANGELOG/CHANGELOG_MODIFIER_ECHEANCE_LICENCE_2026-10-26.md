# Modifier l'échéance d'une licence : réduire ou reculer la date (2026-10-26)

- Problème : « Renouveler » repart d'aujourd'hui ou de l'ancienne échéance et « Prolonger » ne fait qu'ajouter ; impossible de diminuer l'échéance.
- Nouvelle route `POST /admin/clients/:id/license/set-expiry` (Administrateur Principal) : `{ expires_at: 'AAAA-MM-JJ' }` pour fixer une date précise (avant ou après l'actuelle), ou `{ reduce_unit, reduce_value }` pour retrancher jours / mois / années (31 mars - 1 mois = 28 février). Note facultative.
- Refusé : date avant le début du contrat ; réduction d'une licence indéfinie (donner une date précise).
- Une date déjà passée est acceptée (la licence devient expirée) ; l'interface demande confirmation.
- Historique de licence : opération `reduction` (échéance raccourcie) ou `modification` ; entrée dans le journal d'audit. Aucune migration (`reduction` était déjà autorisée par la migration 019).
- Interface : bouton « Modifier l'échéance » dans la fiche contrat, « Échéance » dans la liste des clients, « Modifier l'échéance » dans les pages de détail.
- Le statut suspendu / résilié n'est pas modifié : utiliser « Débloquer » pour rouvrir l'accès.
- Cache PWA : `smp-static-v54`. Test : `npm run test:license-set-expiry`.
