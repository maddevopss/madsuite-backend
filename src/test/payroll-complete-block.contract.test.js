const { calculateGrossPay } = require("../services/business/payroll-gross-calculation.service");
const { calculateNetPay } = require("../services/business/payroll-deductions.service");
const { buildPayrollJournal } = require("../services/business/payroll-accounting.service");
const { buildPayStub } = require("../services/business/payroll-documents.service");

describe("Bloc paie complet #318", () => {
  test("calcule et explique une paie horaire avec temps supplémentaire", () => {
    const gross = calculateGrossPay({
      employee: { pay_type: "hourly", hourly_rate: 25 },
      inputs: [
        { input_type: "regular_hours", quantity: 80 },
        { input_type: "overtime_hours", quantity: 5 },
        { input_type: "bonus", amount: 100 },
        { input_type: "reimbursement", amount: 40 },
      ],
      rules: { overtimeMultiplier: 1.5 },
    });
    expect(gross.grossPay).toBe(2287.5);
    expect(gross.payableBeforeDeductions).toBe(2327.5);

    const net = calculateNetPay({
      grossPay: gross.grossPay,
      reimbursements: gross.reimbursements,
      payDate: "2026-07-31",
      employeeDeductions: [{ code: "TEST", rate: 0.1, version: "2026", effectiveFrom: "2026-01-01" }],
      employerContributions: [{ code: "EMP", rate: 0.05, version: "2026", effectiveFrom: "2026-01-01" }],
    });
    expect(net.netPay).toBe(2098.75);
  });

  test("produit une écriture équilibrée et idempotente", () => {
    const journal = buildPayrollJournal({
      run: { id: 42, organisation_id: 7, period_start: "2026-07-01", period_end: "2026-07-15", totals: { gross: 2000, deductions: 300, employerContributions: 100, net: 1700 } },
      expenseAccountId: 1,
      payableAccountId: 2,
      deductionLiabilityAccountId: 3,
      contributionExpenseAccountId: 4,
      contributionLiabilityAccountId: 5,
    });
    const debit = journal.lines.reduce((sum, line) => sum + line.debit, 0);
    const credit = journal.lines.reduce((sum, line) => sum + line.credit, 0);
    expect(debit).toBe(credit);
    expect(journal.idempotencyKey).toBe("payroll-run:7:42:v1");
  });

  test("génère un talon vérifiable", () => {
    const stub = buildPayStub({
      organisationId: 7,
      run: { id: 42, period_start: "2026-07-01", period_end: "2026-07-15", pay_date: "2026-07-18" },
      line: { gross_pay: 2000, deductions: { TEST: 300 }, employer_contributions: { EMP: 100 }, net_pay: 1700, ruleset_version: "2026.1", calculation_checksum: "abc" },
      employee: { id: 9, employee_number: "E-009", legal_name: "Employé test" },
      generatedBy: 1,
    });
    expect(stub.documentChecksum).toMatch(/^[a-f0-9]{64}$/);
    expect(stub.netPay).toBe(1700);
  });
});
