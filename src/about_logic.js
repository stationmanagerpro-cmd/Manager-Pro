'use strict';
// Logique pure de la page « A propos de Manager PRO » (sans base de données) : modèle par défaut + validation.
// Le contenu est du TEXTE BRUT : jamais de HTML libre (l'interface l'échappe à l'affichage), donc aucune injection de script.
const crypto = require('crypto');

const LIMITS = { sections: 12, title: 80, tagline: 160, intro: 1200, body: 4000, icon: 8, contact: 160, phone: 40 };
const ID_RE = /^[a-z0-9]{4,16}$/;

class AboutError extends Error { constructor(message) { super(message); this.status = 400; } }

function defaultDoc() {
  return {
    v: 1,
    header: {
      title: 'A propos de Manager PRO',
      tagline: 'Gestion intelligente de votre station-service',
      intro: 'Manager PRO réunit dans un même outil les ventes, les quarts de service, les stocks, la caisse, le personnel et la comptabilité de votre station.'
    },
    sections: [
      { id: 'vision01', icon: '🔭', title: 'Notre vision', visible: true, body: 'Devenir la référence de la gestion intelligente des stations-service en Afrique de l’Ouest, avec des outils simples, fiables et accessibles à tous les exploitants.' },
      { id: 'mission1', icon: '🎯', title: 'Notre mission', visible: true, body: 'Aider chaque exploitant à piloter sa station avec précision : suivre les ventes et les stocks, sécuriser la caisse et réduire les pertes.' },
      { id: 'objectf1', icon: '🏁', title: 'Nos objectifs', visible: true, body: '- Fiabiliser la clôture de chaque quart de service\n- Donner une vision claire des stocks et de la trésorerie\n- Simplifier la gestion du personnel et de la paie\n- Accompagner la conformité fiscale et comptable' },
      { id: 'valeurs1', icon: '💎', title: 'Nos valeurs', visible: true, body: '- Transparence\n- Fiabilité\n- Simplicité\n- Proximité avec nos clients' },
      { id: 'solution', icon: '🧩', title: 'Nos solutions', visible: true, body: '- Station Manager Pro\n- School Manager Pro\n- Ika Sô Manager Pro\n- Pharma Manager Pro' }
    ],
    contact: { email: '', phone: '', website: '', address: '' }
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

function sanitize(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new AboutError('Contenu invalide');
  const h = doc.header && typeof doc.header === 'object' ? doc.header : {};
  const header = {
    title: text(h.title, LIMITS.title, 'Titre', { required: true }),
    tagline: text(h.tagline, LIMITS.tagline, 'Slogan'),
    intro: text(h.intro, LIMITS.intro, 'Introduction', { multiline: true })
  };
  const rawSections = doc.sections === undefined ? [] : doc.sections;
  if (!Array.isArray(rawSections)) throw new AboutError('Rubriques invalides');
  if (rawSections.length > LIMITS.sections) throw new AboutError('Maximum ' + LIMITS.sections + ' rubriques');
  const seen = new Set();
  const sections = rawSections.map((s, i) => {
    if (!s || typeof s !== 'object') throw new AboutError('Rubrique ' + (i + 1) + ' invalide');
    let id = typeof s.id === 'string' && ID_RE.test(s.id) && !seen.has(s.id) ? s.id : null;
    while (!id || seen.has(id)) id = 's' + crypto.randomBytes(5).toString('hex');
    seen.add(id);
    return {
      id,
      icon: text(s.icon, LIMITS.icon, 'Icône de la rubrique ' + (i + 1)),
      title: text(s.title, LIMITS.title, 'Titre de la rubrique ' + (i + 1), { required: true }),
      visible: s.visible !== false,
      body: text(s.body, LIMITS.body, 'Texte de la rubrique « ' + String(s.title || i + 1).slice(0, 40) + ' »', { multiline: true })
    };
  });
  const c = doc.contact && typeof doc.contact === 'object' ? doc.contact : {};
  const contact = {
    email: text(c.email, LIMITS.contact, 'E-mail'),
    phone: text(c.phone, LIMITS.phone, 'Téléphone'),
    website: text(c.website, LIMITS.contact, 'Site web'),
    address: text(c.address, LIMITS.contact, 'Adresse')
  };
  if (contact.email && !/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(contact.email)) throw new AboutError('E-mail invalide');
  if (contact.phone && !/^[0-9+()\-. ]+$/.test(contact.phone)) throw new AboutError('Téléphone invalide (chiffres, espaces, + ( ) - . uniquement)');
  if (contact.website && !/^https?:\/\/[^\s<>"']+$/i.test(contact.website)) throw new AboutError('Site web invalide : l’adresse doit commencer par http:// ou https://');
  return { v: 1, header, sections, contact };
}

// Version enregistrée -> document valide, sinon modèle d'origine (un contenu corrompu ne casse jamais la page).
function readable(stored) {
  if (!stored || typeof stored !== 'object') return null;
  try { return sanitize(stored.content); } catch (_) { return null; }
}

module.exports = { LIMITS, ID_RE, AboutError, defaultDoc, sanitize, readable };
