const {
  CUSTOMER_PAYMENT_REVERSAL_POLICY,
  INVOICE_VOID_POLICY,
  CREDIT_NOTE_POLICY,
  evaluateCustomerPaymentReversalPolicy,
  evaluateInvoiceVoidPolicy,
  evaluateCreditNotePolicy,
} = require("../services/business/customer-reversal.service");

describe("brique complète des renversements clients CTMAD", () => {
  test("expose trois politiques versionnées", () => {
    expect(CUSTOMER_PAYMENT_REVERSAL_POLICY).toBe("invoice.payment.reverse@1");
    expect(INVOICE_VOID_POLICY).toBe("invoice.void@1");
    expect(CREDIT_NOTE_POLICY).toBe("invoice.credit_note.post@1");
  });

  test("refuse un renversement de paiement sans raison", () => {
    expect(evaluateCustomerPaymentReversalPolicy({
      idempotencyKey: "reverse-payment-42",
      input: { paymentId: 42, reason: "" },
    })).toMatchObject({ allowed: false, code: "reversal.reason_required" });
  });

  test("refuse un renversement de paiement sans paiement cible", () => {
    expect(evaluateCustomerPaymentReversalPolicy({
      idempotencyKey: "reverse-payment-42",
      input: { reason: "Saisie en double" },
    })).toMatchObject({ allowed: false, code: "payment_reversal.payment_required" });
  });

  test("autorise un renversement de paiement complet", () => {
    expect(evaluateCustomerPaymentReversalPolicy({
      idempotencyKey: "reverse-payment-42",
      input: { paymentId: 42, reason: "Saisie en double" },
    })).toEqual({ allowed: true, code: "payment_reversal.input_valid" });
  });

  test("refuse l’annulation sans facture cible", () => {
    expect(evaluateInvoiceVoidPolicy({
      idempotencyKey: "void-invoice-42",
      input: { reason: "Facture créée par erreur" },
    })).toMatchObject({ allowed: false, code: "invoice_void.invoice_required" });
  });

  test("autorise une annulation documentée", () => {
    expect(evaluateInvoiceVoidPolicy({
      idempotencyKey: "void-invoice-42",
      input: { invoiceId: 42, reason: "Facture créée par erreur" },
    })).toEqual({ allowed: true, code: "invoice_void.input_valid" });
  });

  test("refuse une note de crédit nulle", () => {
    expect(evaluateCreditNotePolicy({
      idempotencyKey: "credit-note-42",
      input: { invoiceId: 42, subtotal: 0, taxTotal: 0, reason: "Ajustement" },
    })).toMatchObject({ allowed: false, code: "credit_note.amount_invalid" });
  });

  test("refuse une taxe négative dans une note de crédit", () => {
    expect(evaluateCreditNotePolicy({
      idempotencyKey: "credit-note-42",
      input: { invoiceId: 42, subtotal: 100, taxTotal: -1, reason: "Ajustement" },
    })).toMatchObject({ allowed: false, code: "credit_note.amount_invalid" });
  });

  test("autorise une note de crédit complète", () => {
    expect(evaluateCreditNotePolicy({
      idempotencyKey: "credit-note-42",
      input: { invoiceId: 42, subtotal: 100, taxTotal: 14.98, reason: "Réduction convenue" },
    })).toEqual({ allowed: true, code: "credit_note.input_valid" });
  });

  test("toutes les opérations exigent une clé d’idempotence solide", () => {
    expect(evaluateInvoiceVoidPolicy({
      idempotencyKey: "court",
      input: { invoiceId: 42, reason: "Erreur" },
    })).toMatchObject({ allowed: false, code: "reversal.idempotency_key_required" });
  });
});
