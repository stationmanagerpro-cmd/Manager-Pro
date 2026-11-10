# Correctifs du 23/10/2026

- **Accès par lien client `/c/<code>`** : chemins CSS/JS de `public/index.html` rendus absolus (la page s'affichait sans style ni scripts).
- **Affichage mobile / petits écrans** (`public/responsive-v3.css`) : titre de page sur 2 lignes, onglets non rognés, cartes et grilles qui ne débordent plus, « Premiers pas » en une colonne.
- **En-tête mobile** : recherche et profil sur la même ligne (la recherche se rétrécit).
- **Menu latéral** : logo et nom plus grands et lisibles, onglet actif toujours lisible.
- **Connexion** : carte limitée à 400 px. **Menu profil** : nom de l'utilisateur lisible.
- **Calculatrice** (`public/ext-calc.css`) : remontée au-dessus de la barre du bas sur mobile.
- **Logo PWA** : nouvelles icônes (`public/icons/`), manifest, favicon, icône iPhone.
- **Nom de l'application** : « Manager PRO » (code, manifest, e-mails, PDF, Excel).
- **Boutons « Envoyer digest e-mail » et « Programmer digest 20h »** (Pilotage direction) : les fonctions associées n’existaient pas ; ajoutées dans `public/ext-modern-pack.js`.
- **Suppression du « lien client » et de sa clé** : plus de route `/c/<code>`, plus d'identification/approbation d'appareil par client, plus d'onglet « Appareils autorisés » dans la fiche client. Seule la **clé d'accès Superadmin** reste : à la première connexion sur un appareil (si activée), la clé est demandée ; une fois validée, l'appareil est reconnu et arrive directement sur la connexion. Migration `070_remove_client_device_link.sql` (supprime `client_devices` et `client_device_keys`), variable `PUBLIC_BASE_URL` retirée.
- **Publicité** : la bannière d'images s'affiche désormais dès que la « Zone PUB » du menu n'est pas visible (menu masqué/réduit, téléphone, écran peu haut) ; l'envoi d'image réduit automatiquement les photos > 1,5 Mo (JPEG ≤ 1600 px) et accepte WebP.
- **Signature imposée du contrat** : affichée en haut sous le nom du client, en plus du pied de page et des documents PDF/Excel.
- Cache du service worker : `smp-static-v43`.

## À faire après installation
1. Remplacer les fichiers, redémarrer le serveur, Ctrl+F5 (PWA mobile : fermer / rouvrir, ou réinstaller pour l'icône).
2. Nom stocké en base : Administration > Identité, ou
   `UPDATE app_settings SET value = to_jsonb('Manager PRO'::text) WHERE key = 'app_name';`
3. Exécuter `npm run migrate` (migration 070 : suppression des tables du lien client). Une sauvegarde est faite automatiquement avant.
