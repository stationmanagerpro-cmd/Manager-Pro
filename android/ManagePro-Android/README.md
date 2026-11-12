# Manager PRO — application Android

Application Android native (Kotlin) qui embarque ManagePro dans un WebView optimisé :
démarrage rapide (écran de démarrage), plein écran sûr (encoche, barre de navigation, clavier), tableaux défilables
horizontalement, zoom par pincement, retour Android intelligent, actualisation par tirage, mode « pas de connexion »
avec reprise automatique, enregistrement des PDF/Excel dans **Téléchargements/ManagePro**, impression, envoi de fichiers
et caméra, liens externes ouverts hors de l'application.

## Fonctions natives
- **Pont `AndroidBridge`** : respecte le contrat de `public/native-bridge.js` du site (WhatsApp, e-mail, enregistrement + ouverture des PDF/Excel, impression Android). Remplace `android_a_copier/MainActivity.kt` : ne copiez pas les deux.
- **Verrouillage** par empreinte ou code du téléphone (au lancement et après 1 min en arrière-plan) : menu du profil (avatar en haut à droite) → « ⚙ Réglages de l'application ».
- **Scan code-barres** : le bouton « 📷 Scanner » apparaît quand un champ texte est actif ; remplit le champ (ex. recherche produit). Nécessite Google Play Services.
- **Notifications** toutes les ~15 min : stock bas, factures en retard, échéances fiscales, quart resté ouvert (serveur : `GET /api/mobile/alerts`, déployer la version web du même jour).
- **Imprimante Bluetooth** (ESC/POS, 58/80 mm) : jumelez-la d'abord dans les réglages Android, puis menu du profil → Réglages de l'application → Imprimante. Les tickets (`printReceipt`) partent dessus ; en cas d'échec, impression Android.

## Ouvrir et lancer
1. Android Studio (Koala 2024.1 ou plus récent) → **File ▸ Open** → dossier `ManagePro-Android`.
2. Attendre la synchronisation Gradle (JDK 17 intégré à Android Studio).
3. Brancher un téléphone (débogage USB) ou créer un émulateur → **Run ▸ Run 'app'**.

## Adresse du site
Dans `app/build.gradle.kts` : ligne `BASE_URL` (déjà sur `https://manager-pro-669w.onrender.com/`, sans `?utm_source=`).
Si vous changez de domaine, modifiez aussi `android:host` dans `AndroidManifest.xml`.

## Publier
- **APK de test** : *Build ▸ Build Bundle(s)/APK(s) ▸ Build APK(s)*.
- **Play Store** : *Build ▸ Generate Signed Bundle / APK* → Android App Bundle, créez une clé (`.jks`) et **sauvegardez-la** :
  sans elle, aucune mise à jour n'est possible. Augmentez `versionCode` à chaque publication.
- **Logo** : logo Manager PRO déjà intégré (icône adaptative + version monochrome, écran de démarrage, écran de verrouillage, notifications). Images dans `app/src/main/res/drawable-nodpi/` et `drawable-*/ic_launcher_foreground.png`.

## Notes
- Serveur Render gratuit : après une période d'inactivité le premier chargement peut prendre ~30 s (message « Réveil du serveur »).
  Un hébergement payant ou un « ping » régulier supprime ce délai.
- Android 10 (API 29) minimum. Cette version n'a pas de mode hors ligne complet : les données restent sur le serveur.
