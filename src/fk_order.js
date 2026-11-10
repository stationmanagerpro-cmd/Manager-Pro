// Ordre de restauration/suppression des tables selon leurs clés étrangères (fonctions pures, testées sans base : test/fk-order-unit.js).
// Les dépendances CIRCULAIRES légitimes (A -> B -> A) sont résolues en « différant » une colonne NULLable de la boucle :
//   - à l'insertion : la colonne est écrite à NULL, puis mise à jour une fois toutes les lignes insérées ;
//   - à la suppression : la colonne est d'abord mise à NULL, puis les lignes sont supprimées.
// Une boucle sans aucune colonne NULLable reste refusée (aucune donnée modifiée), avec la liste des tables concernées.
const { HttpError } = (() => { try { return require('./core'); } catch (_) { return {}; } })();
const fail = msg => { const E = HttpError || Error; const e = new E(...(HttpError ? [409, msg] : [msg])); return e; };

/** Tri de Kahn sur les arêtes enfant -> parent (le parent doit exister avant l'enfant). Renvoie { insert } ou { left } si une boucle subsiste. */
function kahn(names, edges) {
  const parents = new Map(names.map(n => [n, new Set()])), children = new Map(names.map(n => [n, new Set()]));
  for (const e of edges) { parents.get(e.child).add(e.parent); children.get(e.parent).add(e.child); }
  const indeg = new Map(names.map(n => [n, parents.get(n).size]));
  const queue = names.filter(n => indeg.get(n) === 0), insert = [];
  while (queue.length) {
    const n = queue.shift(); insert.push(n);
    for (const c of children.get(n)) { indeg.set(c, indeg.get(c) - 1); if (indeg.get(c) === 0) queue.push(c); }
  }
  return insert.length === names.length ? { insert } : { left: names.filter(n => !insert.includes(n)), parents, children };
}

/** Isole les tables réellement dans une boucle (élague celles qui n'ont ni parent ni enfant dans le reste). */
function cycleCore(left, edges) {
  let core = new Set(left), changed = true;
  while (changed) {
    changed = false;
    for (const n of [...core]) {
      const hasParent = edges.some(e => e.child === n && core.has(e.parent)), hasChild = edges.some(e => e.parent === n && core.has(e.child));
      if (!hasParent || !hasChild) { core.delete(n); changed = true; }
    }
  }
  return core;
}

/**
 * @param names       tables concernées
 * @param fks         [{ child, child_col, parent, parent_col }]
 * @param isNullable  (table, colonne) => boolean
 * @returns { order, deferred } — order : enfants d'abord (suppression) ; insertion = order inversé ; deferred : colonnes à différer
 */
function planOrder(names, fks, isNullable) {
  const set = new Set(names);
  const all = fks.filter(f => set.has(f.child) && set.has(f.parent));
  const key = e => `${e.child}.${e.child_col}->${e.parent}`;
  const deferred = [], isDef = new Set();
  const defer = e => { if (!isDef.has(key(e))) { isDef.add(key(e)); deferred.push(e); } };
  for (const e of all) if (e.child === e.parent && isNullable(e.child, e.child_col)) defer(e);   // clés auto-référentes (ex. responsable)
  for (let guard = 0; guard < 1000; guard++) {
    const active = all.filter(e => e.child !== e.parent && !isDef.has(key(e)));
    const r = kahn(names, active);
    if (r.insert) return { order: r.insert.slice().reverse(), deferred };
    const core = cycleCore(r.left, active);
    const cand = active.find(e => core.has(e.child) && core.has(e.parent) && isNullable(e.child, e.child_col));
    if (!cand) throw fail(`Restauration refusée : dépendances cycliques impossibles à résoudre (aucune colonne optionnelle) entre : ${[...core].join(', ')}. Aucune donnée modifiée.`);
    defer(cand);
  }
  throw fail('Restauration refusée : graphe de dépendances trop complexe. Aucune donnée modifiée.');
}

module.exports = { planOrder, kahn, cycleCore };
