'use strict';
// Vente au nom d'un employé (scan QR) : l'employé concerné est alerté (message interne, et e-mail si SMTP est configuré).
// Appelé APRÈS la transaction de vente : un échec d'alerte n'annule pas la vente, il est seulement journalisé.
const { pool } = require('./core');
const { deliverSystemMessage } = require('./messaging');
const { dispatchExternal, channelState } = require('./notify_channels');

async function notifyDelegatedSale(d) {
  try {
    const { rows: [info] } = await pool.query(
      `SELECT e.user_id, e.email, TRIM(COALESCE(e.first_name,'') || ' ' || COALESCE(e.last_name,'')) AS name,
              s.client_id, COALESCE(NULLIF(TRIM(u.full_name), ''), u.login) AS by_name
         FROM employees e
         JOIN stations s ON s.id = e.station_id
         JOIN users u ON u.id = $2
        WHERE e.id = $1`, [d.employee_id, d.by]);
    if (!info || !info.user_id) return { sent: false, reason: 'no_account' };   // refusé en amont ; garde-fou
    const title = 'Vente enregistrée à votre nom';
    const text = `Vente carburant N° ${d.sale_id} : ${d.liters} L pour ${d.amount}, enregistrée à votre nom par ${info.by_name}.`;
    const internal = await deliverSystemMessage({ clientId: info.client_id, userIds: [info.user_id], title, body: text,
      kind: 'vente_au_nom', refTable: 'sales', refId: d.sale_id });
    let mail = { sent: false, reason: 'e-mail absent sur la fiche' };
    if (info.email && channelState().email.available) {
      const r = await dispatchExternal({ channels: ['email'], recipients: [{ name: info.name, email: info.email }], subject: title, text });
      mail = { sent: !!(r[0] && r[0].sent), reason: r[0] ? r[0].reason : null };
    } else if (!channelState().email.available) mail = { sent: false, reason: 'SMTP non configuré' };
    return { internal: !!internal.sent, mail };
  } catch (e) {
    console.error('[qr_delegate] alerte non envoyée pour la vente', d.sale_id, e.message);
    return { sent: false, reason: 'error' };
  }
}

module.exports = { notifyDelegatedSale };
