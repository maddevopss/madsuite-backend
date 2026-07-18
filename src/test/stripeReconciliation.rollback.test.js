const mockQuery = jest.fn();
const mockRelease = jest.fn();
const mockConnect = jest.fn();
const mockRecordLedgerEntry = jest.fn();
const mockRecordBusinessAudit = jest.fn();

jest.mock("../../db", () => ({
  pool: { connect: (...args) => mockConnect(...args) },
}));

jest.mock("../services/invoice/invoice-ledger.service", () => ({
  recordLedgerEntry: (...args) => mockRecordLedgerEntry(...args),
}));

jest.mock("../services/auditLog.service", () => ({
  recordBusinessAudit: (...args) => mockRecordBusinessAudit(...args),
}));

const service = require("../services/stripeReconciliation.service");

function event() {
  return {
    id: "evt_rollback_001",
    type: "payment_intent.succeeded",
    data: {
      object: {
        amount: 9900,
        currency: "cad",
        metadata: { invoice_id: "77" },
      },
    },
  };
}

describe("StripeReconciliationService — atomicité P0", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConnect.mockResolvedValue({ query: mockQuery, release: mockRelease });
  });

  test("une panne ledger annule toute la transaction et empêche l'audit", async () => {
    mockQuery
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 77, org_id: 5, invoice_number: "INV-0077" }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 77 }] })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({});

    mockRecordLedgerEntry.mockRejectedValueOnce(new Error("ledger unavailable"));

    await expect(service.processWebhookEvent(event())).rejects.toThrow("ledger unavailable");

    expect(mockQuery).toHaveBeenCalledWith("ROLLBACK");
    expect(mockQuery).not.toHaveBeenCalledWith("COMMIT");
    expect(mockRecordBusinessAudit).not.toHaveBeenCalled();
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  test("une panne d'audit annule aussi l'écriture ledger transactionnelle", async () => {
    mockQuery
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 77, org_id: 5, invoice_number: "INV-0077" }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 77 }] })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({});

    mockRecordLedgerEntry.mockResolvedValueOnce({ id: 1 });
    mockRecordBusinessAudit.mockRejectedValueOnce(new Error("audit unavailable"));

    await expect(service.processWebhookEvent(event())).rejects.toThrow("audit unavailable");

    expect(mockRecordLedgerEntry).toHaveBeenCalledTimes(1);
    expect(mockQuery).toHaveBeenCalledWith("ROLLBACK");
    expect(mockQuery).not.toHaveBeenCalledWith("COMMIT");
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });
});
