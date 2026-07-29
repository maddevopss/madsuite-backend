jest.mock("../services/business/accounting-reconciliation.service", () => ({
  reconcilePostedSources: jest.fn(),
}));

jest.mock("../services/business/accounting-governance.service", () => ({
  createPostedAdjustment: jest.fn(),
}));

const reconciliationService = require("../services/business/accounting-reconciliation.service");
const governanceService = require("../services/business/accounting-governance.service");
const {
  findAnomaly,
  validateCommand,
  applyControlledAdjustment,
} = require("../services/business/accounting-remediation.service");

const command = {
  sourceType: "invoice",
  sourceId: "42",
  confirmedByHuman: true,
  reason: "Corriger l’écart confirmé par la personne responsable.",
  idempotencyKey: "remediation-invoice-42",
  entryDate: "2026-07-28",
  description: "Ajustement de la facture 42",
  lines: [
    { accountId: 1, debit: 15, credit: 0 },
    { accountId: 2, debit: 0, credit: 15 },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
});

test("refuse une correction sans confirmation humaine", () => {
  expect(() => validateCommand({ ...command, confirmedByHuman: false }))
    .toThrow("confirmation humaine explicite");
});

test("refuse une justification trop courte", () => {
  expect(() => validateCommand({ ...command, reason: "écart" }))
    .toThrow("au moins 10 caractères");
});

test("retrouve l’anomalie par source", () => {
  expect(findAnomaly({ anomalies: [{ sourceType: "invoice", sourceId: 42 }] }, command))
    .toMatchObject({ sourceType: "invoice", sourceId: 42 });
});

test("refuse une correction lorsque l’anomalie a disparu", async () => {
  reconciliationService.reconcilePostedSources.mockResolvedValue({ anomalies: [] });
  await expect(applyControlledAdjustment({ db: {}, organisationId: 7, userId: 9, command }))
    .rejects.toMatchObject({ code: "ACCOUNTING_REMEDIATION_STALE", statusCode: 409 });
  expect(governanceService.createPostedAdjustment).not.toHaveBeenCalled();
});

test("refuse un ajustement lorsque la recommandation exige un renversement", async () => {
  reconciliationService.reconcilePostedSources.mockResolvedValue({
    anomalies: [{
      sourceType: "invoice",
      sourceId: "42",
      status: "duplicate_entries",
      remediation: { action: "review_and_reverse" },
    }],
  });
  await expect(applyControlledAdjustment({ db: {}, organisationId: 7, userId: 9, command }))
    .rejects.toMatchObject({ code: "ACCOUNTING_REMEDIATION_ACTION_NOT_ALLOWED", statusCode: 409 });
});

test("crée un ajustement idempotent et retourne la preuve avant/après", async () => {
  const before = {
    sourceType: "invoice",
    sourceId: "42",
    status: "amount_mismatch",
    remediation: { action: "create_adjustment" },
  };
  reconciliationService.reconcilePostedSources
    .mockResolvedValueOnce({ anomalies: [before], healthy: false })
    .mockResolvedValueOnce({ anomalies: [], healthy: true });
  governanceService.createPostedAdjustment.mockResolvedValue({
    duplicate: false,
    entry: { id: 88, status: "posted" },
  });
  const db = {
    query: jest.fn().mockResolvedValue({ rows: [{ id: 88 }] }),
  };

  const result = await applyControlledAdjustment({ db, organisationId: 7, userId: 9, command });

  expect(governanceService.createPostedAdjustment).toHaveBeenCalledWith(expect.objectContaining({
    organisationId: 7,
    userId: 9,
    idempotencyKey: "remediation-invoice-42",
    reason: command.reason,
    adjustmentKind: "reconciliation_amount_mismatch",
  }));
  expect(db.query).toHaveBeenCalledWith(
    expect.stringContaining("UPDATE accounting_entries"),
    ["accounting_adjustment_invoice", "42", 7, 88],
  );
  expect(result).toMatchObject({
    confirmedByHuman: true,
    before,
    after: null,
    resolved: true,
    adjustment: { entry: { id: 88, status: "posted" } },
  });
});