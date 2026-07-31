/**
 * stripeEventProcessor.service.js
 * 
 * Processeur métier consolidé pour les événements Stripe.
 * 
 * Responsabilités :
 * - Résoudre l'organisation de manière sûre
 * - Résoudre le plan avec validation
 * - Exécuter les handlers métier dans des transactions
 * - Enregistrer les audits et notifications
 * 
 * La route reste responsable de :
 * - Signature et validation event.id
 * - Idempotence via stripe_webhook_events
 * - Appel du processeur
 * - markProcessed ou markFailed
 * - Réponse HTTP
 */

const db = require("../../db");
const logger = require("../config/logger");
const { applyStripePlanUpdate } = require("./organisation.service");
const analyticsService = require("./analytics.service");
const { recordLedgerEntry } = require("./invoice/invoice-ledger.service");
const { recordBusinessAudit } = require("./auditLog.service");
const stripeReconciliationService = require("./stripeReconciliation.service");

const PAYMENT_RECONCILIATION_EVENTS = new Set([
  "payment_intent.succeeded",
  "charge.succeeded",
  "invoice.payment_succeeded",
  "payment_intent.payment_failed",
  "charge.failed",
  "invoice.payment_failed",
]);

/**
 * Résout l'organisation de manière sûre.
 * 
 * Ordre :
 * 1. Retrouver par stripe_customer_id local (source de vérité)
 * 2. Utiliser métadonnées si aucun lien local
 * 3. Vérifier cohérence
 * 
 * @param {string} customerId - ID client Stripe
 * @param {object} metadata - Métadonnées de l'événement
 * @returns {Promise<number>} ID organisation
 * @throws {Error} Si organisation non trouvée ou conflit
 */
async function resolveOrganisationFromCustomer(customerId, metadata = {}) {
  if (!customerId) {
    throw new Error("Customer ID is required");
  }

  // 1. Retrouver par stripe_customer_id local
  const localOrgResult = await db.query(
    "SELECT id FROM organisations WHERE stripe_customer_id = $1",
    [customerId]
  );

  if (localOrgResult.rows[0]) {
    const orgId = localOrgResult.rows[0].id;
    
    // Vérifier cohérence avec métadonnées si présentes
    const metaOrgId = metadata?.organisation_id;
    if (metaOrgId && Number(metaOrgId) !== orgId) {
      logger.warn("Organisation mismatch: local vs metadata", {
        customerId,
        localOrgId: orgId,
        metaOrgId,
      });
      // Utiliser l'organisation locale (source de vérité)
    }
    
    return orgId;
  }

  // 2. Utiliser métadonnées si aucun lien local
  const metaOrgId = metadata?.organisation_id;
  if (metaOrgId) {
    const metaOrgResult = await db.query(
      "SELECT id FROM organisations WHERE id = $1",
      [metaOrgId]
    );
    
    if (metaOrgResult.rows[0]) {
      logger.info("Organisation resolved from metadata", {
        customerId,
        orgId: metaOrgId,
      });
      return metaOrgResult.rows[0].id;
    }
  }

  throw new Error(`Organisation not found for customer ${customerId}`);
}

/**
 * Normalise une valeur de plan.
 * 
 * @param {*} value - Valeur à normaliser
 * @returns {string|null} Plan normalisé ou null
 */
function normalizePlanType(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

/**
 * Valide un plan contre la liste autorisée.
 * 
 * @param {string} planType - Plan à valider
 * @returns {string|null} Plan validé ou null
 */
function validateAllowedStripePlan(planType) {
  const allowedPlans = new Set(["solo", "pro", "enterprise"]);
  const normalized = normalizePlanType(planType);

  if (!normalized || !allowedPlans.has(normalized)) {
    return null;
  }

  return normalized;
}

/**
 * Résout le plan depuis une session Checkout.
 * 
 * Ordre :
 * 1. session.metadata.plan_type
 * 2. subscriptionDetails.metadata.plan_type
 * 3. subscriptionDetails.items[0].price.lookup_key
 * 4. Erreur si aucun plan valide trouvé
 * 
 * @param {object} session - Checkout session Stripe
 * @param {object} subscriptionDetails - Détails d'abonnement optionnels
 * @returns {string} Plan validé
 * @throws {Error} Si aucun plan valide ne peut être résolu
 */
function resolvePlanTypeFromCheckoutSession(
  session,
  subscriptionDetails = null
) {
  const candidates = [
    session?.metadata?.plan_type,
    subscriptionDetails?.metadata?.plan_type,
    subscriptionDetails?.items?.data?.[0]?.price?.lookup_key,
  ];

  for (const candidate of candidates) {
    const validPlan = validateAllowedStripePlan(candidate);
    if (validPlan) {
      return validPlan;
    }
  }

  throw new Error(
    "Unable to resolve an allowed plan from checkout session"
  );
}

/**
 * Résout un changement de plan depuis une Subscription.
 * 
 * Retourne un objet indiquant si une information de plan a été fournie
 * et quelle est sa valeur.
 * 
 * Ordre :
 * 1. subscription.metadata.plan_type
 * 2. subscription.items[0].price.lookup_key
 * 3. Aucun plan fourni
 * 
 * @param {object} subscription - Subscription Stripe
 * @returns {object} { provided: boolean, planType: string|null }
 */
function resolvePlanChangeFromSubscription(subscription) {
  const candidates = [
    {
      source: "metadata.plan_type",
      value: subscription?.metadata?.plan_type,
    },
    {
      source: "price.lookup_key",
      value: subscription?.items?.data?.[0]?.price?.lookup_key,
    },
  ];

  for (const candidate of candidates) {
    const validPlan = validateAllowedStripePlan(candidate.value);
    if (validPlan) {
      return {
        provided: true,
        planType: validPlan,
      };
    }

    // Vérifier si le champ était présent mais invalide
    if (candidate.value !== null && candidate.value !== undefined) {
      logger.warn("Unknown plan value provided", {
        source: candidate.source,
        value: candidate.value,
        subscriptionId: subscription?.id,
      });
      // Retourner une erreur pour les valeurs explicitement invalides
      throw new Error(
        `Invalid plan value in ${candidate.source}: ${candidate.value}`
      );
    }
  }

  // Aucun plan fourni
  return {
    provided: false,
    planType: null,
  };
}

/**
 * Résout le plan avec validation stricte (legacy).
 * 
 * @param {object} subscription - Subscription Stripe
 * @returns {string} Plan validé ("pro", "enterprise", "solo")
 * @throws {Error} Si aucun plan valide ne peut être résolu
 */
function resolvePlanTypeFromSubscription(subscription) {
  const ALLOWED_PLANS = new Set(["solo", "pro", "enterprise"]);

  // 1. metadata.plan_type
  if (subscription?.metadata?.plan_type) {
    const plan = String(subscription.metadata.plan_type).toLowerCase();
    if (ALLOWED_PLANS.has(plan)) {
      return plan;
    }
    logger.warn("Unknown plan in metadata", {
      plan,
      subscriptionId: subscription.id,
    });
  }

  // 2. lookup_key
  if (subscription?.lookup_key) {
    const plan = String(subscription.lookup_key).toLowerCase();
    if (ALLOWED_PLANS.has(plan)) {
      return plan;
    }
    logger.warn("Unknown plan in lookup_key", {
      plan,
      subscriptionId: subscription.id,
    });
  }

  // 3. Erreur explicite
  throw new Error(
    `No valid plan could be resolved for subscription ${subscription?.id}`
  );
}

/**
 * Traite checkout.session.completed pour abonnement.
 * 
 * Flux :
 * 1. Résoudre organisation
 * 2. Résoudre plan
 * 3. Valider cohérence
 * 4. UPDATE organisation dans transaction
 * 5. Enregistrer audit
 * 6. Tracker événement
 * 
 * @param {object} session - Checkout session Stripe
 * @param {object} context - Contexte (event, etc.)
 * @throws {Error} Si organisation non trouvée ou validation échoue
 */
async function handleCheckoutSessionCompletedSubscription(session, context = {}) {
  const customerId = session.customer;
  const subscriptionId = session.subscription;
  const subscriptionDetails = session.subscription_details || {};

  if (!customerId || !subscriptionId) {
    throw new Error("Customer ID and subscription ID are required");
  }

  // 1. Résoudre organisation
  const orgId = await resolveOrganisationFromCustomer(
    customerId,
    session.metadata
  );

  // 2. Résoudre plan
  const planType = resolvePlanTypeFromCheckoutSession(
    session,
    subscriptionDetails
  );

  // 3. Valider cohérence
  const currentOrgResult = await db.query(
    "SELECT plan_type, stripe_subscription_id FROM organisations WHERE id = $1",
    [orgId]
  );
  const currentOrg = currentOrgResult.rows[0];

  if (!currentOrg) {
    throw new Error(`Organisation ${orgId} not found`);
  }

  const wasAlreadyAtPlan = currentOrg.plan_type === planType;

  // 4. UPDATE dans transaction
  let txClient;
  try {
    txClient = await db.pool.connect();
    await txClient.query("BEGIN");

    // Verrouiller l'organisation
    await txClient.query(
      "SELECT id FROM organisations WHERE id = $1 FOR UPDATE",
      [orgId]
    );

    // Mettre à jour
    await txClient.query(
      `UPDATE organisations
       SET plan_type = $1,
           subscription_status = 'active',
           stripe_subscription_id = $2
       WHERE id = $3`,
      [planType, subscriptionId, orgId]
    );

    // 5. Enregistrer audit
    await recordBusinessAudit({
      organisationId: orgId,
      actorUserId: null,
      action: "subscription_activated_via_stripe",
      entityType: "organisation",
      entityId: orgId,
      details: {
        stripeSessionId: session.id,
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId,
        planType,
      },
      req: null,
      client: txClient,
      throwOnError: true,
    });

    await txClient.query("COMMIT");
  } catch (err) {
    if (txClient) {
      try {
        await txClient.query("ROLLBACK");
      } catch {
        // Ignore rollback error
      }
    }
    throw err;
  } finally {
    if (txClient) {
      txClient.release();
    }
  }

  // 6. Tracker événement (non-blocking)
  if (!wasAlreadyAtPlan) {
    try {
      await analyticsService.trackEvent("subscription_active", {
        organisationId: orgId,
        metadata: {
          subscriptionId,
          source: "checkout.session.completed",
        },
      });
    } catch (e) {
      logger.warn("Failed to track subscription_active event", {
        orgId,
        error: e.message,
      });
    }
  }

  logger.info("Subscription activated", {
    orgId,
    customerId,
    subscriptionId,
    planType,
  });
}

/**
 * Traite checkout.session.completed pour paiement de facture.
 * 
 * Flux :
 * 1. Extraire invoice_id
 * 2. Retrouver facture et organisation
 * 3. Valider montant
 * 4. UPDATE facture
 * 5. Enregistrer ledger et audit
 * 
 * @param {object} session - Checkout session Stripe
 * @param {object} context - Contexte
 * @throws {Error} Si facture non trouvée ou montant invalide
 */
async function handleCheckoutSessionCompletedPayment(session, context = {}) {
  const clientRef = session.client_reference_id;
  
  if (!clientRef || !clientRef.startsWith("INV_")) {
    logger.info("Payment session without invoice reference, ignoring", {
      sessionId: session.id,
    });
    return;
  }

  const invoiceId = parseInt(clientRef.replace("INV_", ""), 10);

  if (Number.isNaN(invoiceId)) {
    throw new Error(`Invalid invoice ID in client_reference_id: ${clientRef}`);
  }

  // 2. Retrouver facture
  const invResult = await db.query(
    `SELECT i.*, o.id AS org_id
     FROM invoices i
     JOIN organisations o ON o.id = i.organisation_id
     WHERE i.id = $1`,
    [invoiceId]
  );

  const inv = invResult.rows[0];
  if (!inv) {
    throw new Error(`Invoice ${invoiceId} not found`);
  }

  // 3. Valider montant
  const expectedAmount = Math.round(Number(inv.total) * 100);
  if (session.amount_total !== expectedAmount) {
    throw new Error(
      `Amount mismatch: expected ${expectedAmount}, got ${session.amount_total}`
    );
  }

  // 4. UPDATE facture
  await db.query(
    `UPDATE invoices
     SET status = 'paid', updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND status IN ('sent', 'draft', 'finalized')
     AND organisation_id = $2`,
    [invoiceId, inv.org_id]
  );

  // 5. Enregistrer ledger et audit
  await recordLedgerEntry({
    organisationId: inv.org_id,
    type: "payment_received",
    amount: Number(session.amount_total) / 100,
    currency: session.currency || "cad",
    referenceType: "stripe_session",
    referenceId: session.id,
  });

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

  logger.info("Invoice paid via checkout session", {
    invoiceId,
    orgId: inv.org_id,
    amount: session.amount_total,
  });
}

/**
 * Traite customer.subscription.updated.
 * 
 * Flux :
 * 1. Résoudre organisation
 * 2. Résoudre plan (si changement)
 * 3. UPDATE organisation dans transaction
 * 4. Enregistrer audit si changement
 * 
 * @param {object} subscription - Subscription Stripe
 * @param {object} context - Contexte
 * @throws {Error} Si organisation non trouvée
 */
async function handleSubscriptionUpdated(subscription, context = {}) {
  const customerId = subscription.customer;

  if (!customerId) {
    throw new Error("Customer ID is required");
  }

  // 1. Résoudre organisation
  const orgId = await resolveOrganisationFromCustomer(
    customerId,
    subscription.metadata
  );

  // 2. Résoudre plan (avec distinction entre absent et invalide)
  const planResolution = resolvePlanChangeFromSubscription(subscription);

  // 3. UPDATE dans transaction
  let txClient;
  try {
    txClient = await db.pool.connect();
    await txClient.query("BEGIN");

    // Verrouiller l'organisation
    const currentResult = await txClient.query(
      "SELECT plan_type, subscription_status FROM organisations WHERE id = $1 FOR UPDATE",
      [orgId]
    );

    const current = currentResult.rows[0];
    if (!current) {
      throw new Error(`Organisation ${orgId} not found`);
    }

    // Déterminer le plan à appliquer
    const planType = planResolution.provided
      ? planResolution.planType
      : current.plan_type;

    const planChanged = current.plan_type !== planType;
    const statusChanged = current.subscription_status !== subscription.status;

    // Mettre à jour
    await txClient.query(
      `UPDATE organisations
       SET plan_type = $1,
           subscription_status = $2
       WHERE id = $3`,
      [planType, subscription.status, orgId]
    );

    // 4. Enregistrer audit si changement
    if (planChanged || statusChanged) {
      await recordBusinessAudit({
        organisationId: orgId,
        actorUserId: null,
        action: "subscription_updated_via_stripe",
        entityType: "organisation",
        entityId: orgId,
        details: {
          stripeSubscriptionId: subscription.id,
          planChanged,
          oldPlan: current.plan_type,
          newPlan: planType,
          statusChanged,
          oldStatus: current.subscription_status,
          newStatus: subscription.status,
        },
        req: null,
        client: txClient,
        throwOnError: true,
      });
    }

    await txClient.query("COMMIT");

    // Retourner le plan appliqué pour le logging
    return planType;
  } catch (err) {
    if (txClient) {
      try {
        await txClient.query("ROLLBACK");
      } catch {
        // Ignore rollback error
      }
    }
    throw err;
  } finally {
    if (txClient) {
      txClient.release();
    }
  }
}

async function handleSubscriptionUpdatedLogging(
  orgId,
  customerId,
  subscription,
  planType
) {
  logger.info("Subscription updated", {
    orgId,
    customerId,
    subscriptionId: subscription.id,
    status: subscription.status,
    planType,
  });
}

async function handleSubscriptionUpdatedWrapper(subscription, context = {}) {
  const customerId = subscription.customer;

  if (!customerId) {
    throw new Error("Customer ID is required");
  }

  // 1. Résoudre organisation
  const orgId = await resolveOrganisationFromCustomer(
    customerId,
    subscription.metadata
  );

  // Exécuter la mise à jour et récupérer le plan appliqué
  const planType = await handleSubscriptionUpdatedTransaction(
    subscription,
    orgId
  );

  // Logging
  await handleSubscriptionUpdatedLogging(orgId, customerId, subscription, planType);
}

async function handleSubscriptionUpdatedTransaction(subscription, orgId) {
  // 2. Résoudre plan (avec distinction entre absent et invalide)
  const planResolution = resolvePlanChangeFromSubscription(subscription);

  // 3. UPDATE dans transaction
  let txClient;
  try {
    txClient = await db.pool.connect();
    await txClient.query("BEGIN");

    // Verrouiller l'organisation
    const currentResult = await txClient.query(
      "SELECT plan_type, subscription_status FROM organisations WHERE id = $1 FOR UPDATE",
      [orgId]
    );

    const current = currentResult.rows[0];
    if (!current) {
      throw new Error(`Organisation ${orgId} not found`);
    }

    // Déterminer le plan à appliquer
    const planType = planResolution.provided
      ? planResolution.planType
      : current.plan_type;

    const planChanged = current.plan_type !== planType;
    const statusChanged = current.subscription_status !== subscription.status;

    // Mettre à jour
    await txClient.query(
      `UPDATE organisations
       SET plan_type = $1,
           subscription_status = $2
       WHERE id = $3`,
      [planType, subscription.status, orgId]
    );

    // 4. Enregistrer audit si changement
    if (planChanged || statusChanged) {
      await recordBusinessAudit({
        organisationId: orgId,
        actorUserId: null,
        action: "subscription_updated_via_stripe",
        entityType: "organisation",
        entityId: orgId,
        details: {
          stripeSubscriptionId: subscription.id,
          planChanged,
          oldPlan: current.plan_type,
          newPlan: planType,
          statusChanged,
          oldStatus: current.subscription_status,
          newStatus: subscription.status,
        },
        req: null,
        client: txClient,
        throwOnError: true,
      });
    }

    await txClient.query("COMMIT");
    return planType;
  } catch (err) {
    if (txClient) {
      try {
        await txClient.query("ROLLBACK");
      } catch {
        // Ignore rollback error
      }
    }
    throw err;
  } finally {
    if (txClient) {
      txClient.release();
    }
  }
}

/**
 * Traite customer.subscription.deleted.
 * 
 * Flux :
 * 1. Résoudre organisation
 * 2. Appeler applyStripePlanUpdate avec plan_type = "free"
 * 3. Enregistrer audit
 * 
 * @param {object} subscription - Subscription Stripe
 * @param {object} context - Contexte
 * @throws {Error} Si organisation non trouvée
 */
async function handleSubscriptionDeleted(subscription, context = {}) {
  const customerId = subscription.customer;

  if (!customerId) {
    throw new Error("Customer ID is required");
  }

  // 1. Résoudre organisation
  const orgId = await resolveOrganisationFromCustomer(customerId);

  // 2. Appeler applyStripePlanUpdate
  await applyStripePlanUpdate({
    organisationId: orgId,
    planType: "free",
    status: "canceled",
  });

  // 3. Enregistrer audit
  await recordBusinessAudit({
    organisationId: orgId,
    actorUserId: null,
    action: "subscription_canceled_via_stripe",
    entityType: "organisation",
    entityId: orgId,
    details: {
      stripeSubscriptionId: subscription.id,
      stripeCustomerId: customerId,
    },
    req: null,
  });

  logger.info("Subscription deleted", {
    orgId,
    customerId,
    subscriptionId: subscription.id,
  });
}

/**
 * Processeur principal pour les événements Stripe.
 * 
 * @param {object} event - Événement Stripe
 * @param {object} context - Contexte optionnel
 * @returns {Promise<object>} Résultat du traitement
 */
async function processStripeEvent(event, context = {}) {
  if (!event || !event.type) {
    throw new Error("Invalid event: missing type");
  }

  logger.info("Processing Stripe event", {
    eventId: event.id,
    eventType: event.type,
  });

  let businessStep = "initialization";

  try {
    if (PAYMENT_RECONCILIATION_EVENTS.has(event.type)) {
      businessStep = "handle_payment_reconciliation";
      const result = await stripeReconciliationService.processWebhookEvent(event);
      return {
        handled: result.status !== "ignored",
        action: "payment_reconciliation",
        reconciliationStatus: result.status,
      };
    }

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        if (session.mode === "subscription") {
          businessStep = "handle_checkout_subscription";
          await handleCheckoutSessionCompletedSubscription(session, context);
        } else if (session.mode === "payment") {
          businessStep = "handle_checkout_payment";
          await handleCheckoutSessionCompletedPayment(session, context);
        }
        return { handled: true, action: "checkout_completed" };
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object;
        businessStep = "handle_subscription_updated";
        await handleSubscriptionUpdatedWrapper(subscription, context);
        return { handled: true, action: "subscription_updated" };
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        businessStep = "handle_subscription_deleted";
        await handleSubscriptionDeleted(subscription, context);
        return { handled: true, action: "subscription_deleted" };
      }

      default:
        // Événement non supporté mais valide
        logger.info("Unhandled event type", { eventType: event.type });
        return { handled: false, action: "ignored" };
    }
  } catch (err) {
    logger.error("Stripe handler failed", {
      eventType: event.type,
      businessStep,
      errorCode: err?.code || null,
      errorMessage: err?.message || null,
      errorName: err?.name || null,
      pgCode: err?.code || null,
      pgConstraint: err?.constraint || null,
      pgTable: err?.table || null,
      pgColumn: err?.column || null,
      pgDetail: process.env.NODE_ENV === "test" ? err?.detail || null : undefined,
      stack: process.env.NODE_ENV === "test" ? err?.stack : undefined,
    });
    throw err;
  }
}

module.exports = {
  processStripeEvent,
  resolveOrganisationFromCustomer,
  resolvePlanTypeFromSubscription,
  handleCheckoutSessionCompletedSubscription,
  handleCheckoutSessionCompletedPayment,
  handleSubscriptionUpdated,
  handleSubscriptionDeleted,
};
