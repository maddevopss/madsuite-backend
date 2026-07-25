const {
  INVOICE_FINALIZATION_POLICY,
  evaluateInvoiceFinalizationPolicy,
  verifyInvoiceFinalization,
} = require("../services/invoice/invoice-finalization.service");
const {
  INVOICE_PAYMENT_POLICY,
  evaluateInvoicePaymentPolicy,
  verifyInvoicePayment,
} = require("../services/invoice/invoice-payment-record.service");

describe("cycle client gouverné par CTMAD", () => {
  test("expose les politiques versionnées", () => {
    expect(INVOICE_FINALIZATION_POLICY).toBe("invoice.finalize@1");
    expect(INVOICE_PAYMENT_POLICY).toBe("invoice.payment.receive@1");
  });

  test("refuse une finalisation sans facture", () => {
    expect(evaluateInvoiceFinalizationPolicy({ input: {} })).toMatchObject({
      allowed: false,
      code: "invoice_finalize.invoice_required",
    });
  });

  test("autorise une finalisation ciblée", () => {
    expect(evaluateInvoiceFinalizationPolicy({ input: { invoiceId: 12 } })).toEqual({
      allowed: true,
      code: "invoice_finalize.input_valid",
    });
  });

  test("refuse un paiement client incomplet", () => {
    expect(evaluateInvoicePaymentPolicy({
      idempotencyKey: "court",
      input: { invoiceId: 12, amount: 100, method: "cash" },
    })).toMatchObject({ allowed: false, code: "invoice_payment.idempotency_invalid" });

    expect(evaluateInvoicePaymentPolicy({
      idempotencyKey: "payment-001",
      input: { invoiceId: 12, amount: 0, method: "cash" },
    })).toMatchObject({ allowed: false, code: "invoice_payment.amount_invalid" });

    expect(evaluateInvoicePaymentPolicy({
      idempotencyKey: "payment-001",
      input: { invoiceId: 12, amount: 100, method: "crypto" },
    })).toMatchObject({ allowed: false, code: "invoice_payment.method_invalid" });
  });

  test("autorise un paiement client complet", () => {
    expect(evaluateInvoicePaymentPolicy({
      idempotencyKey: "payment-001",
      input: { invoiceId: 12, amount: 100, method: "bank_transfer" },
    })).toEqual({ allowed: true, code: "invoice_payment.input_valid" });
  });

  test("la finalisation exige événement, MADTrust et graphe", async () => {
    await expect(verifyInvoiceFinalization({
      result: {
        invoice: { status: "finalized" },
        event: { event_id: "event-1" },
        trust: { assessmentId: "trust-1" },
        graph: [{ id: 1 }, { id: 2 }],
      },
    })).resolves.toBeUndefined();

    await expect(verifyInvoiceFinalization({
      result: {
        invoice: { status: "finalized" },
        event: null,
        trust: { assessmentId: "trust-1" },
        graph: [{ id: 1 }, { id: 2 }],
      },
    })).rejects.toThrow("invoice.finalized");
  });

  test("le paiement exige événement, MADTrust, graphe et solde cohérent", async () => {
    await expect(verifyInvoicePayment({
      result: {
        duplicate: false,
        payment: { id: 9 },
        event: { event_id: "event-2" },
        trust: { assessmentId: "trust-2" },
        graph: [{ id: 1 }, { id: 2 }, { id: 3 }],
        summary: { balance: "0.00" },
      },
    })).resolves.toBeUndefined();

    await expect(verifyInvoicePayment({
      result: {
        duplicate: false,
        payment: { id: 9 },
        event: { event_id: "event-2" },
        trust: null,
        graph: [{ id: 1 }, { id: 2 }, { id: 3 }],
        summary: { balance: "0.00" },
      },
    })).rejects.toThrow("MADTrust");
  });

  test("une répétition idempotente demeure valide sans nouvelle preuve", async () => {
    await expect(verifyInvoicePayment({
      result: { duplicate: true, payment: { id: 9 }, summary: { balance: "25.00" } },
    })).resolves.toBeUndefined();
  });
});
