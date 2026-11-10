/* ext-archive.js — Archivage des clients, fournisseurs et employés inactifs.
   Les listes n'affichent que les actifs ; un bouton bascule vers les inactifs (consultation + réactivation). */
(function () {
  'use strict';
  const LBL = {
    customers: { view: 'cli', one: 'client', many: 'Clients', path: c => `/customers/${c}/status`, perm: 'customer.edit' },
    suppliers: { view: 'four', one: 'fournisseur', many: 'Fournisseurs', path: c => `/suppliers/${c}/status`, perm: 'supplier.edit' },
    employees: { view: 'emp', one: 'employé', many: 'Employés', path: c => `/employees/${c}/status`, perm: 'settings.edit|hr.manage' },
    products: { view: 'prod', one: 'produit', many: 'Produits', path: c => `/products/${c}/status`, perm: 'price.edit' }
  };
  window.ARCH = window.ARCH || { customers: false, suppliers: false, employees: false, products: false };
  if (window.ARCH.products === undefined) window.ARCH.products = false;

  // Paramètre de requête pour les listes
  window.archQuery = kind => kind === 'employees' ? (ARCH.employees ? '?status=inactif' : '') : (ARCH[kind] ? '?inactive=1' : '');

  // Bouton bascule « Clients inactifs » ⇄ « ← Clients actifs »
  window.archToggleBtn = kind => `<button class="b2 arch-toggle${ARCH[kind] ? ' on' : ''}" onclick="archToggle('${kind}')">${ARCH[kind] ? '← ' + LBL[kind].many + ' actifs' : '🗄 ' + LBL[kind].many + ' inactifs'}</button>`;

  // Bandeau affiché quand on consulte les inactifs
  window.archBanner = (kind, n) => ARCH[kind]
    ? `<p class="arch-banner">🗄 <b>${LBL[kind].many} inactifs (archivés)</b> — ${n} ${LBL[kind].one}(s). Ils n'apparaissent plus dans les listes ni les formulaires ; leur historique est conservé.</p>` : '';

  window.archToggle = kind => { ARCH[kind] = !ARCH[kind]; go(LBL[kind].view); };

  // Archiver / réactiver (confirmation, puis rechargement de la liste)
  window.archSet = safe(async (kind, id, active, name) => {
    const L = LBL[kind];
    let msg = active ? `Réactiver ${L.one} « ${name} » ?` : `Mettre ${L.one} « ${name} » en inactif (archivé) ?\nIl ne sera plus visible dans la liste ni proposé dans les formulaires.`;
    if (!active && kind === 'employees') msg += '\nSon compte de connexion éventuel sera désactivé et ses sessions fermées.';
    if (!active && kind === 'products') {
      const pr = (typeof PSC !== 'undefined' && Array.isArray(PSC) ? PSC : []).find(x => String(x.id) === String(id))
        || (window.__ppCur && String(window.__ppCur.id) === String(id) ? window.__ppCur : null);
      msg = `Mettre le produit « ${name} » en inactif (archivé) ?\nIl ne sera plus proposé dans les ventes, les commandes ni les mouvements de stock ; son historique (ventes, achats, prix, stocks) est conservé.`
        + (pr && Number(pr.stock) > 0 ? `\n\nAttention : il reste ${pr.stock} ${pr.unit || ''} en stock.` : '');
    }
    if (!confirm(msg)) return;
    const body = kind === 'employees' ? { status: active ? 'actif' : 'inactif' } : { active };
    await api('PATCH', L.path(id), body);
    toast(active ? 'Réactivé' : 'Archivé (inactif)', 'ok');
    go(L.view);
  });

  // Bouton d'action par ligne
  window.archRowBtn = (kind, id, active, name) => can(LBL[kind].perm)
    ? `<button class="b2" style="padding:2px 10px;font-size:12px" onclick="event.stopPropagation();archSet('${kind}',${id},${active},${jsArg(name)})">${active ? '♻ Réactiver' : '🗄 Archiver'}</button>` : '';
})();
