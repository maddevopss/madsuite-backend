const db = require("../../db");
const { recordLedgerEntry } = require("./invoice/invoice-ledger.service");
const { recordBusinessAudit } = require("./auditLog.service");

function extractPaymentDetails(eventType, stripeObject) {
  const amountInCents = eventType === "invoice.payment_succeeded"
    ? Number(stripeObject.amount_paid || 0)
    : Number(stripeObject.amount || 0);

  return {
    amountInCents,
    amountPaid: amountInCents / 100,
    currency: String(stripeObject.currency || "cad").toLowerCase(),
  };
}

class StripeReconciliationService {
  async processWebhookEvent(event) {
    const allowedEvents = [
      "payment_intent.succeeded",
      "charge.succeeded",
      "invoice.payment_succeeded",
    ];

    if (!event || !allowedEvents.includes(event.type)) {
      return { status: "ignored" };
    }

    const stripeEventId = event.id;
    const payload = event;
    const stripeObject = event.data?.object || {};
    let invoiceId = null;

    if (stripeObject.metadata?.invoice_id) {
      invoiceId = parseInt(stripeObject.metadata.invoice_id, 10);
    } else if (stripeObject.metadata?.invoiceId) {
      invoiceId = parseInt(stripeObject.metadata.invoiceId, 10);
    } else if (
      stripeObject.client_reference_id &&
      stripeObject.client_reference_id.startsWith("INV_")
    ) {
      invoiceId = parseInt(stripeObject.client_reference_id.replace("INV_", ""), 10);
    }

    let txClient;
    let transactionCompleted = false;

    try {
      txClient = await db.pool.connect();

      if (!txClient || typeof txClient.query !== "function") {
        throw new Error("Database connection failed");
      }

      await txClient.query("BEGIN");

      try {
        await txClient.query(
          `
          INSERT INTO payment_events (invoice_id, stripe_event_id, type, payload)
          VALUES ($1, $2, $3, $4)
          `,
          [invoiceId || null, stripeEventId, event.type, JSON.stringify(payload)],
        );
      } catch (err) {
        if (err.code === "23505") {
          await txClient.query("ROLLBACK");
          transactionCompleted = true;
          return { status: "duplicate" };
        }

        throw err;
      }

      if (!invoiceId || Number.isNaN(invoiceId)) {
        await txClient.query("ROLLBACK");
        transactionCompleted = true;
        return { status: "invoice_not_found" };
      }

      const invRes = await txClient.query(
        `
        SELECT i.*, o.id AS org_id
        FROM invoices i
        JOIN organisations o ON o.id = i.organisation_id
        WHERE i.id = $1
        `,
        [invoiceId],
      );

      const inv = invRes.rows[0];

      if (!inv) {
        await txClient.query("ROLLBACK");
        transactionCompleted = true;
        return { status: "invoice_not_found" };
      }

      const { amountInCents, amountPaid, currency } = extractPaymentDetails(event.type, stripeObject);
      const expectedAmountInCents = Math.round(Number(inv.total) * 100);
      const expectedCurrency = String(inv.currency || "cad").toLowerCase();

      if (amountInCents !== expectedAmountInCents) {
        await txClient.query("ROLLBACK");
        transactionCompleted = true;
        return {
          status: "amount_mismatch",
          invoiceId,
          expectedAmountInCents,
          receivedAmountInCents: amountInCents,
        };
      }

      if (currency !== expectedCurrency) {
        await txClient.query("ROLLBACK");
        transactionCompleted = true;
        return {
          status: "currency_mismatch",
          invoiceId,
          expectedCurrency,
          receivedCurrency: currency,
        };
      }

      const invoiceUpdate = await txClient.query(
        `
        UPDATE invoices
        SET status = 'paid',
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
          AND status IN ('sent', 'draft', 'pending', 'overdue')
        RETURNING id
        `,
        [invoiceId],
      );

      if (invoiceUpdate.rowCount > 0) {
        await txClient.query(
          `
          UPDATE time_entries
          SET is_billed = TRUE,
              updated_at = CURRENT_TIMESTAMP
          WHERE invoice_id = $1
            AND organisation_id = $2
          `,
          [invoiceId, inv.org_id],
        );

        await recordLedgerEntry({
          organisationId: inv.org_id,
          type: "payment_received",
          amount: amountPaid,
          currency,
          referenceType: "stripe_webhook",
          referenceId: stripeEventId,
          client: txClient,
        });

        await recordBusinessAudit({
          organisationId: inv.org_id,
          actorUserId: null,
          action: "invoice.paid_via_stripe_reconciliation",
          entityType: "invoice",
          entityId: invoiceId,
          details: {
            stripeEventId,
            amount: amountPaid,
            currency,
            eventType: event.type,
          },
          req: null,
          client: txClient,
          throwOnError: true,
        });

        const adminRes = await txClient.query(
          `
          SELECT id
          FROM utilisateurs
          WHERE organisation_id = $1
            AND role = 'admin'
          LIMIT 1
          `,
          [inv.org_id],
        );

        if (adminRes.rowCount > 0) {
          await txClient.query(
            `
            INSERT INTO notifications (organisation_id, utilisateur_id, type, message)
            VALUES ($1, $2, $3, $4)
            `,
            [
              inv.org_id,
              adminRes.rows[0].id,
              "info",
              `La facture #${inv.invoice_number || invoiceId} a été payée avec succès via Stripe.`,
            ],
          );
        }
      }

      await txClient.query("COMMIT");
      transactionCompleted = true;

      return { status: "success", invoiceId };
    } catch (err) {
      if (txClient && typeof txClient.query === "function" && !transactionCompleted) {
        try {
          await txClient.query("ROLLBACK");
        } catch {
          // On conserve l'erreur originale.
        }
      }

      throw err;
    } finally {
      if (txClient && typeof txClient.release === "function") {
        txClient.release();
      }
    }
  }
}

module.exports = new StripeReconciliationService();
