const {
  inspectPeriodLock,
  assertOpenAccountingPeriod,
} = require("../services/business/accounting-period-lock.service");

function dbWith(...rows) {
  const query = jest.fn();
  for (const row of rows) query.mockResolvedValueOnce({ rows: row });
  return { query };
}

describe("verrouillage des périodes comptables", () => {
  test("autorise une opération dans une période ouverte", async () => {
    const db = dbWith([{
      id: 10,
      fiscal_year: 2026,
      period_number: 7,
      starts_on: "2026-07-01",
      ends_on: "2026-07-31",
      status: "open",
    }]);

    await expect(inspectPeriodLock(db, {
      organisationId: 4,
      entryDate: "2026-07-15",
      operation: "entry.post",
    })).resolves.toMatchObject({
      allowed: true,
      code: "accounting_period.open",
      mutatesAccounting: false,
    });
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining("organisation_id=$1"), [4, "2026-07-15"]);
  });

  test("refuse une période fermée et propose la prochaine période ouverte", async () => {
    const db = dbWith(
      [{
        id: 10,
        fiscal_year: 2026,
        period_number: 7,
        starts_on: "2026-07-01",
        ends_on: "2026-07-31",
        status: "closed",
        closed_at: "2026-08-02T12:00:00.000Z",
        close_reason: "Fermeture mensuelle approuvée",
      }],
      [{
        id: 11,
        fiscal_year: 2026,
        period_number: 8,
        starts_on: "2026-08-01",
        ends_on: "2026-08-31",
        status: "open",
      }],
    );

    const inspection = await inspectPeriodLock(db, {
      organisationId: 4,
      entryDate: "2026-07-15",
      operation: "adjustment.post",
    });

    expect(inspection).toMatchObject({
      allowed: false,
      code: "accounting_period.closed",
      requiresHumanDecision: true,
      mutatesAccounting: false,
      period: { id: 10, status: "closed" },
      nextOpenPeriod: { id: 11, status: "open" },
    });
  });

  test("ne déplace jamais automatiquement la date vers la période suivante", async () => {
    const db = dbWith(
      [{ id: 10, starts_on: "2026-07-01", ends_on: "2026-07-31", status: "closed" }],
      [{ id: 11, starts_on: "2026-08-01", ends_on: "2026-08-31", status: "open" }],
    );

    await expect(assertOpenAccountingPeriod(db, {
      organisationId: 4,
      entryDate: "2026-07-15",
      operation: "reversal.post",
    })).rejects.toMatchObject({
      statusCode: 409,
      code: "accounting_period.closed",
      details: {
        entryDate: "2026-07-15",
        nextOpenPeriod: { id: 11 },
        requiresHumanDecision: true,
        mutatesAccounting: false,
      },
    });
  });

  test("refuse une date sans période configurée", async () => {
    const db = dbWith([]);
    await expect(assertOpenAccountingPeriod(db, {
      organisationId: 4,
      entryDate: "2030-01-01",
      operation: "entry.create",
    })).rejects.toMatchObject({
      statusCode: 409,
      code: "accounting_period.not_configured",
    });
  });

  test("exige une date comptable", async () => {
    await expect(inspectPeriodLock({ query: jest.fn() }, {
      organisationId: 4,
      operation: "entry.post",
    })).rejects.toMatchObject({
      statusCode: 400,
      code: "accounting_period.entry_date_required",
    });
  });
});
