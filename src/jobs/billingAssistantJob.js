const { pool } = require("../../db");
const emailService = require("../services/email.service");
const logger = require("../config/logger");

async function processReminders() {
  logger.info("Démarrage du Billing Assistant Job (Relances automatiques)...");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Relances des factures en retard
    const overdueInvoicesQuery = `
      SELECT i.*, c.email as client_email 
      FROM invoices i
      JOIN clients c ON i.client_id = c.id
      WHERE i.status = 'sent' 
        AND i.due_date < CURRENT_DATE
        AND i.reminders_sent < 3
        AND (i.last_reminder_at IS NULL OR i.last_reminder_at < NOW() - INTERVAL '3 days')
        AND i.deleted_at IS NULL
      FOR UPDATE SKIP LOCKED
    `;
    const overdueInvoices = await client.query(overdueInvoicesQuery);

    for (const invoice of overdueInvoices.rows) {
      if (invoice.client_email) {
        try {
          await emailService.sendInvoiceReminder(invoice.client_email, invoice);
          
          await client.query(`
            UPDATE invoices 
            SET reminders_sent = reminders_sent + 1, last_reminder_at = NOW() 
            WHERE id = $1
          `, [invoice.id]);
          
          logger.info(`Relance envoyée pour la facture ${invoice.invoice_number}`);
        } catch (err) {
          logger.error(`Erreur lors de l'envoi de la relance pour la facture ${invoice.invoice_number}: ${err.message}`);
        }
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
          await emailService.sendEstimateReminder(estimate.client_email, estimate);
          
          await client.query(`
            UPDATE estimates 
            SET reminders_sent = reminders_sent + 1, last_reminder_at = NOW() 
            WHERE id = $1
          `, [estimate.id]);
          
          logger.info(`Relance envoyée pour la soumission ${estimate.estimate_number}`);
        } catch (err) {
          logger.error(`Erreur lors de l'envoi de la relance pour la soumission ${estimate.estimate_number}: ${err.message}`);
        }
      }
    }

    await client.query("COMMIT");
    logger.info("Billing Assistant Job terminé.");
  } catch (error) {
    await client.query("ROLLBACK");
    logger.error("Erreur globale dans le Billing Assistant Job:", error);
  } finally {
    client.release();
  }
}

module.exports = { processReminders };
