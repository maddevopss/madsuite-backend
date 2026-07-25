const {
  money,
  validateEntryLines,
  createEntry,
  postEntry,
} = require("../services/business/accounting.service");

describe("accounting.service", () => {
  test("normalise les montants à deux décimales", () => {
    expect(money("12.345")).toBe(12.35);
    expect(money(null)).toBe(0);
    expect(() => money("non-numérique")).toThrow("Montant comptable invalide");
  });

  test("accepte une écriture équilibrée", () => {
    const result = validateEntryLines([
      { accountId: 1100, debit: 114.98, credit: 0 },
      { accountId: 4000, debit: 0, credit: 100 },
      { accountId: 2100, debit: 0, credit: 14.98 },
    ]);

    expect(result.debit).toBe(114.98);
    expect(result.credit).toBe(114.98);
    expect(result.lines).toHaveLength(3);
  });

  test("refuse une écriture déséquilibrée", () => {
    expect(() => validateEntryLines([
      { accountId: 1100, debit: 100, credit: 0 },
      { accountId: 4000, debit: 0, credit: 90 },
    ])).toThrow("Les débits et crédits doivent être égaux");
  });

  test("refuse une ligne qui contient simultanément débit et crédit", () => {
    expect(() => validateEntryLines([
      { accountId: 1100, debit: 100, credit: 100 },
      { accountId: 4000, debit: 0, credit: 100 },
    ])).toThrow("un seul montant");
  });

  test("annule la transaction quand la création échoue", async () => {
    const db = {
      query: jest.fn()
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({}) // journal insert
        .mockRejectedValueOnce(new Error("échec base"))
        .mockResolvedValueOnce({}), // ROLLBACK
    };

    await expect(createEntry(db, 10, 20, {
      entryDate: "2026-07-24",
      description: "Test",
      lines: [
        { accountId: 1, debit: 50, credit: 0 },
        { accountId: 2, debit: 0, credit: 50 },
      ],
    })).rejects.toThrow("échec base");

    expect(db.query).toHaveBeenLastCalledWith("ROLLBACK");
  });

  test("ne publie jamais une écriture déséquilibrée", async () => {
    const db = {
      query: jest.fn().mockResolvedValue({
        rowCount: 1,
        rows: [{ status: "draft", debit: "100.00", credit: "90.00" }],
      }),
    };

    await expect(postEntry(db, 10, 99)).rejects.toMatchObject({ status: 409 });
    expect(db.query).toHaveBeenCalledTimes(1);
  });
});
