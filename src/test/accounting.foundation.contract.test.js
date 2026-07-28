const accountingService = require("../services/business/accounting.service");

describe("Accounting foundation contracts", () => {
  test("normalizes a balanced two-line entry", () => {
    const result = accountingService.validateEntryLines([
      { accountId: 10, debit: 125.5, credit: 0 },
      { accountId: 20, debit: 0, credit: 125.5 },
    ]);

    expect(result).toEqual({
      lines: [
        { accountId: 10, debit: 125.5, credit: 0 },
        { accountId: 20, debit: 0, credit: 125.5 },
      ],
      debit: 125.5,
      credit: 125.5,
    });
  });

  test.each([
    [[], "au moins deux lignes"],
    [[{ accountId: 10, debit: 10, credit: 0 }], "au moins deux lignes"],
    [[
      { accountId: 10, debit: 10, credit: 0 },
      { accountId: 20, debit: 0, credit: 9 },
    ], "doivent être égaux"],
    [[
      { accountId: 10, debit: 10, credit: 10 },
      { accountId: 20, debit: 0, credit: 10 },
    ], "un seul montant"],
    [[
      { accountId: null, debit: 10, credit: 0 },
      { accountId: 20, debit: 0, credit: 10 },
    ], "un compte"],
  ])("rejects invalid journal lines", (lines, expectedMessage) => {
    expect(() => accountingService.validateEntryLines(lines)).toThrow(expectedMessage);
  });

  test("rounds monetary values to two decimals", () => {
    expect(accountingService.money("12.345")).toBe(12.35);
    expect(accountingService.money(0)).toBe(0);
    expect(() => accountingService.money("not-a-number")).toThrow("Montant comptable invalide");
  });

  test("keeps tenant scope in every foundational write query", async () => {
    const queries = [];
    const db = {
      query: jest.fn(async (sql, params = []) => {
        queries.push({ sql, params });
        if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [], rowCount: 0 };
        if (sql.includes("SELECT id FROM accounting_journals")) return { rows: [{ id: 99 }], rowCount: 1 };
        if (sql.includes("INSERT INTO accounting_entries")) {
          return { rows: [{ id: 501, organisation_id: 77, status: "draft" }], rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      }),
    };

    await accountingService.createEntry(db, 77, 42, {
      entryDate: "2040-01-15",
      description: "Écriture contractuelle",
      entryNumber: "GEN-2040-001",
      lines: [
        { accountId: 10, debit: 100, credit: 0 },
        { accountId: 20, debit: 0, credit: 100 },
      ],
    });

    const scopedWrites = queries.filter(({ sql }) => /INSERT INTO accounting_(journals|entries|entry_lines)/.test(sql));
    expect(scopedWrites).toHaveLength(4);
    expect(scopedWrites.every(({ params }) => params[0] === 77)).toBe(true);
    expect(db.query).toHaveBeenCalledWith("BEGIN");
    expect(db.query).toHaveBeenCalledWith("COMMIT");
  });
});
