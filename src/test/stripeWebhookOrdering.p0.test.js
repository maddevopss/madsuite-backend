const db = require("../../db");
const stripeReconciliationService = require("../services/stripeReconciliation.service");
const {
  createTestOrganisation,
  createTestClient,
} = require("./helpers/testData");

function makeStripeEvent({ id, type, invoiceId, amount = 12500, currency = "cad" }) {
  return {
    id,
    type,
    data: {
      object: {
        id: `pi_${id}`,
        amount,
        currency,
        metadata: {
          invoice_id: String(invoiceId),
        },
      },
    },
  };
}

async function createInvoice({ organisationId, clientId, invoiceNumber, status = "sent" }) {
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
      VALUES ($1, $2, $3, $4, CURRENT_DATE, CURRENT_DATE + INTERVAL '15 days', 125, 0, 125)
      RETURNING *
    `,
    [organisationId, clientId, invoiceNumber, status],
  );

  return result.rows[0];
}

async function readFinancialState(invoiceId) {
  const [invoice, events, ledger, audits] = await Promise.all([
    db.query("SELECT id, status FROM invoices WHERE id = $1", [invoiceId]),
    db.query(
      "SELECT stripe_event_id, type FROM payment_events WHERE invoice_id = $1 ORDER BY stripe_event_id",
      [invoiceId],
    ),
    db.query(
      `
        SELECT type, amount, currency, reference_id
        FROM ledger_entries
        WHERE reference_type = 'stripe_webhook'
          AND reference_id IN (
            SELECT stripe_event_id FROM payment_events WHERE invoice_id = $1
          )
        ORDER BY reference_id
      `,
      [invoiceId],
    ),
    db.query(
      `
        SELECT action, details
        FROM business_audit_logs
        WHERE entity_type = 'invoice'
          AND entity_id = $1
        ORDER BY id
      `,
      [invoiceId],
    ),
  ]);

  return {
    invoice: invoice.rows[0],
    events: events.rows,
    ledger: ledger.rows,
    audits: audits.rows,
  };
}

describe("P0 — webhooks Stripe reçus hors ordre", () => {
  const organisationIds = [];
  const clientIds = [];
  const invoiceIds = [];

  afterAll(async () => {
    if (invoiceIds.length) {
      await db.query("DELETE FROM notifications WHERE organisation_id = ANY($1)", [organisationIds]);
      await db.query(
        "DELETE FROM business_audit_logs WHERE entity_type = 'invoice' AND entity_id = ANY($1)",
        [invoiceIds],
      );
      await db.query(
        `DELETE FROM ledger_entries
         WHERE reference_type = 'stripe_webhook'
           AND reference_id IN (
             SELECT stripe_event_id FROM payment_events WHERE invoice_id = ANY($1)
           )`,
        [invoiceIds],
      );
      await db.query("DELETE FROM payment_events WHERE invoice_id = ANY($1)", [invoiceIds]);
      await db.query("DELETE FROM invoices WHERE id = ANY($1)", [invoiceIds]);
    }
    if (clientIds.length) {
      await db.query("DELETE FROM clients WHERE id = ANY($1)", [clientIds]);
    }
    if (organisationIds.length) {
      await db.query("DELETE FROM organisations WHERE id = ANY($1)", [organisationIds]);
    }
  });

  async function fixture(label) {
    const suffix = `${Date.now()}-${Math.random()}`;
    const organisation = await createTestOrganisation({ nom: `Org ${label} ${suffix}` });
    const client = await createTestClient({
      nom: `Client ${label} ${suffix}`,
      organisation_id: organisation.id,
    });
    const invoice = await createInvoice({
      organisationId: organisation.id,
      clientId: client.id,
      invoiceNumber: `INV-${label}-${suffix}`,
    });

    organisationIds.push(organisation.id);
    clientIds.push(client.id);
    invoiceIds.push(invoice.id);

    return { organisation, client, invoice };
  }

  test("un échec tardif ne rétrograde jamais une facture déjà payée", async () => {
    const { invoice } = await fixture("SUCCESS-THEN-FAILURE");
    const successEvent = makeStripeEvent({
      id: `evt_success_${invoice.id}`,
      type: "payment_intent.succeeded",
      invoiceId: invoice.id,
    });
    const lateFailureEvent = makeStripeEvent({
      id: `evt_late_failure_${invoice.id}`,
      type: "payment_intent.payment_failed",
      invoiceId: invoice.id,
    });

    await expect(stripeReconciliationService.processWebhookEvent(successEvent)).resolves.toMatchObject({
      status: "success",
      invoiceId: invoice.id,
    });
    await expect(stripeReconciliationService.processWebhookEvent(lateFailureEvent)).resolves.toMatchObject({
      status: "stale_failure",
      invoiceId: invoice.id,
    });

    const state = await readFinancialState(invoice.id);

    expect(state.invoice.status).toBe("paid");
    expect(state.events).toEqual([
      { stripe_event_id: lateFailureEvent.id, type: lateFailureEvent.type },
      { stripe_event_id: successEvent.id, type: successEvent.type },
    ]);
    expect(state.ledger).toHaveLength(1);
    expect(state.ledger[0]).toMatchObject({
      type: "payment_received",
      currency: "cad",
      reference_id: successEvent.id,
    });
    expect(Number(state.ledger[0].amount)).toBe(125);
    expect(state.audits.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        "invoice.paid_via_stripe_reconciliation",
        "payment.failure_received_after_success",
      ]),
    );
  });

  test("un échec initial n'empêche pas un succès valide ultérieur", async () => {
    const { invoice } = await fixture("FAILURE-THEN-SUCCESS");
    const failureEvent = makeStripeEvent({
      id: `evt_failure_${invoice.id}`,
      type: "payment_intent.payment_failed",
      invoiceId: invoice.id,
    });
    const successEvent = makeStripeEvent({
      id: `evt_recovery_success_${invoice.id}`,
      type: "payment_intent.succeeded",
      invoiceId: invoice.id,
    });

    await expect(stripeReconciliationService.processWebhookEvent(failureEvent)).resolves.toMatchObject({
      status: "payment_failed",
      invoiceId: invoice.id,
    });

    let state = await readFinancialState(invoice.id);
    expect(state.invoice.status).toBe("sent");
    expect(state.ledger).toHaveLength(0);

    await expect(stripeReconciliationService.processWebhookEvent(successEvent)).resolves.toMatchObject({
      status: "success",
      invoiceId: invoice.id,
    });

    state = await readFinancialState(invoice.id);
    expect(state.invoice.status).toBe("paid");
    expect(state.events).toHaveLength(2);
    expect(state.ledger).toHaveLength(1);
    expect(state.ledger[0].reference_id).toBe(successEvent.id);
    expect(state.audits.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        "payment.failed_via_stripe",
        "invoice.paid_via_stripe_reconciliation",
      ]),
    );
  });
});
