/* Bon de commande fournisseur — même conception que « Nouvelle facture » (ext-billing.js) :
   en-tête, tableau de lignes avec « + Ajouter une ligne » / « × », totaux HT et TTC en direct. */
(function () {
  'use strict';

  window.poNew = async function (presetSupplierId) {
    if (typeof can === 'function' && !can('purchase.manage')) return;
    var results = await Promise.all([G('/suppliers').catch(function () { return []; }), G('/products').catch(function () { return []; })]);
    var suppliers = results[0] || [];
    var products = (results[1] || []).filter(function (p) { return p.active !== false && p.active !== 0; });
    if (!products.length) { toast('Aucun produit disponible pour créer un bon de commande', 'error'); return; }

    var supOpts = (presetSupplierId ? '' : '<option value="">— Choisir un fournisseur —</option>') + suppliers.map(function (s) {
      return '<option value="' + Number(s.id) + '"' + (presetSupplierId && Number(s.id) === Number(presetSupplierId) ? ' selected' : '') + '>' + esc(s.name) + '</option>';
    }).join('');
    var prodOpts = '<option value="">— Choisir un produit —</option>' + products.map(function (p) {
      return '<option value="' + Number(p.id) + '" data-cost="' + (p.buy_price != null ? p.buy_price : '') + '">' + esc(p.name) + '</option>';
    }).join('');

    function lineRow() {
      return '<tr>' +
        '<td><select class="po-prod">' + prodOpts + '</select></td>' +
        '<td><input class="po-qty" type="number" min="0.001" step="0.001" value="1" style="width:90px"></td>' +
        '<td><input class="po-cost" type="number" min="0.01" step="0.01" value="" placeholder="0" style="width:110px"></td>' +
        '<td class="po-amt">0</td>' +
        '<td><button type="button" class="b2 po-del" title="Supprimer la ligne" aria-label="Supprimer la ligne">×</button></td></tr>';
    }

    modal('<h3 style="margin-top:0">Nouveau bon de commande</h3>' +
      '<div class="g"><label>Fournisseur<select id="po_sup"' + (presetSupplierId ? ' disabled' : '') + '>' + supOpts + '</select></label>' +
      '<label>Taxe %<input type="number" id="po_tax" value="0" min="0" max="100" step="0.01"></label></div>' +
      '<div class="tw" style="margin-top:10px;max-height:40vh;overflow:auto"><table id="po_table"><thead><tr>' +
      '<th>Produit</th><th>Qté</th><th>Coût unitaire</th><th>Montant</th><th></th></tr></thead>' +
      '<tbody>' + lineRow() + '</tbody></table></div>' +
      '<p style="margin-top:8px"><button type="button" class="b2" id="po_add">+ Ajouter une ligne</button> ' +
      '<b>Total HT : <span id="po_total">0</span></b> · TTC : <span id="po_ttc">0</span></p>' +
      '<div class="r"><button class="b2" onclick="closeM()">Annuler</button>' +
      '<button id="po_ok">Créer le bon de commande</button></div>');

    var fmt = function (n) { return typeof money === 'function' ? money(n) : n.toFixed(2); };
    function recalc() {
      var total = 0;
      document.querySelectorAll('#po_table tbody tr').forEach(function (tr) {
        var amt = (parseFloat(tr.querySelector('.po-qty').value) || 0) * (parseFloat(tr.querySelector('.po-cost').value) || 0);
        tr.querySelector('.po-amt').textContent = fmt(amt);
        total += amt;
      });
      var tax = parseFloat(document.getElementById('po_tax').value) || 0;
      document.getElementById('po_total').textContent = fmt(total);
      document.getElementById('po_ttc').textContent = fmt(total * (1 + tax / 100));
    }
    function bindRow(tr) {
      tr.querySelector('.po-prod').onchange = function () {
        var cost = this.options[this.selectedIndex].getAttribute('data-cost');
        if (cost && !(parseFloat(tr.querySelector('.po-cost').value) > 0)) tr.querySelector('.po-cost').value = cost;
        recalc();
      };
      tr.querySelector('.po-qty').oninput = recalc;
      tr.querySelector('.po-cost').oninput = recalc;
      tr.querySelector('.po-del').onclick = function () {
        var tb = document.querySelector('#po_table tbody');
        if (tb.rows.length <= 1) { toast('Au moins une ligne requise', 'error'); return; }
        tr.remove(); recalc();
      };
    }
    document.querySelectorAll('#po_table tbody tr').forEach(bindRow);
    document.getElementById('po_tax').oninput = recalc;
    document.getElementById('po_add').onclick = function () {
      var tb = document.querySelector('#po_table tbody');
      if (tb.rows.length >= 30) { toast('Maximum 30 lignes', 'error'); return; }
      tb.insertAdjacentHTML('beforeend', lineRow());
      bindRow(tb.rows[tb.rows.length - 1]);
    };
    document.getElementById('po_ok').onclick = async function () {
      var sup = document.getElementById('po_sup').value;
      if (!sup) { toast('Choisissez un fournisseur', 'error'); return; }
      var tax = parseFloat(document.getElementById('po_tax').value) || 0;
      var items = [], bad = 0;
      document.querySelectorAll('#po_table tbody tr').forEach(function (tr, i) {
        var pid = tr.querySelector('.po-prod').value;
        var qty = parseFloat(tr.querySelector('.po-qty').value) || 0;
        var cost = parseFloat(tr.querySelector('.po-cost').value) || 0;
        if (!pid) { if (cost > 0) bad = bad || i + 1; return; }   // ligne sans produit : ignorée si vide, signalée si un coût est saisi
        if (!(qty > 0) || !(cost > 0)) { bad = bad || i + 1; return; }
        items.push({ product_id: Number(pid), quantity: qty, unit_cost: cost, tax_rate: tax });
      });
      if (bad) { toast('Vérifiez le produit, la quantité et le coût unitaire de la ligne ' + bad, 'error'); return; }
      if (!items.length) { toast('Ajoutez au moins une ligne valide', 'error'); return; }
      this.disabled = true;
      try {
        await Po('/purchases', { supplier_id: Number(sup), items: items });
        closeM();
        toast('Bon de commande créé (' + items.length + ' ligne(s))', 'success');
        if (presetSupplierId) go('supdet', Number(presetSupplierId)); else go('four');
      } catch (e) {
        this.disabled = false;
        toast(typeof errMsg === 'function' ? errMsg(e) : e.message, 'error');
      }
    };
    recalc();
  };

  // Les anciens points d'entrée ouvrent désormais ce même formulaire.
  window.addPO = function () { return window.poNew(); };
  window.addPOForSupplier = function (supplierId) { return window.poNew(Number(supplierId)); };
})();
