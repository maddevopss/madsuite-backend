const { stripe } = require("./stripe.service");
const db = require("../../db");
const { recordLedgerEntry } = require("./invoice/invoice-ledger.service");
const { recordBusinessAudit } = require("./auditLog.service");
const { applyStripePlanUpdate } = require("./organisation.service");

class StripeReconciliationService {
  /**
   * Traite un webhook Stripe de paiement de facture client.
   *
   * Cette méthode existe pour les tests historiques et pour l'idempotence webhook.
   * Elle doit rester défensive : si la connexion transactionnelle échoue avant
   * l'assignation du client, on ne doit jamais appeler release() sur undefined.
   */
  async processWebhookEvent(event) {
    let txClient;

    try {
      txClient = await db.pool.connect();

      await txClient.query("BEGIN");

      const eventId = event?.id;
      const eventType = event?.type;
      const session = event?.data?.object;

      if (!eventId) {
        throw new Error("Stripe event id manquant");
      }

      const existingEvent = await txClient.query(
        `SELECT id
         FROM stripe_webhook_events
         WHERE stripe_event_id = $1
         LIMIT 1`,
        [eventId],
      );

      if (existingEvent.rowCount > 0) {
        await txClient.query("ROLLBACK");
        return { status: "duplicate" };
      }

      await txClient.query(
        `INSERT INTO stripe_webhook_events (stripe_event_id, event_type, processed_at)
         VALUES ($1, $2, CURRENT_TIMESTAMP)`,
        [eventId, eventType || null],
      );

      if (eventType !== "checkout.session.completed") {
        await txClient.query("COMMIT");
        return { status: "ignored" };
      }

      if (!session || session.payment_status !== "paid") {
        await txClient.query("COMMIT");
        return { status: "ignored" };
      }

      const invoiceId =
        session.metadata?.invoice_id ||
        session.metadata?.invoiceId ||
        session.client_reference_id?.replace(/^INV_/, null);

      if (!invoiceId) {
        await txClient.query("COMMIT");
        return { status: "invoice_not_found" };
      }

      const invoiceRes = await txClient.query(
        `SELECT id, organisation_id, total, status
         FROM invoices
         WHERE id = $1
           AND deleted_at IS NULL
         LIMIT 1`,
        [invoiceId],
      );

      if (invoiceRes.rowCount === 0) {
        await txClient.query("COMMIT");
        return { status: "invoice_not_found" };
      }

      const invoice = invoiceRes.rows[0];
      const organisationId = invoice.organisation_id;

      await txClient.query(
        `UPDATE invoices
         SET status = 'paid',
             paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
           AND organisation_id = $2`,
        [invoice.id, organisationId],
      );

      await recordLedgerEntry({
        organisationId,
        type: "payment_received",
        amount: Number(session.amount_total || 0) / 100,
        currency: session.currency || "cad",
        referenceType: "stripe_webhook",
        referenceId: session.id,
      });

      await recordBusinessAudit({
        organisationId,
        actorUserId: null,
        action: "invoice.paid_via_stripe_webhook",
        entityType: "invoice",
        entityId: invoice.id,
        details: {
          stripeEventId: eventId,
          stripeSessionId: session.id,
          amount: session.amount_total,
          currency: session.currency,
        },
        req: null,
      });

      await txClient.query("COMMIT");

      return {
        status: "processed",
        invoiceId: invoice.id,
        organisationId,
      };
    } catch (err) {
      if (txClient && typeof txClient.query === "function") {
        await txClient.query("ROLLBACK");
      }

      throw err;
    } finally {
      if (txClient && typeof txClient.release === "function") {
        txClient.release();
      }
    }
  }

  /**
   * Réconcilie l'état de l'abonnement d'une organisation avec Stripe.
   */
  async reconcileSubscription(organisationId) {
    const orgRes = await db.query(
      "SELECT stripe_customer_id, stripe_subscription_id FROM organisations WHERE id = $1",
      [organisationId],
    );

    if (orgRes.rowCount === 0) throw new Error("Organisation introuvable");
    const org = orgRes.rows[0];

    if (!org.stripe_customer_id) return { status: "no_customer" };

    let activeSub = null;

    if (org.stripe_subscription_id) {
      try {
        activeSub = await stripe.subscriptions.retrieve(org.stripe_subscription_id);
      } catch (err) {
        if (err.statusCode !== 404) throw err;
      }
    }

    if (!activeSub) {
      const subs = await stripe.subscriptions.list({
        customer: org.stripe_customer_id,
        limit: 1,
        status: "all",
      });

      if (subs.data.length > 0) {
        activeSub = subs.data[0];
      }
    }

    if (activeSub) {
      const planType = activeSub.status === "active" || activeSub.status === "trialing" ? "pro" : "free";

      await applyStripePlanUpdate({
        organisationId,
        planType,
        subscriptionId: activeSub.id,
        status: activeSub.status,
      });

      return {
        status: "updated",
        planType,
        stripeStatus: activeSub.status,
      };
    }

    return { status: "no_subscription" };
  }

  /**
   * Réconcilie les paiements de factures clients pour une organisation Stripe Connect.
   */
  async reconcileClientInvoices(organisationId) {
    const orgRes = await db.query(
      "SELECT stripe_account_id FROM organisations WHERE id = $1",
      [organisationId],
    );

    if (orgRes.rowCount === 0) throw new Error("Organisation introuvable");
    const org = orgRes.rows[0];

    if (!org.stripe_account_id) {
      return { status: "no_connect_account" };
    }

    const pendingInvoicesRes = await db.query(
      `SELECT id, total
       FROM invoices
       WHERE organisation_id = $1
         AND status = 'finalized'
         AND deleted_at IS NULL`,
      [organisationId],
    );

    const pendingInvoices = pendingInvoicesRes.rows;

    if (pendingInvoices.length === 0) {
      return { status: "no_pending_invoices", updated: 0 };
    }

    const sessions = await stripe.checkout.sessions.list(
      { limit: 100 },
      { stripeAccount: org.stripe_account_id },
    );

    let updatedCount = 0;
    const details = [];

    for (const session of sessions.data) {
      if (session.payment_status !== "paid" || !session.client_reference_id) {
        continue;
      }

      const refMatch = session.client_reference_id.match(/^INV_(\d+)$/);
      if (!refMatch) continue;

      const invoiceId = parseInt(refMatch[1], 10);
      const invoice = pendingInvoices.find((inv) => inv.id === invoiceId);

      if (!invoice) continue;

      const expectedAmount = Math.round(Number(invoice.total) * 100);

      if (session.amount_total !== expectedAmount) continue;

      await db.query(
        `UPDATE invoices
         SET status = 'paid',
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
           AND organisation_id = $2`,
        [invoiceId, organisationId],
      );

      await recordLedgerEntry({
        organisationId,
        type: "payment_received",
        amount: Number(session.amount_total) / 100,
        currency: session.currency || "cad",
        referenceType: "stripe_session_reconciled",
        referenceId: session.id,
      });

      await recordBusinessAudit({
        organisationId,
        actorUserId: null,
        action: "invoice.paid_via_stripe_reconciliation",
        entityType: "invoice",
        entityId: invoiceId,
        details: {
          stripeSessionId: session.id,
          amount: session.amount_total,
          currency: session.currency,
        },
        req: null,
      });

      updatedCount++;
      details.push({ invoiceId, sessionId: session.id });
    }

    return {
      status: "success",
      updated: updatedCount,
      details,
    };
  }

  /**
   * Effectue la réconciliation complète pour une organisation et sauvegarde un log.
   */
  async runFullReconciliation(organisationId) {
    const logRes = await db.query(
      `INSERT INTO payment_reconciliation_logs (organisation_id, status)
       VALUES ($1, 'processing')
       RETURNING id`,
      [organisationId],
    );

    const logId = logRes.rows[0].id;

    try {
      const subResult = await this.reconcileSubscription(organisationId);
      const invResult = await this.reconcileClientInvoices(organisationId);

      const finalStatus = "success";
      const invoicesUpdated = invResult.updated || 0;

      const logDetails = {
        subscription: subResult,
        invoices: invResult,
      };

      await db.query(
        `UPDATE payment_reconciliation_logs
         SET status = $1,
             invoices_checked = $2,
             invoices_updated = $3,
             details = $4::jsonb
         WHERE id = $5`,
        [finalStatus, 0, invoicesUpdated, JSON.stringify(logDetails), logId],
      );

      return {
        status: finalStatus,
        invoicesUpdated,
        details: logDetails,
      };
    } catch (err) {
      await db.query(
        `UPDATE payment_reconciliation_logs
         SET status = 'failed',
             details = $1::jsonb
         WHERE id = $2`,
        [JSON.stringify({ error: err.message }), logId],
      );

      throw err;
    }
  }
}

module.exports = new StripeReconciliationService();