jest.mock("../services/business/accounting.service", () => ({
  createEntry: jest.fn(),
  postEntry: jest.fn(),
  reverseEntry: jest.fn(),
}));

jest.mock("../services/business/accounting-period-lock.service", () => ({
  assertOpenAccountingPeriod: jest.fn(),
}));

const accountingService = require("../services/business/accounting.service");
const { assertOpenAccountingPeriod } = require("../services/business/accounting-period-lock.service");
const guarded = require("../services/business/accounting-period-guarded-operations.service");

describe("opérations comptables protégées par période", () => {
  beforeEach(() => jest.clearAllMocks());

  test("vérifie la période avant de créer une écriture", async () => {
    const db = { query: jest.fn() };
    assertOpenAccountingPeriod.mockResolvedValue({ allowed: true });
    accountingService.createEntry.mockResolvedValue({ id: 1 });

    await expect(guarded.createEntry(db, 7, 9, {
      entryDate: "2026-07-29",
      description: "Écriture contrôlée",
      lines: [{}, {}],
    })).resolves.toEqual({ id: 1 });

    expect(assertOpenAccountingPeriod).toHaveBeenCalledWith(db, {
      organisationId: 7,
      entryDate: "2026-07-29",
      operation: "accounting.entry.create",
    });
    expect(assertOpenAccountingPeriod.mock.invocationCallOrder[0])
      .toBeLessThan(accountingService.createEntry.mock.invocationCallOrder[0]);
  });

  test("n’appelle jamais la création lorsque la période est fermée", async () => {
    const db = { query: jest.fn() };
    const error = Object.assign(new Error("Période fermée"), { statusCode: 409 });
    assertOpenAccountingPeriod.mockRejectedValue(error);

    await expect(guarded.createEntry(db, 7, 9, { entryDate: "2026-07-29" }))
      .rejects.toBe(error);
    expect(accountingService.createEntry).not.toHaveBeenCalled();
  });

  test("relit la date de l’écriture avant sa publication", async () => {
    const db = { query: jest.fn().mockResolvedValue({ rows: [{ id: 44, entry_date: "2026-07-29", status: "draft" }] }) };
    assertOpenAccountingPeriod.mockResolvedValue({ allowed: true });
    accountingService.postEntry.mockResolvedValue({ id: 44, status: "posted" });

    await guarded.postEntry(db, 7, 44);

    expect(db.query).toHaveBeenCalledWith(expect.stringContaining("organisation_id=$1"), [7, 44]);
    expect(assertOpenAccountingPeriod).toHaveBeenCalledWith(db, {
      organisationId: 7,
      entryDate: "2026-07-29",
      operation: "accounting.entry.post",
    });
    expect(assertOpenAccountingPeriod.mock.invocationCallOrder[0])
      .toBeLessThan(accountingService.postEntry.mock.invocationCallOrder[0]);
  });

  test("refuse la publication avant toute mutation lorsque la période est fermée", async () => {
    const db = { query: jest.fn().mockResolvedValue({ rows: [{ id: 44, entry_date: "2026-07-29", status: "draft" }] }) };
    assertOpenAccountingPeriod.mockRejectedValue(Object.assign(new Error("Période fermée"), { statusCode: 409 }));

    await expect(guarded.postEntry(db, 7, 44)).rejects.toMatchObject({ statusCode: 409 });
    expect(accountingService.postEntry).not.toHaveBeenCalled();
  });

  test("vérifie la date de contrepassation avant le renversement", async () => {
    const db = { query: jest.fn() };
    assertOpenAccountingPeriod.mockResolvedValue({ allowed: true });
    accountingService.reverseEntry.mockResolvedValue({ id: 45 });

    await guarded.reverseEntry(db, 7, 9, 44, "2026-08-01", "Correction approuvée");

    expect(assertOpenAccountingPeriod).toHaveBeenCalledWith(db, {
      organisationId: 7,
      entryDate: "2026-08-01",
      operation: "accounting.entry.reverse",
    });
    expect(assertOpenAccountingPeriod.mock.invocationCallOrder[0])
      .toBeLessThan(accountingService.reverseEntry.mock.invocationCallOrder[0]);
  });
});
