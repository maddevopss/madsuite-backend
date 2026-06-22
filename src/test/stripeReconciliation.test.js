const stripeReconciliationService = require("../services/stripeReconciliation.service");
const db = require("../../db");
const { recordLedgerEntry } = require("../services/invoice/invoice-ledger.service");
const { recordBusinessAudit } = require("../services/auditLog.service");

// Mock dependencies
jest.mock("../../db", () => ({
  query: jest.fn()
}));
jest.mock("../services/invoice/invoice-ledger.service", () => ({
  recordLedgerEntry: jest.fn()
}));
jest.mock("../services/auditLog.service", () => ({
  recordBusinessAudit: jest.fn()
}));

describe("stripeReconciliation.service.js", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  const validEvent = {
    id: "evt_123",
    type: "payment_intent.succeeded",
    data: {
      object: {
        metadata: {
          invoice_id: "99"
        },
        amount: 5000, // 50.00 CAD
        currency: "cad"
      }
    }
  };

  it("devrait ignorer les événements non supportés", async () => {
    const res = await stripeReconciliationService.processWebhookEvent({ type: "some.other.event" });
    expect(res.status).toBe("ignored");
  });

  it("paiement valide: devrait enregistrer le paiement et notifier", async () => {
    // 1. Insert dans payment_events (succès)
    db.query.mockResolvedValueOnce({ rowCount: 1, rows: [] });
    
    // 2. Cherche la facture (trouvée)
    db.query.mockResolvedValueOnce({ rows: [{ id: 99, org_id: 1, invoice_number: "INV-001" }] });
    
    // 3. Update invoice status
    db.query.mockResolvedValueOnce({ rowCount: 1, rows: [] });
    
    // 4. Cherche admin pour notification
    db.query.mockResolvedValueOnce({ rows: [{ id: 10 }] });
    
    // 5. Insert notification
    db.query.mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const res = await stripeReconciliationService.processWebhookEvent(validEvent);

    expect(res.status).toBe("success");
    expect(res.invoiceId).toBe(99);
    
    // Vérifier idempotence DB insert
    expect(db.query).toHaveBeenNthCalledWith(1, expect.stringContaining("INSERT INTO payment_events"), [99, "evt_123", "payment_intent.succeeded", expect.any(String)]);
    
    // Vérifier invoice DB update
    expect(db.query).toHaveBeenNthCalledWith(3, expect.stringContaining("UPDATE invoices SET status = 'paid'"), [99]);

    // Vérifier Ledger
    expect(recordLedgerEntry).toHaveBeenCalledWith(expect.objectContaining({
      amount: 50,
      currency: "cad",
      referenceType: "stripe_webhook"
    }));

    // Vérifier Audit
    expect(recordBusinessAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "invoice.paid_via_stripe_reconciliation",
      entityId: 99
    }));
  });

  it("facture introuvable: retourne invoice_not_found", async () => {
    // 1. Insert dans payment_events (succès)
    db.query.mockResolvedValueOnce({ rowCount: 1, rows: [] });
    
    // 2. Cherche la facture (NON trouvée)
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await stripeReconciliationService.processWebhookEvent(validEvent);

    expect(res.status).toBe("invoice_not_found");
  });

  it("webhook dupliqué: retourne duplicate (idempotence)", async () => {
    // Simuler l'erreur 23505 (unique_violation)
    const error = new Error("Unique violation");
    error.code = "23505";
    db.query.mockRejectedValueOnce(error);

    const res = await stripeReconciliationService.processWebhookEvent(validEvent);

    expect(res.status).toBe("duplicate");
  });

  it("erreur Stripe: rejette l'exception", async () => {
    // Simuler une autre erreur DB
    db.query.mockRejectedValueOnce(new Error("Database connection failed"));

    await expect(stripeReconciliationService.processWebhookEvent(validEvent)).rejects.toThrow("Database connection failed");
  });
});
