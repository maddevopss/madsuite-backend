const { organisationValue } = require("../../utils/organisationScope");

function periodLockError({ operation, entryDate, period, nextOpenPeriod }) {
  return Object.assign(
    new Error("La période comptable visée est fermée. Aucune écriture ne peut y être créée, publiée, ajustée ou renversée."),
    {
      statusCode: 409,
      code: "accounting_period.closed",
      details: {
        operation,
        entryDate,
        period: period ? {
          id: period.id,
          fiscalYear: period.fiscal_year,
          periodNumber: period.period_number,
          startsOn: period.starts_on,
          endsOn: period.ends_on,
          status: period.status,
          closedAt: period.closed_at || null,
          closeReason: period.close_reason || null,
        } : null,
        nextOpenPeriod: nextOpenPeriod ? {
          id: nextOpenPeriod.id,
          fiscalYear: nextOpenPeriod.fiscal_year,
          periodNumber: nextOpenPeriod.period_number,
          startsOn: nextOpenPeriod.starts_on,
          endsOn: nextOpenPeriod.ends_on,
          status: nextOpenPeriod.status,
        } : null,
        requiresHumanDecision: true,
        mutatesAccounting: false,
      },
    },
  );
}

async function inspectPeriodLock(client, { organisationId, entryDate, operation }) {
  const orgId = organisationValue(organisationId);
  if (!entryDate) {
    throw Object.assign(new Error("Une date comptable est obligatoire."), {
      statusCode: 400,
      code: "accounting_period.entry_date_required",
    });
  }

  const periodResult = await client.query(
    `SELECT *
       FROM accounting_periods
      WHERE organisation_id=$1
        AND $2::date BETWEEN starts_on AND ends_on
      ORDER BY starts_on
      LIMIT 1`,
    [orgId, entryDate],
  );
  const period = periodResult.rows[0] || null;

  if (!period) {
    return {
      allowed: false,
      code: "accounting_period.not_configured",
      operation,
      entryDate,
      period: null,
      nextOpenPeriod: null,
      requiresHumanDecision: true,
      mutatesAccounting: false,
    };
  }

  if (period.status !== "closed") {
    return {
      allowed: true,
      code: "accounting_period.open",
      operation,
      entryDate,
      period,
      nextOpenPeriod: null,
      requiresHumanDecision: false,
      mutatesAccounting: false,
    };
  }

  const nextResult = await client.query(
    `SELECT *
       FROM accounting_periods
      WHERE organisation_id=$1
        AND status='open'
        AND starts_on > $2::date
      ORDER BY starts_on
      LIMIT 1`,
    [orgId, period.ends_on],
  );

  return {
    allowed: false,
    code: "accounting_period.closed",
    operation,
    entryDate,
    period,
    nextOpenPeriod: nextResult.rows[0] || null,
    requiresHumanDecision: true,
    mutatesAccounting: false,
  };
}

async function assertOpenAccountingPeriod(client, input) {
  const inspection = await inspectPeriodLock(client, input);
  if (inspection.allowed) return inspection;
  if (inspection.code === "accounting_period.not_configured") {
    throw Object.assign(new Error("Aucune période comptable ne couvre cette date."), {
      statusCode: 409,
      code: inspection.code,
      details: inspection,
    });
  }
  throw periodLockError(inspection);
}

module.exports = {
  inspectPeriodLock,
  assertOpenAccountingPeriod,
  periodLockError,
};
