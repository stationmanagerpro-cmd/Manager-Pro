# Branches à supprimer (liste du 2026-11-26) — NON supprimées

**Statut : aucune n'est supprimée.** La suppression depuis la session de travail a été refusée par GitHub (erreur 403) ; elle doit être faite par le propriétaire dans GitHub (page *Branches* du dépôt, icône corbeille de chaque ligne). À supprimer parce que leur contenu est **entièrement dans `main`** (comparaison GitHub : 0 commit en avance), sauf `fix/quarts-ouverts-etat-courant` dont le correctif a été repris dans `main` par cherry-pick (`5e737af`). Aucun travail n'est perdu.

Une fois supprimées, la liste ci-dessous permet de les recréer.

**Pour recréer une branche** (identifiant conservé ci-dessous) : `git push origin <identifiant>:refs/heads/<nom>`. GitHub conserve un temps les commits non rattachés ; la restauration est fiable tant que l'identifiant reste accessible.

**Mise à jour (2026-11-26, demande « plus rien garder ») :** plus aucune branche ne porte de travail unique. Le contenu non intégré (4 commits) est archivé en fichiers texte dans `docs/archive-branches/` (voir son `README.md`), sans être activé dans le site ; le reste est déjà dans `main` (`fc6f2de`, `17a4667`, `d8ac8dc`, `4d87688`, APK identique). **Toutes les branches ci-dessous, y compris les 9 ajoutées en bas du tableau, peuvent être supprimées.** Supprimer `fix/scanner-flottant-reduire` ferme automatiquement la demande de fusion #16.

| Branche | Identifiant du dernier commit |
|---|---|
| `audit/corrections-2026-11-18` | `a18c261b2c7d83df09b30087d214c34e75244c11` |
| `chore/apk-about-lien-manager-pro` | `eba9a92ca5a1e8cd7249a7d099eb170a01099086` |
| `cleanup/code-mort` | `bb9ee8b35d97174dfef6b5f086f3290db66b37f9` |
| `docs/manuel-v9` | `897748f81d280f2677ce471c9e2acd419bec8add` |
| `feat/acces-onglets-contrat` | `721bedae5ef662935849531a162b59f4bdb67e54` |
| `feat/besoin-aide` | `d4ce3b870e00cc3edb05ce473f0ef9e93116b002` |
| `feat/besoin-aide-modules-editables` | `90e62a20a6eb446383581ded6b56058d779b61bb` |
| `feat/besoin-aide-raccourci` | `d7622040b8af6e776befefe838ce2299136a3d65` |
| `feat/depense-employe-responsable` | `64279599c3b664a3ea3891d0be94b244b2be7e90` |
| `feature/qr-vente-au-nom-employe` | `3807fbc0eeb5f8283f8878e56034895526a8280e` |
| `feature/scan-qr-pompes` | `061f34ca81b4520cc39327b8d99ec0af92466c49` |
| `fix/bandeau-avec-photo` | `9cf3a3230b7ce0aafe62bd90a5a58ec00eb27481` |
| `fix/bandeau-filet-securite` | `cf205ab32ce635a4ad0526148bff74f8e4b99775` |
| `fix/bandeau-image-actualisation` | `eacd654eb53b72f8e756e5e383e9a585ad192e6b` |
| `fix/besoin-aide-affichage` | `b1e5fff7247217ee34577f74ff0800a529f90078` |
| `fix/besoin-aide-bouton-fixe` | `4676f82430e1501e304d4bfefc3b7c595ac8c635` |
| `fix/besoin-aide-modifier-superadmin` | `b02c998ea4a71b6797c7d322dc326de0633e0eb9` |
| `fix/besoin-aide-superadmin-route` | `0dfba83838b74e86a0ff1e069c629fbd2c77ad71` |
| `fix/besoin-aide-titres` | `d8deb13ccacaf75a041feb8babc4d9619131d7e4` |
| `fix/correctifs-2026-11-19` | `114449369534e7ebec538c00c172ad1609aa4ccf` |
| `fix/en-tete-masque-jusqua-pret` | `f1394433b691ef9ccb0742fa2e01a03ffb707e8d` |
| `fix/formulaire-contrat-pied-visible` | `c9b00ac2410ad32c4db1fa31566cefbfadc922f7` |
| `fix/help-guides-schema-auto` | `51ed818b6294dda051c673fec345f292f17d9cdc` |
| `fix/qr-android-payload` | `acbde76af62c066023d4a605705dda935adb6c25` |
| `fix/quarts-ouverts-etat-courant` | `3e01a4e6f72f82a28881e13525d67c8a9aaa9d47` |
| `fix/tests-perimes-2026-11-17` | `656b16bad8f54096f278516d3f0e162c8324f645` |
| `fix/vente-employe-pompe-libelle` | `852cf0862617ba1644aab9c4b19f08699a727023` |
| `perf/bandeau-affichage-immediat` | `1eef345d1922c9ddbdf9d34899f0d862d43037ec` |
| `perf/bandeau-cache-navigateur` | `7a3edae3df6488b91cc111d79dffa69e3097bae7` |
| `refactor/en-tete-unique` | `b30b373c0ee8df11684ce21d474ef8ccc76dcc9d` |
| `release/apk-site-2026-11-17` | `6e48674480d423aacdc582381082f304eccd39f7` |
| `docs/modele-journal-deploiement` | `a598d28` (repris en `fc6f2de`) |
| `docs/changelog-regroupement-deploiement` | `d9b08a6` (repris en `17a4667`) |
| `feat/regroupement-menu-client` | `7fb82f1` (= `d8ac8dc` dans `main`) |
| `fix/scanner-flottant-reduire` | `11a902a` (= `4d87688` dans `main`) |
| `release/apk-debug-2026-11-17` | `6ce9d6f` (APK identique dans `main`) |
| `fix/tests-perimes-2026-11-16` | `c38f068` (archivé) |
| `feat/rapprochement-cloture-alertes` | `8dc1832` (archivé) |
| `feat/affichage-rapprochement-cloture` | `9e85609` (archivé) |
| `feat/rapport-whatsapp-signature-raccourci` | `ad3468d` (archivé, WIP non testé) |
