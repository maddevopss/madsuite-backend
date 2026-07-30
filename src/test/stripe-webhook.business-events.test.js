/**
 * stripe-webhook.business-events.test.js
 * 
 * Suite métier d'intégration pour les événements Stripe.
 * 
 * Valide :
 * - Vraie route Express
 * - Vraie signature Stripe
 * - Vraie base PostgreSQL
 * - Vraie idempotence
 * - Isolation multitenant
 * - Transactions
 * - Résolution d'organisation
 * - Résolution de plan
 * 
 * Aucun mock Stripe, aucun mock PostgreSQL.
 */

const TEST_STRIPE_KEY = "sk_test_dummy_key_for_tests_only";
const TEST_WEBHOOK_SECRET = "whsec_test_secret_12345";

// Définir les variables d'environnement AVANT de charger l'app
process.env.STRIPE_SECRET_KEY = TEST_STRIPE_KEY;
process.env.STRIPE_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;

const request = require("supertest");
const Stripe = require("stripe");
const { randomUUID } = require("crypto");
const db = require("../../db");
const app = require("../app");
const stripeWebhookEventService = require("../services/stripeWebhookEvent.service");
const stripeEventProcessor = require("../services/stripeEventProcessor.service");
const logger = require("../config/logger");

// Créer une instance Stripe réelle AVANT tout mock
const stripeForSigning = new Stripe(TEST_STRIPE_KEY);

// Utilitaires
function uniqueId(prefix) {
  return `${prefix}_test_${randomUUID()}`;
}

function createSignedPayload(event, secret = TEST_WEBHOOK_SECRET) {
  if (typeof secret !== "string" || secret.length === 0) {
    throw new Error("A Stripe webhook secret is required");
  }

  const payload = JSON.stringify(event);

  // Utiliser l'instance Stripe réelle pour générer la signature
  const signature = stripeForSigning.webhooks.generateTestHeaderString({
    payload,
    secret,
  });

  if (typeof signature !== "string" || signature.length === 0) {
    throw new Error("Stripe generated an invalid test signature");
  }

  return {
    payload,
    signature,
  };
}

describe("Stripe Webhook Business Events", () => {
  let testOrgId;
  let testOrgId2;
  let testUserId;

  beforeAll(async () => {
    // Créer les organisations de test
    const orgResult = await db.query(
      `INSERT INTO organisations (nom, plan_type, subscription_status)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [uniqueId("org"), "free", "inactive"]
    );
    testOrgId = orgResult.rows[0].id;
    
    const org2Result = await db.query(
      `INSERT INTO organisations (nom, plan_type, subscription_status)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [uniqueId("org"), "free", "inactive"]
    );
    testOrgId2 = org2Result.rows[0].id;
  });

  afterAll(async () => {
    // Nettoyer les données de test
    // Note: ledger_entries est append-only, donc on ne peut pas supprimer les organisations
    // Les données de test seront nettoyées par la suite de tests
  });

  describe("checkout.session.completed (subscription)", () => {
    it("doit activer un abonnement et mettre à jour l'organisation", async () => {
      const customerId = uniqueId("cus");
      const subscriptionId = uniqueId("sub");
      
      // Lier le customer à l'organisation
      await db.query(
        "UPDATE organisations SET stripe_customer_id = $1 WHERE id = $2",
        [customerId, testOrgId]
      );
      
      const event = {
        id: uniqueId("evt"),
        object: "event",
        type: "checkout.session.completed",
        data: {
          object: {
            id: uniqueId("cs"),
            mode: "subscription",
            customer: customerId,
            subscription: subscriptionId,
            payment_status: "paid",
            metadata: {
              organisation_id: String(testOrgId),
              plan_type: "pro",
            },
            subscription_details: {
              metadata: {
                plan_type: "pro",
              },
            },
          },
        },
      };
      
      const { payload, signature } = createSignedPayload(event);
      
      const res = await request(app)
        .post("/api/stripe/webhook")
        .set("stripe-signature", signature)
        .send(payload)
        .set("Content-Type", "application/json");
      
      expect(res.status).toBe(200);
      
      expect(res.body.received).toBe(true);
      
      // Vérifier que l'organisation a été mise à jour
      const orgResult = await db.query(
        "SELECT plan_type, subscription_status, stripe_subscription_id FROM organisations WHERE id = $1",
        [testOrgId]
      );
      
      const org = orgResult.rows[0];
      expect(org.plan_type).toBe("pro");
      expect(org.subscription_status).toBe("active");
      expect(org.stripe_subscription_id).toBe(subscriptionId);
      
      // Vérifier l'idempotence : renvoyer le même événement
      const res2 = await request(app)
        .post("/api/stripe/webhook")
        .set("stripe-signature", signature)
        .send(payload)
        .set("Content-Type", "application/json")
        .expect(200);
      
      expect(res2.body.received).toBe(true);
      expect(res2.body.duplicate).toBe(true);
      
      // Vérifier qu'aucun doublon n'a été créé
      const orgResult2 = await db.query(
        "SELECT plan_type, subscription_status, stripe_subscription_id FROM organisations WHERE id = $1",
        [testOrgId]
      );
      
      const org2 = orgResult2.rows[0];
      expect(org2.plan_type).toBe("pro");
      expect(org2.subscription_status).toBe("active");
      expect(org2.stripe_subscription_id).toBe(subscriptionId);
    });
  });

  describe("customer.subscription.updated", () => {
    it("doit mettre à jour le statut et le plan de l'abonnement", async () => {
      const customerId = uniqueId("cus");
      const subscriptionId = uniqueId("sub");
      
      // Lier le customer à l'organisation
      await db.query(
        "UPDATE organisations SET stripe_customer_id = $1, stripe_subscription_id = $2, plan_type = $3, subscription_status = $4 WHERE id = $5",
        [customerId, subscriptionId, "pro", "active", testOrgId]
      );
      
      const event = {
        id: uniqueId("evt"),
        object: "event",
        type: "customer.subscription.updated",
        data: {
          object: {
            id: subscriptionId,
            customer: customerId,
            status: "past_due",
            metadata: {
              plan_type: "enterprise",
            },
          },
        },
      };
      
      const { payload, signature } = createSignedPayload(event);
      
      const res = await request(app)
        .post("/api/stripe/webhook")
        .set("stripe-signature", signature)
        .send(payload)
        .set("Content-Type", "application/json");
      
      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);
      
      // Vérifier que l'organisation a été mise à jour
      const orgResult = await db.query(
        "SELECT plan_type, subscription_status FROM organisations WHERE id = $1",
        [testOrgId]
      );
      
      const org = orgResult.rows[0];
      expect(org.plan_type).toBe("enterprise");
      expect(org.subscription_status).toBe("past_due");
    });
  });

  describe("Plan inconnu", () => {
    it("doit refuser un plan inconnu sans élévation de privilège", async () => {
      const customerId = uniqueId("cus");
      const subscriptionId = uniqueId("sub");
      const previousPlan = "pro";
      
      // Lier le customer à l'organisation
      await db.query(
        "UPDATE organisations SET stripe_customer_id = $1, stripe_subscription_id = $2, plan_type = $3, subscription_status = $4 WHERE id = $5",
        [customerId, subscriptionId, previousPlan, "active", testOrgId]
      );
      
      const event = {
        id: uniqueId("evt"),
        object: "event",
        type: "customer.subscription.updated",
        data: {
          object: {
            id: subscriptionId,
            customer: customerId,
            status: "active",
            metadata: {
              plan_type: "unknown_plan",
            },
          },
        },
      };
      
      const { payload, signature } = createSignedPayload(event);
      
      const res = await request(app)
        .post("/api/stripe/webhook")
        .set("stripe-signature", signature)
        .send(payload)
        .set("Content-Type", "application/json");
      
      expect(res.status).toBe(500);
      
      // Vérifier que le plan n'a pas changé
      const orgResult = await db.query(
        "SELECT plan_type FROM organisations WHERE id = $1",
        [testOrgId]
      );
      
      const org = orgResult.rows[0];
      expect(org.plan_type).toBe(previousPlan);
    });
  });

  describe("Conflit d'organisation", () => {
    it("doit refuser un conflit entre association locale et métadonnées", async () => {
      const customerId = uniqueId("cus");
      const subscriptionId = uniqueId("sub");
      
      // Lier le customer à l'organisation 1
      await db.query(
        "UPDATE organisations SET stripe_customer_id = $1, stripe_subscription_id = $2 WHERE id = $3",
        [customerId, subscriptionId, testOrgId]
      );
      
      const event = {
        id: uniqueId("evt"),
        object: "event",
        type: "customer.subscription.updated",
        data: {
          object: {
            id: subscriptionId,
            customer: customerId,
            status: "active",
            metadata: {
              organisation_id: String(testOrgId2), // Conflit !
              plan_type: "pro",
            },
          },
        },
      };
      
      const { payload, signature } = createSignedPayload(event);
      
      const res = await request(app)
        .post("/api/stripe/webhook")
        .set("stripe-signature", signature)
        .send(payload)
        .set("Content-Type", "application/json");
      
      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);
      
      // Vérifier que l'organisation 1 reste associée
      const orgResult = await db.query(
        "SELECT stripe_customer_id FROM organisations WHERE id = $1",
        [testOrgId]
      );
      
      const org = orgResult.rows[0];
      expect(org.stripe_customer_id).toBe(customerId);
      
      // Vérifier que l'organisation 2 n'a pas été modifiée
      const org2Result = await db.query(
        "SELECT stripe_customer_id FROM organisations WHERE id = $1",
        [testOrgId2]
      );
      
      const org2 = org2Result.rows[0];
      expect(org2.stripe_customer_id).toBeNull();
    });
  });

  describe("customer.subscription.deleted", () => {
    it("doit annuler l'abonnement et passer au plan gratuit", async () => {
      const customerId = uniqueId("cus");
      const subscriptionId = uniqueId("sub");
      
      // Lier le customer à l'organisation
      await db.query(
        "UPDATE organisations SET stripe_customer_id = $1, stripe_subscription_id = $2, plan_type = $3, subscription_status = $4 WHERE id = $5",
        [customerId, subscriptionId, "pro", "active", testOrgId]
      );
      
      const event = {
        id: uniqueId("evt"),
        object: "event",
        type: "customer.subscription.deleted",
        data: {
          object: {
            id: subscriptionId,
            customer: customerId,
            status: "canceled",
          },
        },
      };
      
      const { payload, signature } = createSignedPayload(event);
      
      const res = await request(app)
        .post("/api/stripe/webhook")
        .set("stripe-signature", signature)
        .send(payload)
        .set("Content-Type", "application/json");
      
      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);
      
      // Vérifier que l'organisation a été mise à jour
      const orgResult = await db.query(
        "SELECT plan_type, subscription_status FROM organisations WHERE id = $1",
        [testOrgId]
      );
      
      const org = orgResult.rows[0];
      expect(org.plan_type).toBe("free");
      expect(org.subscription_status).toBe("canceled");
    });
  });

  describe("Événement inconnu", () => {
    it("doit ignorer un événement inconnu de manière sûre", async () => {
      const event = {
        id: uniqueId("evt"),
        object: "event",
        type: "mad.test.unknown",
        data: {
          object: {},
        },
      };
      
      const { payload, signature } = createSignedPayload(event);
      
      const res = await request(app)
        .post("/api/stripe/webhook")
        .set("stripe-signature", signature)
        .send(payload)
        .set("Content-Type", "application/json");
      
      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);
    });
  });

   describe("checkout.session.completed (payment)", () => {
     it("doit enregistrer un paiement de facture", async () => {
       // Créer un client de test
       const clientResult = await db.query(
         `INSERT INTO clients (organisation_id, nom, email)
          VALUES ($1, $2, $3)
          RETURNING id`,
         [testOrgId, `Client Stripe Test ${uniqueId("cli")}`, `stripe-test-${uniqueId("cli")}@example.test`]
       );
       const clientId = clientResult.rows[0].id;
       
       // Créer une facture de test
       const invResult = await db.query(
         `INSERT INTO invoices (organisation_id, client_id, status, total, created_at, updated_at)
          VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          RETURNING id`,
         [testOrgId, clientId, "sent", 100.00]
       );
       const invoiceId = invResult.rows[0].id;
      
      const event = {
        id: uniqueId("evt"),
        object: "event",
        type: "checkout.session.completed",
        data: {
          object: {
            id: uniqueId("cs"),
            mode: "payment",
            client_reference_id: `INV_${invoiceId}`,
            amount_total: 10000, // 100.00 CAD en cents
            currency: "cad",
          },
        },
      };
      
      const { payload, signature } = createSignedPayload(event);
      
      const res = await request(app)
        .post("/api/stripe/webhook")
        .set("stripe-signature", signature)
        .send(payload)
        .set("Content-Type", "application/json");
      
      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);
      
      // Vérifier que la facture a été marquée comme payée
      const invCheckResult = await db.query(
        "SELECT status FROM invoices WHERE id = $1",
        [invoiceId]
      );
      
      const inv = invCheckResult.rows[0];
      expect(inv.status).toBe("paid");
      
      // Nettoyer
      await db.query("DELETE FROM invoices WHERE id = $1", [invoiceId]);
    });
  });

  describe("invoice.paid", () => {
    it("doit enregistrer un paiement de facture via invoice.paid", async () => {
      // Créer un client de test
      const clientResult = await db.query(
        `INSERT INTO clients (organisation_id, nom, email)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [testOrgId, `Client Stripe Test ${uniqueId("cli")}`, `stripe-test-${uniqueId("cli")}@example.test`]
      );
      const clientId = clientResult.rows[0].id;
      
      // Créer une facture de test
      const invResult = await db.query(
        `INSERT INTO invoices (organisation_id, client_id, status, total, created_at, updated_at)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         RETURNING id`,
        [testOrgId, clientId, "sent", 50.00]
      );
      const invoiceId = invResult.rows[0].id;
      
      const event = {
        id: uniqueId("evt"),
        object: "event",
        type: "invoice.paid",
        data: {
          object: {
            id: uniqueId("inv"),
            customer: uniqueId("cus"),
            amount_paid: 5000, // 50.00 CAD en cents
            currency: "cad",
            metadata: {
              invoice_id: String(invoiceId),
            },
          },
        },
      };
      
      const { payload, signature } = createSignedPayload(event);
      
      const res = await request(app)
        .post("/api/stripe/webhook")
        .set("stripe-signature", signature)
        .send(payload)
        .set("Content-Type", "application/json");
      
      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);
      
      // Nettoyer
      await db.query("DELETE FROM invoices WHERE id = $1", [invoiceId]);
    });
  });

  describe("invoice.payment_failed", () => {
    it("doit enregistrer un échec de paiement de facture", async () => {
      // Créer un client de test
      const clientResult = await db.query(
        `INSERT INTO clients (organisation_id, nom, email)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [testOrgId, `Client Stripe Test ${uniqueId("cli")}`, `stripe-test-${uniqueId("cli")}@example.test`]
      );
      const clientId = clientResult.rows[0].id;
      
      // Créer une facture de test
      const invResult = await db.query(
        `INSERT INTO invoices (organisation_id, client_id, status, total, created_at, updated_at)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         RETURNING id`,
        [testOrgId, clientId, "sent", 75.00]
      );
      const invoiceId = invResult.rows[0].id;
      
      const event = {
        id: uniqueId("evt"),
        object: "event",
        type: "invoice.payment_failed",
        data: {
          object: {
            id: uniqueId("inv"),
            customer: uniqueId("cus"),
            amount_due: 7500, // 75.00 CAD en cents
            currency: "cad",
            metadata: {
              invoice_id: String(invoiceId),
            },
          },
        },
      };
      
      const { payload, signature } = createSignedPayload(event);
      
      const res = await request(app)
        .post("/api/stripe/webhook")
        .set("stripe-signature", signature)
        .send(payload)
        .set("Content-Type", "application/json");
      
      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);
      
      // Nettoyer
      await db.query("DELETE FROM invoices WHERE id = $1", [invoiceId]);
    });
  });
});
