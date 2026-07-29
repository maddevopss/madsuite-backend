jest.mock("../services/business/accounting-governance.service", () => ({
  createPostedAdjustment: jest.fn(),
}));

jest.mock("../services/business/accounting-period-lock.service", () => ({
  assertOpenAccountingPeriod: jest.fn(),
}));

const governanceService = require("../services/business/accounting-governance.service");
const { assertOpenAccountingPeriod } = require("../services/business/accounting-period-lock.service");
const guardedService = require("../services/business/accounting-governance-period-guarded.service");

describe("ajustements protégés par les périodes comptables", () => {
  beforeEach(() => jest.clearAllMocks());

  test("refuse une exécution sans connexion active", async () => {
    await expect(guardedService.createPostedAdjustment({
      organisationId: 7,
      entryDate: "2026-07-29",
    })).rejects.toMatchObject({
      code: "accounting_period.db_required",
      statusCode: 500,
    });

    expect(assertOpenAccountingPeriod).not.toHaveBeenCalled();
    expect(governanceService.createPostedAdjustment).not.toHaveBeenCalled();
  });

  test("vérifie la période avant de publier un ajustement", async () => {
    const db = { query: jest.fn() };
    const input = {
      db,
      organisationId: 7,
      userId: 12,
      entryDate: "2026-07-29",
      description: "Ajustement contrôlé",
      reason: "Correction approuvée",
      idempotencyKey: "adjust-20260729",
      lines: [
        { accountId: 1, debit: 25, credit: 0 },
        { accountId: 2, debit: 0, credit: 25 },
      ],
    };
    assertOpenAccountingPeriod.mockResolvedValue({ allowed: true });
    governanceService.createPostedAdjustment.mockResolvedValue({ entry: { id: 44 } });

    await expect(guardedService.createPostedAdjustment(input)).resolves.toEqual({ entry: { id: 44 } });

    expect(assertOpenAccountingPeriod).toHaveBeenCalledWith(db, {
      organisationId: 7,
      entryDate: "2026-07-29",
      operation: "accounting.adjustment.post",
    });
    expect(assertOpenAccountingPeriod.mock.invocationCallOrder[0])
      .toBeLessThan(governanceService.createPostedAdjustment.mock.invocationCallOrder[0]);
  });

  test("ne publie aucun ajustement lorsque la période est fermée", async () => {
    const db = { query: jest.fn() };
    assertOpenAccountingPeriod.mockRejectedValue(Object.assign(new Error("Période fermée"), {
      code: "accounting_period.closed",
      statusCode: 409,
    }));

    await expect(guardedService.createPostedAdjustment({
      db,
      organisationId: 7,
      entryDate: "2026-06-30",
    })).rejects.toMatchObject({ code: "accounting_period.closed", statusCode: 409 });

    expect(governanceService.createPostedAdjustment).not.toHaveBeenCalled();
  });
});
