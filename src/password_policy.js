// Politique de mots de passe (audit D5). S'applique aux NOUVEAUX mots de passe (création de compte, changement) ;
// les mots de passe existants ne sont pas invalidés.
//  - 8 caractères minimum pour les comptes ordinaires ;
//  - 12 caractères minimum par défaut pour les comptes à privilèges (ADMIN, SUPERADMIN, compte de plateforme, RG-04) ;
//    PASSWORD_MIN_PRIVILEGED permet de relever ce minimum (jamais en dessous de 12) ;
//  - refus des mots de passe très courants, d'un seul caractère répété, ou égaux à l'identifiant.
const PRIVILEGED_ROLES = new Set(['ADMIN', 'SUPERADMIN']);
const MIN_ORDINARY = 8;
const MIN_PRIVILEGED = 12;

const COMMON = new Set([
  '12345678', '123456789', '1234567890', '123456789012', '0123456789', '11111111', '00000000', '87654321', 'azertyuiop', 'azerty123',
  'azertyazerty', 'qwertyuiop', 'qwerty123', 'qwertyqwerty', 'password', 'password1', 'password12', 'password123', 'passw0rd', 'passw0rd123',
  'motdepasse', 'motdepasse1', 'motdepasse123', 'admin123', 'admin1234', 'administrator', 'adminadmin', 'adminadmin123', 'changeme', 'changeme123',
  'welcome1', 'welcome123', 'bienvenue', 'bienvenue1', 'bienvenue123', 'iloveyou', 'letmein123', 'abc123456', 'abcd1234', 'abcdefgh1234',
  'station123', 'stationmanager', 'managerpro', 'managerpro123', 'mali2020', 'mali2024', 'mali2025', 'mali2026', 'bamako123', 'bamako2026'
]);

function minLength({ role, isGlobal } = {}) {
  if (!(isGlobal || PRIVILEGED_ROLES.has(String(role || '').toUpperCase()))) return MIN_ORDINARY;
  const n = parseInt(process.env.PASSWORD_MIN_PRIVILEGED, 10);
  return Number.isFinite(n) ? Math.max(MIN_PRIVILEGED, n) : MIN_PRIVILEGED;
}

/** Renvoie un message d'erreur (français) si le mot de passe est refusé, sinon null. */
function checkPassword(password, { role, isGlobal, login } = {}) {
  const pw = String(password ?? '');
  const min = minLength({ role, isGlobal });
  if (pw.length < min) return min > MIN_ORDINARY ? `${min} caractères minimum pour ce type de compte` : `${MIN_ORDINARY} caractères minimum`;
  if (/^(.)\1+$/.test(pw)) return 'Mot de passe trop simple : un seul caractère répété';
  const low = pw.toLowerCase();
  if (COMMON.has(low)) return 'Mot de passe trop courant : choisissez-en un moins prévisible';
  if (login && low === String(login).toLowerCase()) return "Le mot de passe ne doit pas être identique à l'identifiant";
  return null;
}

module.exports = { checkPassword, minLength };
