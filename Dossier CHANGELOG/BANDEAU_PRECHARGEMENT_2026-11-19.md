# Bandeau : la photo par défaut est chargée avant d'être posée (2026-11-19)

## Cause
- Le bandeau était posé avec la photo par défaut avant que l'image soit chargée : le fond restait uni (bleu nuit) un instant, puis la photo apparaissait. Le bandeau semblait donc apparaître deux fois.

## Modifications
- `public/ext-banner.js` : fonction `warm()` qui charge et décode la photo par défaut (repli après 3 s). Le bandeau n'est posé qu'après ce chargement. Le préchargement démarre dès le chargement de la page.
- `public/sw.js` régénéré.

## Vérifications
- Enregistrement image par image, 390×844, sans réponse de la photo de la station : un seul bandeau, avec la photo par défaut dès la pose.
- `test/banner-static.js` : 15/15. `test/sw-coherence-static.js` : 8/8.

## Non vérifié
- Sur appareil réel. Quand une photo propre à la station existe, elle remplace la photo par défaut une fois téléchargée (remplacement visible, voulu).
