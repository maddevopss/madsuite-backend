const fs = require("fs");
const path = require("path");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", "..", relativePath), "utf8");
}

describe("Contrat Encaissements et paiements partiels V1", () => {
  test("le schéma impose l’idempotence, les montants positifs et l’isolation", () => {
    const migration = read("db/migrations/061_invoice_payments_v1.sql");
    expect(migration).toContain("CHECK (amount > 0)");
    expect(migration).toContain("UNIQUE (organisation_id, idempotency_key)");
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("invoice_payments_org_isolation");
  });

  test("le moteur interdit le surpaiement et marque paid seulement à solde nul", () => {
    const service = read("src/services/invoice/invoice-payment-record.service.js");
    expect(service).toContain("Le paiement dépasse le solde restant");
    expect(service).toContain("remainingCents === 0");
    expect(service).toContain("SET status = 'paid'");
    expect(service).toContain("payment_reminder_attempts");
    expect(service).toContain('referenceType: "invoice_payment"');
  });

  test("les routes exigent un administrateur pour enregistrer un paiement", () => {
    const routes = read("src/routes/invoicePayments.routes.js");
    expect(routes).toContain("requireAdmin");
    expect(routes).toContain('router.post("/invoices/:id"');
    expect(routes).toContain("idempotency_key");
  });
});
