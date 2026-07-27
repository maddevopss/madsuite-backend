const {
  normalizeCode,
  validateAccountInput,
  validatePeriodInput,
  createAccount,
  createPeriod,
  getEntryDetail,
} = require("../services/business/accounting-masterdata.service");

describe("accounting master data", () => {
  test("normalise et valide un compte", () => {
    expect(normalizeCode(" 1010 ")).toBe("1010");
    expect(validateAccountInput({ code: "6100", name: "Loyer", accountType: "expense", normalBalance: "debit" }))
      .toEqual({ code: "6100", name: "Loyer", accountType: "expense", normalBalance: "debit", parentId: null });
  });

  test("refuse un sens normal incohérent", () => {
    expect(() => validateAccountInput({ code: "4000", name: "Revenus", accountType: "revenue", normalBalance: "debit" }))
      .toThrow("doit normalement être au credit");
  });

  test("valide une période", () => {
    expect(validatePeriodInput({ fiscalYear: 2026, periodNumber: 7, startsOn: "2026-07-01", endsOn: "2026-07-31" }))
      .toEqual({ fiscalYear: 2026, periodNumber: 7, startsOn: "2026-07-01", endsOn: "2026-07-31" });
  });

  test("refuse une période inversée", () => {
    expect(() => validatePeriodInput({ fiscalYear: 2026, periodNumber: 7, startsOn: "2026-07-31", endsOn: "2026-07-01" }))
      .toThrow("doit précéder");
  });

  test("crée un compte dans la portée organisationnelle", async () => {
    const db = { query: jest.fn().mockResolvedValueOnce({ rows: [{ id: 9, code: "1010" }] }) };
    await expect(createAccount(db, 4, { code: "1010", name: "Banque", accountType: "asset", normalBalance: "debit" }))
      .resolves.toEqual({ id: 9, code: "1010" });
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO accounting_accounts"), [4, "1010", "Banque", "asset", "debit", null]);
  });

  test("refuse le chevauchement de périodes", async () => {
    const db = { query: jest.fn().mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 8 }] }) };
    await expect(createPeriod(db, 4, { fiscalYear: 2026, periodNumber: 7, startsOn: "2026-07-01", endsOn: "2026-07-31" }))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  test("retourne une écriture détaillée équilibrée", async () => {
    const db = {
      query: jest.fn()
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 20, status: "posted" }] })
        .mockResolvedValueOnce({ rows: [
          { id: 1, debit: "114.98", credit: "0" },
          { id: 2, debit: "0", credit: "114.98" },
        ] }),
    };
    await expect(getEntryDetail(db, 4, 20)).resolves.toEqual({
      entry: { id: 20, status: "posted" },
      lines: [
        { id: 1, debit: "114.98", credit: "0" },
        { id: 2, debit: "0", credit: "114.98" },
      ],
      totals: { debit: 114.98, credit: 114.98, balanced: true },
    });
  });
});
