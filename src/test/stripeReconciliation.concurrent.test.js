const db = require("../../db");
const service = require("../services/stripeReconciliation.service");
const { createTestOrganisation, createTestUser, createTestClient } = require("./helpers/testData");
const { deleteLedgerEntriesForTest } = require("./helpers/ledgerTestCleanup");

jest.setTimeout(45000);

async function createInvoice(organisationId, clientId) {
  const result = await db.query(
    `INSERT INTO invoices (
      organisation_id, client_id, invoice_number, status,
      issue_date, due_date, subtotal, tax_total, total
    ) VALUES ($1, $2, $3, 'sent', CURRENT_DATE,
      CURRENT_DATE + INTERVAL '15 days', 125, 0, 125)
    RETURNING *`,
    [organisationId, clientId, `INV-CONCURRENT-${Date.now()}-${Math.random()}`],
  );
  return result.rows[0];
}

describe("Stripe — rejeu concurrent P0", () => {
  test("20 livraisons identiques produisent un seul effet financier", async () => {
    const organisation = await createTestOrganisation();
    const admin = await createTestUser({ role: "admin", organisation_id: organisation.id });
    const customer = await createTestClient({ organisation_id: organisation.id });
    const invoice = await createInvoice(organisation.id, customer.id);
    const eventId = `evt_concurrent_${Date.now()}_${Math.random()}`;
    const event = {
      id: eventId,
      type: "payment_intent.succeeded",
      data: { object: {
        amount: 12500,
        currency: "cad",
        metadata: { invoice_id: String(invoice.id) },
      } },
    };

    try {
      const results = await Promise.all(
        Array.from({ length: 20 }, () => service.processWebhookEvent(event)),
      );

      expect(results.filter((r) => r.status === "success")).toHaveLength(1);
      expect(results.filter((r) => r.status === "duplicate")).toHaveLength(19);

      const counts = await db.query(
        `SELECT
          (SELECT status FROM invoices WHERE id = $1) AS invoice_status,
          (SELECT COUNT(*)::int FROM payment_events WHERE stripe_event_id = $2) AS payment_events,
          (SELECT COUNT(*)::int FROM ledger_entries
            WHERE organisation_id = $3 AND reference_type = 'stripe_webhook' AND reference_id = $2) AS ledger_entries,
          (SELECT COUNT(*)::int FROM business_audit_logs
            WHERE organisation_id = $3 AND action = 'invoice.paid_via_stripe_reconciliation'
              AND entity_id::text = $4) AS audits,
          (SELECT COUNT(*)::int FROM notifications
            WHERE organisation_id = $3 AND utilisateur_id = $5) AS notifications`,
        [invoice.id, eventId, organisation.id, String(invoice.id), admin.id],
      );

      expect(counts.rows[0]).toEqual({
        invoice_status: "paid",
        payment_events: 1,
        ledger_entries: 1,
        audits: 1,
        notifications: 1,
      });
    } finally {
      await db.query("DELETE FROM notifications WHERE organisation_id = $1", [organisation.id]);
      await db.query("DELETE FROM business_audit_logs WHERE organisation_id = $1", [organisation.id]);
      await deleteLedgerEntriesForTest(organisation.id);
      await db.query("DELETE FROM payment_events WHERE stripe_event_id = $1", [eventId]);
      await db.query("DELETE FROM invoices WHERE id = $1", [invoice.id]);
      await db.query("DELETE FROM utilisateurs WHERE id = $1", [admin.id]);
      await db.query("DELETE FROM clients WHERE id = $1", [customer.id]);
      await db.query("DELETE FROM organisations WHERE id = $1", [organisation.id]);
    }
  });
});
