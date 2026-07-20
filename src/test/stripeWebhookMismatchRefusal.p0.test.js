const db = require("../../db");
const stripeReconciliationService = require("../services/stripeReconciliation.service");
const {
  createTestOrganisation,
  createTestClient,
} = require("./helpers/testData");

function makeStripeEvent({ id, invoiceId, amount = 12500, currency = "cad" }) {
  return {
    id,
    type: "payment_intent.succeeded",
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

  return { organisation, client, invoice };
}

async function readState({ invoiceId, eventId, classification }) {
  const [invoice, events, ledger, consistency] = await Promise.all([
    db.query("SELECT id, status FROM invoices WHERE id = $1", [invoiceId]),
    db.query("SELECT stripe_event_id FROM payment_events WHERE stripe_event_id = $1", [eventId]),
    db.query(
      `
        SELECT id
        FROM ledger_entries
        WHERE reference_type = 'stripe_webhook'
          AND reference_id = $1
      `,
      [eventId],
    ),
    db.query(
      `
        SELECT status, details
        FROM system_consistency_logs
        WHERE invariant_name = 'stripe_payment_reconciliation'
          AND details->>'stripe_event_id' = $1
          AND details->>'classification' = $2
        ORDER BY id DESC
        LIMIT 1
      `,
      [eventId, classification],
    ),
  ]);

  return {
    invoice: invoice.rows[0],
    events: events.rows,
    ledger: ledger.rows,
    consistency: consistency.rows[0],
  };
}

describe("P0 — refus des paiements Stripe incohérents", () => {
  test("un montant incohérent est refusé, journalisé et ne laisse aucun état partiel", async () => {
    const { organisation, invoice } = await fixture("AMOUNT-MISMATCH");
    const event = makeStripeEvent({
      id: `evt_amount_mismatch_${invoice.id}`,
      invoiceId: invoice.id,
      amount: 12499,
      currency: "cad",
    });

    await expect(stripeReconciliationService.processWebhookEvent(event)).resolves.toMatchObject({
      status: "amount_mismatch",
      invoiceId: invoice.id,
      expectedAmountInCents: 12500,
      receivedAmountInCents: 12499,
    });

    const state = await readState({
      invoiceId: invoice.id,
      eventId: event.id,
      classification: "AMOUNT_MISMATCH",
    });

    expect(state.invoice.status).toBe("sent");
    expect(state.events).toHaveLength(0);
    expect(state.ledger).toHaveLength(0);
    expect(state.consistency).toMatchObject({ status: "FAIL" });
    expect(state.consistency.details).toMatchObject({
      classification: "AMOUNT_MISMATCH",
      stripe_event_id: event.id,
      invoice_id: invoice.id,
      organisation_id: organisation.id,
      expected: { amount_in_cents: 12500 },
      received: { amount_in_cents: 12499 },
      event_type: event.type,
    });
  });

  test("une devise incohérente est refusée, journalisée et ne laisse aucun état partiel", async () => {
    const { organisation, invoice } = await fixture("CURRENCY-MISMATCH");
    const event = makeStripeEvent({
      id: `evt_currency_mismatch_${invoice.id}`,
      invoiceId: invoice.id,
      amount: 12500,
      currency: "usd",
    });

    await expect(stripeReconciliationService.processWebhookEvent(event)).resolves.toMatchObject({
      status: "currency_mismatch",
      invoiceId: invoice.id,
      expectedCurrency: "cad",
      receivedCurrency: "usd",
    });

    const state = await readState({
      invoiceId: invoice.id,
      eventId: event.id,
      classification: "CURRENCY_MISMATCH",
    });

    expect(state.invoice.status).toBe("sent");
    expect(state.events).toHaveLength(0);
    expect(state.ledger).toHaveLength(0);
    expect(state.consistency).toMatchObject({ status: "FAIL" });
    expect(state.consistency.details).toMatchObject({
      classification: "CURRENCY_MISMATCH",
      stripe_event_id: event.id,
      invoice_id: invoice.id,
      organisation_id: organisation.id,
      expected: { currency: "cad" },
      received: { currency: "usd" },
      event_type: event.type,
    });
  });
});
