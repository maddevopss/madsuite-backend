const accountingService = require("../services/business/accounting.service");
const deliveryService = require("../services/business/accounting-delivery.service");

jest.mock("../services/business/accounting.service");

describe("accounting delivery service", () => {
  beforeEach(() => jest.resetAllMocks());

  test("déclare le module prêt lorsque les comptes, la période et les écritures sont sains", async () => {
    const db = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: deliveryService.REQUIRED_ACCOUNT_CODES.map((code) => ({ code })) })
        .mockResolvedValueOnce({ rows: [{ id: 1, status: "open" }] })
        .mockResolvedValueOnce({ rows: [{ count: 2 }] })
        .mockResolvedValueOnce({ rows: [{ count: 0 }] }),
    };

    const result = await deliveryService.getReadiness(db, 7, "2026-07-27");

    expect(result.ready).toBe(true);
    expect(result.draftCount).toBe(2);
    expect(result.blockers).toEqual([]);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining("organisation_id = $1"), expect.arrayContaining([7]));
  });

  test("retourne les blocages réels de livraison", async () => {
    const db = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ code: "1010" }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ count: 0 }] })
        .mockResolvedValueOnce({ rows: [{ count: 1 }] }),
    };

    const result = await deliveryService.getReadiness(db, 8, "2026-07-27");

    expect(result.ready).toBe(false);
    expect(result.blockers.map((item) => item.code)).toEqual(expect.arrayContaining([
      "MISSING_ACCOUNTS",
      "NO_OPEN_PERIOD",
      "UNBALANCED_POSTED_ENTRIES",
    ]));
  });

  test("produit une balance comparative et calcule les écarts", async () => {
    accountingService.trialBalance
      .mockResolvedValueOnce([{ code: "4000", name: "Revenus", account_type: "revenue", debit: 0, credit: 1200, balance: -1200 }])
      .mockResolvedValueOnce([{ code: "4000", name: "Revenus", account_type: "revenue", debit: 0, credit: 900, balance: -900 }]);

    const result = await deliveryService.comparativeTrialBalance(
      {},
      9,
      { startDate: "2026-07-01", endDate: "2026-07-31" },
      { startDate: "2026-06-01", endDate: "2026-06-30" },
    );

    expect(result.rows[0]).toEqual(expect.objectContaining({ code: "4000", variance: -300 }));
    expect(result.currentBalanced).toBe(false);
  });

  test("trace une source sans fuite interorganisation", async () => {
    const db = {
      query: jest.fn().mockResolvedValue({ rows: [{ id: 4, debit: "114.98", credit: "114.98" }] }),
    };

    const result = await deliveryService.traceSource(db, 12, "invoice", 44);

    expect(result[0]).toEqual(expect.objectContaining({ debit: 114.98, credit: 114.98, balanced: true }));
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining("e.organisation_id = $1"), [12, "invoice", "44"]);
  });
});
