const buildPayrollJournalEntry = ({ payrollRunId, payDate, grossCents, deductionTotalCents, employerContributionTotalCents, netCents, accounts }) => {
  const debitTotal = Number(grossCents) + Number(employerContributionTotalCents);
  const creditTotal = Number(netCents) + Number(deductionTotalCents) + Number(employerContributionTotalCents);
  if (debitTotal !== creditTotal) throw new Error("PAYROLL_ACCOUNTING_ENTRY_UNBALANCED");
  return Object.freeze({
    referenceType: "payroll_run",
    referenceId: payrollRunId,
    entryDate: payDate,
    idempotencyKey: `payroll-journal:${payrollRunId}`,
    lines: Object.freeze([
      { accountCode: accounts.wagesExpense, debitCents: Number(grossCents), creditCents: 0 },
      { accountCode: accounts.employerExpense, debitCents: Number(employerContributionTotalCents), creditCents: 0 },
      { accountCode: accounts.payrollPayable, debitCents: 0, creditCents: Number(netCents) },
      { accountCode: accounts.deductionsPayable, debitCents: 0, creditCents: Number(deductionTotalCents) + Number(employerContributionTotalCents) },
    ]),
  });
};

module.exports = { buildPayrollJournalEntry };
