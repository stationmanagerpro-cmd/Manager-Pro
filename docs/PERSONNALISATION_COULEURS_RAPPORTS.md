# Personnalisation des couleurs des rapports — clients et Super Admin

## Compte client : autorisation préalable obligatoire

1. Se connecter avec le compte Super Admin.
2. Ouvrir **Clients / Contrats** dans la gestion de la plateforme.
3. Créer ou modifier le contrat du client.
4. Mettre **Personnaliser les couleurs des rapports exportés** sur **Oui**.
5. Enregistrer le contrat.
6. Dans le compte client, ouvrir **Exports PDF / Excel**. Un utilisateur qui dispose de `appearance.manage` ou `settings.edit` peut choisir la couleur principale, le fond des en-têtes et la couleur du texte.

Le choix est enregistré au niveau du client et partagé par les stations rattachées à ce client. Si le contrat est suspendu ou si l'option est désactivée, les couleurs personnalisées ne sont pas utilisées et les couleurs standards s'appliquent. Le backend vérifie l'autorisation; masquer le bouton ne constitue pas la seule protection.

## Compte Super Admin : couleurs propres à la plateforme

1. Se connecter avec le compte Super Admin.
2. Ouvrir **Finance plateforme** puis l'onglet **Rapports**.
3. Dans **Couleurs des rapports Super Admin**, régler la couleur principale, le fond des en-têtes et la couleur du texte.
4. Cliquer sur **Enregistrer les couleurs**.

Ces préférences s'appliquent uniquement aux exports PDF et Excel des rapports de la plateforme (licences, factures, dépenses de plateforme et contrats). Elles sont stockées dans `platform_report_preferences`, une table distincte de `client_report_preferences`; elles ne modifient donc pas les couleurs d'un client.

## Activation technique

La migration additive `migrations/040_platform_report_export_preferences.sql` doit être appliquée à la base locale avec `npm run migrate` après une sauvegarde vérifiée. Ne pas marquer manuellement la migration comme appliquée. Aucun service externe ni aucune base de production distante ne doit être modifié pour cette étape.

## Limites de validation

Les contrôles automatisés de cette étape sont statiques. La modification n'a pas été testée dans un navigateur connecté à une base PostgreSQL réelle; il faut vérifier sur une base de test que la migration s'applique, que les trois couleurs persistent après reconnexion et que les fichiers PDF/Excel exportés présentent bien les couleurs choisies.
