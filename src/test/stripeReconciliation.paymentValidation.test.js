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
    total: "125.00",
    currency: "cad",
    ...overrides,
  };
}

describe("StripeReconciliationService — validation montant et devise P0", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConnect.mockResolvedValue({ query: mockQuery, release: mockRelease });
  });

  test("refuse un montant différent avant tout effet financier", async () => {
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
    expect(mockRecordLedgerEntry).not.toHaveBeenCalled();
    expect(mockRecordBusinessAudit).not.toHaveBeenCalled();
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  test("refuse une devise différente avant tout effet financier", async () => {
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
    expect(mockRecordLedgerEntry).not.toHaveBeenCalled();
    expect(mockRecordBusinessAudit).not.toHaveBeenCalled();
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });
});
