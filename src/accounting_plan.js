'use strict';
/** Plan comptable OHADA (SYSCOHADA révisé) — comptes usuels d'une station-service / commerce de marchandises.
 *  Source unique : la migration 079 en est la copie SQL (vérifiée par test/accounting-unit.js).
 *  Chaque client peut ajouter ses propres comptes (table acc_accounts, station_id renseigné). */
const PLAN = [
  // Classe 1 — Ressources durables
  ['10', 'Capital'], ['101', 'Capital social'], ['104', 'Primes liées au capital social'], ['109', 'Actionnaires, capital souscrit non appelé'],
  ['11', 'Réserves'], ['111', 'Réserve légale'], ['118', 'Autres réserves'],
  ['12', 'Report à nouveau'], ['121', 'Report à nouveau créditeur'], ['129', 'Report à nouveau débiteur'],
  ['13', 'Résultat net de l’exercice'], ['131', 'Résultat net : bénéfice'], ['139', 'Résultat net : perte'],
  ['14', 'Subventions d’investissement'],
  ['16', 'Emprunts et dettes assimilées'], ['162', 'Emprunts et dettes auprès des établissements de crédit'], ['168', 'Autres emprunts et dettes'],
  // Classe 2 — Actif immobilisé
  ['21', 'Immobilisations incorporelles'], ['212', 'Brevets, licences, logiciels'],
  ['22', 'Terrains'], ['221', 'Terrains agricoles et forestiers'], ['222', 'Terrains nus'], ['223', 'Terrains bâtis'],
  ['23', 'Bâtiments, installations techniques et agencements'], ['231', 'Bâtiments industriels, agricoles et commerciaux'], ['237', 'Bâtiments : installations techniques'], ['238', 'Aménagements et agencements'],
  ['24', 'Matériel, mobilier et actifs biologiques'], ['241', 'Matériel et outillage industriel et commercial'], ['2411', 'Pompes, cuves et équipements de distribution'],
  ['244', 'Matériel et mobilier de bureau'], ['245', 'Matériel de transport'], ['246', 'Matériel informatique'], ['248', 'Autres matériels'],
  ['27', 'Autres immobilisations financières'], ['271', 'Prêts et créances non commerciales (hors exploitation)'], ['275', 'Dépôts et cautionnements versés'],
  ['28', 'Amortissements'], ['281', 'Amortissements des immobilisations incorporelles'], ['283', 'Amortissements des bâtiments et agencements'],
  ['2841', 'Amortissements du matériel et outillage'], ['2844', 'Amortissements du matériel et mobilier de bureau'], ['2845', 'Amortissements du matériel de transport'], ['2846', 'Amortissements du matériel informatique'], ['2848', 'Amortissements des autres matériels'],
  // Classe 3 — Stocks
  ['31', 'Marchandises'], ['311', 'Marchandises (carburants, lubrifiants, boutique)'],
  ['39', 'Dépréciations des stocks'],
  // Classe 4 — Tiers
  ['40', 'Fournisseurs et comptes rattachés'], ['401', 'Fournisseurs'], ['408', 'Fournisseurs, factures non parvenues'], ['409', 'Fournisseurs débiteurs'],
  ['41', 'Clients et comptes rattachés'], ['411', 'Clients'], ['419', 'Clients créditeurs (avances reçues)'],
  ['42', 'Personnel'], ['422', 'Personnel, rémunérations dues'], ['425', 'Personnel, avances et acomptes'], ['4251', 'Avances et acomptes au personnel'], ['4252', 'Prêts et dettes à recouvrer sur le personnel'], ['428', 'Personnel, charges à payer'],
  ['43', 'Organismes sociaux'], ['431', 'Sécurité sociale et organismes sociaux (INPS, AMO)'],
  ['44', 'État et collectivités publiques'], ['441', 'État, impôt sur les bénéfices'], ['4431', 'TVA facturée (collectée)'], ['4441', 'État, TVA due'], ['4452', 'TVA récupérable sur achats'], ['447', 'État, impôts retenus à la source (ITS)'],
  ['47', 'Débiteurs et créditeurs divers'], ['471', 'Compte d’attente à régulariser'],
  ['48', 'Créances et dettes HAO'], ['481', 'Fournisseurs d’investissements'], ['485', 'Créances sur cessions d’immobilisations'],
  // Classe 5 — Trésorerie
  ['52', 'Banques'], ['521', 'Banques locales'],
  ['55', 'Instruments de monnaie électronique'], ['551', 'Portefeuilles électroniques (Mobile Money)'],
  ['57', 'Caisse'], ['571', 'Caisse'],
  ['58', 'Régies d’avances et virements internes'], ['585', 'Virements de fonds'],
  // Classe 6 — Charges
  ['60', 'Achats et variations de stocks'], ['601', 'Achats de marchandises'], ['6031', 'Variations des stocks de marchandises'], ['604', 'Achats de fournitures consommables'], ['609', 'Rabais, remises et ristournes obtenus'], ['605', 'Autres achats (eau, électricité, énergie)'],
  ['61', 'Transports'], ['616', 'Transports du personnel'], ['618', 'Autres frais de transport'],
  ['62', 'Services extérieurs A'], ['622', 'Locations et charges locatives'], ['624', 'Entretien, réparations et maintenance'], ['625', 'Primes d’assurance'],
  ['63', 'Services extérieurs B'], ['627', 'Publicité, publications'], ['628', 'Frais de télécommunications'], ['631', 'Frais bancaires'], ['632', 'Rémunérations d’intermédiaires et honoraires'], ['638', 'Autres charges externes'],
  ['64', 'Impôts et taxes'], ['641', 'Impôts et taxes directs (patente, CFE)'], ['646', 'Droits d’enregistrement'], ['647', 'Pénalités et amendes fiscales'], ['648', 'Autres impôts et taxes'],
  ['65', 'Autres charges'], ['658', 'Charges diverses (dont écarts de caisse)'],
  ['66', 'Charges de personnel'], ['661', 'Rémunérations directes versées au personnel'], ['664', 'Charges sociales'],
  ['67', 'Frais financiers et charges assimilées'], ['671', 'Intérêts des emprunts'],
  ['68', 'Dotations aux amortissements'], ['681', 'Dotations aux amortissements d’exploitation'],
  ['675', 'Valeurs comptables des cessions d’immobilisations'],
  ['69', 'Dotations aux provisions'],
  // Classe 7 — Produits
  ['70', 'Ventes'], ['701', 'Ventes de marchandises'], ['7011', 'Ventes de carburants'], ['7012', 'Ventes de lubrifiants et huiles'], ['7013', 'Ventes boutique, accessoires et autres'],
  ['706', 'Services vendus'], ['707', 'Produits accessoires'], ['709', 'Rabais, remises et ristournes accordés (avoirs clients)'],
  ['75', 'Autres produits'], ['758', 'Produits divers (dont écarts de caisse)'],
  ['77', 'Revenus financiers'], ['771', 'Intérêts de prêts'],
  ['775', 'Produits des cessions d’immobilisations'],
  ['79', 'Reprises de provisions'],
  // Classe 8 — Autres charges et produits (HAO)
  ['81', 'Valeurs comptables des cessions (HAO)'], ['82', 'Produits des cessions (HAO)'], ['83', 'Charges HAO'], ['84', 'Produits HAO'],
  ['89', 'Impôts sur le résultat'], ['891', 'Impôts sur les bénéfices']
];

const LABELS = Object.fromEntries(PLAN);
const CLASSES = {
  1: 'Ressources durables', 2: 'Actif immobilisé', 3: 'Stocks', 4: 'Tiers', 5: 'Trésorerie',
  6: 'Charges des activités ordinaires', 7: 'Produits des activités ordinaires', 8: 'Autres charges et produits (HAO)'
};
module.exports = { PLAN, LABELS, CLASSES };
