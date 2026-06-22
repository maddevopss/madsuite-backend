const db = require("../../db");
const { recordLedgerEntry } = require("./invoice/invoice-ledger.service");
const { recordBusinessAudit } = require("./auditLog.service");

class StripeReconciliationService {
  async processWebhookEvent(event) {
    const allowedEvents = ['payment_intent.succeeded', 'charge.succeeded', 'invoice.payment_succeeded'];
    if (!allowedEvents.includes(event.type)) {
      return { status: 'ignored' };
    }

    const stripeEventId = event.id;
    const payload = event;
    let invoiceId = null;

    // Tentative de récupération de l'invoice ID
    if (event.data.object.metadata && event.data.object.metadata.invoice_id) {
      invoiceId = parseInt(event.data.object.metadata.invoice_id, 10);
    } else if (event.data.object.metadata && event.data.object.metadata.invoiceId) {
      invoiceId = parseInt(event.data.object.metadata.invoiceId, 10);
    } else if (event.data.object.client_reference_id && event.data.object.client_reference_id.startsWith("INV_")) {
      invoiceId = parseInt(event.data.object.client_reference_id.replace("INV_", ""), 10);
    } else if (event.data.object.payment_intent) {
      // Possiblement remonter via le payment_intent si nécessaire, mais dans un webhook
      // on s'attend à ce que le metadata soit correctement populé.
    }

    const txClient = await db.pool.connect();
    try {
      await txClient.query("BEGIN");

      // Idempotence: on insère l'événement. Si échec de contrainte unique, on ignore.
      try {
        await txClient.query(`
          INSERT INTO payment_events (invoice_id, stripe_event_id, type, payload)
          VALUES ($1, $2, $3, $4)
        `, [invoiceId || null, stripeEventId, event.type, JSON.stringify(payload)]);
      } catch (err) {
        if (err.code === '23505') { // unique_violation
          await txClient.query("ROLLBACK");
          return { status: 'duplicate' };
        }
        throw err;
      }

      if (!invoiceId) {
        await txClient.query("ROLLBACK");
        return { status: 'invoice_not_found' };
      }

      // Vérifier l'existence de la facture
      const invRes = await txClient.query(
        `SELECT i.*, o.id AS org_id FROM invoices i
         JOIN organisations o ON o.id = i.organisation_id
         WHERE i.id = $1`,
        [invoiceId]
      );

      const inv = invRes.rows[0];
      if (!inv) {
        await txClient.query("ROLLBACK");
        return { status: 'invoice_not_found' };
      }

      // Calcul du montant payé
      let amountPaid = 0;
      let currency = "cad";
      if (event.type === 'payment_intent.succeeded' || event.type === 'charge.succeeded') {
        amountPaid = event.data.object.amount / 100;
        currency = event.data.object.currency;
      } else if (event.type === 'invoice.payment_succeeded') {
        amountPaid = event.data.object.amount_paid / 100;
        currency = event.data.object.currency;
      }

      // Facture marquée payée
      const invoiceUpdate = await txClient.query(
        `UPDATE invoices SET status = 'paid', updated_at = CURRENT_TIMESTAMP 
         WHERE id = $1 AND status IN ('sent', 'draft', 'pending', 'overdue')
         RETURNING id`,
        [invoiceId]
      );

      if (invoiceUpdate.rowCount > 0) {
        // Fix (HIGH RISK): Marquer les time_entries comme payées/facturées
        await txClient.query(
          `
          UPDATE time_entries
          SET is_billed = TRUE,
              updated_at = CURRENT_TIMESTAMP
          WHERE invoice_id = $1
            AND organisation_id = $2
          `,
          [invoiceId, inv.org_id]
        );

        // Paiement enregistré dans le ledger
        await recordLedgerEntry({
          organisationId: inv.org_id,
          type: "payment_received",
          amount: amountPaid,
          currency: currency || "cad",
          referenceType: "stripe_webhook",
          referenceId: stripeEventId,
          client: txClient
        });

        // Timeline créée (Audit log)
        await recordBusinessAudit({
          organisationId: inv.org_id,
          actorUserId: null,
          action: "invoice.paid_via_stripe_reconciliation",
          entityType: "invoice",
          entityId: invoiceId,
          details: {
            stripeEventId: stripeEventId,
            amount: amountPaid,
            currency: currency,
            eventType: event.type
          },
          req: null,
        });

        // Notification créée
        const adminRes = await txClient.query(
          `SELECT id FROM utilisateurs WHERE organisation_id = $1 AND role = 'admin' LIMIT 1`,
          [inv.org_id]
        );
        if (adminRes.rowCount > 0) {
          const adminId = adminRes.rows[0].id;
          await txClient.query(
            `INSERT INTO notifications (organisation_id, utilisateur_id, type, message)
             VALUES ($1, $2, $3, $4)`,
            [inv.org_id, adminId, 'info', `La facture #${inv.invoice_number || invoiceId} a été payée avec succès via Stripe.`]
          );
        }
      }

      await txClient.query("COMMIT");
      return { status: 'success', invoiceId };

    } catch (err) {
      await txClient.query("ROLLBACK");
      throw err;
    } finally {
      txClient.release();
    }
  }
}

module.exports = new StripeReconciliationService();
