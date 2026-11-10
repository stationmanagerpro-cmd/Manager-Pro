// Erreurs « avalées » rendues visibles (audit B5).
// Usage : promesse.catch(swallow('module:requête', valeurDeRepli))
// Le comportement ne change pas (la valeur de repli est renvoyée comme avant) ; l'erreur est en plus
// journalisée dans la console, au plus une fois toutes les 10 minutes par étiquette, pour ne pas inonder les logs.
const lastLogged = new Map();
const EVERY_MS = 10 * 60 * 1000;

function swallow(label, fallback) {
  return err => {
    const now = Date.now();
    if (now - (lastLogged.get(label) || 0) >= EVERY_MS) {
      lastLogged.set(label, now);
      console.warn(`[safe] ${label} ignorée :`, err && err.message ? err.message : err);
    }
    return fallback;
  };
}

/** Pour les blocs try/catch : journalise une erreur ignorée (même limitation que swallow). */
function ignored(label, err) { swallow(label)(err); }

module.exports = { swallow, ignored };
