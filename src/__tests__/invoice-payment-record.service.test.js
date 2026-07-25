const {
  PAYMENT_METHODS,
  cents,
} = require("../services/invoice/invoice-payment-record.service");

jest.mock("../../db", () => ({
  query: jest.fn(),
  pool: { connect: jest.fn() },
}));

jest.mock("../services/invoice/invoice-ledger.service", () => ({
  recordLedgerEntry: jest.fn(),
}));

describe("invoice-payment-record.service", () => {
  test("convertit les montants en cents sans dérive flottante", () => {
    expect(cents("10.01")).toBe(1001);
    expect(cents(0.1 + 0.2)).toBe(30);
    expect(cents("115.00")).toBe(11500);
  });

  test("refuse implicitement les montants non numériques", () => {
    expect(Number.isNaN(cents("patate"))).toBe(true);
  });

  test("expose uniquement les méthodes supportées", () => {
    expect(PAYMENT_METHODS).toEqual([
      "cash",
      "cheque",
      "bank_transfer",
      "card",
      "stripe",
      "other",
    ]);
  });
});
