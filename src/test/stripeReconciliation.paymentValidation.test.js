const mockQuery = jest.fn();
const mockDurableQuery = jest.fn();
const mockRelease = jest.fn();
const mockConnect = jest.fn();
const mockRecordLedgerEntry = jest.fn();
const mockRecordBusinessAudit = jest.fn();

jest.mock("../../db", () => ({
  query: (...args) => mockDurableQuery(...args),
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

function event(overrides = {}) {
  return {
    id: "evt_validation_001",
    type: "payment_intent.succeeded",
    data: {
      object: {
        amount: 12500,
        currency: "cad",
        metadata: { invoice_id: "42" },
        ...overrides,
      },
    },
  };
}

function invoice(overrides = {}) {
  return {
    id: 42,
    org_id: 7,
    organisation_id: 7,
    invoice_number: "INV-0042",
    status: "sent",
    total: "125.00",
    currency: "cad",
    ...overrides,
  };
}

describe("StripeReconciliationService — validation montant et devise P0", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConnect.mockResolvedValue({ query: mockQuery, release: mockRelease });
    mockDurableQuery.mockResolvedValue({ rowCount: 1, rows: [] });
  });

  test("refuse un montant différent et conserve une trace après rollback", async () => {
    mockQuery
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1, rows: [invoice()] })
      .mockResolvedValueOnce({});

    const result = await stripeReconciliationService.processWebhookEvent(event({ amount: 12499 }));

    expect(result).toEqual({
      status: "amount_mismatch",
      invoiceId: 42,
      expectedAmountInCents: 12500,
      receivedAmountInCents: 12499,
    });
    expect(mockQuery).toHaveBeenLastCalledWith("ROLLBACK");
    expect(mockDurableQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO system_consistency_logs"),
      [
        "stripe_payment_reconciliation",
        expect.stringContaining('"classification":"AMOUNT_MISMATCH"'),
      ],
    );
    expect(mockDurableQuery.mock.calls[0][1][1]).toContain('"stripe_event_id":"evt_validation_001"');
    expect(mockDurableQuery.mock.calls[0][1][1]).toContain('"organisation_id":7');
    expect(mockRecordLedgerEntry).not.toHaveBeenCalled();
    expect(mockRecordBusinessAudit).not.toHaveBeenCalled();
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  test("refuse une devise différente et conserve les valeurs attendue et reçue", async () => {
    mockQuery
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1, rows: [invoice()] })
      .mockResolvedValueOnce({});

    const result = await stripeReconciliationService.processWebhookEvent(event({ currency: "usd" }));

    expect(result).toEqual({
      status: "currency_mismatch",
      invoiceId: 42,
      expectedCurrency: "cad",
      receivedCurrency: "usd",
    });
    expect(mockQuery).toHaveBeenLastCalledWith("ROLLBACK");
    expect(mockDurableQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO system_consistency_logs"),
      [
        "stripe_payment_reconciliation",
        expect.stringContaining('"classification":"CURRENCY_MISMATCH"'),
      ],
    );
    expect(mockDurableQuery.mock.calls[0][1][1]).toContain('"expected":{"currency":"cad"}');
    expect(mockDurableQuery.mock.calls[0][1][1]).toContain('"received":{"currency":"usd"}');
    expect(mockRecordLedgerEntry).not.toHaveBeenCalled();
    expect(mockRecordBusinessAudit).not.toHaveBeenCalled();
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });
});