jest.mock("../../db", () => ({ pool: { connect: jest.fn() } }));
jest.mock("../services/business/business-event.service", () => ({ appendEvent: jest.fn() }));
jest.mock("../services/business/trust-persistence.service", () => ({
  persistTrustAssessment: jest.fn(),
  persistGraphEdges: jest.fn(),
}));

const governance = require("../services/business/accounting-governance.service");
const reversal = require("../services/business/accounting-reversal-governance.service");
const { resolvePolicy } = require("../services/business/transaction-engine.service");

describe("gouvernance comptable CTMAD", () => {
  test("enregistre les politiques de périodes et ajustements", () => {
    expect(resolvePolicy(governance.PERIOD_CLOSE_POLICY).version).toBe("1");
    expect(resolvePolicy(governance.PERIOD_REOPEN_POLICY).version).toBe("1");
    expect(resolvePolicy(governance.ADJUSTMENT_POST_POLICY).version).toBe("1");
  });

  test("enregistre la politique de renversement compensatoire", () => {
    expect(resolvePolicy(reversal.ENTRY_REVERSE_POLICY).version).toBe("1");
  });

  test("refuse une fermeture sans raison significative", () => {
    const result = resolvePolicy(governance.PERIOD_CLOSE_POLICY).evaluate({
      input: { periodId: 12, reason: "non" },
    });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe("accounting_period.close_reason_required");
  });

  test("refuse un ajustement sans clé d’idempotence", () => {
    const result = resolvePolicy(governance.ADJUSTMENT_POST_POLICY).evaluate({
      idempotencyKey: "court",
      input: {
        entryDate: "2026-07-25",
        description: "Ajustement de fin de mois",
        reason: "Correction documentée",
      },
    });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe("accounting_adjustment.idempotency_invalid");
  });

  test("refuse un renversement sans date", () => {
    const result = resolvePolicy(reversal.ENTRY_REVERSE_POLICY).evaluate({
      idempotencyKey: "reverse-12345",
      input: { entryId: 44, reason: "Correction documentée" },
    });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe("accounting_reversal.data_required");
  });

  test("autorise les intentions comptables complètes", () => {
    expect(resolvePolicy(governance.PERIOD_CLOSE_POLICY).evaluate({
      input: { periodId: 12, reason: "Fermeture mensuelle validée" },
    }).allowed).toBe(true);

    expect(resolvePolicy(governance.PERIOD_REOPEN_POLICY).evaluate({
      input: { periodId: 12, reason: "Ajustement autorisé requis" },
    }).allowed).toBe(true);

    expect(resolvePolicy(governance.ADJUSTMENT_POST_POLICY).evaluate({
      idempotencyKey: "adjustment-12345",
      input: { entryDate: "2026-07-25", description: "Ajustement", reason: "Correction documentée" },
    }).allowed).toBe(true);

    expect(resolvePolicy(reversal.ENTRY_REVERSE_POLICY).evaluate({
      idempotencyKey: "reverse-12345",
      input: { entryId: 44, reversalDate: "2026-07-25", reason: "Correction documentée" },
    }).allowed).toBe(true);
  });
});
