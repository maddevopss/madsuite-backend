const { stripe } = require("./stripe.service");
const db = require("../../db");
const { recordLedgerEntry } = require("./invoice/invoice-ledger.service");
const { recordBusinessAudit } = require("./auditLog.service");

class StripeReconciliationService {
  /**
   * Réconcilie l'état de l'abonnement d'une organisation avec Stripe
   */
  async reconcileSubscription(organisationId) {
    const orgRes = await db.query(
      "SELECT stripe_customer_id, stripe_subscription_id FROM organisations WHERE id = $1",
      [organisationId]
    );

    if (orgRes.rowCount === 0) throw new Error("Organisation introuvable");
    const org = orgRes.rows[0];

    if (!org.stripe_customer_id) return { status: 'no_customer' };

    let activeSub = null;

    if (org.stripe_subscription_id) {
      try {
        activeSub = await stripe.subscriptions.retrieve(org.stripe_subscription_id);
      } catch (err) {
        if (err.statusCode !== 404) throw err;
      }
    }

    if (!activeSub) {
      // Fetch all subscriptions for customer
      const subs = await stripe.subscriptions.list({
        customer: org.stripe_customer_id,
        limit: 1,
        status: "all"
      });
      if (subs.data.length > 0) {
        activeSub = subs.data[0];
      }
    }

    if (activeSub) {
      const planType = activeSub.status === 'active' || activeSub.status === 'trialing' ? 'pro' : 'free';
      await db.query(
        `UPDATE organisations 
         SET stripe_subscription_id = $1, 
             plan_type = $2, 
             subscription_status = $3
         WHERE id = $4`,
        [activeSub.id, planType, activeSub.status, organisationId]
      );
      return { status: 'updated', planType, stripeStatus: activeSub.status };
    }

    return { status: 'no_subscription' };
  }

  /**
   * Réconcilie les paiements de factures clients pour une organisation (Stripe Connect)
   */
  async reconcileClientInvoices(organisationId) {
    const orgRes = await db.query(
      "SELECT stripe_account_id FROM organisations WHERE id = $1",
      [organisationId]
    );

    if (orgRes.rowCount === 0) throw new Error("Organisation introuvable");
    const org = orgRes.rows[0];

    if (!org.stripe_account_id) {
      return { status: 'no_connect_account' };
    }

    // Récupérer les factures en attente de paiement dans notre DB
    const pendingInvoicesRes = await db.query(
      `SELECT id, total FROM invoices 
       WHERE organisation_id = $1 AND status = 'finalized' AND deleted_at IS NULL`,
      [organisationId]
    );

    const pendingInvoices = pendingInvoicesRes.rows;
    if (pendingInvoices.length === 0) {
      return { status: 'no_pending_invoices', updated: 0 };
    }

    // On récupère les Checkout Sessions complétées récentes du compte Connect
    // (Dans un cas réel de production avec bcp de volume, on filtrerait ou paginerait)
    const sessions = await stripe.checkout.sessions.list(
      { limit: 100 },
      { stripeAccount: org.stripe_account_id }
    );

    let updatedCount = 0;
    const details = [];

    for (const session of sessions.data) {
      if (session.payment_status === 'paid' && session.client_reference_id) {
        const refMatch = session.client_reference_id.match(/^INV_(\d+)$/);
        if (refMatch) {
          const invoiceId = parseInt(refMatch[1], 10);
          
          // Chercher si cette facture est dans nos pending
          const invoice = pendingInvoices.find(inv => inv.id === invoiceId);
          if (invoice) {
            const expectedAmount = Math.round(Number(invoice.total) * 100);
            if (session.amount_total === expectedAmount) {
              // Update status
              await db.query(
                `UPDATE invoices SET status = 'paid', updated_at = CURRENT_TIMESTAMP 
                 WHERE id = $1 AND organisation_id = $2`,
                [invoiceId, organisationId]
              );

              // Ledger
              await recordLedgerEntry({
                organisationId,
                type: "payment_received",
                amount: Number(session.amount_total) / 100,
                currency: session.currency || "cad",
                referenceType: "stripe_session_reconciled",
                referenceId: session.id,
              });

              // Audit
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
          }
        }
      }
    }

    return { status: 'success', updated: updatedCount, details };
  }

  /**
   * Effectue la réconciliation complète pour une organisation et sauvegarde un log
   */
  async runFullReconciliation(organisationId) {
    const logRes = await db.query(
      `INSERT INTO payment_reconciliation_logs (organisation_id, status)
       VALUES ($1, 'processing') RETURNING id`,
      [organisationId]
    );
    const logId = logRes.rows[0].id;

    try {
      const subResult = await this.reconcileSubscription(organisationId);
      const invResult = await this.reconcileClientInvoices(organisationId);

      const finalStatus = 'success';
      const invoicesUpdated = invResult.updated || 0;
      
      const logDetails = {
        subscription: subResult,
        invoices: invResult
      };

      await db.query(
        `UPDATE payment_reconciliation_logs 
         SET status = $1, invoices_checked = $2, invoices_updated = $3, details = $4::jsonb
         WHERE id = $5`,
        [finalStatus, 0, invoicesUpdated, JSON.stringify(logDetails), logId]
      );

      return { status: finalStatus, invoicesUpdated, details: logDetails };

    } catch (err) {
      await db.query(
        `UPDATE payment_reconciliation_logs 
         SET status = 'failed', details = $1::jsonb
         WHERE id = $2`,
        [JSON.stringify({ error: err.message }), logId]
      );
      throw err;
    }
  }
}

module.exports = new StripeReconciliationService();
