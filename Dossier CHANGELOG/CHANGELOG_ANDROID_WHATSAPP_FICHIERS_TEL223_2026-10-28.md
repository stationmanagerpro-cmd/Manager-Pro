# Android : WhatsApp, ouverture des fichiers exportés, téléphones +223 (2026-10-28)

- public/native-bridge.js (nouveau) : dans l'app Android, exports blob (PDF, Excel, CSV) envoyés au natif et ouverts
  dans une application externe ; liens wa.me / mailto / tel ouverts dehors ; window.print et fenêtres HTML (audit PDF) vers l'impression Android.
- Téléphones : champs *phone* préremplis « +223 », format contrôlé à la sortie du champ ; enregistrement bloqué si invalide
  (+ autres indicatifs acceptés). Serveur : src/phone.js normalise phone / emergency_phone / contact_phone / borrower_phone
  (8 chiffres -> +223). waNumber (finance.js) : 8 chiffres -> 223.
- android_a_copier/ : MainActivity.kt, AndroidManifest_AJOUTS.xml, res/xml/file_paths.xml, LISEZMOI_ANDROID.txt.
- Cache PWA smp-static-v75. Test test/shift-report-share-unit.js mis à jour (non exécuté ici : dépendances Node absentes).

## Page Produits : Liste / Mosaïque (2026-10-28)
- public/ext-product-catalog.js + .css (nouveaux) : remplacent VM.prod. Vue Liste (produit+photo, catégorie, code-barres, coût, prix, marge colorée, stock + badge Faible/Rupture) et vue Mosaïque (cartes avec photo, badge catégorie, prix, marge, stock). Filtres : recherche, catégorie, état du stock. Le choix de vue est mémorisé. Un clic ouvre la fiche produit (go('prodf')).
- Cache PWA smp-static-v76.

## Page Produits : Importer / Exporter PDF / Exporter Excel (2026-10-28)
- src/exports.js : nouveau type d'export « products » (Produit, Référence, Code-barres, Catégorie, Unité, Coût, Prix de vente, Marge %, Stock, Seuil) ; filtres q, category, stock, active ; permissions price.edit | stock.adjust | report.view.
- public/ext-product-catalog.js : boutons ⬆ Importer (modal d'import Excel produits existant), Modèle, 📄 Exporter PDF, 📊 Exporter Excel (appliquent la recherche/filtres affichés).

## Pages Fournisseurs et Clients : nouveau design (2026-10-28)
- public/ext-parties.js + .css (nouveaux) : remplacent VM.four et VM.cli. En-tête (titre, compteur, boutons Nouveau / Nouvelle commande / ⬆ Importer / Modèle / 📄 Exporter PDF / 📊 Exporter Excel / archivés), 4 cartes de synthèse (la carte dette/créances en orange), recherche instantanée sans accents, tableau Fournisseur|Client (nom + code + contact), Contact (tél + e-mail), Adresse, Achats/Limite, Dette/Solde (rouge si dû, vert « Crédit », gris si 0). Clic = fiche. La liste des commandes d'achat reste sous le tableau fournisseurs.
- Cache PWA smp-static-v77.

## Trésorerie et Créances & dettes : nouvelles pages (2026-10-29)
- src/treasury.js (nouveau, monté dans server.js) : GET /treasury/overview | movements | expenses | transfers | reconciliation ; PUT /money/accounts/:id ;
  GET /debts/overview | payments | reminders ; POST /debts/reminders. Lecture sur caisses, comptes, mouvements, dépenses, factures, achats, règlements ; masquage selon receivable.view / debt.view.
- migrations/078_relances_paiement.sql : table payment_reminders (journal des relances).
- public/ext-treasury.js + .css : pages « Trésorerie » (5 onglets, 8 indicateurs, cartes de comptes, boutons Dépense/frais, Autre recette, Transfert de fonds, Nouveau compte, Rapport)
  et « Créances & dettes » (6 onglets, 4 indicateurs par onglet, Encaisser, Relancer WhatsApp/e-mail/appel, État récapitulatif). Entrées de menu ajoutées dans Finance & rapports.
- Cache PWA smp-static-v78.
