# Accueil : alerte de lisibilité, menu burger, en-tête fixe + audit des contrastes (2026-10-27)

## 1. Alerte de lisibilité dans l'éditeur de l'accueil
- Nouveau moteur de contraste WCAG dans `public/home-core.js` (`auditContrast`, `contrastRatio`, `suggestColor`) : pour chaque texte, bouton ou lettre d'icône, il compare la couleur affichée (propre, héritée du parent, style de bouton ou couleur de thème `@jeton`) au fond réellement derrière (fonds, dégradés — pire couleur —, calques, fonds translucides empilés jusqu'à un fond opaque, sinon fond de page). Évalué **appareil par appareil** (ordinateur / tablette / mobile). Éléments masqués, pictogrammes décoratifs (emoji, symboles) et éléments « absolus/fixes » sans fond propre (fond inconnu) ne sont pas évalués. L'image de fond n'est pas mesurée : le résultat est alors marqué « estimation ».
- Seuils : **< 3:1 « illisible »**, **< 4,5:1 « peu lisible »** (3:1 suffit pour le grand texte).
- Éditeur (`public/home-editor.js` / `.css`) :
  - bouton d'alerte en haut (⚠ N illisibles / ⓘ N à vérifier) ;
  - bannière en haut du panneau de droite : sur l'élément sélectionné (ratio, couleurs, bouton « Utiliser #xxxxxx » qui applique une couleur lisible) ; sans sélection : liste de toute la page avec « Aller à l'élément » ;
  - repère ⚠ N à côté de chaque couleur de thème utilisée par un texte peu lisible (ex. « Texte discret ») ;
  - confirmation de publication qui rappelle les textes illisibles.
- Exemple d'origine reproduit en test : « Texte discret » `#ff0000` sur le héro marine → signalé.
- Note : le modèle d'origine contient lui-même quelques zones limites (texte blanc sur le dégradé bleu clair des boutons « Essayer gratuitement » / « Découvrir nos solutions », titres bleu clair sur fond de page, bandeau d'appel à l'action). Elles sont signalées mais **non modifiées** (choix de design).
- Test : `npm run test:home-contrast` (13 contrôles).

## 2. Contrastes du reste de l'application
- `test/contrast-audit.js` (existait mais n'était pas branché et sortait ~530 faux positifs) : désormais contextuel (classes mesurées dans leur vrai parent : `.dv2-card`, `.wa-app .msg-attachments`, `.message-unread-toast`, `#hbe`…, boutons-images ignorés, `home-editor.css` chargé, règle `label{color:var(--m)}` mesurée). 2 976 mesures (110 combinaisons × 2 thèmes × 8 couleurs de marque × placements). Commande : `npm run test:contrast` (échoue si un texte est < 3:1).
- Défaut réel trouvé et corrigé : fenêtre **« Nouvelle vente »** (boutons « Produit » / « Carburant », `button.card`) = texte **blanc sur blanc** (1:1) à cause de `button:not(.b2):not(.bd):not(.bg){color:var(--on-p)!important}`. Correctif ciblé dans `public/design-v2.css` (fond et texte de carte). Le test échoue si on retire ce correctif.

## 3. Menu burger (☰) — sans JavaScript libre
- Nouveau réglage de boîte **« Menu burger »** (`p.burger` : aucun / tablette et mobile ≤ 1000 px / mobile seul ≤ 600 px), validé côté serveur.
- Rendu 100 % CSS (case à cocher cachée + étiquette ☰/✕ + panneau déroulant sous l'en-tête) : aucun script ajouté à la page. `public/ext-home.js` referme le menu au clic sur un lien, en dehors ou avec Échap.
- Modèle par défaut : sur tablette la barre = logo · boutons · ☰ ; sur mobile = logo · « Se connecter » · ☰ (le slogan est masqué, « Essayer gratuitement » passe dans le menu déroulant).
- Éditeur : le panneau reste ouvert tant que la boîte du menu (ou un de ses liens) est sélectionnée.

## 4. En-tête fixe en haut au défilement
- Nouvelle position **« Fixe »** (`pos: fixed`). L'en-tête du modèle est fixe, fond marine (`@navy`) + ombre, `z-index` 40 (sous les boîtes de dialogue de l'appli). « Se connecter » reste toujours visible.
- Les ancres (`#tarifs`…) tiennent compte de l'en-tête (`scroll-margin-top`). Marges hautes du héro ajustées (tablette 110, mobile 100).
- **Pages déjà enregistrées** : à l'ouverture / enregistrement, un en-tête encore identique au modèle (signature exacte) passe automatiquement en en-tête fixe + burger (`upgradeHeaderSticky`). Un en-tête déjà retouché n'est jamais modifié ; on peut l'activer à la main (Position → Fixe ; boîte Menu → Menu burger).

## Technique
- Cache du service worker : `smp-static-v73`. Aucune migration SQL.
- Tests : `npm run test:home-header-responsive` (réécrit, 13 contrôles), `npm run test:home-contrast`, `npm run test:contrast`. Vérifié dans Chromium à 320, 360, 390, 820 et 1280 px (aucun défilement horizontal, en-tête reste en haut) et éditeur piloté dans Chromium (alerte, correction en un clic, burger, sélection du menu).
- Deux échecs déjà présents dans l'archive d'origine, non liés : `test/superadmin-sidebar-icons-static.js` et `test/shift-report-share-unit.js` (module `zod` absent du bac à sable).

## Addendum (livraison)
- Correctif supplémentaire : la règle globale `h1,h2,h3,h4{color:var(--t)}` (design-v2.css) rendait les titres de l'accueil sombres sur fond marine sur la vraie page (invisible dans l'éditeur). `home-core.js` : `.hpx h1..h4{color:inherit;letter-spacing:inherit}`.
- Pages enregistrées : un en-tête identique au modèle précédent, ou issu de l'ancien modèle non retouché, passe automatiquement en fixe + burger. Un en-tête retouché n'est jamais modifié.
- Vérifié dans Chromium (page réelle à 320/360/390/820/1280 px : en-tête fixe, burger, fermeture lien/Échap/clic extérieur, aucun défilement horizontal ; éditeur : alerte, repère de thème, correction en un clic, confirmation de publication).
- `npm run test:home-contrast`, `test:home-header-responsive`, `test:contrast` : tous au vert.
