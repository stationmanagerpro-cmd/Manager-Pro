'use strict';
// CORR-028/029/030 : contrôle client à la modification d'une facture, politique de mot de passe à la création
// du compte ADMIN client, et écritures restantes filtrées par station_id (billing, purchases, hr, operations).
const fs = require('fs'); const path = require('path'); const assert = require('assert');
const rd = f => fs.readFileSync(path.resolve(__dirname, '../src', f), 'utf8');
const bill = rd('billing.js'), pur = rd('purchases.js'), hr = rd('hr.js'), ops = rd('operations.js'), con = rd('contracts.js');
let n = 0; const check = (l, fn) => { fn(); n++; console.log('✓ ' + l); };
const has = (c, re) => assert.match(c, re);
check('billing PATCH : client vérifié sur la station', () => {
  const patch = bill.slice(bill.indexOf("r.patch('/invoices/:id'"));
  has(patch.slice(0, 1800), /FROM customers WHERE id=\$1 AND station_id=\$2 AND deleted_at IS NULL/);
});
check('billing : échéance, client, paiement, solde, annulation filtrés par station', () => {
  has(bill, /SET due_date=\$2 WHERE id=\$1 AND station_id=\$3/);
  has(bill, /SET customer_id=\$2 WHERE id=\$1 AND station_id=\$3/);
  has(bill, /amount_paid=\$2, status=\$3, updated_at=now\(\) WHERE id=\$1 AND station_id=\$4/);
  has(bill, /balance = balance - \$2 WHERE id=\$1 AND station_id=\$3/);
  has(bill, /status='annulee'[\s\S]{0,120}WHERE id=\$1 AND station_id=\$3/);
});
check('purchases : facturation, archivage, annulation filtrés par station', () => {
  has(pur, /invoice_total = \$5 WHERE id = \$1 AND station_id = \$6/);
  has(pur, /status = 'archive'[^"]*WHERE id = \$1 AND station_id = \$2/);
  has(pur, /status = 'annule'[^"]*WHERE id = \$1 AND station_id = \$3/);
});
check('hr : validation, paiement, appréciation des bulletins filtrés par station', () => {
  has(hr, /validated_at = now\(\) WHERE id = \$1 AND station_id = \$3/);
  has(hr, /WHERE id = \$1 AND station_id = \$24/);
  has(hr, /paid_method = \$3 WHERE id = \$1 AND station_id = \$4/);
  has(hr, /hr_comment = COALESCE\(\$4, hr_comment\) WHERE id = \$1 AND station_id = \$5/);
});
check('operations : annulation de vente filtrée par station', () => has(ops, /cancel_reason = \$3 WHERE id = \$1 AND station_id = \$4/));
check('contracts : mot de passe ADMIN client contrôlé par password_policy', () => {
  has(con, /checkPassword\(b\.owner_password, \{ role: 'ADMIN'/);
  assert.ok(con.indexOf('checkPassword(b.owner_password') < con.indexOf('bcrypt.hash(b.owner_password'));
});
console.log(`\n${n}/${n} contrôles réussis.`);
