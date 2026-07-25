const {
  money,
  recordInvoiceFinalizationAccounting,
  recordInvoicePaymentAccounting,
} = require("../services/business/accounting-sync.service");

describe("accounting-sync.service", () => {
  test("normalise les montants comptables en CAD", () => {
    expect(money("125.678")).toBe(125.68);
    expect(money(0, { allowZero: true })).toBe(0);
    expect(() => money(0)).toThrow("invalide");
  });

  test("n’écrit rien si le plan comptable n’est pas initialisé", async () => {
    const client = {
      query: jest.fn().mockResolvedValueOnce({ rows: [] }),
    };

    const result = await recordInvoicePaymentAccounting({
      client,
      organisationId: 10,
      paymentId: 44,
      invoiceNumber: "FAC-2026-0044",
      amount: "125.00",
      receivedAt: "2026-07-24T16:00:00.000Z",
      createdBy: 7,
    });

    expect(result).toEqual({
      skipped: true,
      reason: "chart_of_accounts_not_initialized",
    });
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  test("crée les deux lignes d’encaissement puis publie l’écriture", async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({
          rows: [
            { id: 101, code: "1010" },
            { id: 110, code: "1100" },
          ],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [{ id: 9 }] })
        .mockResolvedValueOnce({ rows: [{ id: 501 }] })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 501 }] }),
    };

    const result = await recordInvoicePaymentAccounting({
      client,
      organisationId: 10,
      paymentId: 44,
      invoiceNumber: "FAC-2026-0044",
      amount: "125.00",
      receivedAt: "2026-07-24T16:00:00.000Z",
      createdBy: 7,
    });

    expect(result).toEqual({ skipped: false, duplicate: false, entryId: 501 });
    const debitLine = client.query.mock.calls[5][1];
    const creditLine = client.query.mock.calls[6][1];
    expect(debitLine.slice(-2)).toEqual(["125.00", "0.00"]);
    expect(creditLine.slice(-2)).toEqual(["0.00", "125.00"]);
  });

  test("ventile une facture entre revenu et taxes à remettre", async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({
          rows: [
            { id: 110, code: "1100" },
            { id: 400, code: "4000" },
            { id: 210, code: "2100" },
          ],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [{ id: 12 }] })
        .mockResolvedValueOnce({ rows: [{ id: 700 }] })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 700 }] }),
    };

    const result = await recordInvoiceFinalizationAccounting({
      client,
      organisationId: 10,
      invoiceId: 88,
      invoiceNumber: "FAC-00088",
      subtotal: "100.00",
      taxTotal: "14.98",
      total: "114.98",
      issueDate: "2026-07-24",
      createdBy: 7,
    });

    expect(result).toEqual({ skipped: false, duplicate: false, entryId: 700 });
    expect(client.query.mock.calls[5][1].slice(-2)).toEqual(["114.98", "0.00"]);
    expect(client.query.mock.calls[6][1].slice(-2)).toEqual(["0.00", "100.00"]);
    expect(client.query.mock.calls[7][1].slice(-2)).toEqual(["0.00", "14.98"]);
  });

  test("retourne l’écriture existante sans créer de doublon", async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({
          rows: [
            { id: 101, code: "1010" },
            { id: 110, code: "1100" },
          ],
        })
        .mockResolvedValueOnce({ rows: [{ id: 777, status: "posted" }] }),
    };

    const result = await recordInvoicePaymentAccounting({
      client,
      organisationId: 10,
      paymentId: 44,
      invoiceNumber: "FAC-2026-0044",
      amount: "125.00",
      receivedAt: "2026-07-24T16:00:00.000Z",
      createdBy: 7,
    });

    expect(result).toEqual({ skipped: false, duplicate: true, entryId: 777 });
    expect(client.query).toHaveBeenCalledTimes(2);
  });
});
