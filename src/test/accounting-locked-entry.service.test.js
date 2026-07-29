jest.mock("../services/business/accounting.service", () => ({
  createEntry: jest.fn(),
  postEntry: jest.fn(),
}));

jest.mock("../services/business/accounting-period-lock.service", () => ({
  assertOpenAccountingPeriod: jest.fn(),
}));

const accountingService = require("../services/business/accounting.service");
const { assertOpenAccountingPeriod } = require("../services/business/accounting-period-lock.service");
const lockedEntryService = require("../services/business/accounting-locked-entry.service");

describe("écritures protégées par les périodes comptables", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("vérifie la période avant de créer une écriture", async () => {
    const db = { query: jest.fn() };
    const payload = {
      entryDate: "2026-07-29",
      description: "Écriture contrôlée",
      lines: [
        { accountId: 1, debit: 25, credit: 0 },
        { accountId: 2, debit: 0, credit: 25 },
      ],
    };
    assertOpenAccountingPeriod.mockResolvedValue({ allowed: true });
    accountingService.createEntry.mockResolvedValue({ id: 88 });

    await expect(lockedEntryService.createEntry(db, 7, 12, payload)).resolves.toEqual({ id: 88 });

    expect(assertOpenAccountingPeriod).toHaveBeenCalledWith(db, {
      organisationId: 7,
      entryDate: "2026-07-29",
      operation: "accounting.entry.create",
    });
    expect(assertOpenAccountingPeriod.mock.invocationCallOrder[0])
      .toBeLessThan(accountingService.createEntry.mock.invocationCallOrder[0]);
  });

  test("ne crée rien lorsque la période est fermée", async () => {
    const db = { query: jest.fn() };
    const refusal = Object.assign(new Error("Période fermée"), {
      statusCode: 409,
      code: "accounting_period.closed",
    });
    assertOpenAccountingPeriod.mockRejectedValue(refusal);

    await expect(lockedEntryService.createEntry(db, 7, 12, {
      entryDate: "2026-06-30",
      description: "Refus attendu",
      lines: [],
    })).rejects.toMatchObject({ code: "accounting_period.closed", statusCode: 409 });

    expect(accountingService.createEntry).not.toHaveBeenCalled();
  });

  test("relit la date du brouillon avant publication", async () => {
    const db = {
      query: jest.fn().mockResolvedValue({ rows: [{ id: 99, entry_date: "2026-07-29", status: "draft" }] }),
    };
    assertOpenAccountingPeriod.mockResolvedValue({ allowed: true });
    accountingService.postEntry.mockResolvedValue({ id: 99, status: "posted" });

    await expect(lockedEntryService.postEntry(db, 7, 99)).resolves.toMatchObject({ status: "posted" });

    expect(db.query).toHaveBeenCalledWith(expect.stringContaining("organisation_id=$1"), [7, 99]);
    expect(assertOpenAccountingPeriod).toHaveBeenCalledWith(db, {
      organisationId: 7,
      entryDate: "2026-07-29",
      operation: "accounting.entry.post",
    });
    expect(assertOpenAccountingPeriod.mock.invocationCallOrder[0])
      .toBeLessThan(accountingService.postEntry.mock.invocationCallOrder[0]);
  });

  test("ne publie rien lorsque la période est fermée", async () => {
    const db = {
      query: jest.fn().mockResolvedValue({ rows: [{ id: 99, entry_date: "2026-06-30", status: "draft" }] }),
    };
    assertOpenAccountingPeriod.mockRejectedValue(Object.assign(new Error("Période fermée"), {
      statusCode: 409,
      code: "accounting_period.closed",
    }));

    await expect(lockedEntryService.postEntry(db, 7, 99))
      .rejects.toMatchObject({ code: "accounting_period.closed" });

    expect(accountingService.postEntry).not.toHaveBeenCalled();
  });

  test("ignore une écriture absente ou déjà publiée", async () => {
    const absentDb = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    await expect(lockedEntryService.postEntry(absentDb, 7, 99)).resolves.toBeNull();

    const postedDb = {
      query: jest.fn().mockResolvedValue({ rows: [{ id: 99, entry_date: "2026-07-29", status: "posted" }] }),
    };
    await expect(lockedEntryService.postEntry(postedDb, 7, 99)).resolves.toBeNull();

    expect(assertOpenAccountingPeriod).not.toHaveBeenCalled();
    expect(accountingService.postEntry).not.toHaveBeenCalled();
  });
});
