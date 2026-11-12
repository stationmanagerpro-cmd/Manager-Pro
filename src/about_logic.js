'use strict';
// Logique pure de la page « A propos de Manager PRO » (sans base de données) : modèle par défaut + validation.
// Le contenu est du TEXTE BRUT : jamais de HTML libre (l'interface l'échappe à l'affichage), donc aucune injection de script.
// Modèle v2 : en-tête, rubriques libres, solutions logicielles (Objectif / Solutions / Avantages), « à venir », approche,
// « pourquoi choisir », téléchargement des applications mobiles, coordonnées, signature.
// Compatibilité : un contenu enregistré en v1 (en-tête, rubriques, coordonnées) reste valide ; les blocs absents reprennent le modèle d'origine.
const crypto = require('crypto');

const LIMITS = {
  sections: 12, title: 80, tagline: 160, intro: 1200, body: 4000, icon: 8, contact: 160, phone: 40,
  solutions: 20, name: 60, subtitle: 120, objective: 600, items: 14, item: 180,
  commitments: 6, why: 12, url: 500, short: 200
};
const ID_RE = /^[a-z0-9]{4,16}$/;
const STATUSES = ['', 'disponible', 'bientot', 'developpement'];

class AboutError extends Error { constructor(message) { super(message); this.status = 400; } }

const sol = (id, icon, name, subtitle, objective, features, benefits, status = '') => ({ id, icon, name, subtitle, status, visible: true, objective, features, benefits });

function defaultDoc() {
  return {
    v: 2,
    header: {
      title: 'A propos de Manager PRO',
      tagline: 'Des solutions intelligentes pour chaque métier.',
      intro: 'MANAGER PRO est un écosystème de solutions numériques professionnelles conçu pour accompagner les entreprises, les entrepreneurs, les commerçants et les organisations dans la gestion quotidienne de leurs activités.'
    },
    sections: [
      { id: 'qui0001', icon: '🏢', title: 'Qui sommes-nous ?', visible: true, body: 'MANAGER PRO développe des logiciels de gestion spécialisés. Chaque solution est conçue pour répondre aux réalités, aux exigences et aux problèmes spécifiques d’un secteur d’activité.' },
      { id: 'vision1', icon: '🔭', title: 'Notre vision', visible: true, body: 'Notre ambition est de simplifier la gestion, renforcer le contrôle, améliorer la productivité, sécuriser les opérations et faciliter la prise de décision.' },
      { id: 'metier1', icon: '🎯', title: 'Un métier, une solution adaptée', visible: true, body: 'Nous ne proposons pas un logiciel généraliste qui tente de répondre à tous les besoins. Nous développons des solutions spécialisées, organisées autour des règles métier propres à chaque domaine.' }
    ],
    solutions_title: 'NOS SOLUTIONS LOGICIELLES',
    solutions: [
      sol('station', '⛽', 'STATION MANAGER PRO', 'Gestion professionnelle des stations-service',
        'Permettre aux propriétaires et gestionnaires de stations-service de maîtriser leurs opérations, leurs ventes, leurs stocks de carburant et leurs finances.',
        ['Gestion des ventes de carburant et des produits.', 'Suivi des pompes, pistes et jaugeages.', 'Gestion des quarts et des équipes.', 'Gestion des stocks et des approvisionnements.', 'Gestion des caisses, recettes et dépenses.', 'Gestion des fournisseurs et des clients.', 'Comptabilité, rapports et tableaux de bord.', 'Suivi des performances et contrôle des opérations.'],
        ['Meilleur contrôle des ventes et des recettes.', 'Réduction des erreurs et des pertes.', 'Suivi précis des stocks de carburant.', 'Transparence dans la gestion des équipes.', 'Vision claire de la rentabilité de la station.', 'Décisions plus rapides grâce aux rapports.'], 'disponible'),
      sol('school', '🎓', 'SCHOOL MANAGER PRO', 'Gestion complète des établissements scolaires',
        'Moderniser l’administration des établissements scolaires et faciliter la gestion des élèves, du personnel, des finances et des activités pédagogiques.',
        ['Gestion des élèves et des inscriptions.', 'Gestion des classes, niveaux et matières.', 'Gestion des enseignants et du personnel.', 'Suivi des notes, moyennes et bulletins.', 'Gestion des frais de scolarité et des paiements.', 'Gestion des emplois du temps.', 'Espaces dédiés aux parents et aux élèves.', 'Gestion des stocks et fournitures.', 'Rapports administratifs et financiers.', 'Possibilités de gestion multiétablissements et d’enseignement en ligne.'],
        ['Centralisation des informations scolaires.', 'Réduction des tâches administratives.', 'Meilleur suivi des résultats des élèves.', 'Transparence financière.', 'Communication facilitée avec les parents.', 'Amélioration de l’organisation de l’établissement.']),
      sol('ikaso', '🏠', 'IKA SÔ MANAGER PRO', 'Gestion et développement des activités immobilières',
        'Faciliter la gestion immobilière et mettre en relation les propriétaires, agences, investisseurs, acheteurs et locataires.',
        ['Publication des annonces immobilières.', 'Vente et location de maisons, terrains et locaux.', 'Gestion des biens immobiliers.', 'Recherche avancée et filtres.', 'Profils des agences et particuliers.', 'Favoris, abonnements et coups de cœur.', 'Messagerie et demandes de contact.', 'Vérification des agences et des annonces.', 'Espace d’administration et statistiques.'],
        ['Plus de visibilité pour les biens immobiliers.', 'Mise en relation facilitée entre les acteurs.', 'Recherche immobilière simplifiée.', 'Meilleure organisation des annonces.', 'Renforcement de la confiance entre utilisateurs.', 'Opportunités commerciales élargies.']),
      sol('pharma', '💊', 'PHARMA MANAGER PRO', 'Gestion professionnelle des pharmacies',
        'Permettre aux pharmacies de contrôler efficacement leurs produits, leurs ventes, leurs achats et leurs opérations financières.',
        ['Gestion des médicaments et produits.', 'Suivi des lots et dates de péremption.', 'Gestion des stocks et approvisionnements.', 'Gestion des ventes et facturations.', 'Gestion des fournisseurs et clients.', 'Gestion des achats et retours.', 'Suivi des caisses et finances.', 'Alertes de rupture et de péremption.', 'Rapports et statistiques.'],
        ['Meilleure maîtrise des stocks.', 'Réduction des pertes liées aux péremptions.', 'Suivi rigoureux des ventes et achats.', 'Disponibilité plus fiable des produits.', 'Amélioration du contrôle financier.']),
      sol('facture', '🧾', 'FACTURE MANAGER PRO', 'Gestion intelligente de la facturation',
        'Simplifier l’établissement, le suivi et le contrôle des factures pour les entreprises, prestataires et entrepreneurs.',
        ['Création de devis et factures.', 'Gestion des clients.', 'Suivi des paiements et impayés.', 'Gestion des factures récurrentes si nécessaire.', 'Numérotation et archivage des documents.', 'Génération PDF et partage des factures.', 'Rapports de facturation et de recouvrement.'],
        ['Gain de temps dans la facturation.', 'Réduction des erreurs de saisie.', 'Meilleur suivi des créances.', 'Documents professionnels.', 'Visibilité sur les recettes et paiements.']),
      sol('pressing', '👔', 'PRESSING MANAGER PRO', 'Gestion des pressings et blanchisseries',
        'Organiser et contrôler toutes les opérations d’un pressing, depuis la réception des vêtements jusqu’à leur restitution.',
        ['Enregistrement des clients et commandes.', 'Identification et suivi des vêtements.', 'Gestion des prestations et tarifs.', 'Suivi des commandes en cours.', 'Gestion des retraits et livraisons.', 'Gestion des paiements.', 'Gestion des employés.', 'Historique des commandes et rapports.'],
        ['Réduction des pertes et confusions.', 'Meilleur suivi des vêtements.', 'Organisation des commandes.', 'Amélioration du service client.', 'Contrôle des recettes.']),
      sol('gestock', '📦', 'GESTOCK MANAGER PRO', 'Gestion intelligente des stocks et entrepôts',
        'Permettre aux entreprises de maîtriser leurs marchandises, leurs entrées, leurs sorties et leurs mouvements de stocks.',
        ['Gestion des articles et catégories.', 'Entrées et sorties de marchandises.', 'Gestion des fournisseurs.', 'Gestion des magasins et entrepôts.', 'Transferts entre dépôts.', 'Inventaires et ajustements contrôlés.', 'Alertes de stock minimum.', 'Valorisation et suivi des stocks.', 'Rapports et historiques des mouvements.'],
        ['Réduction des ruptures et pertes.', 'Meilleure visibilité sur les marchandises.', 'Traçabilité des mouvements.', 'Fiabilité des inventaires.', 'Optimisation des approvisionnements.']),
      sol('commerce', '🛒', 'COMMERCE MANAGER PRO', 'Gestion complète des commerces et points de vente',
        'Accompagner les commerçants dans la gestion quotidienne de leurs boutiques, magasins et activités commerciales.',
        ['Gestion des produits et catégories.', 'Ventes et encaissements.', 'Gestion des achats et fournisseurs.', 'Gestion des clients.', 'Suivi des stocks.', 'Gestion des caisses.', 'Gestion des employés.', 'Facturation et rapports.', 'Suivi des bénéfices et dépenses.'],
        ['Meilleure organisation du commerce.', 'Contrôle des ventes et des dépenses.', 'Réduction des erreurs.', 'Suivi des performances commerciales.', 'Amélioration de la rentabilité.']),
      sol('couture', '🧵', 'COUTURE MANAGER PRO', 'Gestion professionnelle des ateliers de couture',
        'Faciliter l’organisation des ateliers de couture et le suivi des commandes, clients, mesures et livraisons.',
        ['Gestion des clients et de leurs mesures.', 'Enregistrement des commandes.', 'Gestion des modèles et prestations.', 'Suivi de la confection.', 'Gestion des délais et livraisons.', 'Gestion des couturiers et employés.', 'Gestion des paiements et acomptes.', 'Historique des commandes.', 'Rapports d’activité.'],
        ['Meilleur suivi des commandes.', 'Réduction des retards et oublis.', 'Conservation des mesures clients.', 'Organisation du travail des couturiers.', 'Amélioration de la satisfaction client.']),
      sol('ecommerce', '🌐', 'E-COMMERCE MANAGER PRO', 'Gestion des activités de vente en ligne',
        'Permettre aux entrepreneurs et entreprises de développer leur commerce sur Internet et de centraliser leurs opérations commerciales.',
        ['Création et gestion d’une boutique en ligne.', 'Publication des produits avec images et descriptions.', 'Gestion des commandes.', 'Gestion des clients.', 'Gestion des stocks.', 'Paiements et suivi des transactions.', 'Gestion des livraisons.', 'Promotions et réductions.', 'Statistiques de vente.'],
        ['Développement de la présence commerciale en ligne.', 'Possibilité de vendre à distance.', 'Centralisation des commandes.', 'Meilleur suivi des clients.', 'Extension des opportunités de vente.'])
    ],
    upcoming: {
      visible: true,
      title: 'ET BIEN D’AUTRES SOLUTIONS À VENIR...',
      text: 'Notre ambition ne s’arrête pas là. MANAGER PRO poursuit le développement de solutions spécialisées pour accompagner les entreprises de différents secteurs d’activité.\nDe nouveaux logiciels viendront progressivement enrichir notre écosystème afin de répondre à des besoins professionnels toujours plus variés.'
    },
    approach: {
      title: 'UNE SOLUTION ADAPTÉE À CHAQUE MÉTIER',
      text: 'Chez MANAGER PRO, nous sommes convaincus qu’une bonne gestion commence par une bonne compréhension du métier.\nC’est pourquoi chaque logiciel est conçu autour des réalités du secteur auquel il s’adresse. Les fonctionnalités, les processus et les outils de contrôle sont adaptés aux besoins spécifiques de chaque activité.\nNotre objectif est de mettre la technologie au service des professionnels, sans complexifier inutilement leur travail.',
      commitments: [
        { title: 'Spécialisation métier', text: 'Des outils pensés pour les réalités de chaque secteur.' },
        { title: 'Simplicité d’utilisation', text: 'Des interfaces modernes et accessibles.' },
        { title: 'Maîtrise et contrôle', text: 'Des informations fiables pour mieux gérer.' },
        { title: 'Évolution continue', text: 'Des solutions améliorées selon les besoins des utilisateurs.' }
      ]
    },
    why: {
      title: 'POURQUOI CHOISIR MANAGER PRO ?',
      items: [
        'Des logiciels adaptés à chaque activité.', 'Une gestion centralisée et organisée.', 'Des tableaux de bord et rapports professionnels.',
        'Une meilleure maîtrise des opérations.', 'Des outils accessibles sur différents appareils selon les solutions.',
        'Une architecture conçue pour évoluer avec les entreprises.', 'Un accompagnement dans la modernisation des activités.'
      ]
    },
    // Liens de téléchargement : AUCUN lien par défaut (jamais de faux lien). Vide = « Bientôt disponible » ; le Super Admin renseigne les vrais liens.
    downloads: {
      title: 'MANAGER PRO VOUS ACCOMPAGNE PARTOUT',
      subtitle: 'Retrouvez nos solutions sur vos appareils mobiles et profitez d’une expérience de gestion adaptée à votre environnement de travail.',
      android_url: '/telechargements/Ika-So.apk', ios_url: ''
    },
    contact: { email: '', phone: '', website: '', address: '' },
    signature: { name: 'MANAGER PRO', tagline: 'Des solutions intelligentes pour chaque métier.', slogan: '« Votre gestion, notre priorité ! »' }
  };
}

// Texte brut : retire les caractères de contrôle (sauf retour à la ligne), normalise les fins de ligne, coupe les espaces de bord.
function text(v, max, label, { multiline = false, required = false } = {}) {
  if (v === undefined || v === null) v = '';
  if (typeof v !== 'string') throw new AboutError(label + ' : texte attendu');
  let s = v.replace(/\r\n?/g, '\n').replace(multiline ? /[\u0000-\u0009\u000B-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g, '');
  s = s.trim();
  if (s.length > max) throw new AboutError(label + ' : ' + max + ' caractères maximum');
  if (required && !s) throw new AboutError(label + ' : obligatoire');
  return s;
}
// Liste de lignes : tableau de textes (lignes vides ignorées).
function lines(v, maxItems, maxLen, label) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new AboutError(label + ' : liste attendue');
  const out = v.map(x => text(x, maxLen, label)).filter(Boolean);
  if (out.length > maxItems) throw new AboutError(label + ' : ' + maxItems + ' lignes maximum');
  return out;
}
// Lien de téléchargement : vide (= « Bientôt disponible ») ou adresse https:// ou fichier interne /telechargements/… (jamais javascript:, data:, http:).
const SAME_SITE_RE = /^\/telechargements\/[A-Za-z0-9._-]+$/;
function httpsUrl(v, label) {
  const s = text(v, LIMITS.url, label);
  if (!s) return '';
  if (SAME_SITE_RE.test(s)) return s;   // fichier hébergé par l’application elle-même (public/telechargements/)
  let u; try { u = new URL(s); } catch (_) { throw new AboutError(label + ' : adresse invalide (https:// ou /telechargements/…)'); }
  if (u.protocol !== 'https:' || /\s/.test(s)) throw new AboutError(label + ' : l’adresse doit commencer par https://');
  return s;
}
const uid = seen => { let id; do { id = 's' + crypto.randomBytes(5).toString('hex'); } while (seen.has(id)); return id; };
const idOf = (raw, seen) => { const id = typeof raw === 'string' && ID_RE.test(raw) && !seen.has(raw) ? raw : uid(seen); seen.add(id); return id; };
const obj = (v, label) => { if (v !== undefined && (v === null || typeof v !== 'object' || Array.isArray(v))) throw new AboutError(label + ' : bloc invalide'); return v || {}; };

function sanitize(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new AboutError('Contenu invalide');
  const D = defaultDoc();
  const h = obj(doc.header, 'En-tête');
  const header = {
    title: text(h.title, LIMITS.title, 'Titre', { required: true }),
    tagline: text(h.tagline, LIMITS.tagline, 'Slogan'),
    intro: text(h.intro, LIMITS.intro, 'Introduction', { multiline: true })
  };

  // Rubriques libres
  const rawSections = doc.sections === undefined ? D.sections : doc.sections;
  if (!Array.isArray(rawSections)) throw new AboutError('Rubriques invalides');
  if (rawSections.length > LIMITS.sections) throw new AboutError('Maximum ' + LIMITS.sections + ' rubriques');
  const seenS = new Set();
  const sections = rawSections.map((s, i) => {
    if (!s || typeof s !== 'object') throw new AboutError('Rubrique ' + (i + 1) + ' invalide');
    return {
      id: idOf(s.id, seenS),
      icon: text(s.icon, LIMITS.icon, 'Icône de la rubrique ' + (i + 1)),
      title: text(s.title, LIMITS.title, 'Titre de la rubrique ' + (i + 1), { required: true }),
      visible: s.visible !== false,
      body: text(s.body, LIMITS.body, 'Texte de la rubrique « ' + String(s.title || i + 1).slice(0, 40) + ' »', { multiline: true })
    };
  });

  // Solutions logicielles (Objectif / Solutions / Avantages)
  const rawSol = doc.solutions === undefined ? D.solutions : doc.solutions;
  if (!Array.isArray(rawSol)) throw new AboutError('Solutions invalides');
  if (rawSol.length > LIMITS.solutions) throw new AboutError('Maximum ' + LIMITS.solutions + ' solutions');
  const seenL = new Set();
  const solutions = rawSol.map((s, i) => {
    if (!s || typeof s !== 'object') throw new AboutError('Solution ' + (i + 1) + ' invalide');
    const name = text(s.name, LIMITS.name, 'Nom de la solution ' + (i + 1), { required: true });
    const status = typeof s.status === 'string' ? s.status : '';
    if (!STATUSES.includes(status)) throw new AboutError('Statut invalide pour « ' + name + ' »');
    return {
      id: idOf(s.id, seenL),
      icon: text(s.icon, LIMITS.icon, 'Icône de « ' + name + ' »'),
      name,
      subtitle: text(s.subtitle, LIMITS.subtitle, 'Sous-titre de « ' + name + ' »'),
      status,
      visible: s.visible !== false,
      objective: text(s.objective, LIMITS.objective, 'Objectif de « ' + name + ' »', { multiline: true }),
      features: lines(s.features, LIMITS.items, LIMITS.item, 'Solutions de « ' + name + ' »'),
      benefits: lines(s.benefits, LIMITS.items, LIMITS.item, 'Avantages de « ' + name + ' »')
    };
  });
  const solutions_title = doc.solutions_title === undefined ? D.solutions_title : text(doc.solutions_title, LIMITS.title, 'Titre des solutions');

  // « À venir » : jamais présenté comme disponible (simple texte, sans statut de téléchargement)
  const up = doc.upcoming === undefined ? D.upcoming : obj(doc.upcoming, 'Solutions à venir');
  const upcoming = { visible: up.visible !== false, title: text(up.title, LIMITS.title, 'Titre « à venir »'), text: text(up.text, LIMITS.body, 'Texte « à venir »', { multiline: true }) };

  // Notre approche
  const ap = doc.approach === undefined ? D.approach : obj(doc.approach, 'Approche');
  const rawCom = ap.commitments === undefined ? [] : ap.commitments;
  if (!Array.isArray(rawCom)) throw new AboutError('Engagements invalides');
  if (rawCom.length > LIMITS.commitments) throw new AboutError('Maximum ' + LIMITS.commitments + ' engagements');
  const approach = {
    title: text(ap.title, LIMITS.title, 'Titre de l’approche'),
    text: text(ap.text, LIMITS.body, 'Texte de l’approche', { multiline: true }),
    commitments: rawCom.map((c, i) => {
      if (!c || typeof c !== 'object') throw new AboutError('Engagement ' + (i + 1) + ' invalide');
      return { title: text(c.title, LIMITS.name, 'Titre de l’engagement ' + (i + 1), { required: true }), text: text(c.text, LIMITS.short, 'Texte de l’engagement ' + (i + 1)) };
    })
  };

  // Pourquoi choisir
  const wy = doc.why === undefined ? D.why : obj(doc.why, 'Pourquoi choisir');
  const why = { title: text(wy.title, LIMITS.title, 'Titre « pourquoi choisir »'), items: lines(wy.items, LIMITS.why, LIMITS.item, 'Arguments') };

  // Téléchargement des applications mobiles
  const dl = doc.downloads === undefined ? D.downloads : obj(doc.downloads, 'Téléchargement');
  const downloads = {
    title: text(dl.title, LIMITS.title, 'Titre du téléchargement'),
    subtitle: text(dl.subtitle, LIMITS.body, 'Sous-titre du téléchargement', { multiline: true }),
    android_url: httpsUrl(dl.android_url, 'Lien Android'),
    ios_url: httpsUrl(dl.ios_url, 'Lien App Store')
  };

  const c = obj(doc.contact, 'Coordonnées');
  const contact = {
    email: text(c.email, LIMITS.contact, 'E-mail'),
    phone: text(c.phone, LIMITS.phone, 'Téléphone'),
    website: text(c.website, LIMITS.contact, 'Site web'),
    address: text(c.address, LIMITS.contact, 'Adresse')
  };
  if (contact.email && !/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(contact.email)) throw new AboutError('E-mail invalide');
  if (contact.phone && !/^[0-9+()\-. ]+$/.test(contact.phone)) throw new AboutError('Téléphone invalide (chiffres, espaces, + ( ) - . uniquement)');
  if (contact.website && !/^https?:\/\/[^\s<>"']+$/i.test(contact.website)) throw new AboutError('Site web invalide : l’adresse doit commencer par http:// ou https://');

  const sg = doc.signature === undefined ? D.signature : obj(doc.signature, 'Signature');
  const signature = { name: text(sg.name, LIMITS.name, 'Signature'), tagline: text(sg.tagline, LIMITS.tagline, 'Phrase de signature'), slogan: text(sg.slogan, LIMITS.tagline, 'Slogan de signature') };

  return { v: 2, header, sections, solutions_title, solutions, upcoming, approach, why, downloads, contact, signature };
}

// Version enregistrée -> document valide, sinon modèle d'origine (un contenu corrompu ne casse jamais la page).
function readable(stored) {
  if (!stored || typeof stored !== 'object') return null;
  try { return sanitize(stored.content); } catch (_) { return null; }
}

module.exports = { LIMITS, ID_RE, STATUSES, AboutError, defaultDoc, sanitize, readable };
