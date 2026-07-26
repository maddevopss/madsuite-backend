const accountingService = require("../services/business/accounting.service");

describe("Bloc 1 / Sprint 2 — journal et partie double", () => {
  test("refuse une écriture avec moins de deux lignes", () => {
    expect(() => accountingService.validateEntryLines([
      { accountId: 1, debit: 100, credit: 0 },
    ])).toThrow("au moins deux lignes");
  });

  test("refuse une ligne portant simultanément débit et crédit", () => {
    expect(() => accountingService.validateEntryLines([
      { accountId: 1, debit: 100, credit: 100 },
      { accountId: 2, debit: 0, credit: 100 },
    ])).toThrow("un seul montant");
  });

  test("refuse une écriture déséquilibrée", () => {
    expect(() => accountingService.validateEntryLines([
      { accountId: 1, debit: 100, credit: 0 },
      { accountId: 2, debit: 0, credit: 99.99 },
    ])).toThrow("doivent être égaux");
  });

  test("normalise une écriture équilibrée en dollars canadiens", () => {
    expect(accountingService.validateEntryLines([
      { accountId: 1, debit: 125.1, credit: 0 },
      { accountId: 2, debit: 0, credit: 125.1 },
    ])).toEqual(expect.objectContaining({ debit: 125.1, credit: 125.1 }));
  });
});
