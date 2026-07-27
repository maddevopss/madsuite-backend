function money(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function buildPayrollPosting({ grossPay, employeeDeductions, employerContributions, netPay, accounts }) {
  const gross = money(grossPay);
  const deductions = money(employeeDeductions);
  const employer = money(employerContributions);
  const net = money(netPay);
  if (money(gross - deductions) !== net) throw new Error('La paie nette ne concorde pas avec le brut et les retenues.');

  const lines = [
    { accountId: accounts.wageExpense, debit: gross, credit: 0, label: 'Salaires bruts' },
    { accountId: accounts.employerExpense, debit: employer, credit: 0, label: 'Charges employeur' },
    { accountId: accounts.netPayable, debit: 0, credit: net, label: 'Paie nette à payer' },
    { accountId: accounts.deductionsPayable, debit: 0, credit: deductions, label: 'Retenues à remettre' },
    { accountId: accounts.employerPayable, debit: 0, credit: employer, label: 'Charges employeur à remettre' },
  ];
  return { lines, debitTotal: money(gross + employer), creditTotal: money(net + deductions + employer) };
}

module.exports = { buildPayrollPosting };
