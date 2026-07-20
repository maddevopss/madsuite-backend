const db = require("../../db");
const stripeReconciliationService = require("../services/stripeReconciliation.service");
const {
  createTestOrganisation,
  createTestUser,
  createTestClient,
} = require("./helpers/testData");

const CONCURRENT_REPLAYS = 20;

async function createInvoice({ organisationId, clientId, invoiceNumber }) {
  const result = await db.query(
    `
      INSERT INTO invoices (
        organisation_id,
        client_id,
        invoice_number,
        status,
        issue_date,
        due_date,
        subtotal,
        tax_total,
        total
      )
      VALUES ($1, $2, $3, 'sent', CURRENT_DATE, CURRENT_DATE + INTERVAL '15 days', 125, 0, 125)
      RETURNING *
    `,
    [organisationId, clientId, invoiceNumber],
  );

  return result.rows[0];
}

function makeSuccessEvent(invoiceId) {
  return {
    id: `evt_concurrent_replay_${invoiceId}`,
    type: "payment_intent.succeeded",
    data: {
      object: {
        id: `pi_concurrent_replay_${invoiceId}`,
        amount: 12500,
        currency: "cad",
        metadata: {
          invoice_id: String(invoiceId),
        },
      },
    },
  };
}

describe("P0 — rejeu concurrent massif d'un webhook Stripe", () => {
  test("vingt traitements simultanés produisent exactement un effet financier", async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const organisation = await createTestOrganisation({ nom: `Org concurrence ${suffix}` });
    const admin = await createTestUser({
      nom: `Admin concurrence ${suffix}`,
      role: "admin",
      organisation_id: organisation.id,
    });
    const client = await createTestClient({
      nom: `Client concurrence ${suffix}`,
      organisation_id: organisation.id,
    });
    const invoice = await createInvoice({
      organisationId: organisation.id,
      clientId: client.id,
      invoiceNumber: `INV-CONCURRENT-${suffix}`,
    });
    const event = makeSuccessEvent(invoice.id);

    const results = await Promise.all(
      Array.from({ length: CONCURRENT_REPLAYS }, () =>
        stripeReconciliationService.processWebhookEvent(event)),
    );

    const statuses = results.map((result) => result.status);
    expect(statuses.filter((status) => status === "success")).toHaveLength(1);
    expect(statuses.filter((status) => status === "duplicate")).toHaveLength(
      CONCURRENT_REPLAYS - 1,
    );

    const [invoiceState, paymentEvents, ledgerEntries, auditLogs, notifications] = await Promise.all([
      db.query("SELECT status FROM invoices WHERE id = $1", [invoice.id]),
      db.query(
        `SELECT stripe_event_id, type
         FROM payment_events
         WHERE stripe_event_id = $1`,
        [event.id],
      ),
      db.query(
        `SELECT type, amount, currency, reference_id
         FROM ledger_entries
         WHERE reference_type = 'stripe_webhook'
           AND reference_id = $1`,
        [event.id],
      ),
      db.query(
        `SELECT action, details
         FROM business_audit_logs
         WHERE entity_type = 'invoice'
           AND entity_id = $1
           AND action = 'invoice.paid_via_stripe_reconciliation'`,
        [invoice.id],
      ),
      db.query(
        `SELECT utilisateur_id, type, message
         FROM notifications
         WHERE organisation_id = $1
           AND utilisateur_id = $2
           AND message LIKE $3`,
        [organisation.id, admin.id, `%${invoice.invoice_number}%`],
      ),
    ]);

    expect(invoiceState.rows[0].status).toBe("paid");

    expect(paymentEvents.rows).toEqual([
      {
        stripe_event_id: event.id,
        type: event.type,
      },
    ]);

    expect(ledgerEntries).toHaveLength(1);
    expect(ledgerEntries.rows[0]).toMatchObject({
      type: "payment_received",
      currency: "cad",
      reference_id: event.id,
    });
    expect(Number(ledgerEntries.rows[0].amount)).toBe(125);

    expect(auditLogs).toHaveLength(1);
    expect(auditLogs.rows[0].details).toMatchObject({
      stripeEventId: event.id,
      amount: 125,
      currency: "cad",
      eventType: event.type,
    });

    expect(notifications).toHaveLength(1);
    expect(notifications.rows[0]).toMatchObject({
      utilisateur_id: admin.id,
      type: "info",
    });
  }, 30000);
});
