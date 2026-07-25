jest.mock("../../db", () => ({ pool: { connect: jest.fn() } }));
jest.mock("../services/business/business-event.service", () => ({ appendEvent: jest.fn() }));
jest.mock("../services/business/trust-persistence.service", () => ({
  persistTrustAssessment: jest.fn(),
  persistGraphEdges: jest.fn(),
}));
jest.mock("../services/business/accounting-sync.service", () => ({
  recordPostedEntry: jest.fn(),
}));

const {
  RECEIPT_POLICY,
  ISSUE_POLICY,
  ADJUST_POLICY,
  TRANSFER_POLICY,
  normalizeQuantity,
  normalizeCost,
  validIdempotency,
  weightedAverage,
} = require("../services/business/inventory-transaction.service");
const { resolvePolicy } = require("../services/business/transaction-engine.service");

describe("inventaire transactionnel CTMAD", () => {
  test("enregistre les quatre politiques versionnées", () => {
    expect(resolvePolicy(RECEIPT_POLICY).version).toBe("1");
    expect(resolvePolicy(ISSUE_POLICY).version).toBe("1");
    expect(resolvePolicy(ADJUST_POLICY).version).toBe("1");
    expect(resolvePolicy(TRANSFER_POLICY).version).toBe("1");
  });

  test("normalise les quantités et coûts", () => {
    expect(normalizeQuantity("2.3456")).toBe(2.346);
    expect(normalizeQuantity(0)).toBeNull();
    expect(normalizeCost("12.34567")).toBe(12.3457);
    expect(normalizeCost(0)).toBeNull();
    expect(normalizeCost(0, { allowZero: true })).toBe(0);
  });

  test("calcule le coût moyen pondéré", () => {
    expect(weightedAverage(10, 5, 5, 8)).toBe(6);
    expect(weightedAverage(0, 0, 4, 2.5)).toBe(2.5);
  });

  test("exige une clé d’idempotence", () => {
    expect(validIdempotency("stock-1234")).toBe(true);
    expect(validIdempotency("court")).toBe(false);
  });

  test("refuse une réception sans coût", () => {
    const result = resolvePolicy(RECEIPT_POLICY).evaluate({
      idempotencyKey: "receipt-1234",
      input: { itemId: 1, locationId: 2, quantity: 5, unitCost: 0 },
    });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe("inventory_receipt.cost_invalid");
  });

  test("refuse un ajustement sans raison", () => {
    const result = resolvePolicy(ADJUST_POLICY).evaluate({
      idempotencyKey: "adjust-1234",
      input: { itemId: 1, locationId: 2, quantity: 1, direction: "decrease", reason: "" },
    });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe("inventory_adjustment.reason_required");
  });

  test("refuse un transfert vers le même emplacement", () => {
    const result = resolvePolicy(TRANSFER_POLICY).evaluate({
      idempotencyKey: "transfer-1234",
      input: { itemId: 1, locationId: 2, destinationLocationId: 2, quantity: 1 },
    });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe("inventory_transfer.destination_invalid");
  });

  test("autorise les intentions complètes", () => {
    expect(resolvePolicy(RECEIPT_POLICY).evaluate({ idempotencyKey: "receipt-1234", input: { itemId: 1, locationId: 2, quantity: 5, unitCost: 3 } }).allowed).toBe(true);
    expect(resolvePolicy(ISSUE_POLICY).evaluate({ idempotencyKey: "issue-12345", input: { itemId: 1, locationId: 2, quantity: 1 } }).allowed).toBe(true);
    expect(resolvePolicy(ADJUST_POLICY).evaluate({ idempotencyKey: "adjust-1234", input: { itemId: 1, locationId: 2, quantity: 1, direction: "increase", reason: "Comptage physique" } }).allowed).toBe(true);
    expect(resolvePolicy(TRANSFER_POLICY).evaluate({ idempotencyKey: "transfer-1234", input: { itemId: 1, locationId: 2, destinationLocationId: 3, quantity: 1 } }).allowed).toBe(true);
  });
});
