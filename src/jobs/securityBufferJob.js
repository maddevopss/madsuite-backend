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

    const result = await client.query(`
      WITH locked_incidents AS (
        SELECT
          sib.id,
          sib.utilisateur_id,
          sib.type,
          sib.details
        FROM security_incidents_buffer sib
        WHERE sib.notified_at IS NULL
        ORDER BY sib.id
        FOR UPDATE OF sib SKIP LOCKED
      )
      SELECT
        li.utilisateur_id,
        u.email,
        u.nom,
        array_agg(li.id ORDER BY li.id) AS incident_ids,
        json_agg(
          json_build_object(
            'type', li.type,
            'details', li.details
          )
          ORDER BY li.id
        ) AS incidents
      FROM locked_incidents li
      JOIN utilisateurs u ON u.id = li.utilisateur_id
      GROUP BY li.utilisateur_id, u.email, u.nom
    `);

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
         SELECT organisation_id, 'system.security_summary_sent', 'utilisateur', id, $2::jsonb
         FROM utilisateurs WHERE id = $1`,
        [row.utilisateur_id, JSON.stringify({ count: row.incidents.length })],
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
