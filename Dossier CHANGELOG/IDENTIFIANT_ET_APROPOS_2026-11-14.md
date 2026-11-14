# 2026-11-14 — Identifiant admin local + récupération « À propos »
- POST /auth/login-change (admin local uniquement, mot de passe actuel exigé, unicité insensible à la casse, autres sessions révoquées, audit). Bouton « 🆔 Identifiant » dans le menu utilisateur et Mon profil. Le mot de passe reste via chgPwd.
- À propos : historique (10 versions), GET /admin/about/history, POST /admin/about/restore, POST /admin/about/complete (ajoute les solutions/sections du modèle manquantes sans écraser). Boutons « Compléter avec le modèle » et « Versions ».
