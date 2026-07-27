const { buildPayrollPosting } = require('../services/business/payroll-posting.service');

const accounts = { wageExpense: 1, employerExpense: 2, netPayable: 3, deductionsPayable: 4, employerPayable: 5 };

describe('payroll accounting posting', () => {
  test('creates a balanced journal', () => {
    const result = buildPayrollPosting({ grossPay: 1000, employeeDeductions: 250, employerContributions: 120, netPay: 750, accounts });
    expect(result.debitTotal).toBe(1120);
    expect(result.creditTotal).toBe(1120);
  });

  test('rejects an inconsistent net pay', () => {
    expect(() => buildPayrollPosting({ grossPay: 1000, employeeDeductions: 250, employerContributions: 120, netPay: 700, accounts })).toThrow('ne concorde pas');
  });
});
