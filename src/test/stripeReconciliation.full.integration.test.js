const db = require("../../db");
const stripeReconciliationService = require("../services/stripeReconciliation.service");
const {
  createTestOrganisation,
  createTestUser,
  createTestClient,
} = require("./helpers/testData");
const { deleteLedgerEntriesForTest } = require("./helpers/ledgerTestCleanup");

jest.setTimeout(30000);

async function createInvoice({ organisationId, clientId, total = 125 }) {
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
      total,
      notes
    )
    VALUES (
      $1,
      $2,
      $3,
      'sent',
      CURRENT_DATE,
      CURRENT_DATE + INTERVAL '15 days',
      $4,
      0,
      $4,
      'Preuve de réconciliation financière P0'
    )
    RETURNING *
    `,
    [
      organisationId,
      clientId,
      `INV-RECON-${Date.now()}-${Math.random()}`,
      total,
    ],
  );

  return result.rows[0];
}

async function withOrganisationContext(organisationId, callback) {
  const client = await db.connect();

  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT set_config('app.current_organisation_id', $1, true)",
      [String(organisationId)],
    );

    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

describe("Réconciliation financière complète — PostgreSQL réel", () => {
  let organisation;
  let admin;
  let customer;
  let invoice;
  let stripeEventId;

  beforeEach(async () => {
    organisation = await createTestOrganisation({
      nom: `Org Reconciliation ${Date.now()} ${Math.random()}`,
    });
    admin = await createTestUser({
      role: "admin",
      organisation_id: organisation.id,
    });
    customer = await createTestClient({
      organisation_id: organisation.id,
      nom: `Client Reconciliation ${Date.now()}`,
    });
    invoice = await createInvoice({
      organisationId: organisation.id,
      clientId: customer.id,
      total: 125,
    });
    stripeEventId = `evt_full_reconciliation_${Date.now()}_${Math.random()}`;
  });

  afterEach(async () => {
    if (!organisation) return;

    await withOrganisationContext(organisation.id, async (client) => {
      await client.query(
        "DELETE FROM notifications WHERE organisation_id = $1",
        [organisation.id],
      );
      await client.query(
        "DELETE FROM business_audit_logs WHERE organisation_id = $1",
        [organisation.id],
      );
      await client.query(
        "DELETE FROM payment_events WHERE stripe_event_id = $1",
        [stripeEventId],
      );
      await client.query("DELETE FROM invoices WHERE id = $1", [invoice.id]);
      await client.query("DELETE FROM utilisateurs WHERE id = $1", [admin.id]);
      await client.query("DELETE FROM clients WHERE id = $1", [customer.id]);
    });

    await deleteLedgerEntriesForTest(organisation.id);
    await db.query("DELETE FROM organisations WHERE id = $1", [organisation.id]);
  });

  test("facture → paiement → ledger → audit reste cohérent et idempotent", async () => {
    const event = {
      id: stripeEventId,
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: `pi_${Date.now()}`,
          amount: 12500,
          currency: "cad",
          metadata: {
            invoice_id: String(invoice.id),
          },
        },
      },
    };

    const firstResult = await stripeReconciliationService.processWebhookEvent(event);
    expect(firstResult).toEqual({ status: "success", invoiceId: invoice.id });

    await withOrganisationContext(organisation.id, async (client) => {
      const invoiceResult = await client.query(
        "SELECT status FROM invoices WHERE id = $1",
        [invoice.id],
      );
      expect(invoiceResult.rows).toHaveLength(1);
      expect(invoiceResult.rows[0].status).toBe("paid");

      const paymentResult = await client.query(
        `
        SELECT stripe_event_id, type
        FROM payment_events
        WHERE stripe_event_id = $1
        `,
        [stripeEventId],
      );
      expect(paymentResult.rows).toHaveLength(1);
      expect(paymentResult.rows[0]).toEqual(
        expect.objectContaining({
          stripe_event_id: stripeEventId,
          type: "payment_intent.succeeded",
        }),
      );

      const ledgerResult = await client.query(
        `
        SELECT type, amount, LOWER(currency) AS currency, reference_type, reference_id
        FROM ledger_entries
        WHERE organisation_id = $1
          AND reference_type = 'stripe_webhook'
          AND reference_id = $2
        `,
        [organisation.id, stripeEventId],
      );
      expect(ledgerResult.rows).toHaveLength(1);
      expect(ledgerResult.rows[0]).toEqual(
        expect.objectContaining({
          type: "payment_received",
          currency: "cad",
          reference_type: "stripe_webhook",
          reference_id: stripeEventId,
        }),
      );
      expect(Number(ledgerResult.rows[0].amount)).toBe(125);

      const auditResult = await client.query(
        `
        SELECT action, entity_type, entity_id, details
        FROM business_audit_logs
        WHERE organisation_id = $1
          AND action = 'invoice.paid_via_stripe_reconciliation'
          AND entity_id::text = $2
        `,
        [organisation.id, String(invoice.id)],
      );
      expect(auditResult.rows).toHaveLength(1);
      expect(auditResult.rows[0].entity_type).toBe("invoice");
      expect(auditResult.rows[0].details).toEqual(
        expect.objectContaining({
          stripeEventId,
          amount: 125,
          currency: "cad",
          eventType: "payment_intent.succeeded",
        }),
      );

      const notificationResult = await client.query(
        `
        SELECT COUNT(*)::int AS count
        FROM notifications
        WHERE organisation_id = $1
          AND utilisateur_id = $2
        `,
        [organisation.id, admin.id],
      );
      expect(notificationResult.rows[0].count).toBe(1);
    });

    const replayResult = await stripeReconciliationService.processWebhookEvent(event);
    expect(replayResult).toEqual({ status: "duplicate" });

    await withOrganisationContext(organisation.id, async (client) => {
      const counts = await client.query(
        `
        SELECT
          (SELECT COUNT(*)::int FROM payment_events WHERE stripe_event_id = $1) AS payments,
          (
            SELECT COUNT(*)::int
            FROM ledger_entries
            WHERE organisation_id = $2
              AND reference_type = 'stripe_webhook'
              AND reference_id = $1
          ) AS ledger_entries,
          (
            SELECT COUNT(*)::int
            FROM business_audit_logs
            WHERE organisation_id = $2
              AND action = 'invoice.paid_via_stripe_reconciliation'
              AND entity_id::text = $3
          ) AS audits
        `,
        [stripeEventId, organisation.id, String(invoice.id)],
      );

      expect(counts.rows[0]).toEqual({
        payments: 1,
        ledger_entries: 1,
        audits: 1,
      });
    });
  });
});
