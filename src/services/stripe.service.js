const Stripe = require("stripe");
const db = require("../../db");

// Initialisation de Stripe (utiliser une clé secrète via env)
const stripeSecretKey = process.env.STRIPE_SECRET_KEY || "sk_test_placeholder";
const stripe = Stripe(stripeSecretKey);

/**
 * Crée une session Checkout pour l'abonnement
 */
async function createSubscriptionCheckoutSession(organisationId, userEmail, successUrl, cancelUrl) {
  const result = await db.query(
    "SELECT nom, stripe_customer_id FROM organisations WHERE id = $1",
    [organisationId]
  );
  
  if (result.rowCount === 0) throw new Error("Organisation introuvable");
  
  const organisation = result.rows[0];
  let customerId = organisation.stripe_customer_id;

  // Si l'organisation n'a pas encore de client Stripe, on le crée
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: userEmail,
      name: organisation.nom,
      metadata: {
        organisation_id: organisationId.toString()
      }
    });
    customerId = customer.id;

    await db.query(
      "UPDATE organisations SET stripe_customer_id = $1 WHERE id = $2",
      [customerId, organisationId]
    );
  }

  // Création de la session Checkout
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    payment_method_types: ["card"],
    mode: "subscription",
    line_items: [
      {
        // Price ID créé dans le dashboard Stripe (ex: 20$/mois)
        price: process.env.STRIPE_PRICE_ID_PRO || "price_dummy",
        quantity: 1,
      },
    ],
    subscription_data: {
      trial_period_days: 14,
    },
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      organisation_id: organisationId.toString()
    }
  });

  return session.url;
}

/**
 * Crée un lien d'onboarding Stripe Connect (Standard)
 */
async function createAccountLink(organisationId, returnUrl, refreshUrl) {
  const result = await db.query(
    "SELECT stripe_account_id FROM organisations WHERE id = $1",
    [organisationId]
  );
  
  if (result.rowCount === 0) throw new Error("Organisation introuvable");
  
  let accountId = result.rows[0].stripe_account_id;

  if (!accountId) {
    const account = await stripe.accounts.create({ type: "standard" });
    accountId = account.id;
    await db.query(
      "UPDATE organisations SET stripe_account_id = $1 WHERE id = $2",
      [accountId, organisationId]
    );
  }

  const accountLink = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type: "account_onboarding",
  });

  return accountLink.url;
}

/**
 * Crée une session Checkout pour payer une facture (via Stripe Connect)
 */
async function createInvoiceCheckoutSession(invoice, organisation, successUrl, cancelUrl) {
  if (!organisation.stripe_account_id) {
    throw new Error("Cette organisation n'a pas configuré Stripe.");
  }

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "cad",
          product_data: {
            name: `Facture ${invoice.invoice_number}`,
            description: `Paiement de la facture ${invoice.invoice_number}`,
          },
          unit_amount: Math.round(Number(invoice.total) * 100), // En cents
        },
        quantity: 1,
      },
    ],
    client_reference_id: `INV_${invoice.id}`,
    success_url: successUrl,
    cancel_url: cancelUrl,
  }, {
    stripeAccount: organisation.stripe_account_id
  });

  return session.url;
}

/**
 * Gère les webhooks Stripe pour mettre à jour la base de données
 */
async function handleWebhook(event) {
  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        if (session.mode === "subscription") {
          const customerId = session.customer;
          const subscriptionId = session.subscription;
          
          await db.query(
            `UPDATE organisations 
             SET stripe_subscription_id = $1, 
                 plan_type = 'pro', 
                 subscription_status = 'active'
             WHERE stripe_customer_id = $2`,
            [subscriptionId, customerId]
          );
        } else if (session.mode === "payment") {
          // Paiement d'une facture
          const clientRef = session.client_reference_id;
          if (clientRef && clientRef.startsWith("INV_")) {
            const invoiceId = parseInt(clientRef.replace("INV_", ""), 10);
            await db.query(
              `UPDATE invoices SET status = 'paid', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
              [invoiceId]
            );

            // Récupérer la facture pour l'audit
            try {
              const invRes = await db.query(
                `SELECT i.*, c.email AS client_email, c.nom AS client_nom, o.id AS org_id 
                 FROM invoices i 
                 JOIN clients c ON c.id = i.client_id 
                 JOIN organisations o ON o.id = i.organisation_id 
                 WHERE i.id = $1`,
                [invoiceId]
              );
              const inv = invRes.rows[0];
              if (inv) {
                // Log d'audit de paiement
                const { recordBusinessAudit } = require("./auditLog.service");
                await recordBusinessAudit({
                  organisationId: inv.org_id,
                  actorUserId: null,
                  action: "invoice.paid_via_stripe",
                  entityType: "invoice",
                  entityId: invoiceId,
                  details: {
                    stripeSessionId: session.id,
                    amount: session.amount_total,
                    currency: session.currency,
                  },
                  req: null,
                });
              }
            } catch (auditErr) {
              // Ne pas bloquer si l'audit échoue
              console.error("Erreur audit paiement:", auditErr);
            }
          }
        }
        break;
      }
      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        const customerId = subscription.customer;

        await db.query(
          `UPDATE organisations 
           SET plan_type = 'free', 
               subscription_status = 'canceled'
           WHERE stripe_customer_id = $1`,
          [customerId]
        );
        break;
      }
      case "customer.subscription.updated": {
        const subscription = event.data.object;
        const customerId = subscription.customer;

        await db.query(
          `UPDATE organisations 
           SET subscription_status = $1
           WHERE stripe_customer_id = $2`,
          [subscription.status, customerId]
        );
        break;
      }
    }
  } catch (err) {
    console.error("Erreur lors de la gestion du webhook Stripe:", err);
    throw err;
  }
}

module.exports = {
  createSubscriptionCheckoutSession,
  createAccountLink,
  createInvoiceCheckoutSession,
  handleWebhook,
  stripe
};
