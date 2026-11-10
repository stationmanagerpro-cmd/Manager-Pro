// Durée de session (audit D1, volet immédiat) : plus courte pour les comptes à privilèges.
//  - SESSION_HOURS            : comptes ordinaires, défaut 12 (comportement antérieur) ;
//  - SESSION_HOURS_PRIVILEGED : ADMIN, SUPERADMIN et comptes de plateforme, défaut 4.
// Valeurs acceptées : entiers de 1 à 24 ; toute autre valeur → défaut.
const PRIVILEGED_ROLES = new Set(['ADMIN', 'SUPERADMIN']);

function envHours(name, dflt) {
  const n = parseInt(process.env[name], 10);
  return Number.isInteger(n) && n >= 1 && n <= 24 ? n : dflt;
}

function sessionHours({ role, isGlobal } = {}) {
  const privileged = !!isGlobal || PRIVILEGED_ROLES.has(String(role || '').toUpperCase());
  return privileged ? envHours('SESSION_HOURS_PRIVILEGED', 4) : envHours('SESSION_HOURS', 12);
}

module.exports = { sessionHours };
