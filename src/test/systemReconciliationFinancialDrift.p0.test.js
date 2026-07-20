const db = require("../../db");
const { runSystemReconciliation } = require("../jobs/systemReconciliationJob");
const {
  createTestOrganisation,
  createTestClient,
} = require("./helpers/testData");

async function createPaidInvoiceWithoutPayment({ organisationId, clientId, invoiceNumber }) {
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
      VALUES ($1, $2, $3, 'paid', CURRENT_DATE, CURRENT_DATE + INTERVAL '15 days', 210, 0, 210)
      RETURNING *
    `,
    [organisationId, clientId, invoiceNumber],
  );

  return result.rows[0];
}

describe("P0 — détection d'une divergence financière par le moteur de réconciliation", () => {
  test("une facture payée sans événement Stripe ni ledger est signalée sans réparation silencieuse", async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const organisation = await createTestOrganisation({ nom: `Org drift ${suffix}` });
    const client = await createTestClient({
      nom: `Client drift ${suffix}`,
      organisation_id: organisation.id,
    });
    const invoice = await createPaidInvoiceWithoutPayment({
      organisationId: organisation.id,
      clientId: client.id,
      invoiceNumber: `INV-DRIFT-${suffix}`,
    });

    const before = await db.query(
      `SELECT COUNT(*)::int AS count
       FROM system_consistency_logs
       WHERE invariant_name = 'system_integrity_report'`,
    );

    const result = await runSystemReconciliation();

    const anomaly = result.report.anomalies.find(
      (item) => item.classification === "DATA_DRIFT"
        && Number(item.reference_id) === Number(invoice.id)
        && Number(item.organisation_id) === Number(organisation.id),
    );

    expect(result.report.total_anomalies).toBeGreaterThan(0);
    expect(result.report.score).toBeLessThan(100);
    expect(anomaly).toEqual(expect.objectContaining({
      classification: "DATA_DRIFT",
      expected: "successful_payment_with_ledger",
      actual: "missing_payment_or_ledger",
    }));

    const after = await db.query(
      `SELECT status, details
       FROM system_consistency_logs
       WHERE invariant_name = 'system_integrity_report'
       ORDER BY id DESC
       LIMIT 1`,
    );

    expect(after.rowCount).toBe(1);
    expect(after.rows[0].status).toBe("FAIL");
    expect(after.rows[0].details.anomalies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          classification: "DATA_DRIFT",
          reference_id: invoice.id,
          organisation_id: organisation.id,
        }),
      ]),
    );

    const logCount = await db.query(
      `SELECT COUNT(*)::int AS count
       FROM system_consistency_logs
       WHERE invariant_name = 'system_integrity_report'`,
    );
    expect(logCount.rows[0].count).toBe(before.rows[0].count + 1);

    const [invoiceState, paymentEvents, ledgerEntries] = await Promise.all([
      db.query("SELECT status FROM invoices WHERE id = $1", [invoice.id]),
      db.query("SELECT id FROM payment_events WHERE invoice_id = $1", [invoice.id]),
      db.query(
        `SELECT le.id
         FROM ledger_entries le
         JOIN payment_events pe ON pe.stripe_event_id = le.reference_id
         WHERE pe.invoice_id = $1
           AND le.reference_type = 'stripe_webhook'`,
        [invoice.id],
      ),
    ]);

    expect(invoiceState.rows[0].status).toBe("paid");
    expect(paymentEvents.rowCount).toBe(0);
    expect(ledgerEntries.rowCount).toBe(0);
  }, 15000);
});
