jest.mock("../../db", () => ({ pool: { connect: jest.fn() } }));
jest.mock("../services/business/business-event.service", () => ({ appendEvent: jest.fn() }));
jest.mock("../services/business/trust-persistence.service", () => ({
  persistTrustAssessment: jest.fn(),
  persistGraphEdges: jest.fn(),
}));
jest.mock("../services/business/accounting-sync.service", () => ({
  ACCOUNT_CODES: { payables: "2000", generalExpense: "6900", taxReceivable: "1300" },
  loadAccounts: jest.fn(),
  recordPostedEntry: jest.fn(),
  recordSupplierBillAccounting: jest.fn(),
}));

const {
  APPROVE_POLICY,
  CREDIT_POLICY,
  VOID_POLICY,
  validIdempotency,
  normalizeMoney,
} = require("../services/business/supplier-bill-lifecycle.service");
const { resolvePolicy } = require("../services/business/transaction-engine.service");

describe("cycle fournisseur CTMAD", () => {
  test("enregistre les trois politiques versionnées", () => {
    expect(resolvePolicy(APPROVE_POLICY).version).toBe("1");
    expect(resolvePolicy(CREDIT_POLICY).version).toBe("1");
    expect(resolvePolicy(VOID_POLICY).version).toBe("1");
  });

  test("valide les clés d’idempotence", () => {
    expect(validIdempotency("12345678")).toBe(true);
    expect(validIdempotency("court")).toBe(false);
    expect(validIdempotency(null)).toBe(false);
  });

  test("normalise les montants en dollars canadiens", () => {
    expect(normalizeMoney("125.678")).toBe(125.68);
    expect(normalizeMoney(0)).toBeNull();
    expect(normalizeMoney(0, { allowZero: true })).toBe(0);
    expect(normalizeMoney(-1)).toBeNull();
  });

  test("refuse une note de crédit sans raison", () => {
    const policy = resolvePolicy(CREDIT_POLICY);
    const result = policy.evaluate({
      idempotencyKey: "credit-12345",
      input: { billId: 10, total: 25, reason: "" },
    });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe("supplier_credit.reason_required");
  });

  test("refuse une annulation sans clé d’idempotence", () => {
    const policy = resolvePolicy(VOID_POLICY);
    const result = policy.evaluate({
      idempotencyKey: "court",
      input: { billId: 10, reason: "Erreur de saisie" },
    });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe("supplier_void.idempotency_invalid");
  });

  test("autorise les intentions complètes", () => {
    expect(resolvePolicy(APPROVE_POLICY).evaluate({ input: { billId: 10 } }).allowed).toBe(true);
    expect(resolvePolicy(CREDIT_POLICY).evaluate({
      idempotencyKey: "credit-12345",
      input: { billId: 10, total: 25, reason: "Retour de marchandise" },
    }).allowed).toBe(true);
    expect(resolvePolicy(VOID_POLICY).evaluate({
      idempotencyKey: "void-123456",
      input: { billId: 10, reason: "Facture créée en double" },
    }).allowed).toBe(true);
  });
});
