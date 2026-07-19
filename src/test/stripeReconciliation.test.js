jest.mock("../../db", () => {
  const txClient = {
    query: jest.fn(),
    release: jest.fn(),
  };

  return {
    query: jest.fn(),
    pool: {
      connect: jest.fn().mockResolvedValue(txClient),
    },
    __txClient: txClient,
  };
});

jest.mock("../services/invoice/invoice-ledger.service", () => ({
  recordLedgerEntry: jest.fn(),
}));

jest.mock("../services/auditLog.service", () => ({
  recordBusinessAudit: jest.fn(),
}));

const db = require("../../db");
const stripeReconciliationService = require("../services/stripeReconciliation.service");
const { recordLedgerEntry } = require("../services/invoice/invoice-ledger.service");
const { recordBusinessAudit } = require("../services/auditLog.service");

describe("stripeReconciliation.service.js", () => {
  const validEvent = {
    id: "evt_test_123",
    type: "payment_intent.succeeded",
    data: {
      object: {
        id: "pi_test_123",
        amount: 50000,
        currency: "cad",
        metadata: {
          invoice_id: "99",
        },
      },
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();

    db.pool.connect.mockResolvedValue(db.__txClient);
    db.__txClient.query.mockReset();
    db.__txClient.release.mockReset();

    recordLedgerEntry.mockResolvedValue(undefined);
    recordBusinessAudit.mockResolvedValue(undefined);
  });

  it("ignore les événements non supportés", async () => {
    const res = await stripeReconciliationService.processWebhookEvent({
      id: "evt_ignored",
      type: "customer.created",
      data: {
        object: {},
      },
    });

    expect(res.status).toBe("ignored");
    expect(db.pool.connect).not.toHaveBeenCalled();
  });

  it("paiement valide: devrait enregistrer le paiement et notifier", async () => {
    db.__txClient.query
      // BEGIN
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      // INSERT payment_events
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      // SELECT invoice
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: 99,
            org_id: 1,
            organisation_id: 1,
            invoice_number: "INV-99",
            status: "sent",
            total: 500,
            currency: "cad",
          },
        ],
      })
      // UPDATE invoices
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 99 }] })
      // UPDATE time_entries
      .mockResolvedValueOnce({ rowCount: 2, rows: [] })
      // SELECT admin
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: 10 }],
      })
      // INSERT notification
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      // COMMIT
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const res = await stripeReconciliationService.processWebhookEvent(validEvent);

    expect(res.status).toBe("success");
    expect(res.invoiceId).toBe(99);

    expect(db.pool.connect).toHaveBeenCalledTimes(1);
    expect(db.__txClient.query).toHaveBeenCalledWith("BEGIN");
    expect(db.__txClient.query).toHaveBeenCalledWith("COMMIT");

    expect(recordLedgerEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        organisationId: 1,
        type: "payment_received",
        amount: 500,
        currency: "cad",
        referenceType: "stripe_webhook",
        referenceId: "evt_test_123",
        client: db.__txClient,
      }),
    );

    expect(recordBusinessAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        organisationId: 1,
        action: "invoice.paid_via_stripe_reconciliation",
        entityType: "invoice",
        entityId: 99,
        client: db.__txClient,
        throwOnError: true,
      }),
    );

    expect(db.__txClient.release).toHaveBeenCalledTimes(1);
  });

  it("facture introuvable: retourne invoice_not_found", async () => {
    db.__txClient.query
      // BEGIN
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      // INSERT payment_events
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      // SELECT invoice
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      // ROLLBACK
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const res = await stripeReconciliationService.processWebhookEvent(validEvent);

    expect(res.status).toBe("invoice_not_found");
    expect(recordLedgerEntry).not.toHaveBeenCalled();
    expect(recordBusinessAudit).not.toHaveBeenCalled();
    expect(db.__txClient.query).toHaveBeenCalledWith("ROLLBACK");
    expect(db.__txClient.release).toHaveBeenCalledTimes(1);
  });

  it("webhook dupliqué: retourne duplicate", async () => {
    const duplicateError = new Error("duplicate key value violates unique constraint");
    duplicateError.code = "23505";

    db.__txClient.query
      // BEGIN
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      // INSERT payment_events -> unique violation
      .mockRejectedValueOnce(duplicateError)
      // ROLLBACK
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const res = await stripeReconciliationService.processWebhookEvent(validEvent);

    expect(res.status).toBe("duplicate");
    expect(recordLedgerEntry).not.toHaveBeenCalled();
    expect(recordBusinessAudit).not.toHaveBeenCalled();
    expect(db.__txClient.query).toHaveBeenCalledWith("ROLLBACK");
    expect(db.__txClient.release).toHaveBeenCalledTimes(1);
  });

  it("erreur DB: rejette l'exception", async () => {
    db.pool.connect.mockRejectedValueOnce(new Error("Database connection failed"));

    await expect(
      stripeReconciliationService.processWebhookEvent(validEvent),
    ).rejects.toThrow("Database connection failed");

    expect(db.__txClient.release).not.toHaveBeenCalled();
  });
});
