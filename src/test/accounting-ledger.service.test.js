const {
  normalizeLedgerFilters,
  getLedger,
} = require("../services/business/accounting-ledger.service");

describe("accounting-ledger.service", () => {
  test("normalise les filtres du grand livre", () => {
    expect(normalizeLedgerFilters({
      accountId: "42",
      sourceType: "invoice",
      sourceId: 88,
      projectId: 7,
      clientId: 9,
      supplierId: 11,
    })).toEqual({
      accountId: 42,
      startDate: null,
      endDate: null,
      sourceType: "invoice",
      sourceId: "88",
      projectId: "7",
      clientId: "9",
      supplierId: "11",
    });
  });

  test("refuse une période inversée", () => {
    expect(() => normalizeLedgerFilters({
      startDate: "2026-07-31",
      endDate: "2026-07-01",
    })).toThrow("précéder");
  });

  test("regroupe les mouvements par compte avec soldes d'ouverture et de fermeture", async () => {
    const db = {
      query: jest.fn().mockResolvedValue({
        rows: [
          {
            account_id: 101,
            code: "1010",
            account_name: "Banque",
            account_type: "asset",
            entry_id: 500,
            entry_number: "ENC-PMT-44",
            entry_date: "2026-07-24",
            entry_description: "Encaissement",
            source_type: "invoice_payment",
            source_id: "44",
            metadata: { clientId: "9" },
            line_id: 900,
            line_description: "Dépôt",
            debit: "125.00",
            credit: "0.00",
            opening_balance: "50.00",
            running_balance: "175.00",
          },
          {
            account_id: 101,
            code: "1010",
            account_name: "Banque",
            account_type: "asset",
            entry_id: 501,
            entry_number: "DEC-DEP-8",
            entry_date: "2026-07-25",
            entry_description: "Dépense",
            source_type: "expense",
            source_id: "8",
            metadata: {},
            line_id: 901,
            line_description: "Paiement",
            debit: "0.00",
            credit: "25.00",
            opening_balance: "50.00",
            running_balance: "150.00",
          },
        ],
      }),
    };

    const result = await getLedger(db, 10, {
      accountId: 101,
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      clientId: 9,
    });

    expect(result.totals).toEqual({ debit: 125, credit: 25 });
    expect(result.accounts).toHaveLength(1);
    expect(result.accounts[0]).toMatchObject({
      openingBalance: 50,
      debit: 125,
      credit: 25,
      closingBalance: 150,
    });
    expect(result.accounts[0].movements[0].source).toEqual({
      type: "invoice_payment",
      id: "44",
      metadata: { clientId: "9" },
    });

    const [sql, values] = db.query.mock.calls[0];
    expect(sql).toContain("opening_balances");
    expect(sql).toContain("metadata->>'projectId'");
    expect(sql).toContain("metadata->>'clientId'");
    expect(sql).toContain("metadata->>'supplierId'");
    expect(values).toEqual([
      10,
      101,
      "2026-07-01",
      "2026-07-31",
      null,
      null,
      null,
      "9",
      null,
    ]);
  });
});
