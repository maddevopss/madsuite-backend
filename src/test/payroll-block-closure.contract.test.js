const fs = require('fs');
const path = require('path');

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '../..', relativePath), 'utf8');
}

function expectFile(relativePath) {
  expect(fs.existsSync(path.join(__dirname, '../..', relativePath))).toBe(true);
}

describe('Bloc Paie complet — contrat de fermeture', () => {
  test('les fondations de données du cycle complet sont présentes', () => {
    for (const file of [
      'db/migrations/20260727230000_payroll_employee_registry.sql',
      'db/migrations/20260727233000_payroll_employment_contracts.sql',
      'db/migrations/072_payroll_periods_inputs.sql',
      'db/migrations/072_payroll_transactional_core.sql',
      'db/migrations/20260727202000_payroll_approval_controls.sql',
      'db/migrations/20260727190000_payroll_remittances.sql',
      'db/migrations/20260727191000_payroll_vacation_accruals.sql',
      'db/migrations/20260727192000_payroll_termination_roe.sql',
      'db/migrations/20260727193000_payroll_direct_deposit.sql',
      'db/migrations/20260727194000_payroll_year_end_slips.sql',
      'db/migrations/20260727203000_payroll_reconciliation_audit.sql',
    ]) expectFile(file);

    expect(read('db/migrations/20260727233000_payroll_employment_contracts.sql')).toContain('payroll_employment_contracts');
    expect(read('db/migrations/072_payroll_periods_inputs.sql')).toContain('payroll_variable_inputs');
    expect(read('db/migrations/072_payroll_transactional_core.sql')).toContain('payroll_runs');
  });

  test('les services de calcul, comptabilité et documents sont reliés', () => {
    const transaction = require('../services/business/payroll-transaction.service');
    const accounting = require('../services/business/payroll-accounting.service');
    const documents = require('../services/business/payroll-documents.service');

    expect(typeof transaction.calculateRun).toBe('function');
    expect(typeof transaction.transitionRun).toBe('function');
    expect(typeof accounting.buildPayrollJournal).toBe('function');
    expect(typeof documents.buildPayStub).toBe('function');
    expect(typeof documents.buildPayrollRegister).toBe('function');
  });

  test('l API expose le parcours opérationnel complet', () => {
    const routes = read('src/routes/business/payroll.routes.js');
    for (const expected of [
      '/employees',
      '/periods',
      '/periods/:id/inputs',
      '/runs/:id/calculate',
      '/runs/:id/pay-stubs',
      '/runs/:id/register',
      '/runs/:id/accounting-preview',
    ]) expect(routes).toContain(expected);

    expect(routes).toContain('approve');
    expect(routes).toContain('pay');
    expect(routes).toContain('void');
    expect(routes).toContain('organisation_id=$1');
  });

  test('les contrôles de sécurité et d immutabilité sont présents', () => {
    expect(read('db/migrations/20260727230000_payroll_employee_registry.sql')).toContain('ENABLE ROW LEVEL SECURITY');
    expect(read('db/migrations/20260727233000_payroll_employment_contracts.sql')).toContain('ENABLE ROW LEVEL SECURITY');
    expect(read('db/migrations/072_payroll_periods_inputs.sql')).toContain('prevent_locked_payroll_input_change');
    expect(read('src/services/business/payroll-accounting.service.js')).toContain('idempotencyKey');
  });
});
