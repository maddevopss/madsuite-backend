const db = require("../../db");
const stripeReconciliationService = require("../services/stripeReconciliation.service");
const { getBillingDashboard } = require("../services/billingDashboard.service");
const { createTestOrganisation, createTestUser, createTestClient } = require("./helpers/testData");

jest.setTimeout(45000);

async function createInvoice(organisationId, clientId) {
  const result = await db.query(
    `INSERT INTO invoices (
      organisation_id, client_id, invoice_number, status,
      issue_date, due_date, subtotal, tax_total, total
    ) VALUES ($1, $2, $3, 'sent', CURRENT_DATE,
      CURRENT_DATE + INTERVAL '15 days', 125, 0, 125)
    RETURNING *`,
    [organisationId, clientId, `INV-DASHBOARD-${Date.now()}-${Math.random()}`],
  );
  return result.rows[0];
}

describe("Dashboard facturation — vérité après paiement P0", () => {
  test("le paiement déplace exactement 125 CAD de sent vers paid sans double comptage au rejeu", async () => {
    const organisation = await createTestOrganisation();
    const admin = await createTestUser({ role: "admin", organisation_id: organisation.id });
    const customer = await createTestClient({ organisation_id: organisation.id });
    const invoice = await createInvoice(organisation.id, customer.id);
    const eventId = `evt_dashboard_${Date.now()}_${Math.random()}`;
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
      const before = await getBillingDashboard({
        organisationId: organisation.id,
        userId: admin.id,
        role: "admin",
      });

      expect(before.total_paid_this_month).toBe(0);
      expect(before.invoice_status.sent).toEqual({ count: 1, total: 125 });

      expect(await stripeReconciliationService.processWebhookEvent(event)).toEqual({
        status: "success",
        invoiceId: invoice.id,
      });

      const after = await getBillingDashboard({
        organisationId: organisation.id,
        userId: admin.id,
        role: "admin",
      });

      expect(after.total_invoiced_this_month).toBe(125);
      expect(after.total_paid_this_month).toBe(125);
      expect(after.invoice_status.paid).toEqual({ count: 1, total: 125 });
      expect(after.invoice_status.sent).toBeUndefined();
      expect(after.overdue_count).toBe(0);

      expect(await stripeReconciliationService.processWebhookEvent(event)).toEqual({
        status: "duplicate",
      });

      const afterReplay = await getBillingDashboard({
        organisationId: organisation.id,
        userId: admin.id,
        role: "admin",
      });

      expect(afterReplay.total_paid_this_month).toBe(125);
      expect(afterReplay.invoice_status.paid).toEqual({ count: 1, total: 125 });
    } finally {
      await db.query("DELETE FROM notifications WHERE organisation_id = $1", [organisation.id]);
      await db.query("DELETE FROM business_audit_logs WHERE organisation_id = $1", [organisation.id]);
      await db.query("DELETE FROM ledger_entries WHERE organisation_id = $1", [organisation.id]);
      await db.query("DELETE FROM payment_events WHERE stripe_event_id = $1", [eventId]);
      await db.query("DELETE FROM invoices WHERE id = $1", [invoice.id]);
      await db.query("DELETE FROM utilisateurs WHERE id = $1", [admin.id]);
      await db.query("DELETE FROM clients WHERE id = $1", [customer.id]);
      await db.query("DELETE FROM organisations WHERE id = $1", [organisation.id]);
    }
  });
});
