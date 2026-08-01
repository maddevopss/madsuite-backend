const logger = require("../config/logger");
const { EmailService } = require("../services/email.service");
const db = require("../../db");

let Queue = null;
let IORedis = null;

try {
  ({ Queue } = require("bullmq"));
  IORedis = require("ioredis");
} catch {
  Queue = null;
  IORedis = null;
}

const connection = IORedis ? new IORedis(process.env.REDIS_URL || "redis://127.0.0.1:6379") : null;
const emailQueue = Queue && connection ? new Queue("email-notifications", { connection }) : null;
const emailService = new EmailService();

async function processSecurityBuffer() {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");

    // utilisateurs est sous RLS FORCE : ce job traite les incidents de toutes
    // les organisations en lot, sans contexte d'organisation unique.
    // Résolution + verrouillage via fonction SECURITY DEFINER dédiée plutôt
    // qu'une jointure directe bloquée par RLS.
    const result = await client.query(`SELECT * FROM lock_pending_security_incidents()`);

    if (result.rowCount === 0) {
      await client.query("COMMIT");
      return;
    }

    for (const row of result.rows) {
      const subject = `⚠️ MADSuite : ${row.incidents.length} alertes de sécurité sur votre compte`;

      if (emailQueue) {
        await emailQueue.add(
          "send-security-summary",
          {
            to: row.email,
            subject,
            templateData: {
              userName: row.nom,
              incidents: row.incidents,
            },
          },
          { priority: 1, attempts: 3 },
        );
      } else {
        await emailService.sendSecuritySummary(row.email, subject, {
          userName: row.nom,
          incidents: row.incidents,
        });
      }

      await client.query(
        `UPDATE security_incidents_buffer
        SET notified_at = NOW()
        WHERE id = ANY($1)
          AND notified_at IS NULL`,
        [row.incident_ids],
      );

      await client.query(
        `INSERT INTO business_audit_logs (organisation_id, action, entity_type, entity_id, details)
         VALUES ($1, 'system.security_summary_sent', 'utilisateur', $2, $3::jsonb)`,
        [row.organisation_id, row.utilisateur_id, JSON.stringify({ count: row.incidents.length })],
      );
    }

    await client.query("COMMIT");
    logger.info(`Buffer sécurité traité : ${result.rowCount} utilisateurs notifiés.`);
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error("Erreur lors du traitement du buffer sécurité:", err.message);
  } finally {
    client.release();
  }
}

module.exports = { processSecurityBuffer };
