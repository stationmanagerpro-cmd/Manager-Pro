// Verrous consultatifs PostgreSQL (niveau session) pour les tâches planifiées (RG-08 / ANO-07) : avec plusieurs instances de
// l'application, une tâche ne s'exécute qu'une fois par échéance. Modèle : alerts_scheduler.js et scheduled_reports.js.
// Les identifiants sont centralisés ici pour éviter toute collision entre tâches.
const TASK_LOCKS = {
  MIGRATIONS: 74120317,     // src/migrate.js
  ALERTS: 74120318,         // src/alerts_scheduler.js
  REPORTS: 74120319,        // src/scheduled_reports.js
  BACKUP: 74120321,         // src/backup.js (cycle de 30 min)
  NOTIFICATIONS: 74120322   // src/notification_rules.js (cycle de 60 s)
};

/**
 * Exécute fn() seulement si aucune autre instance ne détient le verrou `lockId` ; sinon renvoie { skipped: 'another_instance_running' }.
 * Le verrou est toujours libéré (même en cas d'erreur) et la connexion rendue au pool.
 */
async function withTaskLock(lockId, fn) {
  const { pool } = require('./core');
  const client = await pool.connect();
  let locked = false;
  try {
    locked = !!(await client.query('SELECT pg_try_advisory_lock($1) AS locked', [lockId])).rows[0]?.locked;
    if (!locked) return { skipped: 'another_instance_running' };
    return await fn();
  } finally {
    if (locked) await client.query('SELECT pg_advisory_unlock($1)', [lockId]).catch(() => {});
    client.release();
  }
}

module.exports = { TASK_LOCKS, withTaskLock };
