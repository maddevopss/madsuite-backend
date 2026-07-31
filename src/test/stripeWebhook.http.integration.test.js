const request = require("supertest");

const app = require("../app");
const db = require("../../db");
const stripeService = require("../services/stripe.service");
const {
  createTestOrganisation,
  createTestUser,
  createTestClient,
} = require("./helpers/testData");
const { deleteLedgerEntriesForTest } = require("./helpers/ledgerTestCleanup");

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

function buildPaymentEvent({ eventId, invoiceId, amount = 12500, currency = "cad" }) {
  return {
    id: eventId,
    object: "event",
    type: "payment_intent.succeeded",
    data: {
      object: {
        id: `pi_${eventId}`,
        object: "payment_intent",
        amount,
        currency,
        metadata: {
          invoice_id: String(invoiceId),
        },
      },
    },
  };
}

function buildIgnoredEvent({ eventId }) {
  return {
    id: eventId,
    object: "event",
    type: "product.created",
    data: {
      object: {
        id: `prod_${eventId}`,
        object: "product",
      },
    },
  };
}

function signPayload(payload) {
  const stripe = stripeService.getStripe();
  return stripe.webhooks.generateTestHeaderString({
    payload,
    secret: webhookSecret,
  });
}

describe("Stripe webhook HTTP signé — preuve financière P0", () => {
  test("rejette une fausse signature", async () => {
    expect(webhookSecret).toBeTruthy();
    const stripe = stripeService.getStripe();
    expect(stripe).toBeTruthy();

    const organisation = await createTestOrganisation({
      nom: `Org Stripe HTTP ${Date.now()}`,
    });

    const rejectedEventId = `evt_http_rejected_${Date.now()}`;
    const rejectedPayload = JSON.stringify(
      buildPaymentEvent({
        eventId: rejectedEventId,
        invoiceId: 999999,
      }),
    );

    const rejectedResponse = await request(app)
      .post("/api/stripe/webhook")
      .set("Content-Type", "application/json")
      .set("stripe-signature", "t=1,v1=signature-invalide")
      .send(rejectedPayload);

    expect(rejectedResponse.status).toBe(400);

    const rejectedRows = await db.query(
      "SELECT COUNT(*)::int AS count FROM stripe_webhook_events WHERE stripe_event_id = $1",
      [rejectedEventId],
    );
    expect(rejectedRows.rows[0].count).toBe(0);

    await db.query("DELETE FROM organisations WHERE id = $1", [organisation.id]);
  });

  test("traite un événement signé et refuse les rejeux", async () => {
    expect(webhookSecret).toBeTruthy();
    const stripe = stripeService.getStripe();
    expect(stripe).toBeTruthy();

    const organisation = await createTestOrganisation({
      nom: `Org Stripe HTTP ${Date.now()}`,
    });

    const eventId = `evt_http_signed_${Date.now()}`;
    const payload = JSON.stringify(
      buildIgnoredEvent({
        eventId,
      }),
    );
    const signature = signPayload(payload);

    const firstResponse = await request(app)
      .post("/api/stripe/webhook")
      .set("Content-Type", "application/json")
      .set("stripe-signature", signature)
      .send(payload);

    expect(firstResponse.status).toBe(200);
    expect(firstResponse.body).toEqual({ received: true });

    const replayResponse = await request(app)
      .post("/api/stripe/webhook")
      .set("Content-Type", "application/json")
      .set("stripe-signature", signature)
      .send(payload);

    expect(replayResponse.status).toBe(200);
    expect(replayResponse.body).toEqual({ received: true, duplicate: true });

    const webhookEvents = await db.query(
      "SELECT COUNT(*)::int AS count FROM stripe_webhook_events WHERE stripe_event_id = $1",
      [eventId],
    );
    expect(webhookEvents.rows[0].count).toBe(1);

    await db.query("DELETE FROM stripe_webhook_events WHERE stripe_event_id = $1", [eventId]);
    await db.query("DELETE FROM organisations WHERE id = $1", [organisation.id]);
  });
});
