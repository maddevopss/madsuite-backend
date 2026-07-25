const {
  money,
  recordInvoicePaymentAccounting,
} = require("../services/business/accounting-sync.service");

describe("accounting-sync.service", () => {
  test("normalise un encaissement en devise CAD", () => {
    expect(money("125.678")).toBe(125.68);
    expect(() => money(0)).toThrow("supérieur à zéro");
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

  test("crée les deux lignes puis publie l’écriture", async () => {
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
        .mockResolvedValueOnce({}),
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
    expect(client.query).toHaveBeenCalledTimes(8);

    const draftInsert = client.query.mock.calls[4][0];
    expect(draftInsert).toContain("'draft'");

    const debitLine = client.query.mock.calls[5][1];
    const creditLine = client.query.mock.calls[6][1];
    expect(debitLine.slice(-2)).toEqual(["125.00", "0.00"]);
    expect(creditLine.slice(-2)).toEqual(["0.00", "125.00"]);

    const publishQuery = client.query.mock.calls[7][0];
    expect(publishQuery).toContain("status = 'posted'");
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