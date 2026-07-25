const {
  SUPPLIER_PAYMENT_REVERSAL_POLICY,
  evaluateSupplierPaymentReversalPolicy,
  verifySupplierPaymentReversal,
} = require("../services/business/payment-reversal.service");

describe("renversement de paiement fournisseur conforme au CTMAD", () => {
  test("expose une politique versionnée", () => {
    expect(SUPPLIER_PAYMENT_REVERSAL_POLICY).toBe("supplier.payment.reverse@1");
  });

  test("refuse une demande sans clé d’idempotence", () => {
    expect(evaluateSupplierPaymentReversalPolicy({
      idempotencyKey: "",
      input: { paymentId: 9, reason: "Paiement saisi en double" },
    })).toMatchObject({
      allowed: false,
      code: "supplier_payment_reversal.idempotency_required",
    });
  });

  test("refuse une demande sans raison explicite", () => {
    expect(evaluateSupplierPaymentReversalPolicy({
      idempotencyKey: "reverse-payment-9",
      input: { paymentId: 9, reason: "non" },
    })).toMatchObject({
      allowed: false,
      code: "supplier_payment_reversal.reason_required",
    });
  });

  test("autorise une intention complète", () => {
    expect(evaluateSupplierPaymentReversalPolicy({
      idempotencyKey: "reverse-payment-9",
      input: { paymentId: 9, reason: "Paiement saisi en double" },
    })).toEqual({
      allowed: true,
      code: "supplier_payment_reversal.input_valid",
    });
  });

  test("la validation postérieure exige le marquage, l’événement et MADTrust", async () => {
    await expect(verifySupplierPaymentReversal({
      result: {
        duplicate: false,
        payment: { id: 9, reversed_at: "2026-07-25T12:00:00.000Z" },
        event: { event_id: "ca564cea-a337-4af0-a67e-e7df62573980" },
        trust: { assessmentId: "68b6a695-bdda-43e4-a998-bd4477200bbf" },
      },
    })).resolves.toBeUndefined();

    await expect(verifySupplierPaymentReversal({
      result: {
        duplicate: false,
        payment: { id: 9, reversed_at: "2026-07-25T12:00:00.000Z" },
        event: null,
        trust: { assessmentId: "68b6a695-bdda-43e4-a998-bd4477200bbf" },
      },
    })).rejects.toThrow("événement");
  });

  test("une répétition idempotente demeure valide", async () => {
    await expect(verifySupplierPaymentReversal({
      result: { duplicate: true, payment: { id: 9, reversed_at: "2026-07-25T12:00:00.000Z" } },
    })).resolves.toBeUndefined();
  });
});
