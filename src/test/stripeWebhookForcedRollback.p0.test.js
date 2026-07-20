const db = require("../../db");
const stripeReconciliationService = require("../services/stripeReconciliation.service");
const {
  createTestOrganisation,
  createTestClient,
} = require("./helpers/testData");

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
    id: `evt_forced_rollback_${invoiceId}`,
    type: "payment_intent.succeeded",
    data: {
      object: {
        id: `pi_forced_rollback_${invoiceId}`,
        amount: 12500,
        currency: "cad",
        metadata: {
          invoice_id: String(invoiceId),
        },
      },
    },
  };
}

describe("P0 — rollback forcé après réception d'un webhook Stripe", () => {
  test("une panne injectée après le ledger ne laisse aucun état financier partiel", async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const organisation = await createTestOrganisation({ nom: `Org rollback ${suffix}` });
    const client = await createTestClient({
      nom: `Client rollback ${suffix}`,
      organisation_id: organisation.id,
    });
    const invoice = await createInvoice({
      organisationId: organisation.id,
      clientId: client.id,
      invoiceNumber: `INV-ROLLBACK-${suffix}`,
    });
    const event = makeSuccessEvent(invoice.id);
    const injectedError = new Error("MADPROOF_FORCED_FAILURE_AFTER_LEDGER");

    await expect(
      stripeReconciliationService.processWebhookEvent(event, {
        afterLedgerEntry: async () => {
          throw injectedError;
        },
      }),
    ).rejects.toThrow(injectedError.message);

    const [invoiceState, paymentEvents, ledgerEntries, auditLogs, notifications] = await Promise.all([
      db.query("SELECT status FROM invoices WHERE id = $1", [invoice.id]),
      db.query("SELECT id FROM payment_events WHERE stripe_event_id = $1", [event.id]),
      db.query(
        `SELECT id
         FROM ledger_entries
         WHERE reference_type = 'stripe_webhook'
           AND reference_id = $1`,
        [event.id],
      ),
      db.query(
        `SELECT id
         FROM business_audit_logs
         WHERE entity_type = 'invoice'
           AND entity_id = $1
           AND action = 'invoice.paid_via_stripe_reconciliation'`,
        [invoice.id],
      ),
      db.query(
        `SELECT id
         FROM notifications
         WHERE organisation_id = $1
           AND message LIKE $2`,
        [organisation.id, `%${invoice.invoice_number}%`],
      ),
    ]);

    expect(invoiceState.rows[0].status).toBe("sent");
    expect(paymentEvents.rowCount).toBe(0);
    expect(ledgerEntries.rowCount).toBe(0);
    expect(auditLogs.rowCount).toBe(0);
    expect(notifications.rowCount).toBe(0);
  });
});
