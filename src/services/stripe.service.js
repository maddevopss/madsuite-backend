const Stripe = require("stripe");
const db = require("../../db");
const { applyStripePlanUpdate } = require("./organisation.service");
const analyticsService = require("./analytics.service");

/**
 * Stripe est optionnel au démarrage.
 *
 * Cela permet notamment aux environnements de développement, de test et de
 * staging de démarrer sans clé Stripe.
 *
 * Toute fonctionnalité nécessitant Stripe doit passer par requireStripe().
 */
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripe = stripeSecretKey ? Stripe(stripeSecretKey) : null;

/**
 * Retourne le client Stripe configuré.
 *
 * @throws {Error} Erreur HTTP 503 lorsque Stripe n'est pas configuré.
 * @returns {import("stripe")} Client Stripe
 */
function requireStripe() {
  if (!stripe) {
    const error = new Error(
      "Stripe est désactivé dans cet environnement. Configurez STRIPE_SECRET_KEY pour utiliser cette fonctionnalité."
    );

    error.statusCode = 503;
    error.code = "STRIPE_NOT_CONFIGURED";

    throw error;
  }

  return stripe;
}

/**
 * Indique si Stripe est disponible dans l'environnement courant.
 *
 * @returns {boolean}
 */
function isStripeEnabled() {
  return Boolean(stripe);
}

/**
 * Résout le plan_type à partir d'une subscription Stripe.
 *
 * Stratégie de lookup, dans l'ordre :
 * 1. metadata.plan_type
 * 2. lookup_key
 * 3. fallback "pro"
 *
 * Allowlist stricte : ["pro", "enterprise"]
 *
 * @param {object} subscription Objet subscription Stripe
 * @returns {string} Plan validé
 */
function resolvePlanTypeFromStripeSubscription(subscription) {
  const allowedPlans = new Set(["pro", "enterprise"]);

  if (subscription?.metadata?.plan_type) {
    const planFromMetadata = String(
      subscription.metadata.plan_type
    ).toLowerCase();

    if (allowedPlans.has(planFromMetadata)) {
      return planFromMetadata;
    }
  }

  if (subscription?.lookup_key) {
    const planFromLookupKey = String(subscription.lookup_key).toLowerCase();

    if (allowedPlans.has(planFromLookupKey)) {
      return planFromLookupKey;
    }
  }

  return "pro";
}

/**
 * Crée une session Checkout pour un abonnement.
 *
 * @param {number|string} organisationId
 * @param {string} userEmail
 * @param {string} successUrl
 * @param {string} cancelUrl
 * @returns {Promise<string>}
 */
async function createSubscriptionCheckoutSession(
  organisationId,
  userEmail,
  successUrl,
  cancelUrl
) {
  const stripeClient = requireStripe();

  const result = await db.query(
    "SELECT nom, stripe_customer_id FROM organisations WHERE id = $1",
    [organisationId]
  );

  if (result.rowCount === 0) {
    throw new Error("Organisation introuvable");
  }

  const organisation = result.rows[0];
  let customerId = organisation.stripe_customer_id;

  if (!customerId) {
    const customer = await stripeClient.customers.create({
      email: userEmail,
      name: organisation.nom,
      metadata: {
        organisation_id: organisationId.toString(),
      },
    });

    customerId = customer.id;

    await db.query(
      "UPDATE organisations SET stripe_customer_id = $1 WHERE id = $2",
      [customerId, organisationId]
    );
  }

  const stripePriceId = process.env.STRIPE_PRICE_ID_PRO;

  if (!stripePriceId) {
    const error = new Error(
      "STRIPE_PRICE_ID_PRO est requis pour créer un abonnement Stripe."
    );

    error.statusCode = 503;
    error.code = "STRIPE_PRICE_NOT_CONFIGURED";

    throw error;
  }

  const session = await stripeClient.checkout.sessions.create({
    customer: customerId,
    payment_method_types: ["card"],
    mode: "subscription",
    line_items: [
      {
        price: stripePriceId,
        quantity: 1,
      },
    ],
    subscription_data: {
      trial_period_days: 14,
    },
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      organisation_id: organisationId.toString(),
    },
  });

  return session.url;
}

/**
 * Crée un lien d'onboarding Stripe Connect.
 *
 * @param {number|string} organisationId
 * @param {string} returnUrl
 * @param {string} refreshUrl
 * @returns {Promise<string>}
 */
async function createAccountLink(
  organisationId,
  returnUrl,
  refreshUrl
) {
  const stripeClient = requireStripe();

  const result = await db.query(
    "SELECT stripe_account_id FROM organisations WHERE id = $1",
    [organisationId]
  );

  if (result.rowCount === 0) {
    throw new Error("Organisation introuvable");
  }

  let accountId = result.rows[0].stripe_account_id;

  if (!accountId) {
    const account = await stripeClient.accounts.create({
      type: "standard",
    });

    accountId = account.id;

    await db.query(
      "UPDATE organisations SET stripe_account_id = $1 WHERE id = $2",
      [accountId, organisationId]
    );
  }

  const accountLink = await stripeClient.accountLinks.create({
    account: accountId,
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type: "account_onboarding",
  });

  return accountLink.url;
}

/**
 * Crée une session Checkout pour payer une facture via Stripe Connect.
 *
 * @param {object} invoice
 * @param {object} organisation
 * @param {string} successUrl
 * @param {string} cancelUrl
 * @returns {Promise<string>}
 */
async function createInvoiceCheckoutSession(
  invoice,
  organisation,
  successUrl,
  cancelUrl
) {
  const stripeClient = requireStripe();

  if (!organisation.stripe_account_id) {
    const error = new Error(
      "Cette organisation n'a pas configuré Stripe."
    );

    error.statusCode = 400;
    error.code = "STRIPE_ACCOUNT_NOT_CONFIGURED";

    throw error;
  }

  const session = await stripeClient.checkout.sessions.create(
    {
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
            unit_amount: Math.round(Number(invoice.total) * 100),
          },
          quantity: 1,
        },
      ],
      client_reference_id: `INV_${invoice.id}`,
      success_url: successUrl,
      cancel_url: cancelUrl,
    },
    {
      stripeAccount: organisation.stripe_account_id,
    }
  );

  return session.url;
}

/**
 * Gère les événements Stripe déjà validés et transformés en objets event.
 *
 * La vérification de signature doit être réalisée dans la route webhook avant
 * d'appeler cette fonction.
 *
 * @param {object} event Événement Stripe
 * @returns {Promise<void>}
 */
async function handleWebhook(event) {
  try {
    const stripeReconciliationService = require(
      "./stripeReconciliation.service"
    );

    const reconciliationResult =
      await stripeReconciliationService.processWebhookEvent(event);

    if (
      reconciliationResult &&
      reconciliationResult.status !== "ignored"
    ) {
      // L'événement a été traité par le service de réconciliation.
      // Le switch ci-dessous conserve les comportements métier historiques.
    }

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;

        if (session.mode === "subscription") {
          const customerId = session.customer;
          const subscriptionId = session.subscription;

          const organisationResult = await db.query(
            "SELECT id FROM organisations WHERE stripe_customer_id = $1",
            [customerId]
          );

          if (organisationResult.rows[0]) {
            const organisationId = organisationResult.rows[0].id;

            const currentPlanResult = await db.query(
              "SELECT plan_type FROM organisations WHERE id = $1",
              [organisationId]
            );

            const resolvedPlanType =
              resolvePlanTypeFromStripeSubscription(
                session.subscription_details || {}
              );

            const wasAlreadyAtPlan =
              currentPlanResult.rows[0]?.plan_type === resolvedPlanType;

            await applyStripePlanUpdate({
              organisationId,
              planType: resolvedPlanType,
              subscriptionId,
              status: "active",
            });

            if (!wasAlreadyAtPlan) {
              try {
                await analyticsService.trackEvent(
                  "subscription_active",
                  {
                    organisationId,
                    metadata: {
                      subscriptionId,
                      source: "checkout.session.completed",
                    },
                  }
                );
              } catch (error) {
                console.error(
                  "Impossible d'enregistrer l'événement analytics subscription_active:",
                  error
                );
              }
            }
          }
        } else if (session.mode === "payment") {
          const clientReference = session.client_reference_id;

          if (
            clientReference &&
            clientReference.startsWith("INV_")
          ) {
            const invoiceId = Number.parseInt(
              clientReference.replace("INV_", ""),
              10
            );

            if (!Number.isInteger(invoiceId)) {
              throw new Error(
                "Référence de facture Stripe invalide."
              );
            }

            const invoiceResult = await db.query(
              `SELECT
                 i.*,
                 c.email AS client_email,
                 c.nom AS client_nom,
                 o.id AS org_id
               FROM invoices i
               JOIN clients c ON c.id = i.client_id
               JOIN organisations o ON o.id = i.organisation_id
               WHERE i.id = $1`,
              [invoiceId]
            );

            const invoice = invoiceResult.rows[0];

            if (invoice) {
              const expectedAmount = Math.round(
                Number(invoice.total) * 100
              );

              if (session.amount_total !== expectedAmount) {
                console.error(
                  `Alerte de sécurité : montant payé ${session.amount_total} != montant attendu ${expectedAmount} pour la facture ${invoiceId}`
                );

                throw new Error(
                  "Le montant Stripe ne correspond pas à la facture."
                );
              }

              await db.query(
                `UPDATE invoices
                 SET status = 'paid',
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = $1
                   AND status IN ('sent', 'draft', 'finalized')
                   AND organisation_id = $2`,
                [invoiceId, invoice.org_id]
              );

              const {
                recordLedgerEntry,
              } = require("./invoice/invoice-ledger.service");

              await recordLedgerEntry({
                organisationId: invoice.org_id,
                type: "payment_received",
                amount: Number(session.amount_total) / 100,
                currency: session.currency || "cad",
                referenceType: "stripe_session",
                referenceId: session.id,
              });

              const {
                recordBusinessAudit,
              } = require("./auditLog.service");

              await recordBusinessAudit({
                organisationId: invoice.org_id,
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
          }
        }

        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        const customerId = subscription.customer;

        const organisationResult = await db.query(
          "SELECT id FROM organisations WHERE stripe_customer_id = $1",
          [customerId]
        );

        if (organisationResult.rows[0]) {
          await applyStripePlanUpdate({
            organisationId: organisationResult.rows[0].id,
            planType: "free",
            status: "canceled",
          });
        }

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

      default:
        break;
    }
  } catch (error) {
    console.error(
      "Erreur lors de la gestion du webhook Stripe:",
      error
    );

    throw error;
  }
}

module.exports = {
  createSubscriptionCheckoutSession,
  createAccountLink,
  createInvoiceCheckoutSession,
  handleWebhook,
  resolvePlanTypeFromStripeSubscription,
  requireStripe,
  isStripeEnabled,
  stripe,
};