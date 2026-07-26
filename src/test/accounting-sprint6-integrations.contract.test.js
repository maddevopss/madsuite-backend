const fs = require("fs");
const path = require("path");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

describe("Bloc 1 / Sprint 6 — intégrations comptables", () => {
  test("les factures écrivent une trace comptable liée à une organisation", () => {
    const source = read("services/invoice/invoice-ledger.service.js");

    expect(source).toContain("INSERT INTO ledger_entries");
    expect(source).toContain("organisation_id");
    expect(source).toContain("reference_type");
    expect(source).toContain("reference_id");
  });

  test("les paiements clients sont délégués au serveur avec une clé stable", () => {
    const source = read("routes/invoicePayments.routes.js");

    expect(source).toContain("recordInvoicePayment");
    expect(source).toContain("organisationId: getOrganisationId(req)");
    expect(source).toContain("idempotencyKey: body.data.idempotency_key");
  });

  test("les dépenses financières demeurent isolées par organisation", () => {
    const source = read("services/expenses.service.js");

    expect(source).toContain("amount, tax_amount, total_amount");
    expect(source).toContain("organisation_id = $1");
    expect(source).toContain("organisationId");
  });

  test("les opérations fournisseurs passent par les services comptables du serveur", () => {
    const source = read("routes/business/suppliers.routes.js");

    expect(source).toContain("accountingPostingService.approveSupplierBill");
    expect(source).toContain("supplierPaymentService.recordSupplierPayment");
    expect(source).toContain("organisationId: req.organisationId");
    expect(source).toContain("idempotencyKey: req.body.idempotencyKey");
  });

  test("la comptabilité reste la source des écritures et non le navigateur", () => {
    const routes = read("routes/business/accounting.routes.js");
    expect(routes).toMatch(/requireOrganisation/);
    expect(routes).toMatch(/requireRole/);
  });
});
