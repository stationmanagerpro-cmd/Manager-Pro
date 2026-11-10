# Étape 12 — Fiche B1 : sécurité des pièces jointes

## Correctifs
- Les chemins de fichiers fournis par le client sont résolus avec `realpath` et doivent se trouver sous `UPLOAD_DIR`; les liens symboliques sortant de ce répertoire sont ainsi refusés.
- Les sources doivent être des fichiers ordinaires existants.
- Les fichiers stockés dans la messagerie utilisent des noms aléatoires afin d'éviter les collisions et de ne pas exposer le nom d'origine dans le chemin sur disque.
- Les contrôles existants de contrat, d'appartenance à la conversation et d'isolation par `client_id` pour le téléchargement sont conservés.

## Vérification
- `node --check src/messaging.js` : réussi.
- `node test/messaging-attachment-security-static.js` : contrôle statique ciblé.
- Les tests statiques ne remplacent pas un essai HTTP multipart ni un test d'intégration avec PostgreSQL.

## Limites connues
- La route d'upload utilise `req.file` si un middleware amont le fournit. La configuration réelle de ce middleware et les limites de taille MIME doivent être validées sur l'environnement de déploiement.
- Les routes d'envoi de documents métier supposent que les fichiers temporaires ou générés se trouvent dans `UPLOAD_DIR`.
