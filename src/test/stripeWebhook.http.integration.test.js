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

function signPayload(payload) {
  return stripeService.stripe.webhooks.generateTestHeaderString({
    payload,
    secret: webhookSecret,
  });
}

describe("Stripe webhook HTTP signé — preuve financière P0", () => {
  test("rejette une fausse signature puis réconcilie exactement une fois un événement signé", async () => {
    expect(webhookSecret).toBeTruthy();
    expect(stripeService.stripe).toBeTruthy();

    const organisation = await createTestOrganisation({
      nom: `Org Stripe HTTP ${Date.now()}`,
    });
    const admin = await createTestUser({
      organisation_id: organisation.id,
      role: "admin",
    });
    const client = await createTestClient({
      organisation_id: organisation.id,
      nom: `Client Stripe HTTP ${Date.now()}`,
    });

    const invoiceResult = await db.query(
      `
      INSERT INTO invoices
        (organisation_id, client_id, invoice_number, status, issue_date, due_date, subtotal, tax_total, total, notes)
      VALUES
        ($1, $2, $3, 'sent', CURRENT_DATE, CURRENT_DATE + INTERVAL '15 days', 125, 0, 125, NULL)
      RETURNING *
      `,
      [organisation.id, client.id, `INV-HTTP-${Date.now()}`],
    );
    const invoice = invoiceResult.rows[0];

    const rejectedEventId = `evt_http_rejected_${Date.now()}`;
    const rejectedPayload = JSON.stringify(
      buildPaymentEvent({
        eventId: rejectedEventId,
        invoiceId: invoice.id,
      }),
    );

    const rejectedResponse = await request(app)
      .post("/api/stripe/webhook")
      .set("Content-Type", "application/json")
      .set("stripe-signature", "t=1,v1=signature-invalide")
      .send(rejectedPayload);

    expect(rejectedResponse.status).toBe(400);

    const rejectedRows = await db.query(
      "SELECT COUNT(*)::int AS count FROM payment_events WHERE stripe_event_id = $1",
      [rejectedEventId],
    );
    expect(rejectedRows.rows[0].count).toBe(0);

    const eventId = `evt_http_signed_${Date.now()}`;
    const payload = JSON.stringify(
      buildPaymentEvent({
        eventId,
        invoiceId: invoice.id,
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
    expect(replayResponse.body).toEqual({ received: true });

    const invoiceState = await db.query(
      "SELECT status FROM invoices WHERE id = $1",
      [invoice.id],
    );
    expect(invoiceState.rows[0].status).toBe("paid");

    const paymentEvents = await db.query(
      "SELECT COUNT(*)::int AS count FROM payment_events WHERE stripe_event_id = $1",
      [eventId],
    );
    expect(paymentEvents.rows[0].count).toBe(1);

    const ledgerEntries = await db.query(
      `
      SELECT COUNT(*)::int AS count
      FROM ledger_entries
      WHERE reference_type = 'stripe_webhook'
        AND reference_id = $1
        AND type = 'payment_received'
        AND amount = 125
        AND LOWER(currency) = 'cad'
      `,
      [eventId],
    );
    expect(ledgerEntries.rows[0].count).toBe(1);

    const auditEntries = await db.query(
      `
      SELECT COUNT(*)::int AS count
      FROM business_audit_logs
      WHERE organisation_id = $1
        AND action = 'invoice.paid_via_stripe_reconciliation'
        AND entity_type = 'invoice'
        AND entity_id = $2
        AND details->>'stripeEventId' = $3
      `,
      [organisation.id, String(invoice.id), eventId],
    );
    expect(auditEntries.rows[0].count).toBe(1);

    const notifications = await db.query(
      `
      SELECT COUNT(*)::int AS count
      FROM notifications
      WHERE organisation_id = $1
        AND utilisateur_id = $2
        AND message LIKE $3
      `,
      [organisation.id, admin.id, `%${invoice.invoice_number}%`],
    );
    expect(notifications.rows[0].count).toBe(1);

    await db.query("DELETE FROM notifications WHERE organisation_id = $1", [organisation.id]);
    await db.query("DELETE FROM business_audit_logs WHERE organisation_id = $1", [organisation.id]);
    await deleteLedgerEntriesForTest(organisation.id);
    await db.query("DELETE FROM payment_events WHERE stripe_event_id = ANY($1::text[])", [
      [eventId, rejectedEventId],
    ]);
    await db.query("DELETE FROM invoices WHERE id = $1", [invoice.id]);
    await db.query("DELETE FROM utilisateurs WHERE id = $1", [admin.id]);
    await db.query("DELETE FROM clients WHERE id = $1", [client.id]);
    await db.query("DELETE FROM organisations WHERE id = $1", [organisation.id]);
  });
});
