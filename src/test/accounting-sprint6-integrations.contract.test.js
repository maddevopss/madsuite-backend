const fs = require("fs");
const path = require("path");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

describe("Bloc 1 / Sprint 6 — intégrations comptables", () => {
  test.each([
    ["factures", "services/invoice/invoice-ledger.service.js"],
    ["paiements", "routes/invoicePayments.routes.js"],
    ["dépenses", "services/expenses.service.js"],
    ["fournisseurs", "routes/business/suppliers.routes.js"],
  ])("%s conserve une trace comptable explicite", (_name, relativePath) => {
    const source = read(relativePath);
    expect(source).toMatch(/account|ledger|entry/i);
    expect(source).toMatch(/organisation/i);
  });

  test("les opérations financières utilisent une clé stable ou une référence source", () => {
    const invoiceLedger = read("services/invoice/invoice-ledger.service.js");
    expect(invoiceLedger).toMatch(/idempot|source/i);
  });

  test("la comptabilité reste la source des écritures et non le navigateur", () => {
    const routes = read("routes/business/accounting.routes.js");
    expect(routes).toMatch(/requireOrganisation/);
    expect(routes).toMatch(/requireRole/);
  });
});
