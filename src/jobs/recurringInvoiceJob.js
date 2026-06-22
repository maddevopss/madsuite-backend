const { pool } = require("../../db");
const logger = require("../config/logger");
const outboxService = require("../services/outbox.service");
const crypto = require("crypto");
const { createJobResultTracker } = require("./jobResultAggregator");


async function processRecurringInvoices() {
  const tracker = createJobResultTracker('Recurring Invoices');
  logger.info("Démarrage du Recurring Invoices Job...");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Trouver les factures récurrentes à émettre aujourd'hui
    const query = `
      SELECT r.*, i.notes, i.subtotal, i.tax_total, i.total, c.email as client_email
      FROM recurring_invoices r
      JOIN invoices i ON r.template_invoice_id = i.id
      JOIN clients c ON r.client_id = c.id
      WHERE r.status = 'active'
        AND r.next_issue_date <= CURRENT_DATE
      FOR UPDATE OF r SKIP LOCKED
    `;
    const recurrences = await client.query(query);

    for (const r of recurrences.rows) {
      try {
        const issueDate = new Date(); // Aujourd'hui
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + 14); // Net 14 par défaut (ou on pourrait prendre la diff de l'original)

        // Récupérer le numéro de facture auto-incrémenté ou un format par défaut
        // Un format basique pour le MVP
        const nextIdRes = await client.query("SELECT nextval(pg_get_serial_sequence('invoices', 'id')) as next_id");
        const nextInvoiceNumber = `INV-${new Date().getFullYear()}-${String(nextIdRes.rows[0].next_id).padStart(4, "0")}`;

        // Insérer la nouvelle facture (status = sent directement ?)
        // Le MVP demande l'automatisation, on l'envoie en "sent"
        const insertInvoice = `
          INSERT INTO invoices (
            organisation_id, client_id, invoice_number, status, issue_date, due_date,
            subtotal, tax_total, total, notes, reminders_sent
          ) VALUES ($1, $2, $3, 'sent', CURRENT_DATE, $4, $5, $6, $7, $8, 0)
          RETURNING *
        `;
        const newInvoiceRes = await client.query(insertInvoice, [
          r.organisation_id, r.client_id, nextInvoiceNumber, dueDate,
          r.subtotal, r.tax_total, r.total, r.notes
        ]);
        const newInvoice = newInvoiceRes.rows[0];

        // Cloner les items
        await client.query(`
          INSERT INTO invoice_items (organisation_id, invoice_id, time_entry_id, description, quantity, unit_rate, amount)
          SELECT $1, $2, NULL, description, quantity, unit_rate, amount
          FROM invoice_items
          WHERE invoice_id = $3
        `, [r.organisation_id, newInvoice.id, r.template_invoice_id]);

        // Calculer la prochaine date
        let nextDate = new Date(r.next_issue_date);
        if (r.frequency === 'weekly') nextDate.setDate(nextDate.getDate() + 7);
        else if (r.frequency === 'yearly') nextDate.setFullYear(nextDate.getFullYear() + 1);
        else nextDate.setMonth(nextDate.getMonth() + 1); // monthly par défaut

        await client.query(`
          UPDATE recurring_invoices
          SET next_issue_date = $1, updated_at = CURRENT_TIMESTAMP
          WHERE id = $2
        `, [nextDate, r.id]);

        // Envoyer l'email
        if (r.client_email) {
          await outboxService.insertEvent(client, 'recurring_invoice_reminder', { email: r.client_email, invoice: newInvoice });
        }

        // Notification pour l'admin
        await client.query(`
          INSERT INTO notifications (organisation_id, utilisateur_id, type, message)
          SELECT $1, id, 'recurring_issued', $2 FROM utilisateurs WHERE organisation_id = $1 AND role = 'admin'
        `, [r.organisation_id, `Facture récurrente ${nextInvoiceNumber} générée et envoyée automatiquement.`]);

        logger.info(`Facture récurrente ${nextInvoiceNumber} générée avec succès.`);
        tracker.recordSuccess();
      } catch (err) {
        logger.error(`Erreur génération récurrence ${r.id}: ${err.message}`);
        await tracker.recordFailure(err, { recurrenceId: r.id });
      }
    }

    await client.query("COMMIT");
    logger.info("Recurring Invoices Job terminé.");
    return { successCount: tracker.successCount, failureCount: tracker.failureCount, status: tracker.resolveStatus() };
  } catch (error) {
    await client.query("ROLLBACK");
    logger.error("Erreur globale dans le Recurring Invoices Job:", error);
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { processRecurringInvoices };
