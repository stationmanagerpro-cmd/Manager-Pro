/* ext-manager-extras.js — Justificatif photo d'une dépense (proposé juste après sa saisie, par son auteur).
   API : src/manager_extras.js (POST /api/expenses/:id/receipts). Le justificatif est facultatif : « Plus tard » ferme sans rien envoyer. */
(function () {
  'use strict';
  var MAX = 1.5 * 1024 * 1024;
  window.askExpenseReceipt = function (expenseId) {
    return new Promise(function (resolve) {
      modal('<h3 style="margin-top:0">Justificatif de la dépense</h3>' +
        '<p class="muted">Photographiez le reçu (JPEG, PNG, WebP ou PDF, 1,5 Mo maximum) pour qu\'il soit retrouvé dans le rapport.</p>' +
        '<input id="xr-file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" capture="environment">' +
        '<p id="xr-msg" class="muted"></p>' +
        '<div class="bar" style="justify-content:flex-end"><button class="b2" id="xr-later">Plus tard</button> <button id="xr-send">Joindre</button></div>');
      var done = function () { closeM(); resolve(); };
      document.getElementById('xr-later').onclick = done;
      document.getElementById('xr-send').onclick = async function () {
        var f = document.getElementById('xr-file').files[0], msg = document.getElementById('xr-msg');
        if (!f) { msg.textContent = 'Choisissez un fichier, ou cliquez sur « Plus tard ».'; return; }
        if (f.size > MAX) { msg.textContent = 'Fichier trop volumineux (1,5 Mo maximum) : réduisez la photo.'; return; }
        try {
          var b64 = await new Promise(function (ok, ko) { var r = new FileReader(); r.onload = function () { ok(String(r.result).split(',')[1]); }; r.onerror = ko; r.readAsDataURL(f); });
          await Po('/expenses/' + expenseId + '/receipts', { filename: f.name, mime: f.type, data: b64 });
          toast('Justificatif joint', 'success'); done();
        } catch (e) { msg.textContent = (e && e.message) || 'Envoi impossible'; }
      };
    });
  };
})();
