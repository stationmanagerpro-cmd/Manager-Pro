# Rôles prédéfinis · File hors-ligne · Comparatif multi-stations — 14/10/2026

## 1. Rôles métier prédéfinis
- Migration `051_role_presets.sql` : permissions cohérentes pour POMPISTE, CAISSIER, GERANT, COMPTABLE, SUPERVISEUR, MAGASINIER, ADMIN
- API `GET /roles/presets` : libellés, résumés, liste des permissions
- UI : bouton **Modèles métier** dans Rôles & permissions + `showRolePresets()`

## 2. File hors-ligne visible
- Vue `offlineq` : compteurs en attente / sync / erreur, bouton synchroniser
- Badge flottant existant (`offline-queue-badge`) conservé + styles

## 3. Comparatif multi-stations
- Section **Comparatif du jour** sous « Mes stations » (barres CA relatives, volume, quarts, stock bas)

## Déploiement
```bash
npm run backup
npm run migrate   # applique 051
npm start
```
