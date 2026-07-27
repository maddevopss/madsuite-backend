function cents(value) {
  return Math.round(Number(value || 0) * 100);
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
    description: `Paie du ${run.period_start} au ${run.period_end}`,
    lines: [
      { accountId: expenseAccountId, debit: gross / 100, credit: 0, memo: "Charge salariale brute" },
      { accountId: contributionExpenseAccountId, debit: employer / 100, credit: 0, memo: "Contributions employeur" },
      { accountId: payableAccountId, debit: 0, credit: net / 100, memo: "Salaire net à payer" },
      { accountId: deductionLiabilityAccountId, debit: 0, credit: deductions / 100, memo: "Retenues à remettre" },
      { accountId: contributionLiabilityAccountId, debit: 0, credit: employer / 100, memo: "Contributions à remettre" },
    ].filter((line) => line.debit || line.credit),
  };
}

module.exports = { buildPayrollJournal };
