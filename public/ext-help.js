/* Besoin d'aide : bouton permanent dans la bannière et vue « Besoin d'aide » en cartes par module.
 * Première version : aucun contenu n'est inventé. Chaque carte indique que la procédure et la vidéo restent à renseigner.
 * La rédaction et les liens vidéo seront gérés par le Super Admin dans une étape suivante (stockage serveur). */
(function () {
  if (typeof V === 'undefined' || typeof VM === 'undefined') return;

  // Modules d'aide : mêmes clés que le menu (V). Seules les vues accessibles à l'utilisateur sont affichées.
  const HELP_MODULES = ['dash', 'quart', 'ventes', 'prod', 'pompes', 'cli', 'four', 'caisse', 'emp', 'alert', 'audit', 'param'];

  V.aide = ["Besoin d'aide", '*'];

  VM.aide = function () {
    const cards = HELP_MODULES
      .filter(k => V[k] && (typeof canView === 'function' ? canView(k) : true))
      .map(k => `
        <article class="help-card" data-module="${esc(k)}">
          <h3>${esc(V[k][0])}</h3>
          <p class="help-proc muted">Procédure : à rédiger.</p>
          <button type="button" class="b2 help-video" disabled title="Aucun lien vidéo renseigné">Voir la vidéo</button>
        </article>`).join('');
    return `<section class="help-page">
      <p class="muted">Procédures et vidéos par module. Les contenus seront ajoutés progressivement.</p>
      <div class="help-grid">${cards || '<p class="muted">Aucun module d’aide accessible avec vos droits.</p>'}</div>
    </section>`;
  };

  // Bouton permanent : déjà présent dans la bannière (index.html) ; on relie l'action à la vue.
  window.openHelp = () => (typeof go === 'function' ? go('aide') : null);
})();
