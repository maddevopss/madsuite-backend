const mockQuery = jest.fn();
const mockRelease = jest.fn();
const mockConnect = jest.fn();
const mockRecordLedgerEntry = jest.fn();
const mockRecordBusinessAudit = jest.fn();

jest.mock("../../db", () => ({
  pool: {
    connect: (...args) => mockConnect(...args),
  },
}));

jest.mock("../services/invoice/invoice-ledger.service", () => ({
  recordLedgerEntry: (...args) => mockRecordLedgerEntry(...args),
}));

jest.mock("../services/auditLog.service", () => ({
  recordBusinessAudit: (...args) => mockRecordBusinessAudit(...args),
}));

const stripeReconciliationService = require("../services/stripeReconciliation.service");

function paymentSucceededEvent(overrides = {}) {
  return {
    id: "evt_payment_unique_001",
    type: "payment_intent.succeeded",
    data: {
      object: {
        id: "pi_payment_unique_001",
        amount: 12500,
        currency: "cad",
        metadata: {
          invoice_id: "42",
        },
        ...overrides,
      },
    },
  };
}

describe("StripeReconciliationService — paiement unique et rejeu idempotent P0", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConnect.mockResolvedValue({
      query: mockQuery,
      release: mockRelease,
    });
  });

  test("un paiement réussi produit exactement un effet métier", async () => {
    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rowCount: 1 }) // INSERT payment_events
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: 42,
            organisation_id: 7,
            org_id: 7,
            invoice_number: "INV-0042",
            status: "sent",
          },
        ],
      }) // SELECT invoice
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 42 }] }) // UPDATE invoice
      .mockResolvedValueOnce({ rowCount: 2 }) // UPDATE time_entries
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // SELECT admin
      .mockResolvedValueOnce({}); // COMMIT

    const result = await stripeReconciliationService.processWebhookEvent(paymentSucceededEvent());

    expect(result).toEqual({ status: "success", invoiceId: 42 });
    expect(mockRecordLedgerEntry).toHaveBeenCalledTimes(1);
    expect(mockRecordLedgerEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        organisationId: 7,
        type: "payment_received",
        amount: 125,
        currency: "cad",
        referenceType: "stripe_webhook",
        referenceId: "evt_payment_unique_001",
      }),
    );
    expect(mockRecordBusinessAudit).toHaveBeenCalledTimes(1);
    expect(mockQuery).toHaveBeenCalledWith("COMMIT");
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  test("le rejeu du même event_id est reconnu comme doublon sans deuxième effet métier", async () => {
    const duplicateError = Object.assign(new Error("duplicate stripe_event_id"), {
      code: "23505",
    });

    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockRejectedValueOnce(duplicateError) // INSERT payment_events
      .mockResolvedValueOnce({}); // ROLLBACK

    const result = await stripeReconciliationService.processWebhookEvent(paymentSucceededEvent());

    expect(result).toEqual({ status: "duplicate" });
    expect(mockRecordLedgerEntry).not.toHaveBeenCalled();
    expect(mockRecordBusinessAudit).not.toHaveBeenCalled();
    expect(mockQuery).toHaveBeenCalledTimes(3);
    expect(mockQuery).toHaveBeenLastCalledWith("ROLLBACK");
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  test("un événement non financier est ignoré sans ouvrir de transaction", async () => {
    const result = await stripeReconciliationService.processWebhookEvent({
      id: "evt_ignored_001",
      type: "customer.updated",
      data: { object: {} },
    });

    expect(result).toEqual({ status: "ignored" });
    expect(mockConnect).not.toHaveBeenCalled();
    expect(mockRecordLedgerEntry).not.toHaveBeenCalled();
    expect(mockRecordBusinessAudit).not.toHaveBeenCalled();
  });
});
