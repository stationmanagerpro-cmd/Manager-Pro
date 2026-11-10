# Changelog — C2 : message d’expiration configurable

Date : 19 octobre 2026

- L’écran plein écran C2 conserve le message obligatoire du cahier des charges.
- Il affiche désormais aussi le message d’expiration renvoyé par `/me/license/status-message`, lorsque celui-ci est défini.
- Le message configuré est échappé avec `esc()` avant insertion dans le HTML pour éviter l’interprétation de contenu fourni par la configuration comme balisage.
- Le test statique C2 vérifie cette restitution et l’échappement.
