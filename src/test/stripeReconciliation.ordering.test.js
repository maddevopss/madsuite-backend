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

function event(type, id, invoiceId = 77) {
  return {
    id,
    type,
    data: {
      object: {
        amount: 9900,
        currency: "cad",
        metadata: { invoice_id: String(invoiceId) },
      },
    },
  };
}

function invoice(status = "sent") {
  return {
    id: 77,
    org_id: 5,
    organisation_id: 5,
    invoice_number: "INV-0077",
    status,
    total: "99.00",
    currency: "cad",
  };
}

describe("StripeReconciliationService — ordre des événements P0", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConnect.mockResolvedValue({ query: mockQuery, release: mockRelease });
    mockRecordLedgerEntry.mockResolvedValue({ id: 1 });
    mockRecordBusinessAudit.mockResolvedValue(undefined);
  });

  test("un paiement échoué laisse la facture impayée et un succès ultérieur la paie une seule fois", async () => {
    mockQuery
      // failed event
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rows: [invoice("sent")] })
      .mockResolvedValueOnce({})
      // succeeded event
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rows: [invoice("sent")] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 77 }] })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({});

    const failed = await service.processWebhookEvent(
      event("payment_intent.payment_failed", "evt_failed_77"),
    );
    const succeeded = await service.processWebhookEvent(
      event("payment_intent.succeeded", "evt_succeeded_77"),
    );

    expect(failed).toEqual({ status: "payment_failed", invoiceId: 77 });
    expect(succeeded).toEqual({ status: "success", invoiceId: 77 });
    expect(mockRecordLedgerEntry).toHaveBeenCalledTimes(1);
    expect(mockRecordBusinessAudit).toHaveBeenCalledTimes(2);
    expect(mockRecordBusinessAudit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        action: "payment.failed_via_stripe",
        entityId: 77,
        client: expect.any(Object),
        throwOnError: true,
      }),
    );
  });

  test("un échec reçu après le succès ne régresse jamais une facture payée", async () => {
    mockQuery
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rows: [invoice("paid")] })
      .mockResolvedValueOnce({});

    const result = await service.processWebhookEvent(
      event("payment_intent.payment_failed", "evt_late_failure_77"),
    );

    expect(result).toEqual({ status: "stale_failure", invoiceId: 77 });
    expect(mockRecordLedgerEntry).not.toHaveBeenCalled();
    expect(mockRecordBusinessAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "payment.failure_received_after_success",
        details: expect.objectContaining({ invoiceStatus: "paid" }),
      }),
    );
    expect(mockQuery).not.toHaveBeenCalledWith(
      expect.stringContaining("UPDATE invoices"),
      expect.anything(),
    );
  });

  test("un second succès avec un event_id distinct ne crée aucun deuxième effet financier", async () => {
    mockQuery
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rows: [invoice("paid")] })
      .mockResolvedValueOnce({});

    const result = await service.processWebhookEvent(
      event("charge.succeeded", "evt_second_success_77"),
    );

    expect(result).toEqual({ status: "already_paid", invoiceId: 77 });
    expect(mockRecordLedgerEntry).not.toHaveBeenCalled();
    expect(mockRecordBusinessAudit).not.toHaveBeenCalled();
    expect(mockQuery).toHaveBeenLastCalledWith("COMMIT");
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });
});
