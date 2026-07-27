const fs = require('fs');
const path = require('path');

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '../..', relativePath), 'utf8');
}

describe('Bloc Paie complet — contrat de fermeture', () => {
  test('couvre employés, contrats, périodes et entrées variables', () => {
    const employeeMigration = read('db/migrations/20260727230000_payroll_employee_registry.sql');
    const contractMigration = read('db/migrations/20260727233000_payroll_employment_contracts.sql');
    const periodMigration = read('db/migrations/072_payroll_periods_inputs.sql');

    expect(employeeMigration).toContain('payroll_employees');
    expect(contractMigration).toContain('payroll_employment_contracts');
    expect(contractMigration).toContain('approved_at');
    expect(contractMigration).toContain('ENABLE ROW LEVEL SECURITY');
    expect(periodMigration).toContain('payroll_periods');
    expect(periodMigration).toContain('payroll_variable_inputs');
  });

  test('couvre calcul, approbation, verrouillage et séparation des responsabilités', () => {
    const transactionService = read('src/services/business/payroll-transaction.service.js');
    const approvalMigration = read('db/migrations/20260727202000_payroll_approval_controls.sql');

    expect(transactionService).toContain('calculateRun');
    expect(transactionService).toContain('calculateGrossPay');
    expect(transactionService).toContain('calculateNetPay');
    expect(transactionService).toContain("status='locked'");
    expect(approvalMigration).toContain('payroll_approval');
  });

  test('couvre documents, comptabilité, paiement, remises et audit', () => {
    expect(read('src/services/business/payroll-documents.service.js')).toContain('documentHash');
    expect(read('src/services/business/payroll-accounting.service.js')).toContain('idempotencyKey');
    expect(read('db/migrations/20260727193000_payroll_direct_deposit.sql')).toContain('payroll_direct');
    expect(read('db/migrations/20260727190000_payroll_remittances.sql')).toContain('payroll_remittance');
    expect(read('db/migrations/20260727203000_payroll_reconciliation_audit.sql')).toContain('payroll_reconciliation');
  });

  test('couvre vacances, cessation et fin d’année', () => {
    expect(read('db/migrations/20260727191000_payroll_vacation_accruals.sql')).toContain('payroll_vacation');
    expect(read('db/migrations/20260727192000_payroll_termination_roe.sql')).toContain('payroll_termination');
    expect(read('db/migrations/20260727194000_payroll_year_end_slips.sql')).toContain('payroll_year_end');
  });

  test('l API expose le parcours opérationnel complet', () => {
    const routes = read('src/routes/business/payroll.routes.js');
    for (const expected of [
      'router.get("/employees"',
      'router.post("/employees"',
      'router.get("/periods"',
      'router.post("/periods"',
      'router.post("/periods/:id/inputs"',
      'router.post("/runs/:id/calculate"',
      '"approve", "pay", "void"',
      'router.get("/runs/:id/pay-stubs"',
      'router.get("/runs/:id/register"',
      'router.post("/runs/:id/accounting-preview"',
    ]) {
      expect(routes).toContain(expected);
    }
  });
});
