const { recordPostedEntry } = require("./accounting-sync.service");

function cents(value) {
  return Math.round(Number(value || 0) * 100);
}

function dateOnly(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString().slice(0, 10);
}

function buildPayrollJournal({ run, expenseAccountId, payableAccountId, deductionLiabilityAccountId, contributionExpenseAccountId, contributionLiabilityAccountId }) {
  if (!run?.id || !run?.totals) throw Object.assign(new Error("Cycle de paie calculé requis."), { statusCode: 400 });
  const gross = cents(run.totals.gross);
  const deductions = cents(run.totals.deductions);
  const employer = cents(run.totals.employerContributions);
  const net = cents(run.totals.net);
  const debit = gross + employer;
  const credit = net + deductions + employer;
  if (debit !== credit) throw Object.assign(new Error("L’écriture de paie n’est pas équilibrée."), { statusCode: 409 });

  return {
    sourceType: "payroll_run",
    sourceId: String(run.id),
    idempotencyKey: `payroll-run:${run.organisation_id}:${run.id}:v1`,
    description: `Paie du ${dateOnly(run.period_start)} au ${dateOnly(run.period_end)}`,
    lines: [
      { accountId: expenseAccountId, debit: gross / 100, credit: 0, description: "Charge salariale brute" },
      { accountId: contributionExpenseAccountId, debit: employer / 100, credit: 0, description: "Contributions employeur" },
      { accountId: payableAccountId, debit: 0, credit: net / 100, description: "Salaire net à payer" },
      { accountId: deductionLiabilityAccountId, debit: 0, credit: deductions / 100, description: "Retenues à remettre" },
      { accountId: contributionLiabilityAccountId, debit: 0, credit: employer / 100, description: "Contributions à remettre" },
    ].filter((line) => line.debit || line.credit),
  };
}

// Publie réellement l'écriture de paie (draft → lignes → posted, via le même
// primitive que les factures/paiements/dépenses) et rapproche le cycle avec elle.
// jusqu'ici buildPayrollJournal ne servait qu'à un aperçu jamais persisté.
async function postPayrollJournal(client, {
  organisationId,
  run,
  userId,
  expenseAccountId,
  payableAccountId,
  deductionLiabilityAccountId,
  contributionExpenseAccountId,
  contributionLiabilityAccountId,
}) {
  const journal = buildPayrollJournal({
    run,
    expenseAccountId,
    payableAccountId,
    deductionLiabilityAccountId,
    contributionExpenseAccountId,
    contributionLiabilityAccountId,
  });

  const result = await recordPostedEntry(client, {
    organisationId,
    userId,
    journalCode: "PAI",
    journalName: "Journal de paie",
    journalType: "payroll",
    entryNumber: `PAI-RUN-${run.id}`,
    entryDate: run.pay_date,
    description: journal.description,
    sourceType: journal.sourceType,
    sourceId: journal.sourceId,
    lines: journal.lines,
  });

  if (!result.duplicate) {
    await client.query(
      `UPDATE payroll_runs SET accounting_entry_id=$3 WHERE organisation_id=$1 AND id=$2`,
      [organisationId, run.id, result.entryId],
    );
  }

  return result;
}

module.exports = { buildPayrollJournal, postPayrollJournal };
