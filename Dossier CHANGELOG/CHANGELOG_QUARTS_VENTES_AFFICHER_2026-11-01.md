# Quarts : ventes rattachées + suppression du doublon (2026-11-01)
- Liste des quarts : nouveau bouton vert « Afficher » (à côté de « Voir ») qui affiche en bas de page les ventes rattachées au quart (total, carburant, produits, nombre, détail de chaque vente). Second clic : « Masquer ».
- Nouveau point d'accès `GET /shifts/:id/sales` (src/shifts.js), même contrôle de permission que la fiche complète, isolé par station.
- Tableau « Historique des quarts » supprimé (doublon) : public/ext-p7.js ne rajoute plus de second tableau. « Fiche complète » reste accessible via « Voir ».
