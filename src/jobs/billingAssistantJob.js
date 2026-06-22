const { pool } = require("../../db");
const outboxService = require("../services/outbox.service");
const logger = require("../config/logger");
const { createJobResultTracker } = require("./jobResultAggregator");
const { getStrictMode } = require("../core/executionContext");

async function processReminders() {
  const tracker = createJobResultTracker('Billing Assistant');
  logger.info("Démarrage du Billing Assistant Job (Relances automatiques)...");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Relances des factures en retard (Soft Dunning)
    const overdueInvoicesQuery = `
      SELECT i.*, c.email as client_email,
      EXTRACT(DAY FROM (CURRENT_DATE - i.due_date)) as days_overdue
      FROM invoices i
      JOIN clients c ON i.client_id = c.id
      WHERE i.status = 'sent' 
        AND i.due_date < CURRENT_DATE
        AND i.reminders_sent < 3
        AND i.deleted_at IS NULL
      FOR UPDATE SKIP LOCKED
    `;
    const overdueInvoices = await client.query(overdueInvoicesQuery);

    for (const invoice of overdueInvoices.rows) {
      if (!invoice.client_email) continue;
      
      const mode = getStrictMode();
      if (mode === 'enforce' || mode === 'warn_only') {
        if (invoice.status !== 'sent' || parseInt(invoice.days_overdue, 10) <= 0) {
          const msg = `INVARIANT_VIOLATION: dunning_only_for_overdue_invoices. Invoice ${invoice.invoice_number} is not sent or overdue.`;
          if (mode === 'enforce') {
            logger.error(msg);
            await tracker.recordFailure(new Error(msg));
            continue;
          } else {
            logger.warn(msg);
          }
        }
      }

      const daysOverdue = parseInt(invoice.days_overdue, 10);
      const remindersSent = invoice.reminders_sent;

      try {
        let sentType = null;
        let newCount = remindersSent;

        if (daysOverdue >= 14 && remindersSent < 3) {
          await outboxService.insertEvent(client, 'dunning_reminder', { email: invoice.client_email, invoice, subType: 'final' });
          sentType = 'final';
          newCount = 3;
          await client.query(`
            INSERT INTO notifications (organisation_id, utilisateur_id, type, message)
            SELECT $1, id, 'reminder_final', $2 FROM utilisateurs WHERE organisation_id = $1 AND role = 'admin'
          `, [invoice.organisation_id, `Facture ${invoice.invoice_number} impayée depuis 14 jours (Mise en demeure envoyée).`]);
        } else if (daysOverdue >= 7 && remindersSent < 2) {
          await outboxService.insertEvent(client, 'dunning_reminder', { email: invoice.client_email, invoice, subType: 'firm' });
          sentType = 'firm';
          newCount = 2;
          await client.query(`
            INSERT INTO notifications (organisation_id, utilisateur_id, type, message)
            SELECT $1, id, 'reminder_firm', $2 FROM utilisateurs WHERE organisation_id = $1 AND role = 'admin'
          `, [invoice.organisation_id, `Facture ${invoice.invoice_number} impayée depuis 7 jours (2e rappel envoyé).`]);
        } else if (daysOverdue >= 3 && remindersSent < 1) {
          await outboxService.insertEvent(client, 'dunning_reminder', { email: invoice.client_email, invoice, subType: 'gentle' });
          sentType = 'gentle';
          newCount = 1;
        }

        if (sentType) {
          await client.query(`
            UPDATE invoices 
            SET reminders_sent = $1, last_reminder_at = NOW() 
            WHERE id = $2
          `, [newCount, invoice.id]);
          logger.info(`Relance ${sentType} envoyée pour la facture ${invoice.invoice_number}`);
        }
        tracker.recordSuccess();
      } catch (err) {
        logger.error(`Erreur relance facture ${invoice.invoice_number}: ${err.message}`);
        await tracker.recordFailure(err);
      }
    }

    // 2. Relances des soumissions expirées / en attente
    const pendingEstimatesQuery = `
      SELECT e.*, c.email as client_email
      FROM estimates e
      JOIN clients c ON e.client_id = c.id
      WHERE e.status = 'sent'
        AND e.valid_until < CURRENT_DATE
        AND e.reminders_sent < 3
        AND (e.last_reminder_at IS NULL OR e.last_reminder_at < NOW() - INTERVAL '3 days')
        AND e.deleted_at IS NULL
      FOR UPDATE SKIP LOCKED
    `;
    const pendingEstimates = await client.query(pendingEstimatesQuery);

    for (const estimate of pendingEstimates.rows) {
      if (estimate.client_email) {
        try {
          await outboxService.insertEvent(client, 'estimate_reminder', { email: estimate.client_email, estimate });
          
          await client.query(`
            UPDATE estimates 
            SET reminders_sent = reminders_sent + 1, last_reminder_at = NOW() 
            WHERE id = $1
          `, [estimate.id]);
          
          logger.info(`Relance envoyée pour la soumission ${estimate.estimate_number}`);
          tracker.recordSuccess();
        } catch (err) {
          logger.error(`Erreur relance soumission ${estimate.estimate_number}: ${err.message}`);
          await tracker.recordFailure(err);
        }
      }
    }

    await client.query("COMMIT");
    logger.info("Billing Assistant Job terminé.");
    return { successCount: tracker.successCount, failureCount: tracker.failureCount, status: tracker.resolveStatus() };
  } catch (error) {
    await client.query("ROLLBACK");
    logger.error("Erreur globale dans le Billing Assistant Job:", error);
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { processReminders };
