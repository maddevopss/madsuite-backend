const {
  SUPPLIER_PAYMENT_POLICY,
  evaluateSupplierPaymentPolicy,
  verifySupplierPayment,
} = require("../services/business/supplier-payment.service");

describe("paiement fournisseur conforme au CTMAD", () => {
  test("expose une politique métier versionnée", () => {
    expect(SUPPLIER_PAYMENT_POLICY).toBe("supplier.payment.post@1");
  });

  test("refuse une intention sans clé d’idempotence", () => {
    expect(evaluateSupplierPaymentPolicy({
      idempotencyKey: "",
      input: { billId: 41, amount: 125 },
    })).toMatchObject({
      allowed: false,
      statusCode: 400,
      code: "supplier_payment.idempotency_key_required",
    });
  });

  test("refuse un montant nul ou négatif", () => {
    expect(evaluateSupplierPaymentPolicy({
      idempotencyKey: "payment-41",
      input: { billId: 41, amount: 0 },
    })).toMatchObject({
      allowed: false,
      code: "supplier_payment.amount_invalid",
    });
  });

  test("refuse une intention sans facture fournisseur", () => {
    expect(evaluateSupplierPaymentPolicy({
      idempotencyKey: "payment-41",
      input: { amount: 125 },
    })).toMatchObject({
      allowed: false,
      code: "supplier_payment.bill_required",
    });
  });

  test("autorise une intention complète", () => {
    expect(evaluateSupplierPaymentPolicy({
      idempotencyKey: "payment-41",
      input: { billId: 41, amount: 125 },
    })).toEqual({
      allowed: true,
      code: "supplier_payment.input_valid",
    });
  });

  test("la validation postérieure exige le paiement, l’événement et le statut final", async () => {
    await expect(verifySupplierPayment({
      result: {
        payment: { id: 9 },
        event: { event_id: "8c621680-c786-4bb6-98dd-886f072fea86" },
        status: "partially_paid",
        duplicate: false,
      },
    })).resolves.toBeUndefined();

    await expect(verifySupplierPayment({
      result: {
        payment: { id: 9 },
        event: null,
        status: "partially_paid",
        duplicate: false,
      },
    })).rejects.toThrow("événement");
  });

  test("une répétition idempotente demeure valide sans produire un second événement", async () => {
    await expect(verifySupplierPayment({
      result: { payment: { id: 9 }, duplicate: true },
    })).resolves.toBeUndefined();
  });
});
