const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function exists(relativePath) {
  return fs.existsSync(path.join(ROOT, relativePath));
}

describe('Bloc Paie complet — contrat de fermeture', () => {
  test.each([
    'db/migrations/20260727230000_payroll_employee_registry.sql',
    'db/migrations/20260727232000_payroll_employment_contracts.sql',
    'db/migrations/072_payroll_periods_inputs.sql',
    'db/migrations/072_payroll_transactional_core.sql',
    'db/migrations/20260727202000_payroll_approval_controls.sql',
    'db/migrations/20260727190000_payroll_remittances.sql',
    'db/migrations/20260727191000_payroll_vacation_accruals.sql',
    'db/migrations/20260727192000_payroll_termination_roe.sql',
    'db/migrations/20260727193000_payroll_direct_deposit.sql',
    'db/migrations/20260727194000_payroll_year_end_slips.sql',
    'db/migrations/20260727203000_payroll_reconciliation_audit.sql',
  ])('la migration %s est présente', (file) => {
    expect(exists(file)).toBe(true);
  });

  test.each([
    ['db/migrations/20260727232000_payroll_employment_contracts.sql', /payroll_employment_contracts/],
    ['db/migrations/072_payroll_periods_inputs.sql', /CREATE TABLE IF NOT EXISTS payroll_periods/],
    ['db/migrations/072_payroll_periods_inputs.sql', /CREATE TABLE IF NOT EXISTS payroll_variable_inputs/],
    ['db/migrations/072_payroll_transactional_core.sql', /ALTER TABLE payroll_runs/],
    ['db/migrations/072_payroll_transactional_core.sql', /CREATE TABLE IF NOT EXISTS payroll_payments/],
  ])('%s contient la fondation attendue', (file, pattern) => {
    expect(read(file)).toMatch(pattern);
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

  test.each([
    '/employees',
    '/periods',
    '/periods/:id/inputs',
    '/runs/:id/calculate',
    '/runs/:id/pay-stubs',
    '/runs/:id/register',
    '/runs/:id/accounting-preview',
  ])('l API expose %s', (route) => {
    expect(read('src/routes/business/payroll.routes.js')).toContain(route);
  });

  test('l API expose les transitions et la portée organisationnelle', () => {
    const routes = read('src/routes/business/payroll.routes.js');
    expect(routes).toContain('approve');
    expect(routes).toContain('pay');
    expect(routes).toContain('void');
    expect(routes).toContain('organisation_id=$1');
  });

  test.each([
    ['db/migrations/20260727230000_payroll_employee_registry.sql', /ENABLE ROW LEVEL SECURITY/],
    ['db/migrations/20260727232000_payroll_employment_contracts.sql', /ENABLE ROW LEVEL SECURITY/],
    ['db/migrations/072_payroll_periods_inputs.sql', /ALTER TABLE payroll_periods ENABLE ROW LEVEL SECURITY/],
    ['db/migrations/072_payroll_periods_inputs.sql', /ALTER TABLE payroll_variable_inputs ENABLE ROW LEVEL SECURITY/],
    ['db/migrations/072_payroll_periods_inputs.sql', /CREATE TRIGGER payroll_inputs_lock_guard/],
    ['db/migrations/072_payroll_periods_inputs.sql', /prevent_locked_payroll_input_change/],
    ['db/migrations/072_payroll_transactional_core.sql', /uq_payroll_runs_idempotency/],
    ['db/migrations/072_payroll_transactional_core.sql', /UNIQUE \(organisation_id, idempotency_key\)/],
  ])('%s contient le contrôle attendu', (file, pattern) => {
    expect(read(file)).toMatch(pattern);
  });
});
